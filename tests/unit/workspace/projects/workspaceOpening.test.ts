import { describe, expect, it, vi } from "vitest";
import { openWorkspaceTarget, selectLocalWorkspaceFolder } from "../../../../src/lib/workspaceOpening";
import * as bridge from "../../../../src/lib/localFiles";

vi.mock("../../../../src/lib/localFiles", () => ({
  openWorkspaceInCurrentWindow: vi.fn(), openWorkspaceInNewWindow: vi.fn(),
  selectWorkspaceFolder: vi.fn(), selectWorkspaceFolderInNewWindow: vi.fn(),
  importSource: vi.fn(), createLocalProject: vi.fn(), getDefaultLocalProjectLocation: vi.fn(),
  openDroppedWorkspaceInCurrentWindow: vi.fn(), selectLocalProjectLocation: vi.fn(),
}));

describe("workspace placement contract", () => {
  it("defaults project and folder opening to the current window", async () => {
    await openWorkspaceTarget({ kind: "local", path: "/a" });
    await selectLocalWorkspaceFolder();
    expect(bridge.openWorkspaceInCurrentWindow).toHaveBeenCalledWith("/a");
    expect(bridge.selectWorkspaceFolder).toHaveBeenCalledOnce();
    expect(bridge.openWorkspaceInNewWindow).not.toHaveBeenCalled();
    expect(bridge.selectWorkspaceFolderInNewWindow).not.toHaveBeenCalled();
  });
  it("requires explicit placement to create another window", async () => {
    await openWorkspaceTarget({ kind: "local", path: "/b", placement: "dedicated-window" });
    await selectLocalWorkspaceFolder({ placement: "dedicated-window" });
    expect(bridge.openWorkspaceInNewWindow).toHaveBeenCalledWith("/b");
    expect(bridge.selectWorkspaceFolderInNewWindow).toHaveBeenCalledOnce();
  });
});
