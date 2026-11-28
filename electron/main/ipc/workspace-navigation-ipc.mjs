import { listFolderChildren as defaultListFolderChildren } from "../../local-api/workspace.mjs";

const ASSET_KIND_PRIORITY = {
  html: 0,
  md: 1,
  csv: 2,
  other: 3,
};

function decodeBasicHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanHtmlFragment(value) {
  return decodeBasicHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSnippet(value, limit = 160) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1).trimEnd()}…` : trimmed;
}

function classifyProjectAssetKind(node) {
  const name = typeof node?.name === "string" ? node.name : "";
  if (node?.type === "html" || /\.html?$/i.test(name)) return "html";
  if (node?.type === "markdown" || /\.(?:md|markdown|mdx)$/i.test(name)) return "md";
  if (/\.(?:csv|tsv)$/i.test(name)) return "csv";
  return "other";
}

function extractProjectAssetSnippet(kind, node) {
  const content = typeof node?.content === "string" ? node.content : "";
  const preview = typeof node?.preview === "string" ? node.preview : "";
  const raw = content || preview;
  if (!raw.trim()) return null;

  if (kind === "html") {
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    const title = titleMatch ? cleanHtmlFragment(titleMatch[1]) : "";
    if (title) return truncateSnippet(title, 120);

    const headingMatch = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(raw);
    const heading = headingMatch ? cleanHtmlFragment(headingMatch[1]) : "";
    if (heading) return truncateSnippet(heading, 120);

    const textOnly = cleanHtmlFragment(
      raw
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " "),
    );
    return truncateSnippet(textOnly, 120);
  }

  if (kind === "md") {
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:```|~~~|---+$|\*\*\*+$)/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^>\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 4);
    return lines.length > 0 ? truncateSnippet(lines.join("\n"), 180) : null;
  }

  if (kind === "csv") {
    const header = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return header ? truncateSnippet(header, 160) : null;
  }

  const lines = (preview || content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines.length > 0 ? truncateSnippet(lines.join("\n"), 120) : null;
}

export function selectProjectAssetPreviews(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((node) => node && node.type !== "folder" && typeof node.name === "string" && !node.name.startsWith("."))
    .map((node) => {
      const kind = classifyProjectAssetKind(node);
      return {
        name: node.name,
        kind,
        snippet: extractProjectAssetSnippet(kind, node),
      };
    })
    .sort((left, right) => (
      ASSET_KIND_PRIORITY[left.kind] - ASSET_KIND_PRIORITY[right.kind]
      || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    ))
    .slice(0, 3);
}

export function registerWorkspaceNavigationIpcHandlers({
  ipcMain,
  workspaceStateStore,
  listFolderChildren = defaultListFolderChildren,
  getRestoringProjectForWindow,
  getInitialWorkspaceResultForWindow,
  forgetCurrentWindowWorkspace,
  showHomepageForCurrentWindow,
  openWorkspaceInCurrentWindow,
  openWorkspaceInNewWindow,
  openCloudProjectInNewWindow,
  createProjectForCurrentWindow,
  connectImportSourceForCurrentWindow,
  listImportResourcesForCurrentWindow,
  importSourceForCurrentWindow,
  cancelImportSourceForCurrentWindow,
  selectProjectLocationForCurrentWindow,
  getDefaultProjectLocationForCurrentWindow,
  selectWorkspaceForCurrentWindow,
  selectWorkspaceForCurrentComposition,
  selectWorkspaceForNewWindow,
  attachWorkspaceToCurrentWindow,
  detachWorkspaceFromCurrentWindow,
  folderRelocation,
  getDialogOwnerWindow,
  appFolders,
}) {
  ipcMain.handle("window:get-restoring-project", (event) => getRestoringProjectForWindow(event.sender));

  ipcMain.handle("window:get-initial-workspace", async (event) => {
    return getInitialWorkspaceResultForWindow(event.sender);
  });

  ipcMain.handle("workspace:get-last", async () => {
    return workspaceStateStore.getLastWorkspaceResult();
  });

  ipcMain.handle("workspace:get-recent", async () => {
    return workspaceStateStore.getRecentWorkspacesResult();
  });

  ipcMain.handle("workspace:hydrate-recent", async () => {
    return workspaceStateStore.hydrateRecentWorkspacesResult();
  });

  ipcMain.handle("workspace:remove-recent", async (_event, folderPath) => {
    const result = await workspaceStateStore.removeRecentWorkspacePath(folderPath);
    return { ok: true, ...result };
  });

  ipcMain.handle("workspace:rename-recent", async (_event, request) => {
    const result = await workspaceStateStore.renameRecentWorkspacePath(
      request?.folderPath,
      request?.name,
    );
    return { ok: true, ...result };
  });

  ipcMain.handle("workspace:forget-last", async (event) => {
    await forgetCurrentWindowWorkspace(event.sender);
    return { ok: true };
  });

  ipcMain.handle("workspace:show-homepage", async (event) => {
    await showHomepageForCurrentWindow(event.sender);
    return { ok: true };
  });

  ipcMain.handle("workspace:open-current", async (event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return openWorkspaceInCurrentWindow(event.sender, persistedPath);
  });

  // This path bypasses the recent-workspace allowlist only because the preload
  // resolves it from a native File object granted by a user drop gesture. The
  // renderer never receives a general arbitrary-path opener.
  ipcMain.handle("workspace:open-dropped-current", async (event, folderPath) => {
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      throw new Error("Dropped folder path is required.");
    }
    return openWorkspaceInCurrentWindow(event.sender, folderPath.trim());
  });

  ipcMain.handle("workspace:open-new-window", async (_event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return openWorkspaceInNewWindow(persistedPath);
  });

  ipcMain.handle("workspace:open-cloud-new-window", async (_event, target) => {
    return openCloudProjectInNewWindow(target);
  });

  ipcMain.handle("workspace:create-project-current", async (event, request) => {
    return createProjectForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:select-project-location-current", async (event) => {
    return selectProjectLocationForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:default-project-location-current", async (event) => {
    return getDefaultProjectLocationForCurrentWindow(event.sender);
  });

  // Folders another app already records. Adding re-reads that app's own record
  // and accepts only folders still on it, so no arbitrary path gets through.
  ipcMain.handle("workspace:app-folders-list", async (_event, app) => {
    const folders = await appFolders.list(app);
    const listed = new Set((await workspaceStateStore.getRecentWorkspacesResult()).workspaces.map((workspace) => workspace.path));
    return { folders: folders.map((folder) => ({ ...folder, added: listed.has(folder.path) })) };
  });

  ipcMain.handle("workspace:app-folders-add", async (_event, request) => {
    const offered = new Set((await appFolders.list(request?.app)).map((folder) => folder.path));
    const paths = Array.isArray(request?.paths) ? request.paths.filter((folderPath) => offered.has(folderPath)) : [];
    if (paths.length === 0) throw new Error("Choose a folder that this app still lists.");
    const added = await workspaceStateStore.addRecentWorkspacePaths(paths);
    return { added: added.length };
  });

  ipcMain.handle("workspace:import-source-connect", async (event, request) => {
    return connectImportSourceForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:import-source-list", async (event, request) => {
    return listImportResourcesForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:import-source-current", async (event, request) => {
    return importSourceForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:import-source-cancel", async (event, request) => {
    return cancelImportSourceForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:select-folder", async (event) => {
    return selectWorkspaceForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:select-folder-current", async (event) => {
    return selectWorkspaceForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:select-folder-attach", async (event) => {
    return selectWorkspaceForCurrentComposition(event.sender);
  });

  ipcMain.handle("workspace:attach-current", async (event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return attachWorkspaceToCurrentWindow(event.sender, persistedPath);
  });

  ipcMain.handle("workspace:detach-current", async (event, folderPath) => {
    return detachWorkspaceFromCurrentWindow(event.sender, folderPath);
  });

  // A project whose folder moved, was renamed or whose disk is away: what is known,
  // finding where it went, and using that place from now on.
  ipcMain.handle("workspace:folder-status", async (event, request) => (
    folderRelocation.status(event.sender, request?.paths)
  ));

  ipcMain.handle("workspace:project-previews", async (_event, request) => {
    const paths = request?.paths;
    if (!Array.isArray(paths)) {
      throw new Error("Project preview paths must be an array.");
    }
    const verified = [];
    for (const folderPath of paths) {
      const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
      verified.push({ path: folderPath, persistedPath });
    }
    return Promise.all(verified.map(async ({ path: folderPath, persistedPath }) => {
      try {
        const nodes = await listFolderChildren(persistedPath, null);
        return {
          path: folderPath,
          previews: selectProjectAssetPreviews(nodes),
        };
      } catch {
        return {
          path: folderPath,
          previews: [],
        };
      }
    }));
  });

  ipcMain.handle("workspace:locate-folder", async (event, request) => (
    folderRelocation.locate(event.sender, request?.path, getDialogOwnerWindow(event.sender))
  ));

  ipcMain.handle("workspace:relocate-folder", async (_event, request) => (
    folderRelocation.relocate(request?.token)
  ));

  ipcMain.handle("workspace:select-folder-new-window", async (event) => {
    return selectWorkspaceForNewWindow(event.sender);
  });
}
