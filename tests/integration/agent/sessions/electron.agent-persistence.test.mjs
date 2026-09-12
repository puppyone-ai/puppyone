import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentSessionCachePolicy,
  createEphemeralAgentSessionCache,
} from "../../../../electron/main/agent/cache/ephemeral-agent-session-cache.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.promises.rm(directory, { recursive: true, force: true })
  )));
});

describe("Desktop Agent ephemeral session cache", () => {
  it("keeps bounded redacted recovery events in memory only", async () => {
    const userData = await temporaryDirectory();
    const cache = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });

    await cache.save(record("session-1", [
      event(1, "command.output.delta", { delta: "AWS_SECRET_ACCESS_KEY=raw-secret" }),
      event(2, "tool.completed", { outputPreview: "CLIENT_SECRET=retained-secret" }),
      event(3, "usage.updated", { total: { inputTokens: 12, outputTokens: 4 } }),
    ]));

    const [stored] = await cache.readAll();
    expect(stored.events.map((entry) => entry.type)).toEqual(["tool.completed", "usage.updated"]);
    expect(JSON.stringify(stored)).not.toContain("raw-secret");
    expect(JSON.stringify(stored)).not.toContain("retained-secret");
    expect(stored.events[1].payload.total).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(await fs.promises.readdir(userData)).toEqual([]);
  });

  it("removes the legacy durable chat journal and never recreates it", async () => {
    const userData = await temporaryDirectory();
    const legacyPath = path.join(userData, agentSessionCachePolicy.legacyJournalFilename);
    const staleTemporaryPath = `${legacyPath}.12345.tmp`;
    await fs.promises.writeFile(legacyPath, JSON.stringify({ version: 3, sessions: [record("legacy", [])] }));
    await fs.promises.writeFile(staleTemporaryPath, JSON.stringify({ version: 3, sessions: [record("stale", [])] }));

    const cache = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });
    await expect(cache.readAll()).resolves.toEqual([]);
    await expect(fs.promises.access(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.promises.access(staleTemporaryPath)).rejects.toMatchObject({ code: "ENOENT" });

    await cache.save(record("current", []));
    await expect(fs.promises.access(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not restore conversations in a new application process cache", async () => {
    const userData = await temporaryDirectory();
    const first = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });
    await first.save(record("session-1", [event(1, "assistant.completed", { text: "private chat" })]));
    expect(await first.findLatest("/workspace", "codex")).toMatchObject({ sessionId: "session-1" });

    const restarted = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });
    await expect(restarted.findLatest("/workspace", "codex")).resolves.toBeNull();
    expect(agentSessionCachePolicy.durable).toBe(false);
  });

  it("supports process-local replacement and explicit removal for live recovery", async () => {
    const userData = await temporaryDirectory();
    const cache = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });
    await cache.save(record("session-1", []));
    await cache.save({ ...record("session-1", []), title: "Updated", updatedAt: "2026-01-01T00:00:02.000Z" });

    expect(await cache.readAll()).toEqual([expect.objectContaining({ sessionId: "session-1", title: "Updated" })]);
    await expect(cache.list("/workspace")).resolves.toEqual([]);
    await cache.remove("session-1");
    await expect(cache.findById("session-1", "/workspace")).resolves.toBeNull();
  });

  it("retains independent process-local recovery snapshots for same-workspace tabs", async () => {
    const userData = await temporaryDirectory();
    const cache = createEphemeralAgentSessionCache({ app: { getPath: () => userData } });

    await cache.save(record("session-1", [event(1, "assistant.completed", { text: "first" })]));
    await cache.save(record("session-2", [event(1, "assistant.completed", { text: "second" })]));

    await expect(cache.findById("session-1", "/workspace"))
      .resolves.toMatchObject({ sessionId: "session-1" });
    await expect(cache.findById("session-2", "/workspace"))
      .resolves.toMatchObject({ sessionId: "session-2" });
    expect(await cache.readAll()).toHaveLength(2);
  });
});

async function temporaryDirectory() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-session-cache-"));
  temporaryDirectories.push(directory);
  return directory;
}

function record(sessionId, events) {
  return {
    sessionId,
    workspaceRoot: "/workspace",
    runtimeId: "codex",
    runtime: { id: "codex", displayName: "Codex", kind: "native-cli" },
    providerSessionId: `thread-${sessionId}`,
    title: sessionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    terminalState: "idle",
    selectedModel: "gpt-5",
    lastSequence: events.at(-1)?.sequence ?? 0,
    events,
  };
}

function event(sequence, type, payload) {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: "session-1",
    runtimeId: "codex",
    provider: "codex",
    providerSessionId: "thread-1",
    turnId: "turn-1",
    itemId: null,
    emittedAt: new Date(sequence * 1_000).toISOString(),
    type,
    payload,
  };
}
