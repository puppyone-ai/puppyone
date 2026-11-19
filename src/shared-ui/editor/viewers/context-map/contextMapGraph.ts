import {
  createMarkdownLinkGraphIndex,
  type MarkdownLinkGraphDocument,
} from "../../markdown/linkIndex";
import type { MarkdownBacklink } from "../../registry/viewerTypes";
import type { DataNode, DataPort } from "../../../core/types";
import { isContextMapFilename } from "./contextMapDocument";

export const MAX_FOLDER_RELATIONSHIP_FILES = 1_000;

export type FolderRelationshipEdge = Readonly<{
  sourceId: string;
  targetId: string;
  count: number;
  bidirectional: boolean;
}>;

export type FolderRelationshipGraph = Readonly<{
  folder: DataNode;
  rootNodes: readonly DataNode[];
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  documentNodes: readonly DataNode[];
  backlinks: readonly (readonly [string, readonly MarkdownBacklink[]])[];
  indexedDocumentCount: number;
  scannedFileCount: number;
  truncated: boolean;
}>;

export type FolderRelationshipProjection = Readonly<{
  edges: readonly FolderRelationshipEdge[];
  relationshipCountByNode: ReadonlyMap<string, number>;
}>;

type ScannedFolderGraph = Readonly<{
  rootNodes: readonly DataNode[];
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  metadataNodes: readonly DataNode[];
  markdownSourcePaths: readonly string[];
  truncated: boolean;
}>;

type DirectionalRelationship = {
  sourceId: string;
  targetId: string;
  count: number;
};

export async function loadFolderRelationshipGraph({
  dataPort,
  folder,
  signal,
}: {
  dataPort: DataPort;
  folder: DataNode;
  signal?: AbortSignal;
}): Promise<FolderRelationshipGraph> {
  const scan = await scanFolderGraph(dataPort, folder.path || null, signal);
  if (!dataPort.readFile || scan.markdownSourcePaths.length === 0) {
    return {
      folder,
      rootNodes: scan.rootNodes,
      childrenByFolderPath: scan.childrenByFolderPath,
      documentNodes: scan.metadataNodes,
      backlinks: [],
      indexedDocumentCount: 0,
      scannedFileCount: scan.metadataNodes.length,
      truncated: scan.truncated,
    };
  }

  const markdownSourcePaths = new Set(scan.markdownSourcePaths);
  const documents: MarkdownLinkGraphDocument[] = [];
  for (const node of scan.metadataNodes) {
    signal?.throwIfAborted();
    if (!markdownSourcePaths.has(node.path)) {
      documents.push({ path: node.path, name: node.name, content: null });
      continue;
    }
    try {
      const file = await dataPort.readFile(node.path, { signal });
      documents.push({
        path: file.path,
        name: file.name,
        content: typeof file.content === "string" ? file.content : null,
      });
    } catch (error) {
      signal?.throwIfAborted();
      documents.push({ path: node.path, name: node.name, content: null });
    }
  }
  signal?.throwIfAborted();
  const snapshot = createMarkdownLinkGraphIndex(documents);

  return {
    folder,
    rootNodes: scan.rootNodes,
    childrenByFolderPath: scan.childrenByFolderPath,
    documentNodes: scan.metadataNodes,
    backlinks: snapshot.backlinks,
    indexedDocumentCount: snapshot.indexedDocumentCount,
    scannedFileCount: scan.metadataNodes.length,
    truncated: scan.truncated,
  };
}

/** Projects the complete root graph onto the user's current disclosure
 * frontier. A collapsed folder owns every document below it; once expanded,
 * those documents move to its visible children without changing the root
 * canvas or hiding any siblings. */
export function buildFolderRelationshipProjection(
  graph: FolderRelationshipGraph,
  expandedFolderPaths: ReadonlySet<string>,
): FolderRelationshipProjection {
  const expandedPaths = new Set([...expandedFolderPaths].map(normalizePath));
  const bucketByPath = new Map<string, string>();

  const collectIntoBucket = (node: DataNode, bucketId: string): void => {
    if (node.type !== "folder") {
      bucketByPath.set(normalizePath(node.path), bucketId);
      return;
    }
    for (const child of graph.childrenByFolderPath.get(normalizePath(node.path)) ?? []) {
      collectIntoBucket(child, bucketId);
    }
  };

  const visitVisibleNode = (node: DataNode): void => {
    if (node.type !== "folder") {
      bucketByPath.set(normalizePath(node.path), node.path);
      return;
    }
    if (!expandedPaths.has(normalizePath(node.path))) {
      collectIntoBucket(node, node.path);
      return;
    }
    for (const child of graph.childrenByFolderPath.get(normalizePath(node.path)) ?? []) {
      visitVisibleNode(child);
    }
  };

  for (const node of graph.rootNodes) visitVisibleNode(node);

  const edges = aggregateFolderRelationshipEdges(graph.backlinks, bucketByPath);
  const relationshipCountByNode = new Map<string, number>();
  for (const edge of edges) {
    relationshipCountByNode.set(
      edge.sourceId,
      (relationshipCountByNode.get(edge.sourceId) ?? 0) + edge.count,
    );
    relationshipCountByNode.set(
      edge.targetId,
      (relationshipCountByNode.get(edge.targetId) ?? 0) + edge.count,
    );
  }
  return { edges, relationshipCountByNode };
}

export function aggregateFolderRelationshipEdges(
  backlinksByTargetPath: readonly (readonly [string, readonly MarkdownBacklink[]])[],
  bucketByPath: ReadonlyMap<string, string>,
): FolderRelationshipEdge[] {
  const directionalByPair = new Map<string, DirectionalRelationship[]>();

  for (const [targetPath, backlinks] of backlinksByTargetPath) {
    const targetId = bucketByPath.get(normalizePath(targetPath));
    if (!targetId) continue;
    for (const backlink of backlinks) {
      const sourceId = bucketByPath.get(normalizePath(backlink.sourcePath));
      if (!sourceId || sourceId === targetId) continue;
      const pairKey = [sourceId, targetId].sort().join("\u0000");
      const relationships = directionalByPair.get(pairKey) ?? [];
      const existing = relationships.find((relationship) => (
        relationship.sourceId === sourceId && relationship.targetId === targetId
      ));
      if (existing) {
        existing.count += backlink.count;
      } else {
        relationships.push({ sourceId, targetId, count: backlink.count });
      }
      directionalByPair.set(pairKey, relationships);
    }
  }

  return [...directionalByPair.entries()]
    .map(([pairKey, relationships]) => {
      const [firstId, secondId] = pairKey.split("\u0000") as [string, string];
      const bidirectional = relationships.some((relationship) => relationship.sourceId === firstId)
        && relationships.some((relationship) => relationship.sourceId === secondId);
      const sourceId = bidirectional ? firstId : relationships[0].sourceId;
      const targetId = bidirectional ? secondId : relationships[0].targetId;
      return {
        sourceId,
        targetId,
        count: relationships.reduce((total, relationship) => total + relationship.count, 0),
        bidirectional,
      };
    })
    .sort((left, right) => right.count - left.count || left.sourceId.localeCompare(right.sourceId));
}

async function scanFolderGraph(
  dataPort: DataPort,
  folderPath: string | null,
  signal?: AbortSignal,
): Promise<ScannedFolderGraph> {
  const childrenByFolderPath = new Map<string, readonly DataNode[]>();
  const metadataNodes: DataNode[] = [];
  const markdownSourcePaths: string[] = [];
  let truncated = false;

  const collectFolder = async (path: string | null): Promise<readonly DataNode[]> => {
    signal?.throwIfAborted();
    if (truncated) return [];
    const children = (await dataPort.listChildren(path))
      .filter((node) => !isContextMapFilename(node.name))
      .sort(compareNodes);
    childrenByFolderPath.set(normalizePath(path ?? ""), children);
    for (const node of children) {
      signal?.throwIfAborted();
      if (node.type === "folder") {
        await collectFolder(node.path);
        continue;
      }
      if (metadataNodes.length >= MAX_FOLDER_RELATIONSHIP_FILES) {
        truncated = true;
        break;
      }
      metadataNodes.push(node);
      if (isMarkdownNode(node)) markdownSourcePaths.push(node.path);
    }
    return children;
  };

  const rootNodes = await collectFolder(folderPath);
  return {
    rootNodes,
    childrenByFolderPath,
    metadataNodes,
    markdownSourcePaths,
    truncated,
  };
}

function compareNodes(left: DataNode, right: DataNode): number {
  if (left.type === "folder" && right.type !== "folder") return -1;
  if (left.type !== "folder" && right.type === "folder") return 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function isMarkdownNode(node: DataNode): boolean {
  return node.type === "markdown" || /\.mdx?$/i.test(node.name);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
