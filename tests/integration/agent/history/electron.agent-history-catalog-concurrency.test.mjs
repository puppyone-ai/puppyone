import { createAgentEventEnvelope } from "../../../../electron/main/agent/agent-events.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConversationCatalog } from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { assertAgentIpcResponse, parseAgentIpcRequest } from "../../../../shared/agent-contract/schema.mjs";
import { createAgentHistoryQueries } from "../../../../electron/main/agent/application/history/agent-history-queries.mjs";

const directories = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

describe("History catalog transaction and identity", () => {
  it("allocates one product id under concurrent discovery and after restart", async () => {
    const { catalog, filePath } = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => catalog.upsertNative(record("native/a"))));
    expect(new Set(results.map((entry) => entry.sessionId)).size).toBe(1);
    expect(await catalog.list()).toHaveLength(1);
    const next = await createAgentConversationCatalog({ filePath }).upsertNative(record("native/a"));
    expect(next.sessionId).toBe(results[0].sessionId);
  });

  it("shares first load between all readers and writers instead of observing a temporary empty catalog", async () => {
    const { catalog, filePath } = await fixture();
    const initial = await catalog.upsertNative(record("existing"));
    const realRead = fs.promises.readFile.bind(fs.promises);
    const gate = deferred();
    vi.spyOn(fs.promises, "readFile").mockImplementationOnce(async (...args) => {
      const contents = await realRead(...args);
      await gate.promise;
      return contents;
    });
    const restarted = createAgentConversationCatalog({ filePath });
    const read = restarted.findById(initial.sessionId);
    let writeFinished = false;
    const write = restarted.upsertNative(record("new")).then((value) => { writeFinished = true; return value; });
    await Promise.resolve();
    expect(writeFinished).toBe(false);
    gate.resolve();
    await expect(read).resolves.toMatchObject({ providerSessionId: "existing" });
    await write;
    const memory = await restarted.list();
    const disk = await createAgentConversationCatalog({ filePath }).list();
    expect(memory).toEqual(disk);
    expect(memory.map((entry) => entry.providerSessionId).sort()).toEqual(["existing", "new"]);
  });

  it("preserves archive, selections and live observations while refreshing native metadata", async () => {
    const { catalog } = await fixture();
    const original = await catalog.upsertNative(record("native"));
    await catalog.save({ ...original, selectedModel: "chosen-model", terminalState: "running", lastSequence: 42 });
    await catalog.archive(original.sessionId, "2026-09-02T00:00:00.000Z");
    await catalog.upsertNative({ ...record("native"), title: "New native title", selectedModel: "old-model",
      archivedAt: null, lastSequence: 0, terminalState: "idle" });
    expect(await catalog.list()).toEqual([]);
    await expect(catalog.findById(original.sessionId)).resolves.toMatchObject({ title: "New native title",
      archivedAt: "2026-09-02T00:00:00.000Z", selectedModel: "chosen-model", terminalState: "running", lastSequence: 42 });
  });

  it("does not hide records created or confirmed after the scan began, even with identical timestamps", async () => {
    const { catalog } = await fixture();
    const sameDate = "2026-09-01T00:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(sameDate);
    const existing = await catalog.upsertNative(record("confirmed"));
    const stale = await catalog.upsertNative(record("stale"));
    const startedRevision = await catalog.getRevision();
    await catalog.upsertNative(record("confirmed"));
    const created = await catalog.upsertNative(record("created"));
    await catalog.applyNativePage({ entries: [], reconcileMissing: true,
      scope: { workspaceRoot: "/workspace", runtimeId: "codex", providerSessionIds: [], startedRevision } });
    await expect(catalog.findById(existing.sessionId)).resolves.toMatchObject({ availability: "available" });
    await expect(catalog.findById(created.sessionId)).resolves.toMatchObject({ availability: "available" });
    await expect(catalog.findById(stale.sessionId)).resolves.toMatchObject({ availability: "unavailable" });
  });

  it("rolls back the whole page on validation or disk replacement failure", async () => {
    const { catalog, filePath } = await fixture();
    await catalog.upsertNative(record("existing"));
    const before = await fs.promises.readFile(filePath, "utf8");
    await expect(catalog.applyNativePage({ entries: [record("good"), record("invalid id")], scope: {} })).rejects.toThrow();
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("disk write failed"));
    await expect(catalog.applyNativePage({ entries: [record("good")], scope: {} })).rejects.toThrow(/disk write failed/);
    expect(await fs.promises.readFile(filePath, "utf8")).toBe(before);
    expect((await catalog.list()).map((entry) => entry.providerSessionId)).toEqual(["existing"]);
    expect(await fs.promises.readdir(path.dirname(filePath))).toEqual(["catalog.json"]);
    await catalog.upsertNative(record("retry"));
    expect(await catalog.list()).toHaveLength(2);
  });

  it("serves the last committed catalog while a disk write is still settling", async () => {
    const { catalog } = await fixture();
    await catalog.upsertNative(record("existing"));
    const originalRename = fs.promises.rename.bind(fs.promises);
    const gate = deferred();
    const rename = vi.spyOn(fs.promises, "rename").mockImplementationOnce(async (...args) => {
      await gate.promise;
      return originalRename(...args);
    });
    const write = catalog.upsertNative(record("pending"));
    await vi.waitFor(() => expect(rename).toHaveBeenCalled());
    expect((await catalog.list()).map((entry) => entry.providerSessionId)).toEqual(["existing"]);
    gate.resolve();
    await write;
    expect(await catalog.list()).toHaveLength(2);
  });

  it.each(["invalid JSON", JSON.stringify({ version: 1, records: [{}] })])("preserves malformed stored data rather than overwriting it (%s)", async (contents) => {
    const { filePath } = await fixture();
    await fs.promises.writeFile(filePath, contents);
    const catalog = createAgentConversationCatalog({ filePath, logger: { warn: vi.fn() } });
    await expect(catalog.list()).rejects.toThrow();
    await expect(catalog.upsertNative(record("new"))).rejects.toThrow();
    expect(await fs.promises.readFile(filePath, "utf8")).toBe(contents);
  });

  it("partitions native identity and reconciliation by source as well as workspace and runtime", async () => {
    const { catalog } = await fixture();
    const a = await catalog.upsertNative({ ...record("same"), sourceScopeId: "profile-a" });
    const b = await catalog.upsertNative({ ...record("same"), sourceScopeId: "profile-b" });
    expect(a.sessionId).not.toBe(b.sessionId);
    await catalog.reconcileNative({ workspaceRoot: "/workspace", runtimeId: "codex", sourceScopeId: "profile-a", providerSessionIds: [] });
    await expect(catalog.findById(b.sessionId)).resolves.toMatchObject({ availability: "available" });
    await expect(catalog.findById(a.sessionId)).resolves.toMatchObject({ availability: "unavailable" });
  });

  it("uses the same native ID rules through query, persistence and IPC", async () => {
    const { catalog } = await fixture();
    const nativeId = `profile/${"a".repeat(500)}`;
    await catalog.upsertNative(record(nativeId));
    const queries = createAgentHistoryQueries({ catalog });
    const result = await queries.listSessions(null, {}, "/workspace");
    expect(assertAgentIpcResponse("agent:sessions-list", result).sessions[0].providerSessionId).toBe(nativeId);
    expect(createAgentEventEnvelope({ sequence: 1, sessionId: "product-id", runtimeId: "codex",
      providerSessionId: nativeId, type: "assistant.completed", payload: { text: "Restored answer" },
    }).providerSessionId).toBe(nativeId);
  });

  it("preserves opaque cursor bytes across both IPC directions", () => {
    const cursor = "  native cursor  ";
    expect(parseAgentIpcRequest("agent:sessions-list", { rootPath: "/workspace", runtimeId: "codex", cursor, scanId: "scan-a" }).cursor).toBe(cursor);
    expect(assertAgentIpcResponse("agent:sessions-list", { sessions: [], discovery: {
      runtimeId: "codex", status: "partial", indexed: 0, nextCursor: cursor, scanId: "scan-a", warnings: [],
    }, warnings: [] }).discovery.nextCursor).toBe(cursor);
  });

  it("retains identity metadata independently of catalog page capacity", async () => {
    const { catalog, filePath } = await fixture({ maxRecords: 1 });
    await catalog.upsertNative(record("a"));
    const result = await catalog.applyNativePage({ entries: [record("b")], scope: {} });
    expect(result.truncated).toBe(false);
    expect(await catalog.getCoverage()).toEqual({ truncated: false, capacity: 1, retained: 2 });
    expect(await createAgentConversationCatalog({ filePath }).getCoverage()).toMatchObject({ truncated: false, retained: 2 });
  });
});

function record(providerSessionId) { return { workspaceRoot: "/workspace", runtimeId: "codex", providerSessionId,
  title: "Conversation", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }; }
async function fixture(options = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-history-catalog-"));
  directories.push(directory);
  const filePath = path.join(directory, "catalog.json");
  return { filePath, catalog: createAgentConversationCatalog({ filePath, ...options }) };
}
function deferred() { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; }
