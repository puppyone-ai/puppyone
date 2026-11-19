import type { DataNode } from "../../../core/types";
import type { FolderRelationshipEdge } from "./contextMapGraph";

export type RelationshipLayoutRole = "folders" | "linked" | "unlinked";

export type RelationshipLayoutEntry = Readonly<{
  node: DataNode;
  originalIndex: number;
  relationshipCount: number;
}>;

export type RelationshipLayoutZone = Readonly<{
  role: RelationshipLayoutRole;
  nodes: readonly RelationshipLayoutEntry[];
}>;

export type RelationshipLayoutOffset = Readonly<{
  x: number;
  y: number;
}>;

export type RelationshipDragLimits = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

export type RelationshipViewportTransform = Readonly<{
  x: number;
  y: number;
  scale: number;
}>;

export type RelationshipSceneLayout = Readonly<{
  height: number;
  positions: ReadonlyMap<string, RelationshipLayoutOffset>;
  width: number;
}>;

export type RadialRelationshipLayoutNode = Readonly<{
  angle: number;
  depth: number;
  node: DataNode;
  parentPath: string | null;
  radius: number;
  x: number;
  y: number;
}>;

export type RadialRelationshipHierarchyEdge = Readonly<{
  sourceId: string;
  targetId: string;
}>;

export type RadialRelationshipSceneLayout = Readonly<{
  center: RelationshipLayoutOffset;
  height: number;
  hierarchyEdges: readonly RadialRelationshipHierarchyEdge[];
  nodes: readonly RadialRelationshipLayoutNode[];
  positions: ReadonlyMap<string, RadialRelationshipLayoutNode>;
  ringRadii: readonly number[];
  width: number;
}>;

export type RadialRelationshipSceneLayoutInput = Readonly<{
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  expandedFolderPaths: ReadonlySet<string>;
  root: DataNode;
  rootNodes: readonly DataNode[];
}>;

export type LayeredRelationshipLayoutNode = Readonly<{
  depth: number;
  node: DataNode;
  parentPath: string | null;
  x: number;
  y: number;
}>;

export type LayeredRelationshipSceneLayout = Readonly<{
  anchor: RelationshipLayoutOffset;
  height: number;
  hierarchyEdges: readonly RadialRelationshipHierarchyEdge[];
  nodes: readonly LayeredRelationshipLayoutNode[];
  positions: ReadonlyMap<string, LayeredRelationshipLayoutNode>;
  width: number;
}>;

export type LayeredRelationshipSceneLayoutInput = RadialRelationshipSceneLayoutInput;

export type FolderRelationshipSceneLayoutInput = Readonly<{
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  edges: readonly FolderRelationshipEdge[];
  expandedFolderPaths: ReadonlySet<string>;
  manualOffsetsByNode?: ReadonlyMap<string, RelationshipLayoutOffset>;
  nodes: readonly DataNode[];
  pinnedNodePaths?: ReadonlySet<string>;
  previousPositions?: ReadonlyMap<string, RelationshipLayoutOffset>;
  relationshipCountByNode: ReadonlyMap<string, number>;
}>;

const RELATIONSHIP_NODE_WIDTH = 112;
const EXPANDED_GROUP_HORIZONTAL_GAP = 32;
const EXPANDED_GROUP_HORIZONTAL_PADDING = 48;
const EXPANDED_GROUP_BORDER_WIDTH = 2;
const EXPANDED_GROUP_MAX_COLUMNS = 5;
const RELATIONSHIP_NODE_HEIGHT = 78;
const RELATIONSHIP_SCENE_MIN_WIDTH = 1120;
const RELATIONSHIP_SCENE_MIN_HEIGHT = 640;
const RELATIONSHIP_FOLDER_GAP = 72;
const RELATIONSHIP_FORCE_ITERATIONS = 42;
const RADIAL_RELATIONSHIP_RING_GAP = 148;
const RADIAL_RELATIONSHIP_NODE_ARC_LENGTH = 132;
const RADIAL_RELATIONSHIP_SCENE_PADDING = 124;
const RADIAL_RELATIONSHIP_SCENE_MIN_SIZE = 760;
const LAYERED_RELATIONSHIP_HORIZONTAL_GAP = 148;
const LAYERED_RELATIONSHIP_VERTICAL_GAP = 152;
const LAYERED_RELATIONSHIP_HORIZONTAL_PADDING = 124;
const LAYERED_RELATIONSHIP_TOP_PADDING = 96;
const LAYERED_RELATIONSHIP_BOTTOM_PADDING = 112;
const LAYERED_RELATIONSHIP_SCENE_MIN_WIDTH = 760;
const LAYERED_RELATIONSHIP_SCENE_MIN_HEIGHT = 560;

type MutableSceneNode = {
  height: number;
  id: string;
  pinned: boolean;
  vx: number;
  vy: number;
  width: number;
  x: number;
  y: number;
};

type MutableRadialTreeNode = {
  angle: number;
  children: MutableRadialTreeNode[];
  depth: number;
  node: DataNode;
  parentPath: string | null;
  weight: number;
};

type MutableLayeredTreeNode = {
  children: MutableLayeredTreeNode[];
  depth: number;
  node: DataNode;
  parentPath: string | null;
  xSlot: number;
};

export function buildFolderRelationshipLayoutZones(
  nodes: readonly DataNode[],
  edges: readonly FolderRelationshipEdge[],
  relationshipCountByNode: ReadonlyMap<string, number>,
): readonly RelationshipLayoutZone[] {
  const entries = nodes.map((node, originalIndex) => ({
    node,
    originalIndex,
    relationshipCount: relationshipCountByNode.get(node.path) ?? 0,
  }));
  const folders = entries.filter((entry) => entry.node.type === "folder");
  const folderIndexByPath = new Map(
    folders.map((entry, index) => [entry.node.path, index] as const),
  );
  const linked = entries
    .filter((entry) => entry.node.type !== "folder" && entry.relationshipCount > 0)
    .map((entry) => ({
      ...entry,
      affinity: getFolderAffinity(entry.node.path, edges, folderIndexByPath),
    }));
  const sortedLinked = linked.length > 0 && folders.length === 0
    ? centerHighestRelationshipCount(linked)
    : linked.sort((left, right) => (
      left.affinity - right.affinity
      || right.relationshipCount - left.relationshipCount
      || left.originalIndex - right.originalIndex
    ));
  const unlinked = entries.filter((entry) => (
    entry.node.type !== "folder" && entry.relationshipCount === 0
  ));
  return [
    { role: "folders" as const, nodes: folders },
    { role: "linked" as const, nodes: sortedLinked },
    { role: "unlinked" as const, nodes: unlinked },
  ].filter((zone) => zone.nodes.length > 0);
}

export function getFolderRelationshipLayoutOffset(
  index: number,
  count: number,
  role: RelationshipLayoutRole,
): number {
  if (count <= 1 || role === "unlinked") return 0;
  if (role === "folders") {
    const center = (count - 1) / 2;
    const radius = Math.max(1, center);
    return Math.round((Math.abs(index - center) / radius) * 10 - 6);
  }
  return Math.round(Math.sin(index * 1.7) * 7);
}

export function getExpandedFolderPreferredWidth(childCount: number): number {
  const columnCount = Math.min(
    EXPANDED_GROUP_MAX_COLUMNS,
    Math.max(1, Math.floor(childCount)),
  );
  return EXPANDED_GROUP_BORDER_WIDTH
    + EXPANDED_GROUP_HORIZONTAL_PADDING
    + columnCount * RELATIONSHIP_NODE_WIDTH
    + (columnCount - 1) * EXPANDED_GROUP_HORIZONTAL_GAP;
}

/**
 * Computes a stable macro layout for top-level folders. Only macro nodes enter
 * the bounded force pass; root files are assigned to a compact document rail.
 */
export function buildFolderRelationshipSceneLayout({
  childrenByFolderPath,
  edges,
  expandedFolderPaths,
  manualOffsetsByNode = new Map(),
  nodes,
  pinnedNodePaths = new Set(),
  previousPositions,
  relationshipCountByNode,
}: FolderRelationshipSceneLayoutInput): RelationshipSceneLayout {
  const normalizedExpandedPaths = new Set([...expandedFolderPaths].map(normalizePath));
  const folders = nodes.filter((node) => node.type === "folder");
  const files = nodes.filter((node) => node.type !== "folder");
  const sizes = new Map(nodes.map((node) => [
    node.path,
    getSceneNodeSize(
      node,
      childrenByFolderPath,
      normalizedExpandedPaths,
      relationshipCountByNode,
    ),
  ] as const));
  const estimatedArea = folders.reduce((total, folder) => {
    const size = sizes.get(folder.path) ?? { width: RELATIONSHIP_NODE_WIDTH, height: RELATIONSHIP_NODE_HEIGHT };
    return total + (size.width + RELATIONSHIP_FOLDER_GAP * 2)
      * (size.height + RELATIONSHIP_FOLDER_GAP * 2);
  }, 0);
  const width = Math.max(
    RELATIONSHIP_SCENE_MIN_WIDTH,
    Math.ceil(Math.sqrt(Math.max(1, estimatedArea) * 1.7)),
  );
  const fileRailRows = Math.max(1, Math.ceil(files.length / Math.max(1, Math.floor(width / 156))));
  const fileRailHeight = files.length > 0 ? 52 + fileRailRows * 112 : 0;
  const folderAreaHeight = Math.max(
    RELATIONSHIP_SCENE_MIN_HEIGHT - fileRailHeight,
    Math.ceil(Math.max(1, estimatedArea) / width * 1.18),
  );
  const height = Math.max(RELATIONSHIP_SCENE_MIN_HEIGHT, folderAreaHeight + fileRailHeight);
  const weights = getTopLevelFolderWeights(nodes, folders, edges);
  const mutableFolders = createMutableFolderSceneNodes({
    folders,
    height: folderAreaHeight,
    manualOffsetsByNode,
    pinnedNodePaths,
    previousPositions,
    sizes,
    width,
  });
  simulateFolderScene(mutableFolders, weights, width, folderAreaHeight);

  const positions = new Map<string, RelationshipLayoutOffset>();
  for (const folder of mutableFolders) {
    const manualOffset = manualOffsetsByNode.get(folder.id) ?? { x: 0, y: 0 };
    positions.set(folder.id, {
      x: Math.round((folder.x - folder.width / 2 - manualOffset.x) * 100) / 100,
      y: Math.round((folder.y - folder.height / 2 - manualOffset.y) * 100) / 100,
    });
  }
  placeRootFiles({
    files,
    height,
    pinnedNodePaths,
    positions,
    previousPositions,
    relationshipCountByNode,
    width,
  });
  return { height, positions, width };
}

/**
 * Places the visible disclosure tree on concentric depth rings. Each subtree
 * owns one contiguous angular sector, which keeps the polar hierarchy routes
 * deterministic and prevents sibling branches from crossing.
 */
export function buildRadialRelationshipSceneLayout({
  childrenByFolderPath,
  expandedFolderPaths,
  root,
  rootNodes,
}: RadialRelationshipSceneLayoutInput): RadialRelationshipSceneLayout {
  const normalizedExpandedPaths = new Set([...expandedFolderPaths].map(normalizePath));
  const radialRoot = createRadialTreeNode({
    childrenByFolderPath,
    depth: 0,
    expandedFolderPaths: normalizedExpandedPaths,
    node: root,
    parentPath: null,
    rootChildren: rootNodes,
  });
  radialRoot.angle = -Math.PI / 2;
  assignRadialChildSectors(radialRoot, -Math.PI / 2, Math.PI * 3 / 2);

  const visibleNodes = flattenRadialTree(radialRoot);
  const maximumDepth = visibleNodes.reduce((maximum, entry) => (
    Math.max(maximum, entry.depth)
  ), 0);
  const ringRadii: number[] = [];
  let previousRadius = 0;
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    const nodeCount = visibleNodes.filter((entry) => entry.depth === depth).length;
    const circumferenceRadius = nodeCount * RADIAL_RELATIONSHIP_NODE_ARC_LENGTH
      / (Math.PI * 2);
    const radius = Math.ceil(Math.max(
      previousRadius + RADIAL_RELATIONSHIP_RING_GAP,
      circumferenceRadius,
    ));
    ringRadii.push(radius);
    previousRadius = radius;
  }

  const outerRadius = ringRadii.at(-1) ?? 0;
  const sceneSize = Math.max(
    RADIAL_RELATIONSHIP_SCENE_MIN_SIZE,
    Math.ceil((outerRadius + RADIAL_RELATIONSHIP_SCENE_PADDING) * 2),
  );
  const center = { x: sceneSize / 2, y: sceneSize / 2 };
  const nodes = visibleNodes.map<RadialRelationshipLayoutNode>((entry) => {
    const radius = entry.depth === 0 ? 0 : ringRadii[entry.depth - 1] ?? 0;
    return {
      angle: entry.angle,
      depth: entry.depth,
      node: entry.node,
      parentPath: entry.parentPath,
      radius,
      x: center.x + Math.cos(entry.angle) * radius,
      y: center.y + Math.sin(entry.angle) * radius,
    };
  });
  const positions = new Map(nodes.map((entry) => [entry.node.path, entry] as const));
  const hierarchyEdges = nodes.flatMap((entry) => entry.parentPath === null ? [] : [{
    sourceId: entry.parentPath,
    targetId: entry.node.path,
  }]);
  return {
    center,
    height: sceneSize,
    hierarchyEdges,
    nodes,
    positions,
    ringRadii,
    width: sceneSize,
  };
}

/**
 * Places the visible disclosure tree from top to bottom. Depth maps directly
 * to the y axis, while leaf slots reserve the horizontal width of each
 * subtree so parents remain centered over their visible descendants.
 */
export function buildLayeredRelationshipSceneLayout({
  childrenByFolderPath,
  expandedFolderPaths,
  root,
  rootNodes,
}: LayeredRelationshipSceneLayoutInput): LayeredRelationshipSceneLayout {
  const normalizedExpandedPaths = new Set([...expandedFolderPaths].map(normalizePath));
  const layeredRoot = createLayeredTreeNode({
    childrenByFolderPath,
    depth: 0,
    expandedFolderPaths: normalizedExpandedPaths,
    node: root,
    parentPath: null,
    rootChildren: rootNodes,
  });
  let nextLeafSlot = 0;
  const assignHorizontalSlots = (entry: MutableLayeredTreeNode): number => {
    if (entry.children.length === 0) {
      entry.xSlot = nextLeafSlot;
      nextLeafSlot += 1;
      return entry.xSlot;
    }
    const childSlots = entry.children.map(assignHorizontalSlots);
    entry.xSlot = ((childSlots[0] ?? 0) + (childSlots.at(-1) ?? 0)) / 2;
    return entry.xSlot;
  };
  assignHorizontalSlots(layeredRoot);

  const visibleNodes = flattenLayeredTree(layeredRoot);
  const maximumDepth = visibleNodes.reduce((maximum, entry) => (
    Math.max(maximum, entry.depth)
  ), 0);
  const leafCount = Math.max(1, nextLeafSlot);
  const contentWidth = Math.max(0, (leafCount - 1) * LAYERED_RELATIONSHIP_HORIZONTAL_GAP);
  const width = Math.max(
    LAYERED_RELATIONSHIP_SCENE_MIN_WIDTH,
    contentWidth + LAYERED_RELATIONSHIP_HORIZONTAL_PADDING * 2,
  );
  const height = Math.max(
    LAYERED_RELATIONSHIP_SCENE_MIN_HEIGHT,
    LAYERED_RELATIONSHIP_TOP_PADDING
      + maximumDepth * LAYERED_RELATIONSHIP_VERTICAL_GAP
      + LAYERED_RELATIONSHIP_BOTTOM_PADDING,
  );
  const horizontalOffset = (width - contentWidth) / 2;
  const nodes = visibleNodes.map<LayeredRelationshipLayoutNode>((entry) => ({
    depth: entry.depth,
    node: entry.node,
    parentPath: entry.parentPath,
    x: horizontalOffset + entry.xSlot * LAYERED_RELATIONSHIP_HORIZONTAL_GAP,
    y: LAYERED_RELATIONSHIP_TOP_PADDING + entry.depth * LAYERED_RELATIONSHIP_VERTICAL_GAP,
  }));
  const positions = new Map(nodes.map((entry) => [entry.node.path, entry] as const));
  const hierarchyEdges = nodes.flatMap((entry) => entry.parentPath === null ? [] : [{
    sourceId: entry.parentPath,
    targetId: entry.node.path,
  }]);
  const anchor = positions.get(root.path) ?? {
    x: width / 2,
    y: LAYERED_RELATIONSHIP_TOP_PADDING,
  };
  return {
    anchor: { x: anchor.x, y: anchor.y },
    height,
    hierarchyEdges,
    nodes,
    positions,
    width,
  };
}

function createLayeredTreeNode({
  childrenByFolderPath,
  depth,
  expandedFolderPaths,
  node,
  parentPath,
  rootChildren,
}: Readonly<{
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  depth: number;
  expandedFolderPaths: ReadonlySet<string>;
  node: DataNode;
  parentPath: string | null;
  rootChildren?: readonly DataNode[];
}>): MutableLayeredTreeNode {
  const children = rootChildren ?? (node.type === "folder"
    && expandedFolderPaths.has(normalizePath(node.path))
    ? childrenByFolderPath.get(normalizePath(node.path)) ?? []
    : []);
  const entry: MutableLayeredTreeNode = {
    children: [],
    depth,
    node,
    parentPath,
    xSlot: 0,
  };
  entry.children = children.map((child) => createLayeredTreeNode({
    childrenByFolderPath,
    depth: depth + 1,
    expandedFolderPaths,
    node: child,
    parentPath: node.path,
  }));
  return entry;
}

function flattenLayeredTree(root: MutableLayeredTreeNode): MutableLayeredTreeNode[] {
  const nodes: MutableLayeredTreeNode[] = [];
  const visit = (entry: MutableLayeredTreeNode): void => {
    nodes.push(entry);
    entry.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

function createRadialTreeNode({
  childrenByFolderPath,
  depth,
  expandedFolderPaths,
  node,
  parentPath,
  rootChildren,
}: Readonly<{
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>;
  depth: number;
  expandedFolderPaths: ReadonlySet<string>;
  node: DataNode;
  parentPath: string | null;
  rootChildren?: readonly DataNode[];
}>): MutableRadialTreeNode {
  const children = rootChildren ?? (node.type === "folder"
    && expandedFolderPaths.has(normalizePath(node.path))
    ? childrenByFolderPath.get(normalizePath(node.path)) ?? []
    : []);
  const entry: MutableRadialTreeNode = {
    angle: 0,
    children: [],
    depth,
    node,
    parentPath,
    weight: 1,
  };
  entry.children = children.map((child) => createRadialTreeNode({
    childrenByFolderPath,
    depth: depth + 1,
    expandedFolderPaths,
    node: child,
    parentPath: node.path,
  }));
  entry.weight = entry.children.length > 0
    ? entry.children.reduce((total, child) => total + child.weight, 0)
    : 1;
  return entry;
}

function assignRadialChildSectors(
  parent: MutableRadialTreeNode,
  sectorStart: number,
  sectorEnd: number,
): void {
  if (parent.children.length === 0) return;
  const totalWeight = parent.children.reduce((total, child) => total + child.weight, 0);
  let cursor = sectorStart;
  for (const child of parent.children) {
    const childSpan = (sectorEnd - sectorStart) * child.weight / totalWeight;
    const childStart = cursor;
    const childEnd = childStart + childSpan;
    child.angle = (childStart + childEnd) / 2;
    const padding = Math.min(0.06, childSpan * 0.08);
    assignRadialChildSectors(child, childStart + padding, childEnd - padding);
    cursor = childEnd;
  }
}

function flattenRadialTree(root: MutableRadialTreeNode): MutableRadialTreeNode[] {
  const nodes: MutableRadialTreeNode[] = [];
  const visit = (entry: MutableRadialTreeNode): void => {
    nodes.push(entry);
    entry.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

function createMutableFolderSceneNodes({
  folders,
  height,
  manualOffsetsByNode,
  pinnedNodePaths,
  previousPositions,
  sizes,
  width,
}: Readonly<{
  folders: readonly DataNode[];
  height: number;
  manualOffsetsByNode: ReadonlyMap<string, RelationshipLayoutOffset>;
  pinnedNodePaths: ReadonlySet<string>;
  previousPositions: ReadonlyMap<string, RelationshipLayoutOffset> | undefined;
  sizes: ReadonlyMap<string, Readonly<{ height: number; width: number }>>;
  width: number;
}>): MutableSceneNode[] {
  const count = Math.max(1, folders.length);
  const orbitX = Math.max(120, width * 0.31);
  const orbitY = Math.max(100, height * 0.27);
  return folders.map((folder, index) => {
    const size = sizes.get(folder.path) ?? {
      height: RELATIONSHIP_NODE_HEIGHT,
      width: RELATIONSHIP_NODE_WIDTH,
    };
    const previous = previousPositions?.get(folder.path);
    const manualOffset = manualOffsetsByNode.get(folder.path) ?? { x: 0, y: 0 };
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return {
      height: size.height,
      id: folder.path,
      pinned: pinnedNodePaths.has(folder.path) && Boolean(previous),
      vx: 0,
      vy: 0,
      width: size.width,
      x: previous
        ? previous.x + manualOffset.x + size.width / 2
        : width / 2 + Math.cos(angle) * orbitX,
      y: previous
        ? previous.y + manualOffset.y + size.height / 2
        : height / 2 + Math.sin(angle) * orbitY,
    };
  });
}

function simulateFolderScene(
  nodes: MutableSceneNode[],
  weights: ReadonlyMap<string, number>,
  width: number,
  height: number,
): void {
  if (nodes.length > 180) {
    arrangeDenseFolderGrid(nodes, width);
    return;
  }
  const iterationCount = nodes.length <= 60
    ? RELATIONSHIP_FORCE_ITERATIONS
    : nodes.length <= 120 ? 24 : 12;
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }));
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const dx = right.x - left.x || stablePairDirection(left.id, right.id);
        const dy = right.y - left.y || stablePairDirection(right.id, left.id);
        const distance = Math.max(1, Math.hypot(dx, dy));
        const directionX = dx / distance;
        const directionY = dy / distance;
        const repulsion = 34_000 / (distance * distance + 80);
        applyPairForce(forces, leftIndex, rightIndex, -directionX * repulsion, -directionY * repulsion);

        const weight = weights.get(getRelationshipPairKey(left.id, right.id)) ?? 0;
        if (weight > 0) {
          const desiredDistance = 150 + Math.max(left.width, left.height) / 2
            + Math.max(right.width, right.height) / 2;
          const attraction = (distance - desiredDistance)
            * (0.006 + Math.min(0.018, Math.log2(weight + 1) * 0.003));
          applyPairForce(
            forces,
            leftIndex,
            rightIndex,
            directionX * attraction,
            directionY * attraction,
          );
        }

        const overlapX = (left.width + right.width) / 2 + RELATIONSHIP_FOLDER_GAP - Math.abs(dx);
        const overlapY = (left.height + right.height) / 2 + RELATIONSHIP_FOLDER_GAP - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            applyPairForce(
              forces,
              leftIndex,
              rightIndex,
              -Math.sign(dx || 1) * overlapX * 0.12,
              0,
            );
          } else {
            applyPairForce(
              forces,
              leftIndex,
              rightIndex,
              0,
              -Math.sign(dy || 1) * overlapY * 0.12,
            );
          }
        }
      }
    }

    nodes.forEach((node, index) => {
      if (node.pinned) return;
      forces[index].x += (width / 2 - node.x) * 0.0025;
      forces[index].y += (height / 2 - node.y) * 0.0025;
      node.vx = (node.vx + forces[index].x) * 0.72;
      node.vy = (node.vy + forces[index].y) * 0.72;
      node.x = clampAxis(
        node.x + node.vx,
        width / 2,
        node.width / 2 + 28,
        width - node.width / 2 - 28,
      );
      node.y = clampAxis(
        node.y + node.vy,
        height / 2,
        node.height / 2 + 28,
        height - node.height / 2 - 28,
      );
    });
  }
  resolveFolderCollisions(nodes, width, height);
}

function arrangeDenseFolderGrid(nodes: MutableSceneNode[], width: number): void {
  const pinnedNodes = nodes.filter((node) => node.pinned);
  let cursorX = 28;
  let cursorY = 28;
  let rowHeight = 0;
  for (const node of nodes) {
    if (node.pinned) continue;
    if (cursorX > 28 && cursorX + node.width > width - 28) {
      cursorX = 28;
      cursorY += rowHeight + RELATIONSHIP_FOLDER_GAP;
      rowHeight = 0;
    }
    const blockingPinnedNode = pinnedNodes.find((pinnedNode) => (
      cursorX < pinnedNode.x + pinnedNode.width / 2 + RELATIONSHIP_FOLDER_GAP
      && cursorX + node.width + RELATIONSHIP_FOLDER_GAP > pinnedNode.x - pinnedNode.width / 2
      && cursorY < pinnedNode.y + pinnedNode.height / 2 + RELATIONSHIP_FOLDER_GAP
      && cursorY + node.height + RELATIONSHIP_FOLDER_GAP > pinnedNode.y - pinnedNode.height / 2
    ));
    if (blockingPinnedNode) {
      cursorX = blockingPinnedNode.x + blockingPinnedNode.width / 2
        + RELATIONSHIP_FOLDER_GAP;
      if (cursorX + node.width > width - 28) {
        cursorX = 28;
        cursorY += Math.max(rowHeight, node.height) + RELATIONSHIP_FOLDER_GAP;
        rowHeight = 0;
      }
    }
    node.x = cursorX + node.width / 2;
    node.y = cursorY + node.height / 2;
    cursorX += node.width + RELATIONSHIP_FOLDER_GAP;
    rowHeight = Math.max(rowHeight, node.height);
  }
}

function resolveFolderCollisions(
  nodes: MutableSceneNode[],
  width: number,
  height: number,
): void {
  for (let pass = 0; pass < 18; pass += 1) {
    let collisionFound = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const overlapX = (left.width + right.width) / 2
          + RELATIONSHIP_FOLDER_GAP - Math.abs(dx);
        const overlapY = (left.height + right.height) / 2
          + RELATIONSHIP_FOLDER_GAP - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0 || (left.pinned && right.pinned)) continue;
        collisionFound = true;
        if (overlapX < overlapY) {
          separateSceneNodes(left, right, "x", Math.sign(dx || 1), overlapX + 0.5);
        } else {
          separateSceneNodes(left, right, "y", Math.sign(dy || 1), overlapY + 0.5);
        }
        clampSceneNode(left, width, height);
        clampSceneNode(right, width, height);
      }
    }
    if (!collisionFound) break;
  }
}

function separateSceneNodes(
  left: MutableSceneNode,
  right: MutableSceneNode,
  axis: "x" | "y",
  direction: number,
  distance: number,
): void {
  const leftDistance = right.pinned ? distance : left.pinned ? 0 : distance / 2;
  const rightDistance = left.pinned ? distance : right.pinned ? 0 : distance / 2;
  left[axis] -= direction * leftDistance;
  right[axis] += direction * rightDistance;
}

function clampSceneNode(node: MutableSceneNode, width: number, height: number): void {
  if (node.pinned) return;
  node.x = clampAxis(node.x, width / 2, node.width / 2 + 28, width - node.width / 2 - 28);
  node.y = clampAxis(node.y, height / 2, node.height / 2 + 28, height - node.height / 2 - 28);
}

function applyPairForce(
  forces: Array<{ x: number; y: number }>,
  leftIndex: number,
  rightIndex: number,
  x: number,
  y: number,
): void {
  forces[leftIndex].x += x;
  forces[leftIndex].y += y;
  forces[rightIndex].x -= x;
  forces[rightIndex].y -= y;
}

function getTopLevelFolderWeights(
  rootNodes: readonly DataNode[],
  folders: readonly DataNode[],
  edges: readonly FolderRelationshipEdge[],
): ReadonlyMap<string, number> {
  const folderPaths = new Set(folders.map((folder) => folder.path));
  const weights = new Map<string, number>();
  for (const edge of edges) {
    const sourceOwner = getRootOwner(edge.sourceId, rootNodes);
    const targetOwner = getRootOwner(edge.targetId, rootNodes);
    if (
      !sourceOwner
      || !targetOwner
      || sourceOwner === targetOwner
      || !folderPaths.has(sourceOwner)
      || !folderPaths.has(targetOwner)
    ) continue;
    const key = getRelationshipPairKey(sourceOwner, targetOwner);
    weights.set(key, (weights.get(key) ?? 0) + edge.count);
  }
  return weights;
}

function placeRootFiles({
  files,
  height,
  pinnedNodePaths,
  positions,
  previousPositions,
  relationshipCountByNode,
  width,
}: Readonly<{
  files: readonly DataNode[];
  height: number;
  pinnedNodePaths: ReadonlySet<string>;
  positions: Map<string, RelationshipLayoutOffset>;
  previousPositions: ReadonlyMap<string, RelationshipLayoutOffset> | undefined;
  relationshipCountByNode: ReadonlyMap<string, number>;
  width: number;
}>): void {
  const ordered = centerHighestRelationshipCount(files.map((node, originalIndex) => ({
    node,
    originalIndex,
    relationshipCount: relationshipCountByNode.get(node.path) ?? 0,
  })));
  const columns = Math.max(1, Math.floor((width - 96) / 156));
  const rows = Math.max(1, Math.ceil(ordered.length / columns));
  const usedColumns = Math.min(columns, Math.max(1, ordered.length));
  const railWidth = usedColumns * 156;
  const railTop = height - rows * 112;
  ordered.forEach((entry, index) => {
    const previous = previousPositions?.get(entry.node.path);
    if (previous && pinnedNodePaths.has(entry.node.path)) {
      positions.set(entry.node.path, previous);
      return;
    }
    const row = Math.floor(index / columns);
    const column = index % columns;
    positions.set(entry.node.path, {
      x: width / 2 - railWidth / 2 + column * 156 + 22,
      y: railTop + row * 112 + 18,
    });
  });
}

function getSceneNodeSize(
  node: DataNode,
  childrenByFolderPath: ReadonlyMap<string, readonly DataNode[]>,
  expandedFolderPaths: ReadonlySet<string>,
  relationshipCountByNode: ReadonlyMap<string, number>,
): Readonly<{ height: number; width: number }> {
  if (node.type !== "folder" || !expandedFolderPaths.has(normalizePath(node.path))) {
    return { height: RELATIONSHIP_NODE_HEIGHT, width: RELATIONSHIP_NODE_WIDTH };
  }
  const children = childrenByFolderPath.get(normalizePath(node.path)) ?? [];
  const expandedChildren = children.filter((child) => (
    child.type === "folder" && expandedFolderPaths.has(normalizePath(child.path))
  ));
  const compactChildren = children.filter((child) => !expandedChildren.includes(child));
  const compactZoneCounts = [
    compactChildren.filter((child) => child.type === "folder").length,
    compactChildren.filter((child) => (
      child.type !== "folder" && (relationshipCountByNode.get(child.path) ?? 0) > 0
    )).length,
    compactChildren.filter((child) => (
      child.type !== "folder" && (relationshipCountByNode.get(child.path) ?? 0) === 0
    )).length,
  ];
  const compactRows = Math.max(1, compactZoneCounts.reduce((total, count) => (
    total + Math.ceil(count / EXPANDED_GROUP_MAX_COLUMNS)
  ), 0));
  const nestedHeight = expandedChildren.reduce((total, child) => (
    total + getSceneNodeSize(
      child,
      childrenByFolderPath,
      expandedFolderPaths,
      relationshipCountByNode,
    ).height + 30
  ), 0);
  return {
    height: 82 + compactRows * 106 + nestedHeight,
    width: getExpandedFolderPreferredWidth(children.length),
  };
}

function getRootOwner(path: string, roots: readonly DataNode[]): string | null {
  const normalizedPath = normalizePath(path);
  const owner = roots.find((root) => {
    const rootPath = normalizePath(root.path);
    return normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`);
  });
  return owner?.path ?? null;
}

function getRelationshipPairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function stablePairDirection(left: string, right: string): number {
  let hash = 0;
  for (const character of `${left}\u0000${right}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return hash % 2 === 0 ? 1 : -1;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function getDraggedRelationshipOffset(
  origin: RelationshipLayoutOffset,
  delta: RelationshipLayoutOffset,
  limits: RelationshipDragLimits | null,
): RelationshipLayoutOffset {
  if (!limits) {
    return {
      x: origin.x + delta.x,
      y: origin.y + delta.y,
    };
  }
  return {
    x: clampAxis(origin.x + delta.x, origin.x, limits.minX, limits.maxX),
    y: clampAxis(origin.y + delta.y, origin.y, limits.minY, limits.maxY),
  };
}

export function getZoomedRelationshipViewport(
  current: RelationshipViewportTransform,
  focalPoint: RelationshipLayoutOffset,
  requestedScale: number,
  minimumScale = 0.35,
  maximumScale = 2.4,
): RelationshipViewportTransform {
  const scale = Math.min(maximumScale, Math.max(minimumScale, requestedScale));
  const worldX = (focalPoint.x - current.x) / current.scale;
  const worldY = (focalPoint.y - current.y) / current.scale;
  return {
    x: focalPoint.x - worldX * scale,
    y: focalPoint.y - worldY * scale,
    scale,
  };
}

function getFolderAffinity(
  nodePath: string,
  edges: readonly FolderRelationshipEdge[],
  folderIndexByPath: ReadonlyMap<string, number>,
): number {
  let weightedIndex = 0;
  let totalWeight = 0;
  for (const edge of edges) {
    const otherPath = edge.sourceId === nodePath
      ? edge.targetId
      : edge.targetId === nodePath
        ? edge.sourceId
        : null;
    if (!otherPath) continue;
    const folderIndex = folderIndexByPath.get(otherPath);
    if (folderIndex === undefined) continue;
    weightedIndex += folderIndex * edge.count;
    totalWeight += edge.count;
  }
  return totalWeight > 0
    ? weightedIndex / totalWeight
    : Math.max(0, (folderIndexByPath.size - 1) / 2);
}

function centerHighestRelationshipCount<T extends RelationshipLayoutEntry>(
  entries: readonly T[],
): readonly T[] {
  const ranked = [...entries].sort((left, right) => (
    right.relationshipCount - left.relationshipCount
    || left.originalIndex - right.originalIndex
  ));
  const arranged = new Array<T>(ranked.length);
  const center = Math.floor((ranked.length - 1) / 2);
  const positions = [center];
  for (let offset = 1; positions.length < ranked.length; offset += 1) {
    if (center - offset >= 0) positions.push(center - offset);
    if (center + offset < ranked.length) positions.push(center + offset);
  }
  ranked.forEach((entry, index) => {
    arranged[positions[index]] = entry;
  });
  return arranged;
}

function clampAxis(value: number, fallback: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
