import { clientHandler } from "./helpers/agentIpcClient.mjs";
import { describe, expect, it, vi } from "vitest";
import { registerAgentIpcHandlers } from "../electron/main/ipc/agent-ipc.mjs";
import {
  createSender,
  ipcSnapshot,
  semanticReferenceCapabilities,
} from "./helpers/agentServiceHarness.mjs";

describe("Agent IPC workspace authorization", () => {
  it("authorizes create and resume roots before invoking the service", async () => {
    const handlers = new Map();
    const agentService = createMockAgentService();
    const authorizeWorkspaceRoot = vi.fn(async (_event, requested) => {
      if (requested !== "/workspace") throw new Error("Requested workspace root does not match");
      return "/canonical/workspace";
    });
    const localAgentInventory = {
      discover: vi.fn(async () => ({ connections: [], scannedAt: new Date(0).toISOString(), warnings: [] })),
    };
    registerAgentIpcHandlers({
      ipcMain: { handle: (channel, listener) => handlers.set(channel, clientHandler(listener)) },
      agentService,
      localAgentInventory,
      authorizeWorkspaceRoot,
    });
    const event = { sender: createSender(7) };
    await expect(handlers.get("agent:session-create")(event, { rootPath: "/other" })).rejects.toThrow(/does not match/i);
    expect(agentService.createSession).not.toHaveBeenCalled();
    await handlers.get("agent:session-create")(event, { rootPath: "/workspace" });
    expect(agentService.createSession).toHaveBeenCalledWith(event.sender, { rootPath: "/workspace" }, "/canonical/workspace", undefined);
    await handlers.get("agent:session-resume")(event, { rootPath: "/workspace" });
    expect(agentService.resumeSession).toHaveBeenCalledWith(event.sender, { rootPath: "/workspace" }, "/canonical/workspace", undefined);
    await handlers.get("agent:session-open")(event, {
      rootPath: "/workspace",
      sessionId: "saved-session",
      runtimeId: "codex",
    });
    expect(agentService.openSession).toHaveBeenCalledWith(event.sender, {
      rootPath: "/workspace",
      sessionId: "saved-session",
      runtimeId: "codex",
    }, "/canonical/workspace", undefined);
    await handlers.get("agent:local-connections-discover")(event, {
      rootPath: "/workspace",
      refresh: true,
      command: "unsafe",
    });
    expect(localAgentInventory.discover).toHaveBeenCalledWith({
      refresh: true,
      workspaceRoot: "/canonical/workspace",
    });
    await expect(handlers.get("agent:local-connections-discover")(event, { rootPath: "/other" }))
      .rejects.toThrow(/does not match/i);
  });

  it("registers the full bridge list, including fail-closed steer and question handlers", async () => {
    const handlers = new Map();
    const agentService = createMockAgentService();
    registerAgentIpcHandlers({
      ipcMain: { handle: (channel, listener) => handlers.set(channel, clientHandler(listener)) },
      agentService,
      localAgentInventory: {
        discover: vi.fn(async () => ({ connections: [], scannedAt: new Date(0).toISOString(), warnings: [] })),
      },
      authorizeWorkspaceRoot: vi.fn(async () => "/canonical/workspace"),
    });
    for (const channel of [
      "agent:providers-discover",
      "agent:local-connections-discover",
      "agent:models-list",
      "agent:account-read",
      "agent:session-create",
      "agent:session-resume",
      "agent:session-open",
      "agent:session-replay",
      "agent:sessions-list",
      "agent:session-fork",
      "agent:session-archive",
      "agent:session-delete",
      "agent:session-close",
      "agent:reference-stage",
      "agent:reference-revoke",
      "agent:reference-resolve-workspace",
      "agent:reference-pick-workspace",
      "agent:turn-start",
      "agent:turn-steer",
      "agent:turn-interrupt",
      "agent:session-compact",
      "agent:approval-resolve",
      "agent:question-resolve",
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
    const event = { sender: createSender(8) };
    const steerRequest = { rootPath: "/workspace", sessionId: "s", turnId: "t", message: "steer" };
    await handlers.get("agent:turn-steer")(event, steerRequest);
    expect(agentService.steerTurn).toHaveBeenCalledWith(event.sender, steerRequest, "/canonical/workspace");
    const questionRequest = { rootPath: "/workspace", sessionId: "s", turnId: "t", requestId: "r" };
    await handlers.get("agent:question-resolve")(event, questionRequest);
    expect(agentService.resolveQuestion).toHaveBeenCalledWith(event.sender, questionRequest, "/canonical/workspace");
  });
});

function createMockAgentService() {
  return {
    discoverProviders: vi.fn(),
    listModels: vi.fn(),
    readAccount: vi.fn(),
    createSession: vi.fn(async () => ipcSnapshot()),
    resumeSession: vi.fn(async () => ipcSnapshot()),
    openSession: vi.fn(async () => ({ status: "opened", snapshot: ipcSnapshot() })),
    replay: vi.fn(),
    closeSession: vi.fn(),
    startTurn: vi.fn(),
    steerTurn: vi.fn(async () => ({ sessionId: "s", turnId: "t", accepted: true })),
    interruptTurn: vi.fn(),
    resolveApproval: vi.fn(),
    resolveQuestion: vi.fn(async () => ({ requestId: "r", resolved: true })),
    listSessions: vi.fn(),
    forkSession: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
    compactSession: vi.fn(),
    getReferenceInputCapabilities: vi.fn(() => semanticReferenceCapabilities()),
  };
}
