import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGitAutoCommitHost } from "../../../../electron/main/git-auto-commit/host.mjs";

describe("Git Auto Commit optional-feature host", () => {
  it("is a side-effect-free null object when the release capability is unavailable", async () => {
    const host = createGitAutoCommitHost({ available: false });
    const ipcMain = { handle: vi.fn() };

    expect(host.available).toBe(false);
    expect(host.registerIpcHandlers({ ipcMain, authorizeWorkspaceRoot: vi.fn() })).toBe(false);
    await expect(host.assignWorkspace({ id: 1 }, "/workspace/never-touched")).resolves.toBeUndefined();
    expect(() => host.reconcileWindow(1)).not.toThrow();
    expect(() => host.reconcileAfterResume()).not.toThrow();
    expect(() => host.releaseWindow(1)).not.toThrow();
    expect(() => host.closeAll()).not.toThrow();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });

  it("owns every optional IPC channel when the release capability is available", () => {
    const host = createGitAutoCommitHost({
      available: true,
      preferenceFilePath: path.join(os.tmpdir(), "puppyone-auto-commit-host-test.json"),
      gitOperationCoordinator: {},
      documentDurabilityCoordinator: {},
      workspaceMutationTracker: {},
      workspaceWatchService: {},
    });
    const channels = [];

    expect(host.available).toBe(true);
    expect(host.registerIpcHandlers({
      ipcMain: { handle: (channel) => channels.push(channel) },
      authorizeWorkspaceRoot: vi.fn(),
    })).toBe(true);
    expect(channels.sort()).toEqual([
      "git-auto-commit:get-settings",
      "git-auto-commit:set-experimental-opt-in",
      "git-auto-commit:set-workspace-policy",
    ]);
  });
});
