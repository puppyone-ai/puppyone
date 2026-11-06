import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  EXPLORER_REFERENCE_DRAG_TYPE,
  classifyReferenceDataTransfer,
  type DocumentDataNode,
  type DocumentDropPayload,
  type DocumentDropRegistry,
  type EditorPaneSplitOptions,
  type EditorSplitDirection,
  type ReferenceDataTransferSource,
  isDropImageName,
} from "@puppyone/shared-ui";
import {
  acquireNativeSurfacePointerPassthroughLease,
  acquireNativeSurfaceOcclusionLease,
  createNativeSurfacePointerSessionId,
  type NativeSurfacePointerPassthroughLease,
} from "../../native-surfaces";
import {
  useInteractionTermination,
  type InteractionTerminationReason,
} from "../interactions/useInteractionTermination";
import {
  paneSplitDefinition,
  type PaneDropIntent,
} from "./paneDropGeometry";
import { fileSplitDropEdge, type FileSplitDropEdge } from "./fileSplitDropTarget";
import { resourceDragPreviewStore } from "../../../platform/resourceDragPreviewStore";
import { editorDropDocument } from "./editorResourceDrop";
import { resolveResourceDropSource } from "../../../platform/resourceDragSession";

export type EditorFileDropHandler = (
  node: DocumentDataNode,
  targetPaneId: string,
  direction: EditorSplitDirection,
  placement: NonNullable<EditorPaneSplitOptions["placement"]>,
) => void;

export type EditorDropFailure = "export" | "image";

export type EditorFileDropController = Readonly<{
  dropIntent: PaneDropIntent | null;
  /** `image` means the document claimed the drop but could not insert it;
   * `export` is the pane's own open/export failure. */
  dropFailure: EditorDropFailure | null;
  /** The pointer is over a document drop target: releasing inserts, not splits. */
  insertTargetPaneId: string | null;
  /** The hovered file-drop pane exposes all four explicit split cards. */
  splitTargetPaneId: string | null;
  dismissDropFailure: () => void;
  over: (event: DragEvent<HTMLElement>, paneId: string) => void;
  leave: (event: DragEvent<HTMLElement>, paneId: string) => void;
  drop: (event: DragEvent<HTMLElement>, paneId: string) => void;
}>;

type ExplorerFileDropSession = Readonly<{
  id: string;
  nativeLease: NativeSurfacePointerPassthroughLease;
  releaseOcclusion: () => void;
}>;

type ExplorerFileDropPreview = Readonly<{
  intent: PaneDropIntent;
  sessionId: string;
}>;

export type ExplorerFileDropOptions = Readonly<{
  /** Document targets registered below the pane tree handle image insertion. */
  registry?: DocumentDropRegistry | null;
  onOpenInPane?: (node: DocumentDataNode, paneId: string) => void;
}>;

/** Only a visible split card takes precedence over a document image drop. */
export function shouldRouteToDocumentDrop(input: Readonly<{
  splitEdge: FileSplitDropEdge | null;
  payloadName: string;
  hasTarget: boolean;
}>): boolean {
  return input.splitEdge === null && input.hasTarget && isDropImageName(input.payloadName);
}

export function useExplorerFileDrop(
  workspaceId: string,
  onOpenAtPaneEdge: EditorFileDropHandler,
  target: Readonly<{ workspacePath: string; paneIds: readonly string[] }>,
  options: ExplorerFileDropOptions = {},
): EditorFileDropController {
  const [preview, setPreview] = useState<ExplorerFileDropPreview | null>(null);
  const [dropFailure, setDropFailure] = useState<EditorDropFailure | null>(null);
  const [insertTargetPaneId, setInsertTargetPaneId] = useState<string | null>(null);
  const [splitTargetPaneId, setSplitTargetPaneId] = useState<string | null>(null);
  const clearCardsFrame = useRef<number | null>(null);
  const registry = options.registry ?? null;
  const sessionRef = useRef<ExplorerFileDropSession | null>(null);
  // Pane lifetimes survive resizes, but never removal/recreation or workspace changes.
  const targetsRef = useRef(new Map<string, object>());
  const openRef = useRef(onOpenAtPaneEdge);
  const openInPaneRef = useRef(options.onOpenInPane);
  useLayoutEffect(() => { openRef.current = onOpenAtPaneEdge; });
  useLayoutEffect(() => { openInPaneRef.current = options.onOpenInPane; });
  useLayoutEffect(() => {
    const targets = targetsRef.current;
    setDropFailure(null);
    return () => { targets.clear(); };
  }, [workspaceId, target.workspacePath]);
  useLayoutEffect(() => {
    const targets = targetsRef.current;
    for (const id of targets.keys()) if (!target.paneIds.includes(id)) targets.delete(id);
    for (const id of target.paneIds) if (!targets.has(id)) targets.set(id, {});
  });

  const beginFileDrag = useCallback((): ExplorerFileDropSession => {
    if (clearCardsFrame.current !== null) window.cancelAnimationFrame(clearCardsFrame.current);
    clearCardsFrame.current = null;
    const current = sessionRef.current;
    if (current) return current;
    const id = createNativeSurfacePointerSessionId("explorer-file-drop");
    const session = {
      id,
      nativeLease: acquireNativeSurfacePointerPassthroughLease("explorer-file-drop", id),
      // Native child views receive OS file drops before the DOM pane. Hide them
      // while the pane drop overlay owns the gesture; mouse routing alone only
      // forwards resize move/up events, never the protected native Files store.
      releaseOcclusion: acquireNativeSurfaceOcclusionLease(),
    };
    sessionRef.current = session;
    return session;
  }, []);

  const finishFileDrag = useCallback((reason: InteractionTerminationReason): boolean => {
    if (reason === "unmount" && clearCardsFrame.current !== null) window.cancelAnimationFrame(clearCardsFrame.current);
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    session.nativeLease.release();
    session.releaseOcclusion();
    if (reason !== "unmount") {
      setPreview((current) => current?.sessionId === session.id ? null : current);
      setInsertTargetPaneId(null);
      // Window capture retires native preview before the pane's drop capture.
      // Keep card geometry until that event has snapshotted its actual hit.
      clearCardsFrame.current = window.requestAnimationFrame(() => {
        clearCardsFrame.current = null;
        if (!sessionRef.current) setSplitTargetPaneId(null);
      });
    }
    return true;
  }, []);

  useInteractionTermination({
    finish: finishFileDrag,
    includeHtmlDragEvents: true,
  });

  useEffect(() => {
    const start = (event: globalThis.DragEvent) => {
      if (!event.defaultPrevented && hasExplorerFileDrag(event.dataTransfer)) beginFileDrag();
    };
    // Explorer populates HTML data in its target handler, after window capture.
    window.addEventListener("dragstart", start);
    return () => {
      window.removeEventListener("dragstart", start);
    };
  }, [beginFileDrag]);

  useEffect(() => {
    // Own native-session presentation independently of the cancelled HTML
    // dragstart, using the same idempotent pointer lease as other interactions.
    const sync = () => {
      const native = resourceDragPreviewStore.getSnapshot();
      if (native?.entries.length === 1 && native.entries[0].entryType === "file") {
        beginFileDrag();
        setDropFailure(null);
      } else {
        finishFileDrag("dragend");
      }
    };
    const unsubscribe = resourceDragPreviewStore.subscribe(sync);
    sync();
    return unsubscribe;
  }, [beginFileDrag, finishFileDrag]);

  const over = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    const native = resourceDragPreviewStore.getSnapshot();
    if (!hasExplorerFileDrag(event.dataTransfer)
      && !(hasNativeFiles(event.dataTransfer) && native?.entries.length === 1 && native.entries[0].entryType === "file")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    const session = beginFileDrag();
    setSplitTargetPaneId(paneId);
    const edge = fileSplitDropEdge(event.currentTarget, event.clientX, event.clientY);
    // Native Files are protected during dragover. Session names are presentation
    // only; the drop still obtains an independent Main receipt below.
    const candidateName = hasNativeFiles(event.dataTransfer)
      ? native?.entries[0]?.name
      : dropCandidate(classifyReferenceDataTransfer(event.dataTransfer), workspaceId)?.name;
    const target = edge === null ? registry?.find(event.clientX, event.clientY) ?? null : null;
    if (candidateName && target && shouldRouteToDocumentDrop({
      splitEdge: edge,
      payloadName: candidateName,
      hasTarget: true,
    })) {
      // No split preview: the release will edit the document.
      setPreview(null);
      setInsertTargetPaneId(paneId);
      return;
    }
    setInsertTargetPaneId(null);
    setPreview(edge ? {
      sessionId: session.id,
      intent: {
        targetPaneId: paneId,
        edge,
      },
    } : null);
  }, [beginFileDrag, registry, workspaceId]);

  const leave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setInsertTargetPaneId((current) => current === paneId ? null : current);
    setSplitTargetPaneId((current) => current === paneId ? null : current);
    setPreview((current) => current?.intent.targetPaneId === paneId ? null : current);
  }, []);

  const drop = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    if (!hasExplorerFileDrag(event.dataTransfer) && !hasNativeFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    // Copy the browser's protected data store before any await. Window capture
    // has already cleared preview; only a drop receipt can authorize native data.
    const source = hasNativeFiles(event.dataTransfer)
      ? { kind: "files" as const, files: Array.from(event.dataTransfer.files) }
      : classifyReferenceDataTransfer(event.dataTransfer);
    const edge = fileSplitDropEdge(event.currentTarget, event.clientX, event.clientY);
    finishFileDrag("drop");
    setDropFailure(null);
    setInsertTargetPaneId(null);
    setSplitTargetPaneId(null);

    const lifetime = targetsRef.current.get(paneId);
    const isCurrent = () => Boolean(lifetime && targetsRef.current.get(paneId) === lifetime);
    if (source.kind === "files" && source.files.length !== 1) return;
    const deliver = (node: DocumentDataNode | null) => {
      if (node && isCurrent()) {
        if (edge) {
          const { direction, placement } = paneSplitDefinition(edge);
          openRef.current(node, paneId, direction, placement);
        } else {
          openInPaneRef.current?.(node, paneId);
        }
      }
    };
    const candidate = dropCandidate(source, workspaceId);
    const target = edge === null ? registry?.find(event.clientX, event.clientY) ?? null : null;
    const complete = candidate && target && isDropImageName(candidate.name)
      ? target.prepareInsert({ x: event.clientX, y: event.clientY }) : null;
    void (async () => {
      let admitted: ReferenceDataTransferSource;
      try {
        admitted = await resolveResourceDropSource(source, "editor-open");
      } catch {
        await complete?.(null);
        if (isCurrent()) setDropFailure("export");
        return;
      }
      const node = editorDropDocument(admitted, workspaceId);
      if (!isCurrent()) { await complete?.(null); return; }
      if (!complete) { deliver(node); return; }
      // A receipt supplies canonical identity. Only a genuine external file
      // (no receipt) reaches the document's existing asset import port.
      const payload = dropCandidate(admitted, workspaceId)?.payload ?? null;
      try {
        if (!await complete(payload) && isCurrent()) setDropFailure("image");
      } catch {
        if (isCurrent()) setDropFailure("image");
      }
    })();
  }, [finishFileDrag, registry, workspaceId]);

  const dismissDropFailure = useCallback(() => setDropFailure(null), [])
  const dropIntent = preview?.intent ?? null;
  return useMemo(
    () => ({ dropIntent, dropFailure, insertTargetPaneId, splitTargetPaneId, dismissDropFailure, over, leave, drop }),
    [dismissDropFailure, drop, dropFailure, dropIntent, insertTargetPaneId, splitTargetPaneId, leave, over],
  );
}

/** Only a single file from this workspace may become a document edit. Native
 * drops keep the original `File` handle: Electron's user-selected path grant
 * does not survive reconstruction. */
function dropCandidate(
  source: ReferenceDataTransferSource,
  workspaceId: string,
): { payload: DocumentDropPayload; name: string } | null {
  if (source.kind === "files") {
    if (source.files.length !== 1) return null;
    const file = source.files[0];
    return file ? { payload: { kind: "file", file }, name: file.name } : null;
  }
  const node = editorDropDocument(source, workspaceId);
  if (!node) return null;
  return {
    payload: { kind: "workspace-entry", path: node.path, name: node.name },
    name: node.name,
  };
}

function hasNativeFiles(dataTransfer: DataTransfer): boolean {
  return Boolean(window.puppyoneDesktop?.resourceDragSessionSupported
    && Array.from(dataTransfer.types ?? []).includes("Files"));
}

function hasExplorerFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer
    && Array.from(dataTransfer.types ?? []).includes(EXPLORER_REFERENCE_DRAG_TYPE),
  );
}
