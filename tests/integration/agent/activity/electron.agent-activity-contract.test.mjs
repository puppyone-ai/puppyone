import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentActivityEvent } from "../../../../shared/agent-activity-contract/schema.mjs";
import { resolvePublicActivityTarget } from "../../../../electron/main/agent-activity/security/activity-path-policy.mjs";
import { createAgentActivityService } from "../../../../electron/main/agent-activity/application/agent-activity-service.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("Agent activity public contract", () => {
  it("accepts relative metadata and rejects absolute path leakage", () => {
    const event = publicEvent({ workspaceRelativePath: "src/App.tsx" });
    expect(parseAgentActivityEvent(event)).toMatchObject({ providerId: "codex" });
    expect(parseAgentActivityEvent(publicEvent({ workspaceRelativePath: "/Users/me/secret.txt" }))).toBeNull();
    expect(parseAgentActivityEvent(publicEvent({ workspaceRelativePath: "../secret.txt" }))).toBeNull();
  });
});

describe("Agent activity path policy", () => {
  it("canonicalizes reads and nonexistent write targets inside the workspace", async () => {
    const root = await temporaryWorkspace();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "readme.md"), "ok");
    await expect(resolvePublicActivityTarget({
      candidate: { path: "src/readme.md", access: "read", confidence: "exact" },
      cwd: root,
      workspaceRoot: await realpath(root),
    })).resolves.toMatchObject({ workspaceRelativePath: "src/readme.md" });
    await expect(resolvePublicActivityTarget({
      candidate: { path: "src/new/deep.txt", access: "write", confidence: "exact" },
      cwd: root,
      workspaceRoot: await realpath(root),
    })).resolves.toMatchObject({ workspaceRelativePath: "src/new/deep.txt" });
  });

  it("canonicalizes the workspace root before enforcing the containment boundary", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, "readme.md"), "ok");
    await expect(resolvePublicActivityTarget({
      candidate: { path: "readme.md", access: "read", confidence: "exact" },
      cwd: root,
      workspaceRoot: root,
    })).resolves.toMatchObject({ workspaceRelativePath: "readme.md" });
  });

  it("rejects traversal and symlink escape", async () => {
    const parent = await temporaryWorkspace();
    const root = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "escape"));
    await expect(resolvePublicActivityTarget({
      candidate: { path: "../outside/secret.txt", access: "read", confidence: "exact" },
      cwd: root,
      workspaceRoot: await realpath(root),
    })).resolves.toBeNull();
    await expect(resolvePublicActivityTarget({
      candidate: { path: "escape/secret.txt", access: "read", confidence: "exact" },
      cwd: root,
      workspaceRoot: await realpath(root),
    })).resolves.toBeNull();
  });
});

describe("Agent activity broker", () => {
  it("publishes sanitized starts and correlates terminal events to their owner", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, "note.md"), "hello");
    const published = [];
    const service = createAgentActivityService({ publish: (...args) => published.push(args) });
    service.registerTerminalSession({
      terminalSessionId: "terminal-1",
      providerId: "codex",
      workspaceRoot: await realpath(root),
      webContentsId: 9,
    });
    expect(await service.ingest(sourceEvent({ phase: "started", cwd: root }))).toBe(true);
    expect(published).toHaveLength(1);
    expect(JSON.stringify(published[0])).not.toContain(root);
    expect(published[0][1]).toMatchObject({
      phase: "started",
      targets: [{ workspaceRelativePath: "note.md", access: "read" }],
    });
    expect(await service.ingest(sourceEvent({ phase: "completed", cwd: root }))).toBe(true);
    expect(published[1][1]).toMatchObject({
      activityId: published[0][1].activityId,
      phase: "completed",
    });
    expect(service.getSnapshotForWindow(9).activities).toEqual([]);
    service.dispose();
  });

  it("clears outstanding claims when the terminal closes", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, "note.md"), "hello");
    const publish = vi.fn();
    const service = createAgentActivityService({ publish });
    service.registerTerminalSession({
      terminalSessionId: "terminal-1",
      providerId: "codex",
      workspaceRoot: await realpath(root),
      webContentsId: 7,
    });
    await service.ingest(sourceEvent({ phase: "started", cwd: root }));
    service.closeTerminalSession("terminal-1");
    expect(publish.mock.calls.at(-1)?.[1]).toMatchObject({ phase: "cancelled" });
  });
});

async function temporaryWorkspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-agent-activity-"));
  temporaryDirectories.push(directory);
  return directory;
}

function publicEvent(target) {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    activityId: "activity-1",
    providerId: "codex",
    terminalSessionId: "terminal-1",
    phase: "started",
    operation: "file.read",
    targets: [{ ...target, access: "read", confidence: "exact" }],
    occurredAt: 1,
  };
}

function sourceEvent({ phase, cwd }) {
  return {
    schemaVersion: 1,
    sourceSurface: "terminal",
    providerId: "codex",
    terminalSessionId: "terminal-1",
    sourceSessionId: "session-1",
    nativeTurnId: "turn-1",
    nativeToolCallId: "call-1",
    nativeToolName: "mcp__filesystem__read_file",
    phase,
    operation: "file.read",
    cwd,
    targets: [{ kind: "file", path: "note.md", access: "read", confidence: "exact" }],
    occurredAt: Date.now(),
  };
}
