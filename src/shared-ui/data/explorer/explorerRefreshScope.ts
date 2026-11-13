import type { DataNode, WorkspaceContentChange } from "../../core/types";
import { createWorkspaceResourceUri } from "../../core/resourceUri";
import { MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES } from "../../core/workspaceContentChange";

export type ExplorerRefreshScope =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "all" }>
  /** Loaded folders whose listings a change can affect; null is an unnamed tree root. */
  | Readonly<{ kind: "folders"; folders: readonly (string | null)[] }>;

/**
 * Decides which listings a content change can affect. A changed path can add,
 * remove or rename an entry of its parent, and replace the listing of itself
 * when it is a loaded folder. Folders that were never loaded need no refresh;
 * they read fresh bytes when opened. Unknown scope or a lost journal refreshes all.
 */
export function planExplorerRefresh(
  change: WorkspaceContentChange,
  afterSequence: number,
  tree: readonly DataNode[],
): ExplorerRefreshScope {
  if (change.sequence === afterSequence) return { kind: "none" };
  if (change.sequence < afterSequence) return { kind: "all" };
  // A newer sequence without a retained entry names nothing: the scope is unknown.
  const entries = change.entries.filter((entry) => entry.sequence > afterSequence);
  if (entries.length === 0) return { kind: "all" };
  const oldestRetained = change.entries[0]?.sequence ?? change.sequence;
  if (change.entries.length >= MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES && afterSequence < oldestRetained - 1) {
    return { kind: "all" };
  }
  const folders = new Set<string | null>();
  for (const entry of entries) {
    if (!entry.rootUri || entry.paths === null) return { kind: "all" };
    const rootUri = entry.rootUri;
    for (const path of entry.paths) {
      try {
        // The changed path itself, when it is a loaded folder, lists new entries.
        const self = findNode(tree, createWorkspaceResourceUri(rootUri, path));
        if (self?.type === "folder" && Array.isArray(self.children)) folders.add(self.path);
        // Its nearest loaded ancestor holds the row that was added, removed or
        // changed; an unloaded ancestor only needs its own row refreshed.
        let ancestor = parentPath(path);
        while (true) {
          if (ancestor === null) {
            const rootNode = findNode(tree, rootUri);
            // A single-Folder tree lists its root directly; the root has no row.
            folders.add(rootNode ? rootNode.path : null);
            break;
          }
          const node = findNode(tree, createWorkspaceResourceUri(rootUri, ancestor));
          if (node?.type === "folder" && Array.isArray(node.children)) { folders.add(node.path); break; }
          ancestor = parentPath(ancestor);
        }
      } catch {
        return { kind: "all" };
      }
    }
  }
  return folders.size > 0 ? { kind: "folders", folders: [...folders] } : { kind: "none" };
}

/** Provider-relative parent; null above a top-level entry. */
function parentPath(path: string): string | null {
  if (!path) return null;
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function findNode(nodes: readonly DataNode[], path: string): DataNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children && path.startsWith(`${node.path}/`)) {
      const child = findNode(node.children, path);
      if (child) return child;
    }
  }
  return null;
}
