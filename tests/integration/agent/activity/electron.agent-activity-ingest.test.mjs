import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentActivityService } from "../../../../electron/main/agent-activity/application/agent-activity-service.mjs";
import { createHookIngestServer } from "../../../../electron/main/agent-activity/transport/hook-ingest-server.mjs";
import { createHookSessionAuth } from "../../../../electron/main/agent-activity/transport/hook-session-auth.mjs";
import { codexActivityAdapter } from "../../../../electron/main/terminal-agent/activity/adapters/codex/descriptor.mjs";
import { forwardHookInput } from "../../../../electron/main/terminal-agent/activity/bridge/puppyone-agent-hook.mjs";

const cleanups = [];
const socketTestTempRoot = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Agent activity local ingest", () => {
  it("accepts one authenticated local frame and rejects a stale token", async () => {
    const directory = await mkdtemp(path.join(socketTestTempRoot, "puppyone-activity-ingest-"));
    const auth = createHookSessionAuth();
    const received = [];
    const server = createHookIngestServer({
      auth,
      runtimeDirectory: path.join(directory, "runtime"),
      onEnvelope: async (envelope) => {
        received.push(envelope);
        return true;
      },
    });
    cleanups.push(async () => {
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    });
    const endpoint = await server.start();
    const token = auth.issue({ terminalSessionId: "terminal-1", providerId: "*" });
    const envelope = hookEnvelope({ token });
    await sendFrame(endpoint, `${JSON.stringify(envelope)}\n`);
    await waitFor(() => received.length === 1);
    expect(received[0]).toMatchObject({ providerId: "codex", terminalSessionId: "terminal-1" });
    expect(await server.processFrame(JSON.stringify(hookEnvelope({ token: "x".repeat(43) })))).toBe(false);
    expect(received).toHaveLength(1);
    if (process.platform !== "win32") {
      expect((await stat(endpoint)).mode & 0o777).toBe(0o600);
    }
  });

  it("carries versioned Codex read and write Hooks through the real socket into editor-safe activity", async () => {
    const directory = await mkdtemp(path.join(socketTestTempRoot, "puppyone-codex-hook-e2e-"));
    const workspaceRoot = path.join(directory, "workspace");
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, "notes.md"), "test\n");

    const publicEvents = [];
    const service = createAgentActivityService({
      publish(_webContentsId, event) {
        publicEvents.push(event);
      },
    });
    service.registerTerminalSession({
      terminalSessionId: "terminal-codex-e2e",
      providerId: "codex",
      workspaceRoot,
      webContentsId: 7,
    });
    const auth = createHookSessionAuth();
    const server = createHookIngestServer({
      auth,
      runtimeDirectory: path.join(directory, "runtime"),
      onEnvelope: async (envelope) => {
        const normalized = codexActivityAdapter.normalize(envelope.payload, {
          terminalSessionId: envelope.terminalSessionId,
          occurredAt: Date.now(),
        });
        return normalized ? service.ingest(normalized) : false;
      },
    });
    cleanups.push(async () => {
      service.dispose();
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    });
    const endpoint = await server.start();
    const token = auth.issue({
      terminalSessionId: "terminal-codex-e2e",
      providerId: "codex",
    });
    const fixture = {
      ...readFixture("codex-0.147.0/pre-tool-use-bash-read.json"),
      cwd: workspaceRoot,
    };
    const environment = {
      PUPPYONE_AGENT_ACTIVITY_ENDPOINT: endpoint,
      PUPPYONE_AGENT_ACTIVITY_TOKEN: token,
      PUPPYONE_AGENT_ACTIVITY_PROVIDER: "codex",
      PUPPYONE_AGENT_ACTIVITY_TERMINAL_SESSION_ID: "terminal-codex-e2e",
    };

    expect(await forwardHookInput({
      environment,
      input: Readable.from([JSON.stringify(fixture)]),
    })).toBe(true);
    await waitFor(() => publicEvents.length === 1);
    expect(publicEvents[0]).toMatchObject({
      providerId: "codex",
      terminalSessionId: "terminal-codex-e2e",
      phase: "started",
      operation: "file.read",
      targets: [{
        workspaceRelativePath: "notes.md",
        access: "read",
        confidence: "exact",
      }],
    });
    expect(JSON.stringify(publicEvents[0])).not.toContain("tail -20");
    expect(JSON.stringify(publicEvents[0])).not.toContain(workspaceRoot);

    expect(await forwardHookInput({
      environment,
      input: Readable.from([JSON.stringify({
        ...fixture,
        hook_event_name: "PostToolUse",
      })]),
    })).toBe(true);
    await waitFor(() => publicEvents.length === 2);
    expect(publicEvents[1]).toMatchObject({
      activityId: publicEvents[0].activityId,
      phase: "completed",
      operation: "file.read",
      targets: [{ workspaceRelativePath: "notes.md" }],
    });

    const writeFixture = {
      ...readFixture("codex-0.147.0/pre-tool-use-apply-patch-write.json"),
      cwd: workspaceRoot,
    };
    expect(await forwardHookInput({
      environment,
      input: Readable.from([JSON.stringify(writeFixture)]),
    })).toBe(true);
    await waitFor(() => publicEvents.length === 3);
    expect(publicEvents[2]).toMatchObject({
      providerId: "codex",
      phase: "started",
      operation: "file.write",
      targets: [{
        workspaceRelativePath: "notes.md",
        access: "write",
        confidence: "exact",
      }],
    });
    expect(JSON.stringify(publicEvents[2])).not.toContain("+new");

    expect(await forwardHookInput({
      environment,
      input: Readable.from([JSON.stringify({
        ...writeFixture,
        hook_event_name: "PostToolUse",
      })]),
    })).toBe(true);
    await waitFor(() => publicEvents.length === 4);
    expect(publicEvents[3]).toMatchObject({
      activityId: publicEvents[2].activityId,
      phase: "completed",
      operation: "file.write",
      targets: [{ workspaceRelativePath: "notes.md" }],
    });
  });
});

function hookEnvelope({ token }) {
  return {
    schemaVersion: 1,
    terminalSessionId: "terminal-1",
    providerId: "codex",
    token,
    payload: {
      eventName: "PreToolUse",
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      toolName: "Read",
      cwd: "/workspace",
      input: { file_path: "/workspace/readme.md" },
    },
  };
}

function sendFrame(endpoint, frame) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once("error", reject);
    socket.once("connect", () => socket.end(frame));
    socket.once("close", resolve);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for local ingest.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readFixture(relativePath) {
  return JSON.parse(readFileSync(
    new URL(`../../../fixtures/agent/activity/${relativePath}`, import.meta.url),
    "utf8",
  ));
}
