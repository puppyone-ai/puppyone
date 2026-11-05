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
  closestPaneDropEdge,
  paneSplitDefinition,
  type PaneDropIntent,
} from "./paneDropGeometry";
import { resolvePaneDropRegion, type PaneDropRegion } from "./paneDropRegion";
import { resourceDragPreviewStore } from "../../../platform/resourceDragPreviewStore";
import { claimEditorDropDocument, editorDropDocument } from "./editorResourceDrop";

export type EditorFileDropHandler = (
  node: DocumentDataNode,
  targetPaneId: string,
  direction: EditorSplitDirection,
  placement: NonNullable<EditorPaneSplitOptions["placement"]>,
) => void;

export type EditorFileDropController = Readonly<{
  dropIntent: PaneDropIntent | null;
  dropFailed: boolean;
  /** The pointer is over a document drop target: releasing inserts, not splits. */
  insertIntent: boolean;
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
  /** Document targets are registered below the pane tree; `null` keeps the
   * pre-insert behaviour everywhere. */
  registry?: DocumentDropRegistry | null;
}>;

/** An image released in the reading area belongs to the document; an image
 * released near an edge still splits the pane. */
export function shouldRouteToDocumentDrop(input: Readonly<{
  region: PaneDropRegion;
  payloadName: string;
  hasTarget: boolean;
}>): boolean {
  return input.region === "center" && input.hasTarget && isDropImageName(input.payloadName);
}

export function useExplorerFileDrop(
  workspaceId: string,
  onOpenAtPaneEdge: EditorFileDropHandler,
  target: Readonly<{ workspacePath: string; paneIds: readonly string[] }>,
  options: ExplorerFileDropOptions = {},
): EditorFileDropController {
  const [preview, setPreview] = useState<ExplorerFileDropPreview | null>(null);
  const [dropFailed, setDropFailed] = useState(false);
  const [insertIntent, setInsertIntent] = useState(false);
  const registry = options.registry ?? null;
  const sessionRef = useRef<ExplorerFileDropSession | null>(null);
  // Pane lifetimes survive resizes, but never removal/recreation or workspace changes.
  const targetsRef = useRef(new Map<string, object>());
  const openRef = useRef(onOpenAtPaneEdge);
  useLayoutEffect(() => { openRef.current = onOpenAtPaneEdge; });
  useLayoutEffect(() => {
    const targets = targetsRef.current;
    setDropFailed(false);
    return () => { targets.clear(); };
  }, [workspaceId, target.workspacePath]);
  useLayoutEffect(() => {
    const targets = targetsRef.current;
    for (const id of targets.keys()) if (!target.paneIds.includes(id)) targets.delete(id);
    for (const id of target.paneIds) if (!targets.has(id)) targets.set(id, {});
  });

  const beginFileDrag = useCallback((): ExplorerFileDropSession => {
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
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    session.nativeLease.release();
    session.releaseOcclusion();
    if (reason !== "unmount") {
      setPreview((current) => current?.sessionId === session.id ? null : current);
      setInsertIntent(false);
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
        setDropFailed(false);
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
    const rect = event.currentTarget.getBoundingClientRect();
    const region = resolvePaneDropRegion(rect, event.clientX, event.clientY);
    const candidate = dropCandidate(event.dataTransfer, workspaceId);
    const target = region === "center" ? registry?.find(event.clientX, event.clientY) ?? null : null;
    if (candidate && target && shouldRouteToDocumentDrop({
      region,
      payloadName: candidate.name,
      hasTarget: true,
    })) {
      // No split preview: the release will edit the document.
      setPreview(null);
      setInsertIntent(true);
      return;
    }
    setInsertIntent(false);
    setPreview({
      sessionId: session.id,
      intent: {
        targetPaneId: paneId,
        edge: closestPaneDropEdge(rect, event.clientX, event.clientY),
      },
    });
  }, [beginFileDrag, registry, workspaceId]);

  const leave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setInsertIntent(false);
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
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = closestPaneDropEdge(rect, event.clientX, event.clientY);
    finishFileDrag("drop");
    setDropFailed(false);
    setInsertIntent(false);

    const lifetime = targetsRef.current.get(paneId);
    const deliver = (node: DocumentDataNode | null) => {
      if (node && lifetime && targetsRef.current.get(paneId) === lifetime) {
        const { direction, placement } = paneSplitDefinition(edge);
        openRef.current(node, paneId, direction, placement);
      }
    };
    const split = () => {
      if (source.kind === "files") {
        void claimEditorDropDocument(source).then(deliver).catch(() => {
          if (targetsRef.current.get(paneId) === lifetime) setDropFailed(true);
        });
      } else {
        deliver(editorDropDocument(source, workspaceId));
      }
    };

    const region = resolvePaneDropRegion(rect, event.clientX, event.clientY);
    const candidate = dropCandidate(event.dataTransfer, workspaceId);
    const target = region === "center" ? registry?.find(event.clientX, event.clientY) ?? null : null;
    if (!candidate || !target || !shouldRouteToDocumentDrop({
      region,
      payloadName: candidate.name,
      hasTarget: true,
    })) {
      split();
      return;
    }
    void target.insert(candidate.payload).then((claimed) => {
      // A target that cannot express the path (another root, an unsupported
      // asset) hands the drop back to the pane instead of swallowing it.
      if (!claimed) split();
    }).catch(() => {
      setDropFailed(true);
    });
  }, [finishFileDrag, registry, workspaceId]);

  const dismissDropFailure = useCallback(() => setDropFailed(false), []);
  const dropIntent = preview?.intent ?? null;
  return useMemo(
    () => ({ dropIntent, dropFailed, insertIntent, dismissDropFailure, over, leave, drop }),
    [dismissDropFailure, drop, dropFailed, dropIntent, insertIntent, leave, over],
  );
}

/** Only a single file from this workspace may become a document edit. Native
 * drops keep the original `File` handle: Electron's user-selected path grant
 * does not survive reconstruction. */
function dropCandidate(
  dataTransfer: DataTransfer,
  workspaceId: string,
): { payload: DocumentDropPayload; name: string } | null {
  const source: ReferenceDataTransferSource = hasNativeFiles(dataTransfer)
    ? { kind: "files", files: Array.from(dataTransfer.files) }
    : classifyReferenceDataTransfer(dataTransfer);
  if (source.kind === "files") {
    const file = source.files[0];
    return file ? { payload: { kind: "file", file }, name: file.name } : null;
  }
  if (source.kind !== "workspace-entries" || !source.typed || source.entries.length !== 1) return null;
  const entry = source.entries[0]!;
  if (entry.entryType !== "file") return null;
  if (source.workspaceId !== null && source.workspaceId !== workspaceId) return null;
  return {
    payload: { kind: "workspace-entry", path: entry.path, name: entry.name },
    name: entry.name,
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
