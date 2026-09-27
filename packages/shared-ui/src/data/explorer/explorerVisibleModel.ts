import type { DataNode } from "../../core/types";
import { getMatchedExtension } from "../../core/fileFormats";

export type ExplorerDisplayName = {
  primary: string;
  extension: string | null;
};

export type ExplorerVisibleNodeRow = {
  kind: "node";
  key: string;
  node: DataNode;
  path: string;
  parentPath: string | null;
  depth: number;
  index: number;
  positionInSet: number;
  setSize: number;
  siblingDisplayNameCounts: ReadonlyMap<string, number>;
};

export type ExplorerVisibleMetaRow = {
  kind: "meta";
  key: string;
  depth: number;
  index: number;
  label: string;
  loading: boolean;
};

export type ExplorerVisibleRow = ExplorerVisibleNodeRow | ExplorerVisibleMetaRow;

export type ExplorerVisibleModel = {
  rows: readonly ExplorerVisibleRow[];
  pathToIndex: ReadonlyMap<string, number>;
  pathToNode: ReadonlyMap<string, DataNode>;
};

export type BuildExplorerVisibleModelOptions = {
  expandedPaths: ReadonlySet<string>;
  loadingPaths?: ReadonlySet<string>;
  loadingLabel: string;
};

const EMPTY_PATH_SET: ReadonlySet<string> = new Set();

/**
 * Produces the stable, complete navigation model used by virtualization,
 * keyboard navigation, range selection, drag/drop and scroll-to-active.
 * Selection is intentionally absent: selecting a row must never rebuild this
 * array or walk the workspace tree.
 */
export function buildExplorerVisibleModel(
  nodes: readonly DataNode[],
  {
    expandedPaths,
    loadingPaths = EMPTY_PATH_SET,
    loadingLabel,
  }: BuildExplorerVisibleModelOptions,
): ExplorerVisibleModel {
  const rows: ExplorerVisibleRow[] = [];
  const pathToIndex = new Map<string, number>();
  const pathToNode = new Map<string, DataNode>();

  const appendSiblings = (
    siblings: readonly DataNode[],
    depth: number,
    parentPath: string | null,
  ) => {
    const siblingDisplayNameCounts = buildDisplayNameCounts(siblings);
    const setSize = siblings.length;

    for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
      const node = siblings[siblingIndex];
      if (!node) continue;

      const index = rows.length;
      rows.push({
        kind: "node",
        key: node.path,
        node,
        path: node.path,
        parentPath,
        depth,
        index,
        positionInSet: siblingIndex + 1,
        setSize,
        siblingDisplayNameCounts,
      });
      pathToIndex.set(node.path, index);
      pathToNode.set(node.path, node);

      if (node.type !== "folder" || !expandedPaths.has(node.path)) continue;

      const children = node.children ?? [];
      if (children.length > 0) {
        appendSiblings(children, depth + 1, node.path);
        continue;
      }

      if (loadingPaths.has(node.path)) {
        rows.push({
          kind: "meta",
          key: `${node.path}:loading`,
          depth: depth + 1,
          index: rows.length,
          label: loadingLabel,
          loading: true,
        });
      }
    }
  };

  appendSiblings(nodes, 0, null);
  return { rows, pathToIndex, pathToNode };
}

export function buildExplorerNodeIndex(nodes: readonly DataNode[]): ReadonlyMap<string, DataNode> {
  const result = new Map<string, DataNode>();
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    result.set(node.path, node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

export function getExplorerDisplayName(node: DataNode): ExplorerDisplayName {
  if (node.type === "folder") {
    return { primary: node.name, extension: null };
  }

  const matchedExtension = getMatchedExtension(node.name);
  if (!matchedExtension) {
    return { primary: node.name, extension: null };
  }

  const suffix = `.${matchedExtension}`;
  const primary = node.name.slice(0, -suffix.length);
  return {
    primary: primary || node.name,
    extension: primary ? matchedExtension : null,
  };
}

export function getDisplayNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function buildDisplayNameCounts(nodes: readonly DataNode[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const displayName = getExplorerDisplayName(node);
    const key = getDisplayNameKey(displayName.primary);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
