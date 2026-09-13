import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("workspace folder drop preload boundary", () => {
  it("derives the path from the native File grant before invoking main", async () => {
    const folder = { name: "Notes" };
    const invoke = vi.fn(async () => ({ status: "opened-current" }));
    const bridge = await loadPreloadBridge({
      invoke,
      getPathForFile: (value) => value === folder ? "/Users/example/Notes" : "",
    });

    await expect(bridge.openDroppedWorkspaceInCurrentWindow(folder)).resolves.toEqual({ status: "opened-current" });
    expect(invoke).toHaveBeenCalledWith("workspace:open-dropped-current", "/Users/example/Notes");
  });

  it("fails closed when Electron cannot resolve the dropped File", async () => {
    const invoke = vi.fn(async () => ({ status: "opened-current" }));
    const bridge = await loadPreloadBridge({ invoke, getPathForFile: () => "" });

    await expect(bridge.openDroppedWorkspaceInCurrentWindow({ name: "Notes" })).rejects.toThrow(/could not be resolved/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exposes a location grant and narrow create/clone requests without accepting a renderer path", async () => {
    const invoke = vi.fn(async () => ({ status: "opened-current" }));
    const bridge = await loadPreloadBridge({ invoke, getPathForFile: () => "" });

    await bridge.selectLocalProjectLocation();
    expect(invoke).toHaveBeenCalledWith("workspace:select-project-location-current");
    await bridge.createLocalProject({ name: "Notes", locationGrantId: "location-1" });
    expect(invoke).toHaveBeenCalledWith("workspace:create-project-current", {
      name: "Notes",
      locationGrantId: "location-1",
    });
    await bridge.cloneRepository({
      repositoryUrl: "https://github.com/owner/repository.git",
    });
    expect(invoke).toHaveBeenCalledWith("workspace:clone-repository-current", {
      repositoryUrl: "https://github.com/owner/repository.git",
    });
  });

  it("exposes a gesture-bound attach picker without accepting a renderer path", async () => {
    const invoke = vi.fn(async () => ({ status: "attached-current", workspaces: [] }));
    const bridge = await loadPreloadBridge({ invoke, getPathForFile: () => "" });

    await bridge.selectFolderToAttach();

    expect(invoke).toHaveBeenCalledWith("workspace:select-folder-attach");
  });
});

async function loadPreloadBridge({ invoke, getPathForFile }) {
  const source = await readFile(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
  let exposed = null;
  const context = {
    process: { argv: ["electron", "app"] },
    require: (specifier) => {
      if (specifier !== "electron") throw new Error(`Unexpected preload import: ${specifier}`);
      return {
        contextBridge: {
          exposeInMainWorld: (_name, value) => { exposed = value; },
        },
        ipcRenderer: {
          invoke,
          on: () => undefined,
          removeListener: () => undefined,
          send: () => undefined,
        },
        webUtils: { getPathForFile },
      };
    },
    console,
    Promise,
    Error,
  };
  vm.runInNewContext(source, context, { filename: "preload.cjs" });
  return exposed;
}
