import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConversationCatalog } from "../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentSessionRepository } from "../electron/main/agent/persistence/agent-session-repository.mjs";
import { createEphemeralAgentSessionCache } from "../electron/main/agent/cache/ephemeral-agent-session-cache.mjs";
import { createAgentService } from "../electron/main/agent/application/agent-service.mjs";
import { AgentRuntimeRegistry } from "../electron/main/agent/runtime/agent-runtime-registry.mjs";
import { createCodexRuntimeDefinition } from "../electron/main/agent/runtimes/codex/codex-runtime-definition.mjs";
import { codexHistorySource } from "../electron/main/agent/runtimes/codex/codex-history-source.mjs";
import { claudeHistorySource } from "../electron/main/agent/runtimes/claude/claude-history-source.mjs";
import { piHistorySource } from "../electron/main/agent/runtimes/pi/pi-history-source.mjs";
import { createSender } from "./helpers/agentServiceHarness.mjs";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const date = "2026-01-01T00:00:00.000Z";
const metadata = (id = "native-1") => ({ workspaceRoot: "/workspace", runtimeId: "codex", providerSessionId: id,
  title: "History", createdAt: date, updatedAt: date });

async function catalog(maxRecords = 2) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-identity-test-"));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "catalog.json");
  return { filePath, catalog: createAgentConversationCatalog({ filePath, maxRecords }) };
}

async function service({ source = "default", create, hydrate, store: persistedStore } = {}) {
  const store = persistedStore ?? await catalog();
  const adapters = [];
  const definition = createCodexRuntimeDefinition({ discovery: { discover: async () => ({
    runtimeId: "codex", status: "ready", code: "READY", executablePath: "/usr/bin/fake", environment: {},
  }) }, adapterFactory: (options) => {
    let id = "native-1";
    const adapter = {
      options,
      inspect: async () => ({ account: { account: { type: "test" }, requiresOpenaiAuth: false },
        models: [{ id: "model", model: "model", displayName: "Model", isDefault: true }], capabilities: {} }),
      createSession: vi.fn(async () => { await create?.(options); return { ...metadata(), model: "model" }; }),
      resumeSession: vi.fn(async ({ threadId }) => { id = threadId; return { ...metadata(id), model: "model" }; }),
      getSessionHistoryPort: () => ({ sourceScopeId: source, hydrate: async () => hydrate
        ? hydrate(options, id) : { providerSessionId: id, events: [], coverage: "complete" } }),
      startTurn: async () => { options.onEvent({ type: "turn.started", providerSessionId: id, turnId: "turn-1", payload: {} }); return { turnId: "turn-1" }; },
      interruptTurn() {}, dispose: vi.fn(),
    };
    adapters.push(adapter);
    return adapter;
  } });
  const registry = new AgentRuntimeRegistry([definition]);
  const repository = createAgentSessionRepository({ eventCache: createEphemeralAgentSessionCache(), conversationCatalog: store.catalog });
  const api = createAgentService({ runtimeRegistry: registry, sessionCache: repository, conversationCatalog: store.catalog, logger: { warn: vi.fn() } });
  cleanups.push(() => api.closeAll());
  return { ...store, api, adapters, registry };
}

describe("Agent history identity and opening boundaries", () => {
  it("keeps every product id across catalog page limits and process restarts", async () => {
    const h = await catalog();
    const saved = [];
    for (let index = 0; index < 5; index++) saved.push(await h.catalog.upsertNative(metadata(`native-${index}`)));
    const restarted = createAgentConversationCatalog({ filePath: h.filePath, maxRecords: 2 });
    expect((await restarted.upsertNative(metadata("native-0"))).sessionId).toBe(saved[0].sessionId);
    const ids = [];
    let cursor;
    do {
      const page = await restarted.listPage("/workspace", { cursor });
      expect(page.sessions.length).toBeLessThanOrEqual(2);
      ids.push(...page.sessions.map((entry) => entry.sessionId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids)).toEqual(new Set(saved.map((entry) => entry.sessionId)));
    expect(await restarted.findById(saved[0].sessionId, "/workspace")).not.toBeNull();
    expect(await restarted.getCoverage()).toMatchObject({ truncated: false, retained: 5 });
    const page = await restarted.listPage("/workspace");
    await expect(restarted.listPage("/another", { cursor: page.nextCursor })).rejects.toThrow(/cursor/);
  });

  it("bounds both visible rows and explicit exclusions without deleting identity", async () => {
    const h = await catalog();
    const saved = [];
    for (let i = 0; i < 7; i++) saved.push(await h.catalog.upsertNative(metadata(`native-${i}`)));
    for (const row of saved.slice(0, 5)) await h.catalog.archive(row.sessionId);
    let cursor;
    const visible = [], excluded = [];
    do {
      const page = await h.catalog.listPage("/workspace", { cursor });
      expect(page.sessions.length + page.excludedSessionIds.length).toBeLessThanOrEqual(2);
      visible.push(...page.sessions.map((entry) => entry.sessionId));
      excluded.push(...page.excludedSessionIds);
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(visible)).toEqual(new Set(saved.slice(5).map((row) => row.sessionId)));
    expect(new Set(excluded)).toEqual(new Set(saved.slice(0, 5).map((row) => row.sessionId)));
    expect(await h.catalog.findById(saved[0].sessionId)).not.toBeNull();
    expect((await h.catalog.listPage("/workspace", { includeArchived: true })).excludedSessionIds).toEqual([]);
  });

  it("reserves identity independently of persistence and never rebinds a product id", async () => {
    const h = await catalog();
    const [reservation, discovery] = await Promise.all([
      h.catalog.bindNative({ ...metadata(), sessionId: "product-a", sourceScopeId: "profile-a" }),
      h.catalog.upsertNative({ ...metadata(), sourceScopeId: "profile-a" }),
    ]);
    expect(discovery.sessionId).toBe(reservation.sessionId);
    const other = await h.catalog.upsertNative({ ...metadata(), sourceScopeId: "profile-b" });
    expect(other.sessionId).not.toBe(reservation.sessionId);
    await expect(h.catalog.save({ ...metadata("another-native"), sessionId: reservation.sessionId, sourceScopeId: "profile-a" }))
      .rejects.toThrow(/rebound/);
  });

  it("adopts discovery's product id before publishing a newly created session", async () => {
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    const h = await service({ create: async ({ onEvent }) => {
      onEvent({ type: "session.started", providerSessionId: "native-1", payload: { title: "New" } });
      started.resolve();
      await release.promise;
    } });
    const pending = h.api.createSession(createSender(1), { runtimeId: "codex" }, "/workspace");
    await started.promise;
    const discovered = await h.catalog.upsertNative(metadata());
    release.resolve();
    const snapshot = await pending;
    expect(snapshot.session.id).toBe(discovered.sessionId);
    expect(snapshot.events.length).toBeGreaterThan(0);
    expect(snapshot.events.every((event) => event.sessionId === discovered.sessionId)).toBe(true);
    expect(h.api.getSessionCount()).toBe(1);
  });

  it("does not promote a start receipt and accepts only matching adapter persistence evidence", async () => {
    const h = await service();
    const owner = createSender(1);
    const created = await h.api.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await h.api.startTurn(owner, { sessionId: created.session.id, prompt: "Hello" }, "/workspace");
    const report = h.adapters[0].options.onSessionPersisted;
    report({ providerSessionId: "wrong", sourceScopeId: "default" });
    expect((await h.catalog.findById(created.session.id)).availability).toBe("unverified");
    report({ providerSessionId: "native-1", sourceScopeId: "other-profile" });
    expect(await h.catalog.list("/workspace")).toEqual([]);
    report({ providerSessionId: "native-1", sourceScopeId: "default" });
    await vi.waitFor(async () => expect((await h.catalog.findById(created.session.id)).availability).toBe("available"));
  });

  it("rejects a changed native profile before resuming anything", async () => {
    const h = await service({ source: "profile-b" });
    const saved = await h.catalog.upsertNative({ ...metadata(), sourceScopeId: "profile-a" });
    await expect(h.api.resumeSession(createSender(1), { sessionId: saved.sessionId, runtimeId: "codex" }, "/workspace"))
      .rejects.toThrow(/history source changed/);
    expect(h.adapters[0].resumeSession).not.toHaveBeenCalled();
    expect((await h.catalog.findById(saved.sessionId)).availability).toBe("available");
  });

  it("uses the same display JSON for partial history and flushes newer live observations after replay", async () => {
    const h = await service({ hydrate: async ({ onEvent }, id) => {
      onEvent({ type: "turn.completed", providerSessionId: id, turnId: "turn-1", payload: { status: "completed" } });
      return { providerSessionId: id, coverage: "partial", events: [
        { type: "turn.started", providerSessionId: id, turnId: "turn-1", payload: { restored: true, prompt: "Old" } },
        { type: "assistant.completed", providerSessionId: id, turnId: "turn-1", itemId: "answer", payload: { text: "Answer" } },
      ] };
    } });
    const saved = await h.catalog.upsertNative(metadata());
    const result = await h.api.openSession(createSender(1), { sessionId: saved.sessionId, runtimeId: "codex" }, "/workspace");
    expect(result.status).toBe("opened");
    expect(result.snapshot.session.historyCoverage).toBe("partial");
    expect(result.snapshot.display.history.coverage).toBe("partial");
    expect(result.snapshot.control.execution).toMatchObject({ status: "ended", nativeOutcome: "completed" });
    expect(result.snapshot.events.at(-2).type).toBe("turn.completed");
  });

  it("restores complete native history after a restart without treating old event numbers as lost messages", async () => {
    const first = await service();
    const owner = createSender(1);
    const created = await first.api.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await first.api.startTurn(owner, { sessionId: created.session.id, prompt: "Hello" }, "/workspace");
    first.adapters[0].options.onEvent({ type: "turn.completed", providerSessionId: "native-1", turnId: "turn-1", payload: { status: "completed" } });
    first.adapters[0].options.onSessionPersisted({ providerSessionId: "native-1", sourceScopeId: "default" });
    await first.api.closeAll();
    const persisted = await first.catalog.findById(created.session.id);
    expect(persisted.lastSequence).toBeGreaterThan(0);
    expect(persisted).not.toHaveProperty("events");

    const restarted = await service({ store: {
      filePath: first.filePath, catalog: createAgentConversationCatalog({ filePath: first.filePath }),
    }, hydrate: async (_options, id) => ({ providerSessionId: id, coverage: "complete", events: [
      { type: "turn.started", providerSessionId: id, turnId: "turn-1", payload: { restored: true, prompt: "Hello" } },
      { type: "assistant.completed", providerSessionId: id, turnId: "turn-1", itemId: "answer", payload: { text: "Hello back" } },
      { type: "turn.completed", providerSessionId: id, turnId: "turn-1", payload: { status: "completed" } },
    ] }) });
    const opened = await restarted.api.openSession(createSender(2), { sessionId: created.session.id, runtimeId: "codex" }, "/workspace");
    expect(opened.status).toBe("opened");
    expect(opened.snapshot.session.id).toBe(created.session.id);
    expect(opened.snapshot.events[0].sequence).toBeGreaterThan(persisted.lastSequence);
    expect(opened.snapshot.partial).toBe(true); // Local replay remains bounded; native content is complete.
    expect(opened.snapshot.display.history).toEqual({ coverage: "complete", reason: null });
    expect(opened.snapshot.display.displayWindow.truncated).toBe(false);
    expect(opened.snapshot.display.missingRanges).toEqual([]);
    expect(opened.snapshot.display.messages.map((message) => message.text)).toEqual(["Hello", "Hello back"]);
    expect(restarted.adapters[0].createSession).not.toHaveBeenCalled();
  });

  it("keeps the same saved target retryable after a transient history read failure", async () => {
    const hydrate = vi.fn().mockRejectedValueOnce(new Error("Native read timed out"))
      .mockImplementationOnce(async (_options, id) => ({ providerSessionId: id, events: [], coverage: "complete" }));
    const h = await service({ hydrate });
    const saved = await h.catalog.upsertNative(metadata());
    const request = { sessionId: saved.sessionId, runtimeId: "codex" };
    const owner = createSender(1);
    expect(await h.api.openSession(owner, request, "/workspace")).toMatchObject({
      status: "failed", error: { code: "HISTORY_READ_FAILED", retryable: true },
    });
    expect((await h.catalog.findById(saved.sessionId)).availability).toBe("available");
    expect(h.api.getSessionCount()).toBe(0);
    expect(await h.api.openSession(owner, request, "/workspace")).toMatchObject({
      status: "opened", snapshot: { session: { id: saved.sessionId, providerSessionId: saved.providerSessionId } },
    });
    expect(h.adapters.every((adapter) => adapter.createSession.mock.calls.length === 0)).toBe(true);
  });

  it("refuses another conversation's history and a live session from another workspace", async () => {
    const h = await service({ hydrate: async () => ({ providerSessionId: "wrong", coverage: "complete", events: [] }) });
    const saved = await h.catalog.upsertNative(metadata());
    expect((await h.api.openSession(createSender(1), { sessionId: saved.sessionId, runtimeId: "codex" }, "/workspace")).status).toBe("failed");
    const owner = createSender(2);
    const live = await h.api.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await expect(h.api.resumeSession(owner, { sessionId: live.session.id, runtimeId: "codex" }, "/wrong"))
      .rejects.toThrow(/workspace/i);
  });

  it.each([
    [codexHistorySource, "CODEX_HOME"], [claudeHistorySource, "CLAUDE_CONFIG_DIR"], [piHistorySource, "PI_CODING_AGENT_DIR"],
  ])("binds native namespaces to storage selectors without credential values (%s)", (source, key) => {
    const first = source({ HOME: os.homedir(), [key]: "/profiles/a", API_KEY: "secret-one" });
    const again = source({ HOME: os.homedir(), [key]: "/profiles/a", API_KEY: "secret-two" });
    const other = source({ HOME: os.homedir(), [key]: "/profiles/b" });
    expect(first.sourceScopeId).toBe(again.sourceScopeId);
    expect(first.sourceScopeId).not.toBe(other.sourceScopeId);
    expect(first.sourceScopeId).not.toContain("profiles");
  });
});
