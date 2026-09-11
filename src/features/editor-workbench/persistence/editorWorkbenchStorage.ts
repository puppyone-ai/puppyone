import {
  EMPTY_EDITOR_GROUP,
  activateEditor,
  closeEditorPane,
  createEditorPaneLayout,
  getActiveEditorPane,
  getEditorPanes,
  parseEditorGroupState,
  parseEditorPaneLayoutState,
  type EditorGroupState,
  type EditorPaneLayoutState,
  type ResourceUri,
} from "@puppyone/shared-ui";

export const EDITOR_WORKBENCH_STORAGE_PREFIX = "puppyone.desktop.editor-workbench.v3";
export const LEGACY_EDITOR_WORKBENCH_STORAGE_PREFIX = "puppyone.desktop.editor-workbench.v2";
export const LEGACY_EDITOR_GROUP_STORAGE_PREFIX = "puppyone.desktop.editor-group.v1";

export type DesktopEditorWorkbenchState = Readonly<{
  group: EditorGroupState;
  layout: EditorPaneLayoutState;
}>;

export const EMPTY_EDITOR_WORKBENCH: DesktopEditorWorkbenchState = createEditorWorkbenchState(
  EMPTY_EDITOR_GROUP,
  createEditorPaneLayout(),
);

export function readStoredEditorWorkbench(
  storageKey: string,
  legacyWorkbenchStorageKey: string | null,
  legacyGroupStorageKey: string | null,
  rootUri: ResourceUri | null = null,
  previousCompositionStorageKey: string | null = null,
): DesktopEditorWorkbenchState {
  try {
    const raw = window.localStorage.getItem(storageKey)
      ?? (previousCompositionStorageKey ? window.localStorage.getItem(previousCompositionStorageKey) : null)
      ?? (legacyWorkbenchStorageKey ? window.localStorage.getItem(legacyWorkbenchStorageKey) : null);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DesktopEditorWorkbenchState>;
      const group = parseEditorGroupState(parsed.group, rootUri ? { rootUri } : undefined);
      const editorIds = new Set(group.editors.map(({ id }) => id));
      const layout = collapseDuplicateVisibleResources(
        parseEditorPaneLayoutState(
          remapPersistedEditorIds(parsed.layout, group),
          editorIds,
          group.activeEditorId,
        ),
      );
      const activeEditorId = getActiveEditorPane(layout).editorId;
      return createEditorWorkbenchState(
        activeEditorId ? activateEditor(group, activeEditorId) : group,
        layout,
      );
    }
    const legacyRaw = legacyGroupStorageKey ? window.localStorage.getItem(legacyGroupStorageKey) : null;
    const group = legacyRaw
      ? parseEditorGroupState(JSON.parse(legacyRaw), rootUri ? { rootUri } : undefined)
      : EMPTY_EDITOR_GROUP;
    return createEditorWorkbenchState(group, createEditorPaneLayout(group.activeEditorId));
  } catch {
    return EMPTY_EDITOR_WORKBENCH;
  }
}

function remapPersistedEditorIds(
  value: unknown,
  group: EditorGroupState,
): unknown {
  const ids = new Map<string, string>();
  for (const editor of group.editors) {
    ids.set(editor.id, editor.id);
    ids.set(editor.resource, editor.id);
    ids.set(editor.resourceUri, editor.id);
  }
  if (!value || typeof value !== "object") return value;
  const layout = value as Record<string, unknown>;
  return { ...layout, root: remapLayoutNode(layout.root, ids) };
}

function remapLayoutNode(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "pane") {
    const editorId = typeof candidate.editorId === "string"
      ? ids.get(candidate.editorId) ?? candidate.editorId
      : candidate.editorId;
    return { ...candidate, editorId };
  }
  if (candidate.kind !== "split") return value;
  return {
    ...candidate,
    first: remapLayoutNode(candidate.first, ids),
    second: remapLayoutNode(candidate.second, ids),
  };
}

export function createEditorWorkbenchState(
  group: EditorGroupState,
  layout: EditorPaneLayoutState,
): DesktopEditorWorkbenchState {
  return Object.freeze({ group, layout });
}

function collapseDuplicateVisibleResources(
  layout: EditorPaneLayoutState,
): EditorPaneLayoutState {
  const panes = getEditorPanes(layout);
  const activePane = panes.find((pane) => pane.id === layout.activePaneId);
  const orderedPanes = activePane
    ? [activePane, ...panes.filter((pane) => pane.id !== activePane.id)]
    : panes;
  const visibleResources = new Set<string>();
  const duplicatePaneIds: string[] = [];

  for (const pane of orderedPanes) {
    if (!pane.editorId) continue;
    if (visibleResources.has(pane.editorId)) duplicatePaneIds.push(pane.id);
    else visibleResources.add(pane.editorId);
  }

  return duplicatePaneIds.reduce(
    (current, paneId) => closeEditorPane(current, paneId),
    layout,
  );
}
