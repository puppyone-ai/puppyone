import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  DataNode,
  DataWorkspaceExplorerSession,
  Workspace,
  WorkspaceFolder,
} from "@puppyone/shared-ui";

const MAX_CACHED_EXPLORER_SESSIONS = 12;

export function useProjectExplorerSelection(workspace: Workspace | null): readonly [
  DataNode | null,
  Dispatch<SetStateAction<DataNode | null>>,
] {
  const projectIdentity = workspace ? getProjectUiIdentity(workspace) : null;
  const [nodesByProject, setNodesByProject] = useState<ReadonlyMap<string, DataNode>>(
    () => new Map(),
  );
  const activeNode = projectIdentity ? nodesByProject.get(projectIdentity) ?? null : null;
  const setActiveNode: Dispatch<SetStateAction<DataNode | null>> = useCallback((update) => {
    if (!projectIdentity) return;
    setNodesByProject((current) => {
      const currentNode = current.get(projectIdentity) ?? null;
      const nextNode = typeof update === "function" ? update(currentNode) : update;
      if (nextNode === currentNode) return current;
      const next = new Map(current);
      if (nextNode) {
        next.delete(projectIdentity);
        next.set(projectIdentity, nextNode);
      }
      else next.delete(projectIdentity);
      trimOldestEntries(next, MAX_CACHED_EXPLORER_SESSIONS);
      return next;
    });
  }, [projectIdentity]);

  return [activeNode, setActiveNode] as const;
}

/**
 * Keeps renderer-only Explorer state independent from the ephemeral Workbench
 * composition identity used by native capabilities and process ownership.
 */
export function useProjectExplorerSession(
  workspace: Workspace,
  workspaceFolders: readonly WorkspaceFolder[],
) {
  const sessionsRef = useRef(new Map<string, DataWorkspaceExplorerSession>());
  const key = useMemo(
    () => createProjectExplorerSessionKey(workspace, workspaceFolders),
    [workspace, workspaceFolders],
  );
  const initialSessionRef = useRef<Readonly<{
    key: string;
    session: DataWorkspaceExplorerSession | null;
  }> | null>(null);
  if (initialSessionRef.current?.key !== key) {
    initialSessionRef.current = {
      key,
      session: sessionsRef.current.get(key) ?? null,
    };
  }
  const initialSession = initialSessionRef.current.session;
  const onSessionChange = useCallback((session: DataWorkspaceExplorerSession) => {
    putBoundedSession(sessionsRef.current, key, session);
  }, [key]);

  return { key, initialSession, onSessionChange } as const;
}

export function createProjectExplorerSessionKey(
  workspace: Workspace,
  workspaceFolders: readonly WorkspaceFolder[],
): string {
  const folderIdentities = workspaceFolders.map((folder) => (
    folder.workspace.workspaceInstanceId?.trim() || folder.id
  ));
  return folderIdentities.length > 0
    ? folderIdentities.join("\u001f")
    : getProjectUiIdentity(workspace);
}

export function getProjectUiIdentity(workspace: Workspace): string {
  return workspace.workspaceInstanceId?.trim() || workspace.id || workspace.path;
}

function putBoundedSession(
  sessions: Map<string, DataWorkspaceExplorerSession>,
  key: string,
  session: DataWorkspaceExplorerSession,
) {
  sessions.delete(key);
  sessions.set(key, session);
  trimOldestEntries(sessions, MAX_CACHED_EXPLORER_SESSIONS);
}

function trimOldestEntries<T>(entries: Map<string, T>, maximumSize: number) {
  while (entries.size > maximumSize) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
}
