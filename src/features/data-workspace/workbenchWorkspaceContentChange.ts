import {
  appendWorkspaceContentChange,
  getWorkspaceResourcePath,
  ResourceUriIdentityService,
  type ResourceUri,
  type WorkbenchWorkspace,
  type WorkspaceContentChange,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";

const resourceIdentity = new ResourceUriIdentityService();

export type WorkbenchWorkspaceMutation = Readonly<{
  workspaceFolderId: string | null;
  paths: readonly string[] | string | null;
}>;

/**
 * Maps one provider-local filesystem notification into the window's canonical
 * Workbench mutation journal. Missing Folder identity degrades to a global
 * refresh so an event can be over-broad, but can never alias another root.
 */
export function appendWorkbenchWorkspaceContentChange(
  current: WorkspaceContentChange,
  workbench: WorkbenchWorkspace | null,
  mutation: WorkbenchWorkspaceMutation,
): WorkspaceContentChange {
  const folder = mutation.workspaceFolderId
    ? workbench?.folders.find((candidate) => candidate.id === mutation.workspaceFolderId) ?? null
    : null;
  const scoped = Boolean(mutation.workspaceFolderId && folder);
  return appendWorkspaceContentChange(current, {
    rootUri: scoped ? folder!.uri : null,
    // Never route an unscoped provider path through the legacy primary-Folder
    // fallback. Unknown or detached ownership becomes a safe global refresh.
    paths: scoped ? mutation.paths : null,
  });
}

/**
 * Records resources changed by an own Explorer action (create, rename, delete)
 * as one path-scoped entry per owning Folder. Any resource outside the
 * Workbench degrades the whole action to a global refresh.
 */
export function appendWorkbenchResourceContentChange(
  current: WorkspaceContentChange,
  workbench: WorkbenchWorkspace | null,
  resources: readonly string[] | null | undefined,
): WorkspaceContentChange {
  const byFolder = new Map<WorkspaceFolder, string[]>();
  const owned = Array.isArray(resources) && resources.length > 0 && resources.every((resource) => {
    const folder = ownerOf(workbench, resource);
    if (!folder) return false;
    const path = getWorkspaceResourcePath(folder.uri, resource as ResourceUri);
    if (!path) return false;
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    return true;
  });
  if (!owned) return appendWorkspaceContentChange(current, { rootUri: null, paths: null });
  let next = current;
  for (const [folder, paths] of byFolder) next = appendWorkspaceContentChange(next, { rootUri: folder.uri, paths });
  return next;
}

function ownerOf(workbench: WorkbenchWorkspace | null, resource: string): WorkspaceFolder | null {
  try {
    return [...(workbench?.folders ?? [])]
      .filter((folder) => resourceIdentity.isEqualOrParent(resource as ResourceUri, folder.uri))
      .sort((first, second) => second.uri.length - first.uri.length)[0] ?? null;
  } catch {
    return null;
  }
}
