import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerWorkspaceGitIpcHandlers } from "../../../../electron/main/ipc/workspace-git-ipc.mjs";

function createHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
  };
}

function createSender(id) {
  const sender = new EventEmitter();
  sender.id = id;
  return sender;
}

function createBlockingCoordinator() {
  const whenIdle = vi.fn((_rootPath, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      const error = new Error("cancelled");
      error.name = "AbortError";
      reject(error);
      return;
    }
    options.signal?.addEventListener("abort", () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
    void resolve;
  }));
  return {
    run: (_rootPath, operation) => operation(),
    whenIdle,
    whenIdleAll: async (lockKeys, options = {}) => {
      for (const key of lockKeys) {
        await whenIdle(key, options);
      }
    },
  };
}

describe("Git status IPC cancellation", () => {
  it("cancels an active request within the calling renderer", async () => {
    const { ipcMain, handlers } = createHarness();
    const coordinator = createBlockingCoordinator();
    registerWorkspaceGitIpcHandlers({
      ipcMain,
      BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: vi.fn() },
      authorizeWorkspaceRoot: async () => "/repo",
      gitOperationCoordinator: coordinator,
    });
    const event = { sender: createSender(7) };

    const status = handlers.get("workspace:git-status")(event, {
      rootPath: "/repo",
      requestId: "request-1",
    });
    await Promise.resolve();
    await handlers.get("workspace:git-status-cancel")(event, { requestId: "request-1" });

    await expect(status).rejects.toMatchObject({ name: "AbortError" });
  });

  it("honors cancellation that arrives before status handler setup", async () => {
    const { ipcMain, handlers } = createHarness();
    const coordinator = createBlockingCoordinator();
    registerWorkspaceGitIpcHandlers({
      ipcMain,
      BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: vi.fn() },
      authorizeWorkspaceRoot: async () => "/repo",
      gitOperationCoordinator: coordinator,
    });
    const event = { sender: createSender(8) };

    await handlers.get("workspace:git-status-cancel")(event, { requestId: "request-early" });
    const status = handlers.get("workspace:git-status")(event, {
      rootPath: "/repo",
      requestId: "request-early",
    });

    await expect(status).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels a format-aware diff request and revokes its resource session", async () => {
    const { ipcMain, handlers } = createHarness();
    const coordinator = createBlockingCoordinator();
    const gitDiffResourceBroker = {
      createSessionId: () => "git-diff-session:fallback",
      issueDetail: vi.fn(),
      read: vi.fn(),
      revokeSession: vi.fn(() => true),
      revokeOwner: vi.fn(),
    };
    registerWorkspaceGitIpcHandlers({
      ipcMain,
      BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: vi.fn() },
      authorizeWorkspaceRoot: async () => "/repo",
      gitOperationCoordinator: coordinator,
      gitDiffResourceBroker,
    });
    const event = { sender: createSender(9) };
    const request = {
      rootPath: "/repo",
      path: "report.docx",
      scope: "unstaged",
      requestId: "diff-request-1",
      sessionId: "git-diff-session:test-1",
    };

    const pending = handlers.get("workspace:git-file-diff")(event, request);
    await Promise.resolve();
    await handlers.get("workspace:git-file-diff-cancel")(event, request);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(gitDiffResourceBroker.revokeSession).toHaveBeenCalledWith(
      "git-diff-session:test-1",
      { ownerWebContentsId: 9, ignoreMissing: true },
    );
    expect(gitDiffResourceBroker.issueDetail).not.toHaveBeenCalled();
  });

  it("forwards only the calling renderer audience and bounded range to resource reads", async () => {
    const { ipcMain, handlers } = createHarness();
    const read = vi.fn(() => ({ bytes: new Uint8Array([2]), offset: 2, size: 4, done: false }));
    registerWorkspaceGitIpcHandlers({
      ipcMain,
      BrowserWindow: { fromWebContents: () => null },
      dialog: { showMessageBox: vi.fn() },
      authorizeWorkspaceRoot: async () => "/repo",
      gitOperationCoordinator: createBlockingCoordinator(),
      gitDiffResourceBroker: {
        createSessionId: () => "git-diff-session:fallback",
        issueDetail: vi.fn(),
        read,
        revokeSession: vi.fn(() => true),
        revokeOwner: vi.fn(),
      },
    });

    const request = {
      handle: "opaque-handle",
      sessionId: "git-diff-session:test",
      selectionIdentity: "selection:1",
      revisionIdentity: "revision:1",
      offset: 2,
      length: 1,
      ownerWebContentsId: 999,
    };
    handlers.get("workspace:git-diff-resource-read")({ sender: createSender(11) }, request);

    expect(read).toHaveBeenCalledWith({
      handle: "opaque-handle",
      ownerWebContentsId: 11,
      sessionId: "git-diff-session:test",
      selectionIdentity: "selection:1",
      revisionIdentity: "revision:1",
      offset: 2,
      length: 1,
    });
  });
});
