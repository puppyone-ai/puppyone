import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  EXPLORER_REFERENCE_DRAG_TYPE,
  getFileSemanticKind,
  parseExplorerReferenceDrag,
  type DocumentDataNode,
  type EditorPaneSplitOptions,
  type EditorSplitDirection,
  type ExplorerReferenceDragEntry,
} from "@puppyone/shared-ui";
import {
  acquireNativeSurfacePointerPassthroughLease,
  createNativeSurfacePointerSessionId,
  type NativeSurfacePointerPassthroughLease,
} from "../../native-surfaces";
import {
  useInteractionTermination,
  type InteractionTerminationReason,
} from "../interactions/useInteractionTermination";
import {
  closestPaneDropEdge,
  paneSplitDefinition,
  type PaneDropIntent,
} from "./paneDropGeometry";

export type EditorFileDropHandler = (
  node: DocumentDataNode,
  targetPaneId: string,
  direction: EditorSplitDirection,
  placement: NonNullable<EditorPaneSplitOptions["placement"]>,
) => void;

export type EditorResourceDropResolver = (
  files: File[],
  resourceDragSessionId: string,
) => Promise<readonly ExplorerReferenceDragEntry[] | null>;

export type EditorFileDropController = Readonly<{
  dropIntent: PaneDropIntent | null;
  over: (event: DragEvent<HTMLElement>, paneId: string) => void;
  leave: (event: DragEvent<HTMLElement>, paneId: string) => void;
  drop: (event: DragEvent<HTMLElement>, paneId: string) => void;
}>;

type ExplorerFileDropSession = Readonly<{
  id: string;
  nativeLease: NativeSurfacePointerPassthroughLease;
}>;

type ExplorerFileDropPreview = Readonly<{
  intent: PaneDropIntent;
  sessionId: string;
}>;

type NativeExplorerFileDrop = Readonly<{
  resourceDragSessionId: string;
  sessionId: string;
  targetPaneId: string;
}>;

const NATIVE_DROP_SETTLE_MS = 100;

export function useExplorerFileDrop(
  workspaceId: string,
  onOpenAtPaneEdge: EditorFileDropHandler,
  resourceDragEntries: readonly ExplorerReferenceDragEntry[] | null,
  resourceDragSessionId: string | null,
  onResolveResourceDrop?: EditorResourceDropResolver,
): EditorFileDropController {
  const [preview, setPreview] = useState<ExplorerFileDropPreview | null>(null);
  const sessionRef = useRef<ExplorerFileDropSession | null>(null);
  const nativeDropRef = useRef<NativeExplorerFileDrop | null>(null);

  const beginFileDrag = useCallback((): ExplorerFileDropSession => {
    const current = sessionRef.current;
    if (current) return current;
    const id = createNativeSurfacePointerSessionId("explorer-file-drop");
    const session = {
      id,
      nativeLease: acquireNativeSurfacePointerPassthroughLease("explorer-file-drop", id),
    };
    sessionRef.current = session;
    return session;
  }, []);

  const clearFileDrag = useCallback((reason: InteractionTerminationReason): boolean => {
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    session.nativeLease.release();
    const clearNativeDrop = () => {
      if (nativeDropRef.current?.sessionId === session.id) nativeDropRef.current = null;
    };
    if (reason === "drop") queueMicrotask(clearNativeDrop);
    else clearNativeDrop();
    if (reason !== "unmount") {
      setPreview((current) => current?.sessionId === session.id ? null : current);
    }
    return true;
  }, []);

  const finishFileDrag = useCallback((reason: InteractionTerminationReason): boolean => {
    if (
      nativeDropRef.current
      && (reason === "blur" || reason === "dragend")
    ) return false;
    return clearFileDrag(reason);
  }, [clearFileDrag]);

  useEffect(() => {
    const nativeDrop = nativeDropRef.current;
    if (!nativeDrop || resourceDragSessionId === nativeDrop.resourceDragSessionId) return;
    if (resourceDragSessionId) {
      clearFileDrag("dragend");
      return;
    }
    const timeout = window.setTimeout(() => {
      if (nativeDropRef.current?.resourceDragSessionId === nativeDrop.resourceDragSessionId) {
        clearFileDrag("dragend");
      }
    }, NATIVE_DROP_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [clearFileDrag, resourceDragSessionId]);

  useInteractionTermination({
    finish: finishFileDrag,
    includeHtmlDragEvents: true,
  });

  useEffect(() => {
    const start = (event: globalThis.DragEvent) => {
      if (hasExplorerFileDrag(event.dataTransfer)) beginFileDrag();
    };
    window.addEventListener("dragstart", start, true);
    return () => {
      window.removeEventListener("dragstart", start, true);
    };
  }, [beginFileDrag]);

  const openEntryAtPaneEdge = useCallback((
    entry: ExplorerReferenceDragEntry,
    paneId: string,
    edge: PaneDropIntent["edge"],
  ) => {
    if (entry.entryType !== "file") return;
    const { direction, placement } = paneSplitDefinition(edge);
    const type = getFileSemanticKind(entry.name, "file");
    if (type === "folder") return;
    onOpenAtPaneEdge({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      type,
    }, paneId, direction, placement);
  }, [onOpenAtPaneEdge]);

  const over = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    const hasLegacyPayload = hasExplorerFileDrag(event.dataTransfer);
    const nativeEntry = hasLegacyPayload || !resourceDragSessionId
      ? null
      : getNativeExplorerFileEntry(event.dataTransfer, resourceDragEntries);
    if (!hasLegacyPayload && !nativeEntry) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    const session = beginFileDrag();
    nativeDropRef.current = nativeEntry && resourceDragSessionId
      ? { resourceDragSessionId, sessionId: session.id, targetPaneId: paneId }
      : null;
    setPreview({
      sessionId: session.id,
      intent: {
        targetPaneId: paneId,
        edge: closestPaneDropEdge(
          event.currentTarget.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        ),
      },
    });
  }, [beginFileDrag, resourceDragEntries, resourceDragSessionId]);

  const leave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setPreview((current) => current?.intent.targetPaneId === paneId ? null : current);
  }, []);

  const drop = useCallback(async (event: DragEvent<HTMLElement>, paneId: string) => {
    const hasLegacyPayload = hasExplorerFileDrag(event.dataTransfer);
    const nativeDrop = nativeDropRef.current;
    const hasNativePayload = !hasLegacyPayload
      && nativeDrop?.targetPaneId === paneId;
    if (!hasLegacyPayload && !hasNativePayload) return;
    event.preventDefault();
    event.stopPropagation();
    const edge = closestPaneDropEdge(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const files = hasNativePayload ? Array.from(event.dataTransfer.files) : [];
    const nativeSessionId = hasNativePayload ? nativeDrop?.resourceDragSessionId ?? null : null;
    finishFileDrag("drop");
    nativeDropRef.current = null;

    if (hasLegacyPayload) {
      const payload = parseExplorerReferenceDrag(
        event.dataTransfer.getData(EXPLORER_REFERENCE_DRAG_TYPE),
      );
      const entry = payload?.workspaceId === workspaceId && payload.entries.length === 1
        ? payload.entries[0]
        : null;
      if (entry) openEntryAtPaneEdge(entry, paneId, edge);
      return;
    }

    if (!nativeSessionId || !onResolveResourceDrop) return;
    try {
      const entries = await onResolveResourceDrop(files, nativeSessionId);
      const entry = entries?.length === 1 ? entries[0] : null;
      if (entry) openEntryAtPaneEdge(entry, paneId, edge);
    } catch {
      // The resolver owns user-visible authorization failure reporting.
    }
  }, [
    finishFileDrag,
    onResolveResourceDrop,
    openEntryAtPaneEdge,
    workspaceId,
  ]);

  const dropIntent = preview?.intent ?? null;
  return useMemo(() => ({ dropIntent, over, leave, drop }), [drop, dropIntent, leave, over]);
}

function hasExplorerFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer
    && Array.from(dataTransfer.types ?? []).includes(EXPLORER_REFERENCE_DRAG_TYPE),
  );
}

function getNativeExplorerFileEntry(
  dataTransfer: DataTransfer | null,
  entries: readonly ExplorerReferenceDragEntry[] | null,
): ExplorerReferenceDragEntry | null {
  if (
    !dataTransfer
    || !Array.from(dataTransfer.types ?? []).includes("Files")
    || entries?.length !== 1
  ) return null;
  return entries[0]?.entryType === "file" ? entries[0] : null;
}
