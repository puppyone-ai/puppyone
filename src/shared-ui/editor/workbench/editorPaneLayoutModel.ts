import { rebaseResourcePath } from "../../core/resourcePath";
import { ResourceUriIdentityService, type ResourceUri } from "../../core/resourceUri";
import {
  collectWorkbenchSplitLeaves,
  createWorkbenchSplit,
  extractWorkbenchSplitLeaf,
  findWorkbenchSplitLeaf,
  mapWorkbenchSplitLeaves,
  moveWorkbenchSplitLeafToEdge,
  nextWorkbenchSplitNumericId,
  replaceWorkbenchSplitNode,
  updateWorkbenchSplitRatio,
  type WorkbenchSplit,
  type WorkbenchSplitDirection,
  type WorkbenchSplitLeaf,
  type WorkbenchSplitNode,
  type WorkbenchSplitPlacement,
} from "../../workbench/split-tree";
import {
  createEditorInput,
  type EditorResourceReference,
} from "./editorGroupModel";

export type EditorSplitDirection = WorkbenchSplitDirection;
export type EditorSplitPlacement = WorkbenchSplitPlacement;

export type EditorPaneSplitOptions = Readonly<{
  editorId?: string | null;
  placement?: EditorSplitPlacement;
}>;

export type EditorPaneLayoutLeaf = WorkbenchSplitLeaf<"pane", {
  editorId: string | null;
}>;

export type EditorPaneLayoutSplit = WorkbenchSplit<EditorPaneLayoutLeaf>;
export type EditorPaneLayoutNode = WorkbenchSplitNode<EditorPaneLayoutLeaf>;

export type EditorPaneLayoutState = Readonly<{
  root: EditorPaneLayoutNode;
  activePaneId: string;
}>;

const DEFAULT_PANE_ID = "editor-pane-1";
export const EDITOR_SPLIT_RATIO_MIN = 0.15;
export const EDITOR_SPLIT_RATIO_MAX = 0.85;
const MAX_LAYOUT_DEPTH = 12;

export function createEditorPaneLayout(editorId: string | null = null): EditorPaneLayoutState {
  return freezeLayout(createPane(DEFAULT_PANE_ID, editorId), DEFAULT_PANE_ID);
}

export function getEditorPanes(state: EditorPaneLayoutState): readonly EditorPaneLayoutLeaf[] {
  return collectWorkbenchSplitLeaves(state.root);
}

export function getActiveEditorPane(state: EditorPaneLayoutState): EditorPaneLayoutLeaf {
  return findWorkbenchSplitLeaf(state.root, state.activePaneId)
    ?? collectWorkbenchSplitLeaves(state.root)[0]!;
}

export function activateEditorPane(
  state: EditorPaneLayoutState,
  paneId: string,
): EditorPaneLayoutState {
  if (paneId === state.activePaneId || !findWorkbenchSplitLeaf(state.root, paneId)) return state;
  return freezeLayout(state.root, paneId);
}

export function assignEditorToPane(
  state: EditorPaneLayoutState,
  paneId: string,
  editorId: string | null,
): EditorPaneLayoutState {
  if (!findWorkbenchSplitLeaf(state.root, paneId)) return state;
  const root = mapWorkbenchSplitLeaves(state.root, (pane) => (
    pane.id === paneId ? createPane(pane.id, editorId) : pane
  ));
  return freezeLayout(root, paneId);
}

export function assignEditorToActivePane(
  state: EditorPaneLayoutState,
  editorId: string | null,
): EditorPaneLayoutState {
  return assignEditorToPane(state, state.activePaneId, editorId);
}

export function splitEditorPane(
  state: EditorPaneLayoutState,
  paneId: string,
  direction: EditorSplitDirection,
  options: EditorPaneSplitOptions = {},
): EditorPaneLayoutState {
  const source = findWorkbenchSplitLeaf(state.root, paneId);
  if (!source) return state;
  const nextPaneId = `editor-pane-${nextWorkbenchSplitNumericId(state.root, "editor-pane-")}`;
  const nextSplitId = `editor-split-${nextWorkbenchSplitNumericId(state.root, "editor-split-")}`;
  const nextPane = createPane(
    nextPaneId,
    Object.prototype.hasOwnProperty.call(options, "editorId")
      ? options.editorId ?? null
      : source.editorId,
  );
  const nextPaneFirst = options.placement === "first";
  const root = replaceWorkbenchSplitNode(state.root, paneId, createWorkbenchSplit({
    id: nextSplitId,
    direction,
    ratio: 0.5,
    first: nextPaneFirst ? nextPane : source,
    second: nextPaneFirst ? source : nextPane,
  }));
  return freezeLayout(root, nextPaneId);
}

export function moveEditorPane(
  state: EditorPaneLayoutState,
  sourcePaneId: string,
  targetPaneId: string,
  direction: EditorSplitDirection,
  placement: EditorSplitPlacement = "second",
): EditorPaneLayoutState {
  if (sourcePaneId === targetPaneId || state.root.kind === "pane") return state;
  if (
    !findWorkbenchSplitLeaf(state.root, sourcePaneId)
    || !findWorkbenchSplitLeaf(state.root, targetPaneId)
  ) return state;

  const result = moveWorkbenchSplitLeafToEdge(
    state.root,
    sourcePaneId,
    targetPaneId,
    direction,
    placement,
    `editor-split-${nextWorkbenchSplitNumericId(state.root, "editor-split-")}`,
  );
  if (!result.moved && state.activePaneId === sourcePaneId) return state;
  return freezeLayout(result.root, sourcePaneId);
}

export function closeEditorPane(
  state: EditorPaneLayoutState,
  paneId: string,
): EditorPaneLayoutState {
  if (!findWorkbenchSplitLeaf(state.root, paneId)) return state;
  if (state.root.kind === "pane") {
    return freezeLayout(createPane(state.root.id, null), state.root.id);
  }

  const extracted = extractWorkbenchSplitLeaf(state.root, paneId);
  if (!extracted.root || !extracted.leaf) return state;
  const remainingPanes = collectWorkbenchSplitLeaves(extracted.root);
  const activePaneId = state.activePaneId === paneId
    ? remainingPanes[0]!.id
    : findWorkbenchSplitLeaf(extracted.root, state.activePaneId)?.id
      ?? remainingPanes[0]!.id;
  return freezeLayout(extracted.root, activePaneId);
}

export function updateEditorSplitRatio(
  state: EditorPaneLayoutState,
  splitId: string,
  ratio: number,
): EditorPaneLayoutState {
  const root = updateWorkbenchSplitRatio(
    state.root,
    splitId,
    clampEditorSplitRatio(ratio),
  );
  return root === state.root ? state : freezeLayout(root, state.activePaneId);
}

export function removeEditorFromPanes(
  state: EditorPaneLayoutState,
  editorId: string,
  fallbackEditorId: string | null,
): EditorPaneLayoutState {
  const root = mapWorkbenchSplitLeaves(state.root, (pane) => (
    pane.editorId === editorId ? createPane(pane.id, fallbackEditorId) : pane
  ));
  return root === state.root ? state : freezeLayout(root, state.activePaneId);
}

export function rebaseEditorPaneResources(
  state: EditorPaneLayoutState,
  previousResource: EditorResourceReference,
  nextResource: EditorResourceReference,
): EditorPaneLayoutState {
  const previousInput = createEditorInput(previousResource);
  const compatibleNextResource = typeof nextResource === "string" && previousInput.rootUri
    ? { rootUri: previousInput.rootUri, resourcePath: nextResource }
    : nextResource;
  const nextInput = createEditorInput(compatibleNextResource);
  if (
    previousInput.rootUri
    && nextInput.rootUri
    && !editorPaneResourceIdentity.isEqual(previousInput.rootUri, nextInput.rootUri)
  ) {
    throw new Error("Editor Pane resource rebasing cannot cross Workspace Folders.");
  }
  const root = mapWorkbenchSplitLeaves(state.root, (pane) => {
    if (!pane.editorId) return pane;
    const editorId = previousInput.rootUri
      ? editorPaneResourceIdentity.rebase(
        pane.editorId as ResourceUri,
        previousInput.resourceUri,
        nextInput.resourceUri,
      )
      : rebaseResourcePath(
        pane.editorId,
        previousInput.resource,
        nextInput.resource,
      );
    return editorId === pane.editorId ? pane : createPane(pane.id, editorId);
  });
  return root === state.root ? state : freezeLayout(root, state.activePaneId);
}

const editorPaneResourceIdentity = new ResourceUriIdentityService();

export function parseEditorPaneLayoutState(
  value: unknown,
  validEditorIds: ReadonlySet<string>,
  fallbackEditorId: string | null = null,
): EditorPaneLayoutState {
  if (!value || typeof value !== "object") return createEditorPaneLayout(fallbackEditorId);
  const candidate = value as Partial<EditorPaneLayoutState>;
  const root = parseNode(candidate.root, validEditorIds, new Set(), 0);
  if (!root) return createEditorPaneLayout(fallbackEditorId);
  const panes = collectWorkbenchSplitLeaves(root);
  const activePaneId = typeof candidate.activePaneId === "string"
    && panes.some(({ id }) => id === candidate.activePaneId)
    ? candidate.activePaneId
    : panes[0]!.id;
  return freezeLayout(root, activePaneId);
}

function parseNode(
  value: unknown,
  validEditorIds: ReadonlySet<string>,
  seenIds: Set<string>,
  depth: number,
): EditorPaneLayoutNode | null {
  if (!value || typeof value !== "object" || depth > MAX_LAYOUT_DEPTH) return null;
  const candidate = value as Partial<EditorPaneLayoutNode>;
  if (candidate.kind === "pane") {
    if (typeof candidate.id !== "string" || !candidate.id || seenIds.has(candidate.id)) return null;
    seenIds.add(candidate.id);
    const editorId = typeof candidate.editorId === "string" && validEditorIds.has(candidate.editorId)
      ? candidate.editorId
      : null;
    return createPane(candidate.id, editorId);
  }
  if (candidate.kind !== "split") return null;
  if (typeof candidate.id !== "string" || !candidate.id || seenIds.has(candidate.id)) return null;
  if (candidate.direction !== "horizontal" && candidate.direction !== "vertical") return null;
  seenIds.add(candidate.id);
  const first = parseNode(candidate.first, validEditorIds, seenIds, depth + 1);
  const second = parseNode(candidate.second, validEditorIds, seenIds, depth + 1);
  if (!first || !second) return null;
  return createWorkbenchSplit({
    id: candidate.id,
    direction: candidate.direction,
    ratio: clampEditorSplitRatio(typeof candidate.ratio === "number" ? candidate.ratio : 0.5),
    first,
    second,
  });
}

function createPane(id: string, editorId: string | null): EditorPaneLayoutLeaf {
  return Object.freeze({ kind: "pane", id, editorId });
}

function freezeLayout(root: EditorPaneLayoutNode, activePaneId: string): EditorPaneLayoutState {
  return Object.freeze({ root, activePaneId });
}

export function clampEditorSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(
    EDITOR_SPLIT_RATIO_MAX,
    Math.max(EDITOR_SPLIT_RATIO_MIN, Math.round(ratio * 1_000) / 1_000),
  );
}
