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
  type EditorPaneSplitOptions,
  type EditorSplitDirection,
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

export function useExplorerFileDrop(
  workspaceId: string,
  onOpenAtPaneEdge: EditorFileDropHandler,
  target: Readonly<{ workspacePath: string; paneIds: readonly string[] }>,
): EditorFileDropController {
  const [preview, setPreview] = useState<ExplorerFileDropPreview | null>(null);
  const [dropFailed, setDropFailed] = useState(false);
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
    };
    sessionRef.current = session;
    return session;
  }, []);

  const finishFileDrag = useCallback((reason: InteractionTerminationReason): boolean => {
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    session.nativeLease.release();
    if (reason !== "unmount") {
      setPreview((current) => current?.sessionId === session.id ? null : current);
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
  }, [beginFileDrag]);

  const leave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
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
    const edge = closestPaneDropEdge(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    finishFileDrag("drop");
    setDropFailed(false);
    const lifetime = targetsRef.current.get(paneId);
    if (!lifetime) return;
    const { direction, placement } = paneSplitDefinition(edge);
    const deliver = (node: DocumentDataNode | null) => {
      if (node && targetsRef.current.get(paneId) === lifetime) {
        openRef.current(node, paneId, direction, placement);
      }
    };
    if (source.kind === "files") {
      void claimEditorDropDocument(source).then(deliver).catch(() => {
        if (targetsRef.current.get(paneId) === lifetime) setDropFailed(true);
      });
    } else {
      deliver(editorDropDocument(source, workspaceId));
    }
  }, [finishFileDrag, workspaceId]);

  const dropIntent = preview?.intent ?? null;
  return useMemo(() => ({ dropIntent, dropFailed, over, leave, drop }), [drop, dropFailed, dropIntent, leave, over]);
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
