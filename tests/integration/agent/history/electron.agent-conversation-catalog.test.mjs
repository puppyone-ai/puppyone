import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentConversationCatalog,
} from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { WORKBUDDY_CHINA_CHANNEL } from "../../../../electron/main/agent/runtimes/workbuddy/workbuddy-channels.mjs";
import { workBuddyHistorySource } from "../../../../electron/main/agent/runtimes/workbuddy/workbuddy-history-source.mjs";

const temporaryDirectories = [];

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => (
  fs.promises.rm(directory, { recursive: true, force: true })
))));

describe("Agent conversation catalog", () => {
  it("persists only bounded routing metadata and native session pointers across restarts", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "catalog.json");
    const first = createAgentConversationCatalog({ filePath });
    await first.save({
      sessionId: "product-session",
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      providerSessionId: "native-thread",
      title: "Fix tests",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      selectedProviderId: "openai",
      selectedModel: "gpt-5.6",
      selectedVariant: "fast",
      selectedEffort: "high",
      selectedMode: "build",
      capabilityRevision: "codex-app-server:1",
      availability: "available",
      events: [{ type: "assistant.completed", payload: { text: "private transcript" } }],
      secret: "sk-not-allowed",
    });

    const raw = await fs.promises.readFile(filePath, "utf8");
    expect(raw).not.toContain("private transcript");
    expect(raw).not.toContain("sk-not-allowed");
    const restarted = createAgentConversationCatalog({ filePath });
    await expect(restarted.findLatest("/workspace", "codex")).resolves.toMatchObject({
      sessionId: "product-session",
      providerSessionId: "native-thread",
      selectedProviderId: "openai",
      selectedModel: "gpt-5.6",
      selectedVariant: "fast",
      selectedEffort: "high",
      capabilityRevision: "codex-app-server:1",
    });
    await expect(restarted.list("/workspace")).resolves.toHaveLength(1);
  });

  it("migrates the former WorkBuddy runtime id at the durable catalog boundary", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "catalog.json");
    const sourceScopeId = workBuddyHistorySource({
      channel: WORKBUDDY_CHINA_CHANNEL,
      environment: process.env,
    });
    await fs.promises.writeFile(filePath, JSON.stringify({
      version: 2,
      truncated: false,
      records: [{
        sessionId: "legacy-workbuddy-session",
        workspaceRoot: "/workspace",
        runtimeId: "workbuddy",
        runtime: { id: "workbuddy", displayName: "WorkBuddy", kind: "native-cli" },
        providerSessionId: "native-workbuddy-thread",
        sourceScopeId,
        title: "Legacy WorkBuddy session",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        availability: "available",
      }],
    }));

    const catalog = createAgentConversationCatalog({ filePath });
    await expect(catalog.list("/workspace", { runtimeId: "workbuddy-china" })).resolves.toEqual([
      expect.objectContaining({
        sessionId: "legacy-workbuddy-session",
        runtimeId: "workbuddy-china",
        runtime: expect.objectContaining({
          id: "workbuddy-china",
          displayName: "WorkBuddy (China)",
        }),
      }),
    ]);
    await expect(catalog.list("/workspace", { runtimeId: "workbuddy-international" })).resolves.toEqual([]);
  });

  it("keeps legacy unverified locators internal until a turn or native scan confirms them", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const catalog = createAgentConversationCatalog({ filePath: path.join(directory, "catalog.json") });
    const record = {
      sessionId: "legacy-empty-session",
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      providerSessionId: "native-thread-without-rollout",
      title: "Codex session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    };

    await catalog.save(record);
    await expect(catalog.list("/workspace")).resolves.toEqual([]);
    await expect(catalog.findLatest("/workspace", "codex")).resolves.toBeNull();
    await expect(catalog.list("/workspace", { includeUnverified: true })).resolves.toEqual([
      expect.objectContaining({ sessionId: "legacy-empty-session", availability: "unverified" }),
    ]);

    await catalog.save({ ...record, availability: "available" });
    await expect(catalog.list("/workspace")).resolves.toEqual([
      expect.objectContaining({ sessionId: "legacy-empty-session", availability: "available" }),
    ]);
  });

  it("upserts one stable product locator for a native conversation discovered more than once", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "catalog.json");
    const catalog = createAgentConversationCatalog({ filePath });

    const first = await catalog.upsertNative({
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      providerSessionId: "native-thread",
      title: "Initial title",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      events: [{ payload: { text: "must not be persisted" } }],
    });
    const second = await catalog.upsertNative({
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      providerSessionId: "native-thread",
      title: "Updated title",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(second.sessionId).toBe(first.sessionId);
    await expect(catalog.list("/workspace", { runtimeId: "codex" })).resolves.toEqual([
      expect.objectContaining({
        sessionId: first.sessionId,
        providerSessionId: "native-thread",
        title: "Updated title",
        origin: "native-discovery",
      }),
    ]);
    expect(await fs.promises.readFile(filePath, "utf8")).not.toContain("must not be persisted");
  });

  it("tombstones only missing locators in the fully-scanned workspace and runtime", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const catalog = createAgentConversationCatalog({ filePath: path.join(directory, "catalog.json") });
    const base = {
      runtime: { id: "cursor", displayName: "Cursor" },
      title: "Saved chat",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
      availability: "available",
    };
    await catalog.save({ ...base, sessionId: "keep", workspaceRoot: "/workspace/a", runtimeId: "cursor", providerSessionId: "native-keep" });
    await catalog.save({ ...base, sessionId: "stale", workspaceRoot: "/workspace/a", runtimeId: "cursor", providerSessionId: "native-stale" });
    await catalog.save({ ...base, sessionId: "other-root", workspaceRoot: "/workspace/b", runtimeId: "cursor", providerSessionId: "native-other" });
    await catalog.save({
      ...base,
      sessionId: "other-runtime",
      workspaceRoot: "/workspace/a",
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      providerSessionId: "thread-other",
    });

    await expect(catalog.reconcileNative({
      workspaceRoot: "/workspace/a",
      runtimeId: "cursor",
      providerSessionIds: ["native-keep"],
      reconciledAt: "2026-09-01T01:00:00.000Z",
    })).resolves.toEqual({ unavailableSessionIds: ["stale"] });

    await expect(catalog.list("/workspace/a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "keep" }),
      expect.objectContaining({ sessionId: "other-runtime" }),
    ]));
    expect((await catalog.list("/workspace/a")).map((entry) => entry.sessionId)).not.toContain("stale");
    await expect(catalog.list("/workspace/b")).resolves.toEqual([
      expect.objectContaining({ sessionId: "other-root" }),
    ]);
    await expect(catalog.findById("stale", "/workspace/a")).resolves.toMatchObject({
      availability: "unavailable",
      unavailableAt: "2026-09-01T01:00:00.000Z",
    });
  });

  it("reactivates a tombstone without changing its stable product id", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-catalog-"));
    temporaryDirectories.push(directory);
    const catalog = createAgentConversationCatalog({ filePath: path.join(directory, "catalog.json") });
    await catalog.save({
      sessionId: "stable-product-id",
      workspaceRoot: "/workspace",
      runtimeId: "cursor",
      runtime: { id: "cursor", displayName: "Cursor" },
      providerSessionId: "native-eventual",
      title: "Saved chat",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    });
    await catalog.reconcileNative({ workspaceRoot: "/workspace", runtimeId: "cursor", providerSessionIds: [] });

    const restored = await catalog.upsertNative({
      workspaceRoot: "/workspace",
      runtimeId: "cursor",
      runtime: { id: "cursor", displayName: "Cursor" },
      providerSessionId: "native-eventual",
      title: "Now durable",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T02:00:00.000Z",
    });
    expect(restored).toMatchObject({
      sessionId: "stable-product-id",
      availability: "available",
      origin: "puppyone",
      title: "Now durable",
    });
  });
});
