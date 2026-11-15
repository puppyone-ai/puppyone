import { describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceNavigationIpcHandlers,
  selectProjectAssetPreviews,
} from "../../../../electron/main/ipc/workspace-navigation-ipc.mjs";

function setupPreviewHandler({ allowedPaths, childrenByPath }) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => {
      handlers.set(channel, fn);
    },
  };
  const requireRecentWorkspacePath = vi.fn(async (candidatePath) => {
    if (!allowedPaths.has(candidatePath)) {
      throw new Error(`Workspace path is not in recent workspaces: ${candidatePath}`);
    }
    return allowedPaths.get(candidatePath);
  });
  const listFolderChildren = vi.fn(async (folderPath) => {
    if (!(folderPath in childrenByPath)) {
      throw new Error(`Missing folder: ${folderPath}`);
    }
    return childrenByPath[folderPath];
  });

  registerWorkspaceNavigationIpcHandlers({
    ipcMain,
    workspaceStateStore: {
      requireRecentWorkspacePath,
      getLastWorkspaceResult: async () => ({ path: null }),
      getRecentWorkspacesResult: async () => ({ workspaces: [] }),
      hydrateRecentWorkspacesResult: async () => ({ workspaces: [] }),
      removeRecentWorkspacePath: async () => ({ workspaces: [] }),
      renameRecentWorkspacePath: async () => ({ workspaces: [] }),
      addRecentWorkspacePaths: async () => [],
    },
    listFolderChildren,
    getRestoringProjectForWindow: () => null,
    getInitialWorkspaceResultForWindow: async () => ({ path: null }),
    forgetCurrentWindowWorkspace: async () => undefined,
    showHomepageForCurrentWindow: async () => undefined,
    openWorkspaceInCurrentWindow: async () => undefined,
    openWorkspaceInNewWindow: async () => undefined,
    openCloudProjectInNewWindow: async () => undefined,
    createProjectForCurrentWindow: async () => undefined,
    connectImportSourceForCurrentWindow: async () => undefined,
    listImportResourcesForCurrentWindow: async () => undefined,
    importSourceForCurrentWindow: async () => undefined,
    cancelImportSourceForCurrentWindow: async () => undefined,
    selectProjectLocationForCurrentWindow: async () => null,
    getDefaultProjectLocationForCurrentWindow: async () => null,
    selectWorkspaceForCurrentWindow: async () => null,
    selectWorkspaceForCurrentComposition: async () => null,
    selectWorkspaceForNewWindow: async () => null,
    attachWorkspaceToCurrentWindow: async () => undefined,
    detachWorkspaceFromCurrentWindow: async () => undefined,
    folderRelocation: { status: async () => [], locate: async () => null, relocate: async () => null },
    getDialogOwnerWindow: () => null,
    appFolders: { list: async () => [] },
  });

  return {
    invoke: (request) => handlers.get("workspace:project-previews")({ sender: {} }, request),
    requireRecentWorkspacePath,
    listFolderChildren,
  };
}

describe("workspace:project-previews IPC", () => {
  it("rejects any path that is not registered in recentWorkspaces before reading folder children", async () => {
    const { invoke, listFolderChildren } = setupPreviewHandler({
      allowedPaths: new Map([["/Users/example/Projects/notes", "/Users/example/Projects/notes"]]),
      childrenByPath: {
        "/Users/example/Projects/notes": [{ name: "readme.md", type: "markdown", content: "# Notes" }],
      },
    });

    await expect(invoke({
      paths: ["/Users/example/Projects/notes", "/etc"],
    })).rejects.toThrow("Workspace path is not in recent workspaces: /etc");

    expect(listFolderChildren).not.toHaveBeenCalled();
  });

  it("excludes folders and dotfiles, sorts HTML > MD > CSV > other, caps at 3, and extracts snippets", async () => {
    const projectPath = "/Users/example/Projects/revenue";
    const { invoke, listFolderChildren } = setupPreviewHandler({
      allowedPaths: new Map([[projectPath, projectPath]]),
      childrenByPath: {
        [projectPath]: [
          { name: "assets", type: "folder" },
          { name: ".DS_Store", type: "file", preview: "binary" },
          { name: "notes.txt", type: "file", preview: "Plain text fallback\nSecond line" },
          { name: "stripe-export.csv", type: "file", content: "month,mrr,churn,net\n2026-01,42000,1200,40800" },
          {
            name: "summary.md",
            type: "markdown",
            content: "---\ntitle: ignored\n---\n# Q1 收入复盘\nMRR 增长 18%\n净留存 108%",
          },
          {
            name: "board-deck.html",
            type: "html",
            content: "<!doctype html><html><head><title>Board Revenue Deck &amp; Forecast</title></head><body><h1>Ignored</h1></body></html>",
          },
        ],
      },
    });

    const result = await invoke({ paths: [projectPath] });
    expect(listFolderChildren).toHaveBeenCalledWith(projectPath, null);
    expect(result).toEqual([
      {
        path: projectPath,
        previews: [
          {
            name: "board-deck.html",
            kind: "html",
            snippet: "Board Revenue Deck & Forecast",
          },
          {
            name: "summary.md",
            kind: "md",
            snippet: "Q1 收入复盘\nMRR 增长 18%\n净留存 108%",
          },
          {
            name: "stripe-export.csv",
            kind: "csv",
            snippet: "month,mrr,churn,net",
          },
        ],
      },
    ]);
  });

  it("falls back to the first HTML heading when <title> is absent", () => {
    const previews = selectProjectAssetPreviews([
      {
        name: "landing.html",
        type: "html",
        content: "<main><h1>What your Agents make is yours to keep</h1><p>Body</p></main>",
      },
    ]);
    expect(previews).toEqual([
      {
        name: "landing.html",
        kind: "html",
        snippet: "What your Agents make is yours to keep",
      },
    ]);
  });
});
