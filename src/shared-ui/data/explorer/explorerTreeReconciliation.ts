import type { DataNode } from "../../core/types";

/**
 * Directory listings describe immediate children only. Reconciliation keeps
 * already-loaded descendants while accepting additions, removals and metadata
 * changes from the latest sibling listing. An unchanged listing returns the
 * previous array, so revalidating a folder whose entries did not change does
 * not re-render the tree.
 */
export function reconcileDataNodeLists(
  previousNodes: readonly DataNode[],
  listedNodes: readonly DataNode[],
): DataNode[] {
  const previousByPath = new Map(previousNodes.map((node) => [node.path, node]));
  let changed = previousNodes.length !== listedNodes.length;
  const nextNodes = listedNodes.map((listedNode, index) => {
    const next = reconcileNode(previousByPath.get(listedNode.path), listedNode);
    if (next !== previousNodes[index]) changed = true;
    return next;
  });
  return changed ? nextNodes : previousNodes as DataNode[];
}

function reconcileNode(previousNode: DataNode | undefined, listedNode: DataNode): DataNode {
  if (!previousNode) return listedNode;
  if (listedNode.type !== "folder" || previousNode.type !== "folder") {
    return sameNodeMetadata(previousNode, listedNode) ? previousNode : listedNode;
  }
  let children: DataNode["children"];
  if (!Array.isArray(listedNode.children)) {
    children = Array.isArray(previousNode.children) ? previousNode.children : listedNode.children;
  } else {
    children = reconcileDataNodeLists(previousNode.children ?? [], listedNode.children);
  }
  if (children === previousNode.children && sameNodeMetadata(previousNode, listedNode)) return previousNode;
  return { ...listedNode, children };
}

/** Field-by-field equality of everything except loaded children. */
function sameNodeMetadata(previousNode: DataNode, listedNode: DataNode): boolean {
  const keys = new Set([...Object.keys(previousNode), ...Object.keys(listedNode)]);
  for (const key of keys) {
    if (key === "children") continue;
    if (!Object.is(previousNode[key as keyof DataNode], listedNode[key as keyof DataNode])) return false;
  }
  return true;
}

export function reconcileFolderChildren(
  nodes: readonly DataNode[],
  folderPath: string | null,
  listedChildren: readonly DataNode[],
): DataNode[] {
  if (!folderPath) return reconcileDataNodeLists(nodes, listedChildren);

  let changed = false;
  const nextNodes = nodes.map((node) => {
    let next = node;
    if (node.path === folderPath) {
      const children = reconcileDataNodeLists(node.children ?? [], listedChildren);
      if (children !== node.children) next = { ...node, children };
    } else if (node.children) {
      const children = reconcileFolderChildren(node.children, folderPath, listedChildren);
      if (children !== node.children) next = { ...node, children };
    }
    if (next !== node) changed = true;
    return next;
  });
  return changed ? nextNodes : nodes as DataNode[];
}
