import { describe, expect, it, vi } from "vitest";
import { registerGitAutoCommitIpcHandlers } from "../../../../electron/main/ipc/git-auto-commit-ipc.mjs";

function createHarness() {
  const handlers = new Map();
  const authorizeWorkspaceRoot = vi.fn(async (_event, rootPath) => (
    rootPath === "/renderer/workspace" ? "/authorized/workspace" : "/authorized/other"
  ));
  const gitAutoCommitService = {
    getSnapshot: vi.fn(async () => ({ available: true })),
    setExperimentalOptIn: vi.fn(async () => ({ available: true })),
    setWorkspacePolicy: vi.fn(async () => ({ available: true })),
  };
  registerGitAutoCommitIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    authorizeWorkspaceRoot,
    gitAutoCommitService,
  });
  return { handlers, authorizeWorkspaceRoot, gitAutoCommitService };
}

describe("Git Auto Commit IPC authority", () => {
  it("uses only the Main-authorized workspace root", async () => {
    const harness = createHarness();
    const event = { sender: { id: 7 } };
    await harness.handlers.get("git-auto-commit:get-settings")(event, {
      rootPath: "/renderer/workspace",
    });
    expect(harness.authorizeWorkspaceRoot).toHaveBeenCalledWith(event, "/renderer/workspace");
    expect(harness.gitAutoCommitService.getSnapshot).toHaveBeenCalledWith("/authorized/workspace");
  });

  it("filters workspace policy input before passing it to the service", async () => {
    const harness = createHarness();
    await harness.handlers.get("git-auto-commit:set-workspace-policy")(
      { sender: { id: 8 } },
      {
        rootPath: "/renderer/workspace",
        enabled: true,
        minimumIntervalMs: 900_000,
        scope: "everything",
        push: true,
      },
    );
    expect(harness.gitAutoCommitService.setWorkspacePolicy).toHaveBeenCalledWith(
      "/authorized/workspace",
      { enabled: true, minimumIntervalMs: 900_000 },
    );
  });

  it("rejects empty policy mutations", async () => {
    const harness = createHarness();
    await expect(harness.handlers.get("git-auto-commit:set-workspace-policy")(
      { sender: { id: 9 } },
      { rootPath: "/renderer/workspace", push: true },
    )).rejects.toThrow(/policy change is required/i);
    expect(harness.gitAutoCommitService.setWorkspacePolicy).not.toHaveBeenCalled();
  });
});
