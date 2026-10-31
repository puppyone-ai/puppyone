import type { DataNode } from "../../core/types";

/**
 * Directory listings describe immediate children only. Reconciliation keeps
 * already-loaded descendants while accepting additions, removals and metadata
 * changes from the latest sibling listing.
 */
export function reconcileDataNodeLists(
  previousNodes: readonly DataNode[],
  listedNodes: readonly DataNode[],
): DataNode[] {
  const previousByPath = new Map(previousNodes.map((node) => [node.path, node]));
  return listedNodes.map((listedNode) => {
    const previousNode = previousByPath.get(listedNode.path);
    if (!previousNode || listedNode.type !== "folder" || previousNode.type !== "folder") {
      return listedNode;
    }

    if (!Array.isArray(listedNode.children)) {
      return Array.isArray(previousNode.children)
        ? { ...listedNode, children: previousNode.children }
        : listedNode;
    }

    return {
      ...listedNode,
      children: reconcileDataNodeLists(previousNode.children ?? [], listedNode.children),
    };
  });
}

export function reconcileFolderChildren(
  nodes: readonly DataNode[],
  folderPath: string | null,
  listedChildren: readonly DataNode[],
): DataNode[] {
  if (!folderPath) return reconcileDataNodeLists(nodes, listedChildren);

  return nodes.map((node) => {
    if (node.path === folderPath) {
      return {
        ...node,
        children: reconcileDataNodeLists(node.children ?? [], listedChildren),
      };
    }
    if (node.children) {
      return {
        ...node,
        children: reconcileFolderChildren(node.children, folderPath, listedChildren),
      };
    }
    return node;
  });
}
