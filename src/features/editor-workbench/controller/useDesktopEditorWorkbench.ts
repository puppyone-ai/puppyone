import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activateEditor,
  activateEditorPane,
  assignEditorToActivePane,
  assignEditorToPane,
  closeEditor,
  closeEditorPane,
  closeEditorsUnderResource,
  createEditorInput,
  getActiveEditorPane,
  getEditorPanes,
  moveEditorPane,
  openEditor,
  rebaseEditorPaneResources,
  rebaseEditorResources,
  removeEditorFromPanes,
  splitEditorPane,
  updateEditorSplitRatio,
  isDocumentDataNode,
  isDataResourceUri,
  type DataNode,
  type DocumentDataNode,
  type EditorGroupState,
  type EditorResourceDescriptor,
  type EditorPaneLayoutState,
  type EditorPaneSplitOptions,
  type EditorSplitDirection,
  type ResourceUri,
  type Workspace,
} from "@puppyone/shared-ui";
import {
  EDITOR_WORKBENCH_STORAGE_PREFIX,
  EMPTY_EDITOR_WORKBENCH,
  LEGACY_EDITOR_GROUP_STORAGE_PREFIX,
  LEGACY_EDITOR_WORKBENCH_STORAGE_PREFIX,
  createEditorWorkbenchState,
  readStoredEditorWorkbench,
  type DesktopEditorWorkbenchState,
} from "../persistence/editorWorkbenchStorage";
import { EditorWorkbenchPersistenceScheduler } from "../persistence/editorWorkbenchPersistence";

export type DesktopEditorWorkbenchController = Readonly<{
  state: EditorGroupState;
  paneLayout: EditorPaneLayoutState;
  activePath: string | null;
  activeEditorId: string | null;
  activePaneId: string;
  openDocument: (node: DocumentDataNode) => void;
  openDocumentAtPaneEdge: (
    node: DocumentDataNode,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
  splitPane: (
    paneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
  activate: (editorId: string) => void;
  focusPane: (paneId: string) => void;
  movePane: (
    sourcePaneId: string,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  close: (editorId: string) => void;
  closeUnderResource: (resource: string) => void;
  rebaseResource: (previousResource: string, nextResource: string) => void;
  clear: () => void;
}>;

export type EditorDocumentNodeResolver = (path: string) => Promise<DataNode | null>;
export type EditorResourceResolver = (path: string) => EditorResourceDescriptor | null;

export function useDesktopEditorWorkbench(
  workspace: Workspace | null,
  resolveNode: EditorDocumentNodeResolver | null,
  workspaceFolderUri: ResourceUri | null = null,
  resolveEditorResource: EditorResourceResolver | null = null,
  compositionId: string | null = null,
): DesktopEditorWorkbenchController {
  const storageKey = compositionId
    ? `${EDITOR_WORKBENCH_STORAGE_PREFIX}:composition:${compositionId}`
    : workspace ? `${EDITOR_WORKBENCH_STORAGE_PREFIX}:${workspace.id}:${workspace.path}` : null;
  const previousCompositionStorageKey = compositionId && workspace ? `${EDITOR_WORKBENCH_STORAGE_PREFIX}:${workspace.id}:${workspace.path}` : null;
  const legacyWorkbenchStorageKey = workspace
    ? `${LEGACY_EDITOR_WORKBENCH_STORAGE_PREFIX}:${workspace.id}:${workspace.path}`
    : null;
  const legacyGroupStorageKey = workspace
    ? `${LEGACY_EDITOR_GROUP_STORAGE_PREFIX}:${workspace.id}:${workspace.path}`
    : null;
  type Record = { storageKey: string | null; workbench: DesktopEditorWorkbenchState; hydrated: boolean };
  const [records, setRecords] = useState(() => new Map<string | null, Record>());
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const record = useMemo(() => records.get(storageKey) ?? { storageKey, workbench: EMPTY_EDITOR_WORKBENCH, hydrated: false }, [records, storageKey]);
  const setRecord = useCallback((update: Record | ((current: Record) => Record)) => {
    setRecords((current) => {
      const previous = current.get(storageKey) ?? { storageKey, workbench: EMPTY_EDITOR_WORKBENCH, hydrated: false };
      const next = typeof update === "function" ? update(previous) : update;
      if (previous === next) return current;
      if (next.storageKey && next.hydrated) persistenceRef.current?.schedule(next.storageKey, next.workbench);
      const updated = new Map(current);
      updated.set(storageKey, next);
      return updated;
    });
  }, [storageKey]);
  const persistenceRef = useRef<EditorWorkbenchPersistenceScheduler | null>(null);
  const hydrationGenerationRef = useRef(0);
  const interactionGenerationRef = useRef(0);
  persistenceRef.current ??= new EditorWorkbenchPersistenceScheduler(
    window.localStorage,
    window,
  );
  const workbench = record.storageKey === storageKey ? record.workbench : EMPTY_EDITOR_WORKBENCH;

  useEffect(() => {
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    const interactionGeneration = interactionGenerationRef.current;
    if (!storageKey) {
      setRecord({ storageKey: null, workbench: EMPTY_EDITOR_WORKBENCH, hydrated: true });
      return undefined;
    }

    if (recordsRef.current.get(storageKey)?.hydrated) return undefined;

    const stored = readStoredEditorWorkbench(
      storageKey,
      legacyWorkbenchStorageKey,
      legacyGroupStorageKey,
      workspaceFolderUri,
      previousCompositionStorageKey,
    );
    if (!resolveNode) {
      // A workspace session without a metadata resolver cannot prove that its
      // persisted paths are documents. Fail closed instead of trusting storage.
      setRecord({ storageKey, workbench: EMPTY_EDITOR_WORKBENCH, hydrated: true });
      return undefined;
    }

    // Restored paths are untrusted until the storage boundary proves they are
    // documents. Keep the workbench empty so a stale folder tab cannot flash.
    setRecord({ storageKey, workbench: EMPTY_EDITOR_WORKBENCH, hydrated: false });
    let cancelled = false;
    void retainResolvedDocuments(stored, resolveNode).then((validated) => {
      if (
        cancelled
        || hydrationGenerationRef.current !== generation
        || interactionGenerationRef.current !== interactionGeneration
      ) return;
      setRecord((current) => current.storageKey === storageKey
        ? { storageKey, workbench: validated, hydrated: true }
        : current);
    });
    return () => {
      cancelled = true;
    };
  }, [legacyGroupStorageKey, legacyWorkbenchStorageKey, previousCompositionStorageKey, resolveNode, setRecord, storageKey, workspaceFolderUri]);

  useEffect(() => {
    if (!storageKey || record.storageKey !== storageKey || !record.hydrated) return;
    persistenceRef.current?.schedule(storageKey, record.workbench);
  }, [record, storageKey]);

  useEffect(() => {
    const flush = () => persistenceRef.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const updateWorkbench = useCallback((
    update: (current: DesktopEditorWorkbenchState) => DesktopEditorWorkbenchState,
  ) => {
    interactionGenerationRef.current += 1;
    setRecord((current) => {
      const currentWorkbench = current.storageKey === storageKey
        ? current.workbench
        : EMPTY_EDITOR_WORKBENCH;
      return { storageKey, workbench: update(currentWorkbench), hydrated: true };
    });
  }, [setRecord, storageKey]);

  const toEditorResource = useCallback((path: string) => (
    resolveEditorResource?.(path)
      ?? (workspaceFolderUri ? { rootUri: workspaceFolderUri, resourcePath: path } : path)
  ), [resolveEditorResource, workspaceFolderUri]);

  const openDocument = useCallback((node: DocumentDataNode) => {
    if (!isDocumentDataNode(node) || !node.path) return;
    updateWorkbench((current) => {
      const input = createEditorInput(
        toEditorResource(node.path),
        node.name,
      );
      const group = openEditor(current.group, input);
      const visiblePane = getEditorPanes(current.layout).find((pane) => pane.editorId === input.id);
      const layout = visiblePane
        ? activateEditorPane(current.layout, visiblePane.id)
        : assignEditorToActivePane(current.layout, input.id);
      return createEditorWorkbenchState(group, layout);
    });
  }, [toEditorResource, updateWorkbench]);

  const activate = useCallback((editorId: string) => {
    updateWorkbench((current) => {
      const group = activateEditor(current.group, editorId);
      if (group === current.group && group.activeEditorId !== editorId) return current;
      const visiblePane = getEditorPanes(current.layout).find((pane) => pane.editorId === editorId);
      const layout = visiblePane
        ? activateEditorPane(current.layout, visiblePane.id)
        : assignEditorToActivePane(current.layout, editorId);
      return createEditorWorkbenchState(group, layout);
    });
  }, [updateWorkbench]);

  const openDocumentAtPaneEdge = useCallback((
    node: DocumentDataNode,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => {
    if (!isDocumentDataNode(node) || !node.path) return;
    updateWorkbench((current) => {
      const input = createEditorInput(
        toEditorResource(node.path),
        node.name,
      );
      const visiblePane = getEditorPanes(current.layout).find((pane) => pane.editorId === input.id);
      const group = openEditor(current.group, input);
      if (visiblePane) {
        return createEditorWorkbenchState(
          activateEditor(group, input.id),
          activateEditorPane(current.layout, visiblePane.id),
        );
      }

      const targetPane = getEditorPanes(current.layout).find((pane) => pane.id === targetPaneId);
      if (!targetPane) return current;
      const layout = targetPane.editorId === null
        ? assignEditorToPane(current.layout, targetPaneId, input.id)
        : splitEditorPane(current.layout, targetPaneId, direction, { editorId: input.id, placement });
      return createEditorWorkbenchState(activateEditor(group, input.id), layout);
    });
  }, [toEditorResource, updateWorkbench]);

  const focusPane = useCallback((paneId: string) => {
    updateWorkbench((current) => {
      const layout = activateEditorPane(current.layout, paneId);
      if (layout === current.layout) return current;
      const editorId = getActiveEditorPane(layout).editorId;
      const group = editorId ? activateEditor(current.group, editorId) : current.group;
      return createEditorWorkbenchState(group, layout);
    });
  }, [updateWorkbench]);

  const splitPane = useCallback((
    paneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => {
    updateWorkbench((current) => {
      const layout = splitEditorPane(current.layout, paneId, direction, {
        editorId: null,
        placement,
      });
      return layout === current.layout ? current : createEditorWorkbenchState(current.group, layout);
    });
  }, [updateWorkbench]);

  const movePane = useCallback((
    sourcePaneId: string,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => {
    updateWorkbench((current) => {
      const layout = moveEditorPane(
        current.layout,
        sourcePaneId,
        targetPaneId,
        direction,
        placement,
      );
      if (layout === current.layout) return current;
      const editorId = getActiveEditorPane(layout).editorId;
      const group = editorId ? activateEditor(current.group, editorId) : current.group;
      return createEditorWorkbenchState(group, layout);
    });
  }, [updateWorkbench]);

  const closePane = useCallback((paneId: string) => {
    updateWorkbench((current) => {
      const layout = closeEditorPane(current.layout, paneId);
      if (layout === current.layout) return current;
      const editorId = getActiveEditorPane(layout).editorId;
      const group = editorId ? activateEditor(current.group, editorId) : current.group;
      return createEditorWorkbenchState(group, layout);
    });
  }, [updateWorkbench]);

  const resizeSplit = useCallback((splitId: string, ratio: number) => {
    updateWorkbench((current) => {
      const layout = updateEditorSplitRatio(current.layout, splitId, ratio);
      return layout === current.layout ? current : createEditorWorkbenchState(current.group, layout);
    });
  }, [updateWorkbench]);

  const close = useCallback((editorId: string) => {
    updateWorkbench((current) => {
      const group = closeEditor(current.group, editorId);
      const layout = removeEditorFromPanes(current.layout, editorId, group.activeEditorId);
      return createEditorWorkbenchState(group, layout);
    });
  }, [updateWorkbench]);

  const closeUnderResource = useCallback((resource: string) => {
    updateWorkbench((current) => {
      const target = isDataResourceUri(resource) ? resource : toEditorResource(resource);
      const group = closeEditorsUnderResource(current.group, target);
      const retainedEditorIds = new Set(group.editors.map((editor) => editor.id));
      const removedEditorIds = current.group.editors
        .filter((editor) => !retainedEditorIds.has(editor.id))
        .map((editor) => editor.id);
      const layout = removedEditorIds.reduce(
        (next, editorId) => removeEditorFromPanes(next, editorId, group.activeEditorId),
        current.layout,
      );
      return createEditorWorkbenchState(group, layout);
    });
  }, [toEditorResource, updateWorkbench]);

  const rebaseResource = useCallback((previousResource: string, nextResource: string) => {
    const previous = toEditorResource(previousResource);
    const next = toEditorResource(nextResource);
    updateWorkbench((current) => createEditorWorkbenchState(
      rebaseEditorResources(current.group, previous, next),
      rebaseEditorPaneResources(current.layout, previous, next),
    ));
  }, [toEditorResource, updateWorkbench]);

  const clear = useCallback(() => updateWorkbench(() => EMPTY_EDITOR_WORKBENCH), [updateWorkbench]);
  const activePane = getActiveEditorPane(workbench.layout);
  const activeEditor = workbench.group.editors.find((editor) => editor.id === activePane.editorId);

  return useMemo(() => ({
    state: workbench.group,
    paneLayout: workbench.layout,
    activePath: activeEditor?.resource ?? null,
    activeEditorId: activeEditor?.id ?? null,
    activePaneId: activePane.id,
    openDocument,
    openDocumentAtPaneEdge,
    splitPane,
    activate,
    focusPane,
    movePane,
    closePane,
    resizeSplit,
    close,
    closeUnderResource,
    rebaseResource,
    clear,
  }), [
    activate,
    activeEditor?.resource,
    activeEditor?.id,
    activePane.id,
    clear,
    close,
    closePane,
    closeUnderResource,
    focusPane,
    movePane,
    openDocument,
    openDocumentAtPaneEdge,
    splitPane,
    rebaseResource,
    resizeSplit,
    workbench.group,
    workbench.layout,
  ]);
}

async function retainResolvedDocuments(
  workbench: DesktopEditorWorkbenchState,
  resolveNode: EditorDocumentNodeResolver,
): Promise<DesktopEditorWorkbenchState> {
  const resolved = await Promise.all(workbench.group.editors.map(async (editor) => {
    const node = await resolveNode(editor.resource).catch(() => null);
    return { editorId: editor.id, admitted: isDocumentDataNode(node) };
  }));
  const rejectedEditorIds = resolved
    .filter(({ admitted }) => !admitted)
    .map(({ editorId }) => editorId);
  if (rejectedEditorIds.length === 0) return workbench;

  const group = rejectedEditorIds.reduce(
    (current, editorId) => closeEditor(current, editorId),
    workbench.group,
  );
  const layout = rejectedEditorIds.reduce(
    (current, editorId) => removeEditorFromPanes(current, editorId, group.activeEditorId),
    workbench.layout,
  );
  return createEditorWorkbenchState(group, layout);
}
