export type WorkbenchSplitDirection = "horizontal" | "vertical";
export type WorkbenchSplitPlacement = "first" | "second";

export type WorkbenchSplitLeaf<
  TKind extends string,
  TData extends object = Record<never, never>,
> = Readonly<{
  kind: TKind;
  id: string;
}> & Readonly<TData>;

export type WorkbenchSplit<TLeaf extends { readonly kind: string; readonly id: string }> = Readonly<{
  kind: "split";
  id: string;
  direction: WorkbenchSplitDirection;
  ratio: number;
  first: WorkbenchSplitNode<TLeaf>;
  second: WorkbenchSplitNode<TLeaf>;
}>;

export type WorkbenchSplitNode<
  TLeaf extends { readonly kind: string; readonly id: string },
> = TLeaf | WorkbenchSplit<TLeaf>;

export type ExtractWorkbenchSplitLeafResult<
  TLeaf extends { readonly kind: string; readonly id: string },
> = Readonly<{
  root: WorkbenchSplitNode<TLeaf> | null;
  leaf: TLeaf | null;
}>;

export type MoveWorkbenchSplitLeafResult<
  TLeaf extends { readonly kind: string; readonly id: string },
> = Readonly<{
  root: WorkbenchSplitNode<TLeaf>;
  moved: boolean;
}>;

export function createWorkbenchSplit<
  TLeaf extends { readonly kind: string; readonly id: string },
>(options: Omit<WorkbenchSplit<TLeaf>, "kind">): WorkbenchSplit<TLeaf> {
  return Object.freeze({ kind: "split", ...options });
}

export function isWorkbenchSplit<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>): node is WorkbenchSplit<TLeaf> {
  return node.kind === "split" && "first" in node && "second" in node;
}

export function collectWorkbenchSplitLeaves<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>): readonly TLeaf[] {
  if (!isWorkbenchSplit(node)) return Object.freeze([node]);
  return Object.freeze([
    ...collectWorkbenchSplitLeaves(node.first),
    ...collectWorkbenchSplitLeaves(node.second),
  ]);
}

export function findWorkbenchSplitLeaf<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>, leafId: string): TLeaf | null {
  if (!isWorkbenchSplit(node)) return node.id === leafId ? node : null;
  return findWorkbenchSplitLeaf(node.first, leafId)
    ?? findWorkbenchSplitLeaf(node.second, leafId);
}

export function findWorkbenchSplit<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>, splitId: string): WorkbenchSplit<TLeaf> | null {
  if (!isWorkbenchSplit(node)) return null;
  if (node.id === splitId) return node;
  return findWorkbenchSplit(node.first, splitId)
    ?? findWorkbenchSplit(node.second, splitId);
}

export function replaceWorkbenchSplitNode<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  nodeId: string,
  replacement: WorkbenchSplitNode<TLeaf>,
): WorkbenchSplitNode<TLeaf> {
  if (node.id === nodeId) return replacement;
  if (!isWorkbenchSplit(node)) return node;
  const first = replaceWorkbenchSplitNode(node.first, nodeId, replacement);
  const second = replaceWorkbenchSplitNode(node.second, nodeId, replacement);
  if (first === node.first && second === node.second) return node;
  return createWorkbenchSplit({ ...node, first, second });
}

export function mapWorkbenchSplitLeaves<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  map: (leaf: TLeaf) => TLeaf,
): WorkbenchSplitNode<TLeaf> {
  if (!isWorkbenchSplit(node)) return map(node);
  const first = mapWorkbenchSplitLeaves(node.first, map);
  const second = mapWorkbenchSplitLeaves(node.second, map);
  if (first === node.first && second === node.second) return node;
  return createWorkbenchSplit({ ...node, first, second });
}

export function mapWorkbenchSplitNodes<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  map: (node: WorkbenchSplitNode<TLeaf>) => WorkbenchSplitNode<TLeaf>,
): WorkbenchSplitNode<TLeaf> {
  if (!isWorkbenchSplit(node)) return map(node);
  const first = mapWorkbenchSplitNodes(node.first, map);
  const second = mapWorkbenchSplitNodes(node.second, map);
  const withMappedChildren = first === node.first && second === node.second
    ? node
    : createWorkbenchSplit({ ...node, first, second });
  return map(withMappedChildren);
}

export function extractWorkbenchSplitLeaf<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  leafId: string,
): ExtractWorkbenchSplitLeafResult<TLeaf> {
  if (!isWorkbenchSplit(node)) {
    return node.id === leafId
      ? Object.freeze({ root: null, leaf: node })
      : Object.freeze({ root: node, leaf: null });
  }
  if (!isWorkbenchSplit(node.first) && node.first.id === leafId) {
    return Object.freeze({ root: node.second, leaf: node.first });
  }
  if (!isWorkbenchSplit(node.second) && node.second.id === leafId) {
    return Object.freeze({ root: node.first, leaf: node.second });
  }

  const first = extractWorkbenchSplitLeaf(node.first, leafId);
  if (first.leaf) {
    return Object.freeze({
      root: first.root
        ? createWorkbenchSplit({ ...node, first: first.root })
        : node.second,
      leaf: first.leaf,
    });
  }
  const second = extractWorkbenchSplitLeaf(node.second, leafId);
  if (second.leaf) {
    return Object.freeze({
      root: second.root
        ? createWorkbenchSplit({ ...node, second: second.root })
        : node.first,
      leaf: second.leaf,
    });
  }
  return Object.freeze({ root: node, leaf: null });
}

export function insertWorkbenchSplitLeafAtEdge<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  root: WorkbenchSplitNode<TLeaf>,
  targetLeafId: string,
  sourceLeaf: TLeaf,
  direction: WorkbenchSplitDirection,
  placement: WorkbenchSplitPlacement,
  splitId: string,
): WorkbenchSplitNode<TLeaf> {
  const target = findWorkbenchSplitLeaf(root, targetLeafId);
  if (!target || findWorkbenchSplitLeaf(root, sourceLeaf.id)) return root;
  const sourceFirst = placement === "first";
  return replaceWorkbenchSplitNode(root, targetLeafId, createWorkbenchSplit({
    id: splitId,
    direction,
    ratio: 0.5,
    first: sourceFirst ? sourceLeaf : target,
    second: sourceFirst ? target : sourceLeaf,
  }));
}

export function moveWorkbenchSplitLeafToEdge<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  root: WorkbenchSplitNode<TLeaf>,
  sourceLeafId: string,
  targetLeafId: string,
  direction: WorkbenchSplitDirection,
  placement: WorkbenchSplitPlacement,
  splitId: string,
): MoveWorkbenchSplitLeafResult<TLeaf> {
  if (sourceLeafId === targetLeafId || !isWorkbenchSplit(root)) {
    return Object.freeze({ root, moved: false });
  }
  const source = findWorkbenchSplitLeaf(root, sourceLeafId);
  const target = findWorkbenchSplitLeaf(root, targetLeafId);
  if (!source || !target) return Object.freeze({ root, moved: false });

  const sibling = findDirectSiblingWorkbenchSplit(root, sourceLeafId, targetLeafId);
  if (sibling) {
    const sourceFirst = placement === "first";
    const first = sourceFirst ? source : target;
    const second = sourceFirst ? target : source;
    if (
      sibling.direction === direction
      && sibling.first === first
      && sibling.second === second
    ) {
      return Object.freeze({ root, moved: false });
    }
    const replacement = createWorkbenchSplit({
      ...sibling,
      direction,
      ratio: sibling.direction === direction ? sibling.ratio : 0.5,
      first,
      second,
    });
    return Object.freeze({
      root: replaceWorkbenchSplitNode(root, sibling.id, replacement),
      moved: true,
    });
  }

  const extracted = extractWorkbenchSplitLeaf(root, sourceLeafId);
  if (!extracted.root || !extracted.leaf) {
    return Object.freeze({ root, moved: false });
  }
  const nextRoot = insertWorkbenchSplitLeafAtEdge(
    extracted.root,
    targetLeafId,
    extracted.leaf,
    direction,
    placement,
    splitId,
  );
  return Object.freeze({ root: nextRoot, moved: nextRoot !== extracted.root });
}

export function updateWorkbenchSplitRatio<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  root: WorkbenchSplitNode<TLeaf>,
  splitId: string,
  ratio: number,
): WorkbenchSplitNode<TLeaf> {
  return mapWorkbenchSplitNodes(root, (node) => {
    if (!isWorkbenchSplit(node) || node.id !== splitId || node.ratio === ratio) return node;
    return createWorkbenchSplit({ ...node, ratio });
  });
}

export function findDirectSiblingWorkbenchSplit<
  TLeaf extends { readonly kind: string; readonly id: string },
>(
  node: WorkbenchSplitNode<TLeaf>,
  firstLeafId: string,
  secondLeafId: string,
): WorkbenchSplit<TLeaf> | null {
  if (!isWorkbenchSplit(node)) return null;
  if (!isWorkbenchSplit(node.first) && !isWorkbenchSplit(node.second)) {
    const directIds = new Set([node.first.id, node.second.id]);
    if (directIds.has(firstLeafId) && directIds.has(secondLeafId)) return node;
  }
  return findDirectSiblingWorkbenchSplit(node.first, firstLeafId, secondLeafId)
    ?? findDirectSiblingWorkbenchSplit(node.second, firstLeafId, secondLeafId);
}

export function nextWorkbenchSplitNumericId<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>, prefix: string): number {
  let maximum = 0;
  visitWorkbenchSplitNodes(node, (item) => {
    if (!item.id.startsWith(prefix)) return;
    const numeric = Number(item.id.slice(prefix.length));
    if (Number.isInteger(numeric)) maximum = Math.max(maximum, numeric);
  });
  return maximum + 1;
}

export function visitWorkbenchSplitNodes<
  TLeaf extends { readonly kind: string; readonly id: string },
>(node: WorkbenchSplitNode<TLeaf>, visit: (node: WorkbenchSplitNode<TLeaf>) => void): void {
  visit(node);
  if (!isWorkbenchSplit(node)) return;
  visitWorkbenchSplitNodes(node.first, visit);
  visitWorkbenchSplitNodes(node.second, visit);
}
