import {
  collectWorkbenchSplitLeaves,
  extractWorkbenchSplitLeaf,
  findWorkbenchSplitLeaf,
  insertWorkbenchSplitLeafAtEdge,
  isWorkbenchSplit,
  moveWorkbenchSplitLeafToEdge,
  updateWorkbenchSplitRatio,
  visitWorkbenchSplitNodes,
  workbenchSplitDefinition,
  type WorkbenchSplit,
  type WorkbenchSplitDropEdge,
  type WorkbenchSplitLeaf,
  type WorkbenchSplitNode,
} from "../split-tree";

/** Serializable identity only. Feature runtimes live outside the topology. */
export type AuxiliaryWorkbenchItem = Readonly<{
  id: string;
  kind: string;
  rootId: string;
  contextId: string;
}>;

/** One split leaf with a local, mixed-kind Tab stack. */
export type AuxiliaryWorkbenchGroup = Readonly<{
  id: string;
  itemIds: readonly string[];
  activeItemId: string;
}>;

export type AuxiliaryWorkbenchLayoutLeaf = WorkbenchSplitLeaf<"group", {
  groupId: string;
}>;
export type AuxiliaryWorkbenchLayoutSplit = WorkbenchSplit<AuxiliaryWorkbenchLayoutLeaf>;
export type AuxiliaryWorkbenchLayoutNode = WorkbenchSplitNode<AuxiliaryWorkbenchLayoutLeaf>;

export type AuxiliaryWorkbenchState = Readonly<{
  items: readonly AuxiliaryWorkbenchItem[];
  groups: readonly AuxiliaryWorkbenchGroup[];
  root: AuxiliaryWorkbenchLayoutNode | null;
  activeGroupId: string | null;
}>;

export type AuxiliaryWorkbenchAction =
  | {
    type: "create";
    item: AuxiliaryWorkbenchItem;
    groupId: string;
    targetGroupId?: string | null;
  }
  | { type: "activate"; itemId: string }
  | { type: "replace-item"; itemId: string; item: AuxiliaryWorkbenchItem }
  | { type: "close"; itemId: string }
  | {
    type: "split-item";
    sourceItemId: string;
    targetGroupId: string;
    edge: WorkbenchSplitDropEdge;
    groupId: string;
    splitId: string;
  }
  | {
    type: "merge-item";
    sourceItemId: string;
    targetGroupId: string;
    targetIndex: number;
  }
  | {
    type: "move-group";
    sourceGroupId: string;
    targetGroupId: string;
    edge: WorkbenchSplitDropEdge;
    splitId: string;
  }
  | {
    type: "merge-group";
    sourceGroupId: string;
    targetGroupId: string;
    targetIndex: number;
  }
  | { type: "resize-split"; splitId: string; ratio: number };

export function createAuxiliaryWorkbenchState(
  initialItem: AuxiliaryWorkbenchItem | null = null,
  initialGroupId = initialItem ? `auxiliary-group-${initialItem.id}` : null,
): AuxiliaryWorkbenchState {
  if (!initialItem || !initialGroupId) return freezeState([], [], null, null);
  const group = createGroup(initialGroupId, initialItem.id);
  return freezeState([initialItem], [group], createGroupLeaf(group.id), group.id);
}

export function auxiliaryWorkbenchReducer(
  state: AuxiliaryWorkbenchState,
  action: AuxiliaryWorkbenchAction,
): AuxiliaryWorkbenchState {
  if (action.type === "create") {
    if (hasItem(state, action.item.id)) return state;
    return insertNewItem(state, action.item, action.groupId, action.targetGroupId);
  }
  if (action.type === "activate") return activateItem(state, action.itemId);
  if (action.type === "replace-item") {
    const previous = state.items.find((item) => item.id === action.itemId);
    if (!previous || hasItem(state, action.item.id)
      || previous.rootId !== action.item.rootId || previous.contextId !== action.item.contextId) return state;
    return finalize({
      ...state,
      items: state.items.map((item) => item.id === previous.id ? action.item : item),
      groups: state.groups.map((group) => group.itemIds.includes(previous.id) ? freezeGroup({
        ...group,
        itemIds: group.itemIds.map((id) => id === previous.id ? action.item.id : id),
        activeItemId: group.activeItemId === previous.id ? action.item.id : group.activeItemId,
      }) : group),
    });
  }
  if (action.type === "close") return closeItem(state, action.itemId);
  if (action.type === "split-item") return splitItemToNewGroup(state, action);
  if (action.type === "merge-item") {
    return mergeItemIntoGroup(
      state,
      action.sourceItemId,
      action.targetGroupId,
      action.targetIndex,
    );
  }
  if (action.type === "move-group") return moveGroupToEdge(state, action);
  if (action.type === "merge-group") return mergeGroupIntoGroup(state, action);
  if (action.type === "resize-split") {
    if (!state.root) return state;
    const root = updateWorkbenchSplitRatio(
      state.root,
      action.splitId,
      clampAuxiliaryWorkbenchSplitRatio(action.ratio),
    );
    return root === state.root ? state : finalize({ ...state, root });
  }
  return state;
}

export function getActiveAuxiliaryWorkbenchGroup(
  state: AuxiliaryWorkbenchState,
): AuxiliaryWorkbenchGroup | null {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? null;
}

export function getActiveAuxiliaryWorkbenchItemId(
  state: AuxiliaryWorkbenchState,
): string | null {
  return getActiveAuxiliaryWorkbenchGroup(state)?.activeItemId ?? null;
}

export function getPresentedAuxiliaryWorkbenchItemIds(
  state: AuxiliaryWorkbenchState,
): readonly string[] {
  return Object.freeze(getAuxiliaryWorkbenchLayoutGroupIds(state.root).flatMap((groupId) => {
    const group = state.groups.find((candidate) => candidate.id === groupId);
    return group ? [group.activeItemId] : [];
  }));
}

export function findAuxiliaryWorkbenchItemGroup(
  state: AuxiliaryWorkbenchState,
  itemId: string,
): AuxiliaryWorkbenchGroup | null {
  return state.groups.find((group) => group.itemIds.includes(itemId)) ?? null;
}

export function getAuxiliaryWorkbenchLayoutGroupIds(
  root: AuxiliaryWorkbenchLayoutNode | null,
): readonly string[] {
  return root
    ? Object.freeze(collectWorkbenchSplitLeaves(root).map((leaf) => leaf.groupId))
    : Object.freeze([]);
}

export function getOrderedAuxiliaryWorkbenchItems(
  state: AuxiliaryWorkbenchState,
): readonly AuxiliaryWorkbenchItem[] {
  const itemById = new Map(state.items.map((item) => [item.id, item]));
  const groupById = new Map(state.groups.map((group) => [group.id, group]));
  return Object.freeze(getAuxiliaryWorkbenchLayoutGroupIds(state.root).flatMap((groupId) => (
    (groupById.get(groupId)?.itemIds ?? [])
      .map((itemId) => itemById.get(itemId))
      .filter((item): item is AuxiliaryWorkbenchItem => Boolean(item))
  )));
}

export function canSplitAuxiliaryWorkbenchItem(
  state: AuxiliaryWorkbenchState,
  itemId: string,
  targetGroupId: string,
): boolean {
  const sourceGroup = findAuxiliaryWorkbenchItemGroup(state, itemId);
  const targetGroup = state.groups.find((group) => group.id === targetGroupId);
  if (!sourceGroup || !targetGroup) return false;
  return sourceGroup.id !== targetGroup.id || sourceGroup.itemIds.length > 1;
}

/** The insertion index is evaluated after removing the source Item. */
export function canInsertAuxiliaryWorkbenchItem(
  state: AuxiliaryWorkbenchState,
  itemId: string,
  targetGroupId: string,
  targetIndex: number,
): boolean {
  const sourceGroup = findAuxiliaryWorkbenchItemGroup(state, itemId);
  const targetGroup = state.groups.find((group) => group.id === targetGroupId);
  if (!sourceGroup || !targetGroup || !Number.isInteger(targetIndex)) return false;
  const targetLengthAfterRemoval = targetGroup.itemIds.length
    - (sourceGroup.id === targetGroup.id ? 1 : 0);
  return targetIndex >= 0 && targetIndex <= targetLengthAfterRemoval;
}

export function canMoveAuxiliaryWorkbenchGroup(
  state: AuxiliaryWorkbenchState,
  sourceGroupId: string,
  targetGroupId: string,
): boolean {
  if (!state.root || !isWorkbenchSplit(state.root) || sourceGroupId === targetGroupId) {
    return false;
  }
  return Boolean(
    state.groups.some((group) => group.id === sourceGroupId)
    && state.groups.some((group) => group.id === targetGroupId)
    && findWorkbenchSplitLeaf(state.root, sourceGroupId)
    && findWorkbenchSplitLeaf(state.root, targetGroupId),
  );
}

export function canMergeAuxiliaryWorkbenchGroup(
  state: AuxiliaryWorkbenchState,
  sourceGroupId: string,
  targetGroupId: string,
  targetIndex: number,
): boolean {
  const sourceGroup = state.groups.find((group) => group.id === sourceGroupId);
  const targetGroup = state.groups.find((group) => group.id === targetGroupId);
  return Boolean(
    state.root
    && sourceGroup
    && targetGroup
    && sourceGroup.id !== targetGroup.id
    && Number.isInteger(targetIndex)
    && targetIndex >= 0
    && targetIndex <= targetGroup.itemIds.length,
  );
}

export function assertAuxiliaryWorkbenchState(state: AuxiliaryWorkbenchState): void {
  const errors = auxiliaryWorkbenchStateErrors(state);
  if (errors.length > 0) {
    throw new Error(`Invalid Auxiliary Workbench state: ${errors.join("; ")}`);
  }
}

export function auxiliaryWorkbenchStateErrors(
  state: AuxiliaryWorkbenchState,
): readonly string[] {
  const errors: string[] = [];
  const itemIds = new Set<string>();
  for (const item of state.items) {
    if (!item.id || itemIds.has(item.id)) errors.push(`duplicate Item ${item.id}`);
    if (!item.kind) errors.push(`Item ${item.id} has no kind`);
    itemIds.add(item.id);
  }

  const groupIds = new Set<string>();
  const ownedItemIds = new Set<string>();
  for (const group of state.groups) {
    if (!group.id || groupIds.has(group.id)) errors.push(`duplicate Group ${group.id}`);
    groupIds.add(group.id);
    if (group.itemIds.length === 0) errors.push(`empty Group ${group.id}`);
    if (!group.itemIds.includes(group.activeItemId)) {
      errors.push(`Group ${group.id} active Item is outside its Tab stack`);
    }
    for (const itemId of group.itemIds) {
      if (!itemIds.has(itemId)) errors.push(`missing Item ${itemId}`);
      if (ownedItemIds.has(itemId)) errors.push(`Item ${itemId} has two owners`);
      ownedItemIds.add(itemId);
    }
  }
  for (const itemId of itemIds) {
    if (!ownedItemIds.has(itemId)) errors.push(`Item ${itemId} has no Group`);
  }

  const layoutGroupIds = new Set<string>();
  const nodeIds = new Set<string>();
  if (state.root) {
    visitWorkbenchSplitNodes(state.root, (node) => {
      if (!node.id || nodeIds.has(node.id)) errors.push(`duplicate layout node ${node.id}`);
      nodeIds.add(node.id);
      if (isWorkbenchSplit(node)) return;
      if (node.id !== node.groupId) errors.push(`Group leaf identity mismatch ${node.id}`);
      if (!groupIds.has(node.groupId)) errors.push(`missing Group ${node.groupId}`);
      if (layoutGroupIds.has(node.groupId)) errors.push(`Group ${node.groupId} has two leaves`);
      layoutGroupIds.add(node.groupId);
    });
  }
  for (const groupId of groupIds) {
    if (!layoutGroupIds.has(groupId)) errors.push(`Group ${groupId} has no layout leaf`);
  }
  if ((state.groups.length === 0) !== (state.root === null)) {
    errors.push("empty workbench root mismatch");
  }
  if (state.groups.length === 0 && state.activeGroupId !== null) {
    errors.push("empty workbench has active Group");
  }
  if (state.groups.length > 0 && !groupIds.has(state.activeGroupId ?? "")) {
    errors.push("active Group is missing");
  }
  return Object.freeze(errors);
}

export function clampAuxiliaryWorkbenchSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.99, Math.max(0.01, Math.round(ratio * 1_000) / 1_000));
}

function insertNewItem(
  state: AuxiliaryWorkbenchState,
  item: AuxiliaryWorkbenchItem,
  nextGroupId: string,
  requestedGroupId?: string | null,
): AuxiliaryWorkbenchState {
  const targetGroup = state.groups.find((group) => (
    group.id === (requestedGroupId ?? state.activeGroupId)
  ));
  if (targetGroup) {
    const groups = state.groups.map((group) => group.id === targetGroup.id
      ? freezeGroup({
          ...group,
          itemIds: [...group.itemIds, item.id],
          activeItemId: item.id,
        })
      : group);
    return finalize({
      ...state,
      items: [...state.items, item],
      groups,
      activeGroupId: targetGroup.id,
    });
  }

  if (state.root || state.groups.length > 0 || hasGroup(state, nextGroupId)) return state;
  const group = createGroup(nextGroupId, item.id);
  return finalize({
    ...state,
    items: [item],
    groups: [group],
    root: createGroupLeaf(group.id),
    activeGroupId: group.id,
  });
}

function activateItem(
  state: AuxiliaryWorkbenchState,
  itemId: string,
): AuxiliaryWorkbenchState {
  const owner = findAuxiliaryWorkbenchItemGroup(state, itemId);
  if (!owner) return state;
  if (owner.activeItemId === itemId && state.activeGroupId === owner.id) return state;
  const groups = owner.activeItemId === itemId
    ? state.groups
    : state.groups.map((group) => group.id === owner.id
      ? freezeGroup({ ...group, activeItemId: itemId })
      : group);
  return finalize({ ...state, groups, activeGroupId: owner.id });
}

function splitItemToNewGroup(
  state: AuxiliaryWorkbenchState,
  action: Extract<AuxiliaryWorkbenchAction, { type: "split-item" }>,
): AuxiliaryWorkbenchState {
  if (
    !state.root
    || hasGroup(state, action.groupId)
    || hasLayoutNode(state, action.splitId)
    || !canSplitAuxiliaryWorkbenchItem(state, action.sourceItemId, action.targetGroupId)
  ) return state;
  const sourceGroup = findAuxiliaryWorkbenchItemGroup(state, action.sourceItemId)!;
  const targetGroup = state.groups.find((group) => group.id === action.targetGroupId)!;
  let root = state.root;
  let groups = [...state.groups];

  if (sourceGroup.itemIds.length === 1) {
    const extracted = extractWorkbenchSplitLeaf(root, sourceGroup.id);
    if (!extracted.leaf || !extracted.root) return state;
    root = extracted.root;
    groups = groups.filter((group) => group.id !== sourceGroup.id);
  } else {
    const sourceIndex = sourceGroup.itemIds.indexOf(action.sourceItemId);
    const remaining = sourceGroup.itemIds.filter((id) => id !== action.sourceItemId);
    const fallbackIndex = Math.min(sourceIndex, remaining.length - 1);
    groups = groups.map((group) => group.id === sourceGroup.id
      ? freezeGroup({
          ...group,
          itemIds: remaining,
          activeItemId: group.activeItemId === action.sourceItemId
            ? remaining[fallbackIndex]!
            : group.activeItemId,
        })
      : group);
  }

  if (!findWorkbenchSplitLeaf(root, targetGroup.id)) return state;
  const { direction, placement } = workbenchSplitDefinition(action.edge);
  const nextGroup = createGroup(action.groupId, action.sourceItemId);
  const nextRoot = insertWorkbenchSplitLeafAtEdge(
    root,
    targetGroup.id,
    createGroupLeaf(nextGroup.id),
    direction,
    placement,
    action.splitId,
  );
  if (nextRoot === root) return state;
  const targetIndex = groups.findIndex((group) => group.id === targetGroup.id);
  groups.splice(targetIndex + 1, 0, nextGroup);
  return finalize({ ...state, groups, root: nextRoot, activeGroupId: nextGroup.id });
}

function mergeItemIntoGroup(
  state: AuxiliaryWorkbenchState,
  sourceItemId: string,
  targetGroupId: string,
  targetIndex: number,
): AuxiliaryWorkbenchState {
  if (!state.root || !canInsertAuxiliaryWorkbenchItem(
    state,
    sourceItemId,
    targetGroupId,
    targetIndex,
  )) return state;
  const sourceGroup = findAuxiliaryWorkbenchItemGroup(state, sourceItemId)!;
  const targetGroup = state.groups.find((group) => group.id === targetGroupId)!;

  if (sourceGroup.id === targetGroup.id) {
    const remaining = sourceGroup.itemIds.filter((id) => id !== sourceItemId);
    const reordered = insertAt(remaining, sourceItemId, targetIndex);
    const orderUnchanged = reordered.every((id, index) => id === sourceGroup.itemIds[index]);
    if (orderUnchanged && state.activeGroupId === targetGroup.id) return state;
    const groups = orderUnchanged
      ? state.groups
      : state.groups.map((group) => group.id === targetGroup.id
        ? freezeGroup({ ...group, itemIds: reordered })
        : group);
    return finalize({ ...state, groups, activeGroupId: targetGroup.id });
  }

  let root = state.root;
  let groups = [...state.groups];
  if (sourceGroup.itemIds.length === 1) {
    const extracted = extractWorkbenchSplitLeaf(root, sourceGroup.id);
    if (!extracted.leaf || !extracted.root) return state;
    root = extracted.root;
    groups = groups.filter((group) => group.id !== sourceGroup.id);
  } else {
    const sourceIndex = sourceGroup.itemIds.indexOf(sourceItemId);
    const remaining = sourceGroup.itemIds.filter((id) => id !== sourceItemId);
    groups = groups.map((group) => group.id === sourceGroup.id
      ? freezeGroup({
          ...group,
          itemIds: remaining,
          activeItemId: group.activeItemId === sourceItemId
            ? remaining[Math.min(sourceIndex, remaining.length - 1)]!
            : group.activeItemId,
        })
      : group);
  }
  groups = groups.map((group) => group.id === targetGroup.id
    ? freezeGroup({
        ...group,
        itemIds: insertAt(group.itemIds, sourceItemId, targetIndex),
        activeItemId: sourceItemId,
      })
    : group);
  return finalize({ ...state, groups, root, activeGroupId: targetGroup.id });
}

function moveGroupToEdge(
  state: AuxiliaryWorkbenchState,
  action: Extract<AuxiliaryWorkbenchAction, { type: "move-group" }>,
): AuxiliaryWorkbenchState {
  if (
    !state.root
    || hasLayoutNode(state, action.splitId)
    || !canMoveAuxiliaryWorkbenchGroup(state, action.sourceGroupId, action.targetGroupId)
  ) return state;
  const { direction, placement } = workbenchSplitDefinition(action.edge);
  const moved = moveWorkbenchSplitLeafToEdge(
    state.root,
    action.sourceGroupId,
    action.targetGroupId,
    direction,
    placement,
    action.splitId,
  );
  if (!moved.moved) {
    return state.activeGroupId === action.sourceGroupId
      ? state
      : finalize({ ...state, activeGroupId: action.sourceGroupId });
  }
  return finalize({ ...state, root: moved.root, activeGroupId: action.sourceGroupId });
}

function mergeGroupIntoGroup(
  state: AuxiliaryWorkbenchState,
  action: Extract<AuxiliaryWorkbenchAction, { type: "merge-group" }>,
): AuxiliaryWorkbenchState {
  if (!state.root || !canMergeAuxiliaryWorkbenchGroup(
    state,
    action.sourceGroupId,
    action.targetGroupId,
    action.targetIndex,
  )) return state;
  const sourceGroup = state.groups.find((group) => group.id === action.sourceGroupId)!;
  const extracted = extractWorkbenchSplitLeaf(state.root, sourceGroup.id);
  if (!extracted.leaf || !extracted.root) return state;
  const groups = state.groups
    .filter((group) => group.id !== sourceGroup.id)
    .map((group) => group.id === action.targetGroupId
      ? freezeGroup({
          ...group,
          itemIds: insertManyAt(group.itemIds, sourceGroup.itemIds, action.targetIndex),
          activeItemId: sourceGroup.activeItemId,
        })
      : group);
  return finalize({
    ...state,
    groups,
    root: extracted.root,
    activeGroupId: action.targetGroupId,
  });
}

function closeItem(state: AuxiliaryWorkbenchState, itemId: string): AuxiliaryWorkbenchState {
  const itemIndex = state.items.findIndex((item) => item.id === itemId);
  const sourceGroup = findAuxiliaryWorkbenchItemGroup(state, itemId);
  if (itemIndex < 0 || !sourceGroup || !state.root) return state;
  const items = state.items.filter((item) => item.id !== itemId);

  if (sourceGroup.itemIds.length > 1) {
    const closingIndex = sourceGroup.itemIds.indexOf(itemId);
    const remaining = sourceGroup.itemIds.filter((id) => id !== itemId);
    const activeItemId = sourceGroup.activeItemId === itemId
      ? remaining[Math.min(closingIndex, remaining.length - 1)]!
      : sourceGroup.activeItemId;
    const groups = state.groups.map((group) => group.id === sourceGroup.id
      ? freezeGroup({ ...group, itemIds: remaining, activeItemId })
      : group);
    return finalize({ ...state, items, groups });
  }

  const extracted = extractWorkbenchSplitLeaf(state.root, sourceGroup.id);
  if (!extracted.leaf) return state;
  const groups = state.groups.filter((group) => group.id !== sourceGroup.id);
  const root = extracted.root;
  const activeGroupId = state.activeGroupId === sourceGroup.id
    ? getAuxiliaryWorkbenchLayoutGroupIds(root)[0] ?? null
    : state.activeGroupId;
  return finalize({ ...state, items, groups, root, activeGroupId });
}

function createGroup(id: string, itemId: string): AuxiliaryWorkbenchGroup {
  return freezeGroup({ id, itemIds: [itemId], activeItemId: itemId });
}

function createGroupLeaf(groupId: string): AuxiliaryWorkbenchLayoutLeaf {
  return Object.freeze({ kind: "group", id: groupId, groupId });
}

function freezeGroup(group: AuxiliaryWorkbenchGroup): AuxiliaryWorkbenchGroup {
  return Object.freeze({ ...group, itemIds: Object.freeze([...group.itemIds]) });
}

function freezeState(
  items: readonly AuxiliaryWorkbenchItem[],
  groups: readonly AuxiliaryWorkbenchGroup[],
  root: AuxiliaryWorkbenchLayoutNode | null,
  activeGroupId: string | null,
): AuxiliaryWorkbenchState {
  return Object.freeze({
    items: Object.freeze([...items]),
    groups: Object.freeze([...groups]),
    root,
    activeGroupId,
  });
}

function finalize(state: AuxiliaryWorkbenchState): AuxiliaryWorkbenchState {
  const next = freezeState(state.items, state.groups, state.root, state.activeGroupId);
  if (import.meta.env.DEV) assertAuxiliaryWorkbenchState(next);
  return next;
}

function insertAt(values: readonly string[], value: string, index: number): readonly string[] {
  return Object.freeze([...values.slice(0, index), value, ...values.slice(index)]);
}

function insertManyAt(
  values: readonly string[],
  inserted: readonly string[],
  index: number,
): readonly string[] {
  return Object.freeze([...values.slice(0, index), ...inserted, ...values.slice(index)]);
}

function hasItem(state: AuxiliaryWorkbenchState, itemId: string): boolean {
  return state.items.some((item) => item.id === itemId);
}

function hasGroup(state: AuxiliaryWorkbenchState, groupId: string): boolean {
  return state.groups.some((group) => group.id === groupId);
}

function hasLayoutNode(state: AuxiliaryWorkbenchState, nodeId: string): boolean {
  if (!state.root) return false;
  let found = false;
  visitWorkbenchSplitNodes(state.root, (node) => {
    if (node.id === nodeId) found = true;
  });
  return found;
}
