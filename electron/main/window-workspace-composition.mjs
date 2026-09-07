import { WindowWorkspaceState } from "./window-workspace-state.mjs";
import { createWindowWorkspaceOperationQueue } from "./workspace/project-sessions/window-workspace-operation-queue.mjs";

/**
 * Main-process transaction boundary for adding one local Folder to a window's
 * ordered Workspace composition. Candidate discovery and persistence complete
 * before the authoritative WindowWorkspaceState snapshot is published.
 */
export function createWindowWorkspaceCompositionService({
  canonicalizeWorkspacePath,
  cleanupDetachedWorkspace = async () => undefined,
  openProject = () => undefined,
  getWindowState,
  getWorkspaceWindow,
  indexWorkspacePath,
  persistWorkspaceComposition,
  revealWindow,
  unindexWorkspacePath = () => undefined,
  workspaceFromPath,
}) {
  const transactions = createWindowWorkspaceOperationQueue();
  return Object.freeze({
    attach(window, folderPath) { return transactions.run(window, async () => {
      const workspace = await workspaceFromPath(folderPath);
      const canonicalPath = await canonicalizeWorkspacePath(workspace.path);
      const state = getWindowState(window);
      const currentWorkspaces = () => state.folders.map((folder) => folder.workspace);
      const existingWindow = getWorkspaceWindow(canonicalPath);

      if (existingWindow === window && state.folderPaths.includes(canonicalPath)) {
        return createResult("already-attached", canonicalPath, workspace, currentWorkspaces(), state.workspaceId);
      }
      if (existingWindow && existingWindow !== window) {
        revealWindow(existingWindow, canonicalPath);
        const existingState = getWindowState(existingWindow);
        return createResult(
          "focused-existing",
          canonicalPath,
          workspace,
          existingState.folders.map((folder) => folder.workspace),
          existingState.workspaceId,
        );
      }

      const nextFolders = [...state.folders, { path: canonicalPath, workspace }];
      // Validate path and stable Folder identity before durable state changes.
      const validationState = new WindowWorkspaceState();
      validationState.replaceFolders(nextFolders);
      await persistWorkspaceComposition(
        nextFolders.map((folder) => folder.workspace),
        state.workspaceId,
      );

      openProject(window, { path: canonicalPath, workspace });
      state.replaceFolders(nextFolders);
      indexWorkspacePath(canonicalPath, window);
      return createResult("attached-current", canonicalPath, workspace, currentWorkspaces(), state.workspaceId);
    }); },
    detach(window, folderPath) { return transactions.run(window, async () => {
      const canonicalPath = await canonicalizeWorkspacePath(folderPath);
      const state = getWindowState(window);
      const detachedFolder = state.folders.find((folder) => folder.path === canonicalPath);
      if (!detachedFolder) {
        return createResult(
          "not-attached",
          canonicalPath,
          null,
          state.folders.map((folder) => folder.workspace),
          state.workspaceId,
        );
      }
      const nextFolders = state.folders.filter((folder) => folder !== detachedFolder);
      await cleanupDetachedWorkspace(window, detachedFolder);
      await persistWorkspaceComposition(
        nextFolders.map((folder) => folder.workspace),
        state.workspaceId,
      );
      state.forgetFolder(canonicalPath);
      state.replaceFolders(nextFolders);
      unindexWorkspacePath(canonicalPath, window);
      return createResult(
        "detached-current",
        canonicalPath,
        detachedFolder.workspace,
        nextFolders.map((folder) => folder.workspace),
        state.workspaceId,
      );
    }); },
  });
}

function createResult(status, folderPath, workspace, workspaces, workspaceId) {
  return Object.freeze({
    status,
    workspaceId,
    path: folderPath,
    workspace,
    workspaces: Object.freeze([...workspaces]),
  });
}
