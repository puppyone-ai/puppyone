import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { DataNode } from "../core/types";
import {
  getDataResourceParent,
  isDataResourceDescendant,
  isSameDataResource,
} from "../core/dataResourcePath";
import {
  FileGlyphIcon,
  getFileVisualKind,
  type FileIconThemeId,
} from "../file/fileIcons";
import { DotsLoader, InlineLoading } from "../primitives/LoadingIndicator";
import { useScrollEdgeState } from "../primitives/useScrollableClass";
import {
  buildExplorerNodeIndex,
  buildExplorerVisibleModel,
  getDisplayNameKey,
  getExplorerDisplayName,
  type ExplorerVisibleNodeRow,
  type ExplorerVisibleRow,
} from "./explorer/explorerVisibleModel";
import {
  equalExplorerRowInteraction,
  selectExplorerRowInteraction,
  type ExplorerRowInteractionState,
  type ExplorerRowStateSources,
} from "./explorer/explorerRowInteraction";
import {
  createExplorerMotionAnimation,
  EXPLORER_MOTION_DURATION_MS,
  EXPLORER_MOTION_EASING,
} from "./explorer/explorerMotionAnimation";
import type {
  ExplorerRevealPhase,
  ExplorerRowMotionInstruction,
} from "./explorer/explorerMotionPlan";
import { useExplorerMotion } from "./explorer/useExplorerMotion";
import {
  EXPLORER_REFERENCE_DRAG_TYPE,
  EXPLORER_TREE_NODE_DRAG_TYPE,
  parseExplorerReferenceDrag,
  serializeExplorerReferenceDrag,
} from "./explorer/explorerReferenceDrag";
import {
  EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
  useExplorerVirtualWindow,
} from "./explorer/useExplorerVirtualWindow";

export type ExplorerLoadingPresentation = "dots" | "skeleton" | "none";

export type ExplorerTreeProps = {
  nodes: readonly DataNode[];
  activePath: string | null;
  selectedPaths?: ReadonlySet<string>;
  cutPaths?: ReadonlySet<string>;
  currentFolderPath?: string | null;
  loadingPath?: string | null;
  expandedPaths: ReadonlySet<string>;
  loadingPaths?: ReadonlySet<string>;
  rootLoading?: boolean;
  rootError?: string | null;
  rootLabel?: string;
  showRoot?: boolean;
  loadingLabel?: string;
  loadingPresentation?: ExplorerLoadingPresentation;
  fileIconTheme?: FileIconThemeId;
  /** Stable workspace identity embedded in outbound reference drags. */
  dragWorkspaceId?: string;
  canMoveNodes?: boolean;
  onSelectNode: (node: DataNode | null, intent?: ExplorerSelectionIntent) => void;
  onToggleFolder?: (node: DataNode, expanded: boolean) => void;
  onMoveNode?: (node: DataNode, targetFolderPath: string | null) => void | Promise<void>;
  onMoveNodes?: (nodes: DataNode[], targetFolderPath: string | null) => void | Promise<void>;
  onCopyNodes?: (nodes: DataNode[]) => void | Promise<void>;
  onCutNodes?: (nodes: DataNode[]) => void | Promise<void>;
  onPasteNodes?: (targetFolderPath: string | null) => void | Promise<void>;
  onDuplicateNodes?: (nodes: DataNode[]) => void | Promise<void>;
  onImportFiles?: (files: File[], targetFolderPath: string | null) => void | Promise<void>;
  onRootContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onNodeContextMenu?: (node: DataNode, event: ReactMouseEvent<HTMLDivElement>) => void;
  onRootClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  renderRootContent?: () => ReactNode;
  renderListStart?: () => ReactNode;
  renderListEnd?: () => ReactNode;
  renderRootActions?: () => ReactNode;
  renderFolderActions?: (node: DataNode) => ReactNode;
  renderNodeActions?: (node: DataNode) => ReactNode;
};

export type ExplorerSelectionIntent = {
  additive?: boolean;
  range?: boolean;
};

type TreeDropTarget = {
  rowPath: string | null;
  targetFolderPath: string | null;
  mode: "folder" | "parent";
  valid: boolean;
} | null;

type TreeDragController = {
  enabled: boolean;
  onNodeDragStart: (event: ReactDragEvent<HTMLDivElement>, node: DataNode) => void;
  onNodeDragEnd: () => void;
  onRowDragOver: (
    event: ReactDragEvent<HTMLElement>,
    rowPath: string | null,
    targetFolderPath: string | null,
    mode: "folder" | "parent",
  ) => boolean;
  onRowDrop: (event: ReactDragEvent<HTMLElement>, targetFolderPath: string | null) => void;
};

export { EXPLORER_TREE_NODE_DRAG_TYPE } from "./explorer/explorerReferenceDrag";
const FOLDER_HOVER_EXPAND_MS = 620;
const FOLDER_PEER_DROP_ZONE_RATIO = 0.34;
const EXPLORER_ROW_DOM_ID_PREFIX = "puppyone-explorer-row";

export function ExplorerTree({
  nodes,
  activePath,
  selectedPaths = EMPTY_PATH_SET,
  cutPaths = EMPTY_PATH_SET,
  currentFolderPath = null,
  loadingPath = null,
  expandedPaths,
  loadingPaths,
  rootLoading = false,
  rootError = null,
  rootLabel,
  showRoot = true,
  loadingLabel,
  loadingPresentation = "dots",
  fileIconTheme = "default",
  dragWorkspaceId = "",
  canMoveNodes = false,
  onSelectNode,
  onToggleFolder,
  onMoveNode,
  onMoveNodes,
  onCopyNodes,
  onCutNodes,
  onPasteNodes,
  onDuplicateNodes,
  onImportFiles,
  onRootContextMenu,
  onNodeContextMenu,
  onRootClick,
  renderRootContent,
  renderListStart,
  renderListEnd,
  renderRootActions,
  renderFolderActions,
  renderNodeActions,
}: ExplorerTreeProps) {
  const { direction, t } = useLocalization();
  const resolvedRootLabel = rootLabel ?? t("shared-ui.explorer.root");
  const resolvedLoadingLabel = loadingLabel ?? t("shared-ui.loading");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Native dragenter/dragleave events fire for descendants too. The target is
  // outside this tree only when the balanced depth returns to zero.
  const dragEnterDepthRef = useRef(0);
  const [draggedNodes, setDraggedNodes] = useState<DataNode[]>([]);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget>(null);
  const moveEnabled = Boolean(canMoveNodes && (onMoveNodes || onMoveNode));
  const importEnabled = Boolean(onImportFiles);
  const dropEnabled = moveEnabled || importEnabled;
  const resolvedLoadingPaths = useMemo<ReadonlySet<string>>(
    () => loadingPaths ?? (loadingPath ? new Set([loadingPath]) : EMPTY_PATH_SET),
    [loadingPath, loadingPaths],
  );
  const visibleModel = useMemo(() => buildExplorerVisibleModel(nodes, {
    expandedPaths,
    loadingPaths: resolvedLoadingPaths,
    loadingLabel: resolvedLoadingLabel,
  }), [expandedPaths, nodes, resolvedLoadingLabel, resolvedLoadingPaths]);
  const initialLoading = rootLoading && nodes.length === 0;
  const softWorkspaceGrouping = useMemo(
    () => nodes.filter((node) => node.workspaceFolderRoot).length > 1,
    [nodes],
  );
  const nodeIndex = useMemo(() => buildExplorerNodeIndex(nodes), [nodes]);
  const selectedDragNodes = useMemo(
    () => collectTopLevelSelectedNodes(nodeIndex, selectedPaths),
    [nodeIndex, selectedPaths],
  );
  const draggedPaths = useMemo(
    () => new Set(draggedNodes.map((node) => node.path)),
    [draggedNodes],
  );
  const rowStateSources = useMemo<ExplorerRowStateSources>(() => ({
    activePath,
    selectedPaths,
    cutPaths,
    loadingPaths: resolvedLoadingPaths,
    draggedPaths,
    dropTarget,
  }), [activePath, cutPaths, draggedPaths, dropTarget, resolvedLoadingPaths, selectedPaths]);
  const activeIndex = activePath ? visibleModel.pathToIndex.get(activePath) ?? null : null;
  const firstNavigableIndex = useMemo(
    () => findNavigableRowIndex(visibleModel.rows, 0, 1),
    [visibleModel.rows],
  );
  const virtualWindow = useExplorerVirtualWindow({
    rowCount: visibleModel.rows.length,
    scrollRef,
    activeIndex,
  });
  const visibleRows = useMemo(
    () => visibleModel.rows.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [virtualWindow.endIndex, virtualWindow.startIndex, visibleModel.rows],
  );
  const motionPlan = useExplorerMotion({
    rows: visibleModel.rows,
    mountedRows: visibleRows,
    startIndex: virtualWindow.startIndex,
    endIndex: virtualWindow.endIndex,
    rowSize: virtualWindow.rowSize,
    maxMountedRows: EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
  });
  const scrollEdgeState = useScrollEdgeState(scrollRef, {
    revision: `${visibleModel.rows.length}:${rootLoading ? "loading" : "idle"}:${rootError ?? ""}`,
  });
  const scrollable = scrollEdgeState.scrollable;
  const callbackRef = useRef({
    onSelectNode,
    onToggleFolder,
    onNodeContextMenu,
    renderFolderActions,
    renderNodeActions,
  });
  callbackRef.current = {
    onSelectNode,
    onToggleFolder,
    onNodeContextMenu,
    renderFolderActions,
    renderNodeActions,
  };
  const selectNode = useCallback<ExplorerTreeProps["onSelectNode"]>(
    (node, intent) => callbackRef.current.onSelectNode(node, intent),
    [],
  );
  const toggleFolder = useCallback<NonNullable<ExplorerTreeProps["onToggleFolder"]>>(
    (node, expanded) => callbackRef.current.onToggleFolder?.(node, expanded),
    [],
  );
  const openNodeContextMenu = useCallback<NonNullable<ExplorerTreeProps["onNodeContextMenu"]>>(
    (node, event) => callbackRef.current.onNodeContextMenu?.(node, event),
    [],
  );
  const renderNodeRowActions = useCallback((node: DataNode) => (
    callbackRef.current.renderNodeActions?.(node)
      ?? (node.type === "folder" ? callbackRef.current.renderFolderActions?.(node) : null)
  ), []);
  const selectedPathsRef = useRef(selectedPaths);
  const selectedDragNodesRef = useRef(selectedDragNodes);
  // This ref is the operational drag session. React state below is only its
  // visual projection and must never overwrite the session during render.
  const draggedNodesRef = useRef<DataNode[]>([]);
  selectedPathsRef.current = selectedPaths;
  selectedDragNodesRef.current = selectedDragNodes;
  const dragCallbacksRef = useRef({ onImportFiles, onMoveNode, onMoveNodes });
  dragCallbacksRef.current = { onImportFiles, onMoveNode, onMoveNodes };

  const clearDropTarget = useCallback(() => {
    dragEnterDepthRef.current = 0;
    setDropTarget((current) => (current === null ? current : null));
  }, []);

  const clearDragState = useCallback(() => {
    clearDropTarget();
    draggedNodesRef.current = [];
    setDraggedNodes((current) => (current.length === 0 ? current : []));
  }, [clearDropTarget]);

  useEffect(() => {
    // A cancelled native drag is not guaranteed to finish over this tree.
    // Treat document/window terminal signals as idempotent session cleanup.
    let disposed = false;
    const clearAfterDrop = () => {
      queueMicrotask(() => {
        if (!disposed) clearDragState();
      });
    };
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDragState();
    };
    const clearOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearDragState();
    };

    window.addEventListener("dragend", clearDragState, true);
    window.addEventListener("drop", clearAfterDrop, true);
    window.addEventListener("keydown", clearOnEscape, true);
    // Window focus is not a drag terminal signal. Chromium/Electron may move
    // focus while a native drag session is still active, so preserve the
    // synchronous source session and clear only stale hover feedback.
    window.addEventListener("blur", clearDropTarget, true);
    document.addEventListener("visibilitychange", clearOnVisibilityChange, true);
    return () => {
      disposed = true;
      window.removeEventListener("dragend", clearDragState, true);
      window.removeEventListener("drop", clearAfterDrop, true);
      window.removeEventListener("keydown", clearOnEscape, true);
      window.removeEventListener("blur", clearDropTarget, true);
      document.removeEventListener("visibilitychange", clearOnVisibilityChange, true);
    };
  }, [clearDragState, clearDropTarget]);

  const setNextDropTarget = useCallback((
    rowPath: string | null,
    targetFolderPath: string | null,
    mode: "folder" | "parent",
    valid: boolean,
  ) => {
    setDropTarget((current) => {
      if (
        current?.rowPath === rowPath
        && current.targetFolderPath === targetFolderPath
        && current.mode === mode
        && current.valid === valid
      ) {
        return current;
      }
      return { rowPath, targetFolderPath, mode, valid };
    });
  }, []);

  const recoverDraggedNodes = useCallback((dataTransfer: DataTransfer): DataNode[] => {
    const payload = parseExplorerReferenceDrag(dataTransfer.getData(EXPLORER_REFERENCE_DRAG_TYPE));
    if (!payload || !dragWorkspaceId || payload.workspaceId !== dragWorkspaceId) return [];

    const recoveredNodes = payload.entries
      .map((entry) => nodeIndex.get(entry.path) ?? null)
      .filter((node): node is DataNode => node !== null);
    if (recoveredNodes.length !== payload.entries.length) return [];

    return recoveredNodes.filter((node) => !recoveredNodes.some((candidate) => (
      !isSameDataResource(candidate.path, node.path)
        && isDataResourceDescendant(node.path, candidate.path)
    )));
  }, [dragWorkspaceId, nodeIndex]);

  const beginNodeDrag = useCallback((event: ReactDragEvent<HTMLDivElement>, node: DataNode) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = moveEnabled ? "copyMove" : "copy";
    const movingNodes = selectedPathsRef.current.has(node.path) && selectedDragNodesRef.current.length > 0
      ? selectedDragNodesRef.current
      : [node];
    event.dataTransfer.setData(EXPLORER_TREE_NODE_DRAG_TYPE, movingNodes.map((item) => item.path).join("\n"));
    if (dragWorkspaceId) {
      event.dataTransfer.setData(
        EXPLORER_REFERENCE_DRAG_TYPE,
        serializeExplorerReferenceDrag(dragWorkspaceId, movingNodes),
      );
    }
    event.dataTransfer.setData("text/plain", movingNodes.map((item) => item.path).join("\n"));
    // Native drag events are not coupled to React's commit timing. Seed the
    // operation ref synchronously so an immediate dragover/drop cannot observe
    // the previous render's empty state.
    draggedNodesRef.current = movingNodes;
    setDraggedNodes(movingNodes);
    setDropTarget(null);
  }, [dragWorkspaceId, moveEnabled]);

  const dragOverRow = useCallback((
    event: ReactDragEvent<HTMLElement>,
    rowPath: string | null,
    targetFolderPath: string | null,
    mode: "folder" | "parent",
  ) => {
    if (importEnabled && hasDataTransferFiles(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setNextDropTarget(rowPath, targetFolderPath, mode, true);
      return true;
    }

    const currentDraggedNodes = draggedNodesRef.current;
    const transferTypes = Array.from(event.dataTransfer.types);
    const hasInternalTransfer = transferTypes.includes(EXPLORER_REFERENCE_DRAG_TYPE)
      || transferTypes.includes(EXPLORER_TREE_NODE_DRAG_TYPE);
    if (!moveEnabled || (currentDraggedNodes.length === 0 && !hasInternalTransfer)) return false;

    // The HTML drag data store is in protected mode during dragover, so payload
    // data cannot be read here. A typed internal transfer is provisionally
    // accepted and is resolved and validated during drop.
    const valid = currentDraggedNodes.length === 0
      ? true
      : isValidMoveTargetForNodes(currentDraggedNodes, targetFolderPath);
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = valid ? "move" : "none";
    setNextDropTarget(rowPath, targetFolderPath, mode, valid);
    return valid;
  }, [importEnabled, moveEnabled, setNextDropTarget]);

  const enterTree = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const transferTypes = Array.from(event.dataTransfer.types);
    const accepted = (importEnabled && hasDataTransferFiles(event.dataTransfer))
      || (moveEnabled && (
        draggedNodesRef.current.length > 0
        || transferTypes.includes(EXPLORER_TREE_NODE_DRAG_TYPE)
      ));
    if (!accepted) return;
    dragEnterDepthRef.current += 1;
  }, [importEnabled, moveEnabled]);

  const leaveTree = useCallback(() => {
    dragEnterDepthRef.current = Math.max(0, dragEnterDepthRef.current - 1);
    if (dragEnterDepthRef.current === 0) clearDropTarget();
  }, [clearDropTarget]);

  const dropOnRow = useCallback((event: ReactDragEvent<HTMLElement>, targetFolderPath: string | null) => {
    const importedFiles = getDataTransferFiles(event.dataTransfer);
    if (importEnabled && importedFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      clearDragState();
      void Promise.resolve(dragCallbacksRef.current.onImportFiles?.(importedFiles, targetFolderPath)).catch((error) => {
        console.error("Unable to import dropped files:", error);
      });
      return;
    }

    const currentDraggedNodes = draggedNodesRef.current.length > 0
      ? draggedNodesRef.current
      : recoverDraggedNodes(event.dataTransfer);
    if (!moveEnabled || currentDraggedNodes.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const movingNodes = currentDraggedNodes;
    const valid = isValidMoveTargetForNodes(movingNodes, targetFolderPath);
    clearDragState();
    if (!valid) return;

    const moveResult = dragCallbacksRef.current.onMoveNodes
      ? dragCallbacksRef.current.onMoveNodes(movingNodes, targetFolderPath)
      : Promise.all(movingNodes.map((node) => dragCallbacksRef.current.onMoveNode?.(node, targetFolderPath)));
    void Promise.resolve(moveResult).catch((error) => {
      console.error("Unable to move explorer item:", error);
    });
  }, [clearDragState, importEnabled, moveEnabled, recoverDraggedNodes]);

  const dragController = useMemo<TreeDragController>(() => ({
    // Outbound copy/context drag is independent from in-tree move support.
    enabled: true,
    onNodeDragStart: beginNodeDrag,
    onNodeDragEnd: clearDragState,
    onRowDragOver: dragOverRow,
    onRowDrop: dropOnRow,
  }), [
    beginNodeDrag,
    clearDragState,
    dragOverRow,
    dropOnRow,
  ]);

  const handleClipboardShortcut = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isPrimaryModifierShortcut(event) || isEditableEventTarget(event.target)) return;

    const key = event.key.toLowerCase();
    const selectedNodes = selectedDragNodes;
    let command: (() => void | Promise<void>) | null = null;

    if (key === "c" && onCopyNodes && selectedNodes.length > 0) {
      command = () => onCopyNodes(selectedNodes);
    } else if (key === "x" && onCutNodes && selectedNodes.length > 0) {
      command = () => onCutNodes(selectedNodes);
    } else if (key === "v" && onPasteNodes) {
      command = () => onPasteNodes(currentFolderPath);
    } else if (key === "d" && onDuplicateNodes && selectedNodes.length > 0) {
      command = () => onDuplicateNodes(selectedNodes);
    }

    if (!command || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    void Promise.resolve(command()).catch((error) => {
      console.error("Unable to run explorer clipboard command:", error);
    });
  }, [currentFolderPath, onCopyNodes, onCutNodes, onDuplicateNodes, onPasteNodes, selectedDragNodes]);

  const focusRowAtIndex = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      document.getElementById(getExplorerRowDomId(index))?.focus();
    });
  }, []);

  const handleTreeNavigation = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isEditableEventTarget(event.target)) return;
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const targetPath = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-explorer-path]")?.dataset.explorerPath ?? null
      : null;
    const currentIndex = targetPath
      ? visibleModel.pathToIndex.get(targetPath) ?? activeIndex ?? -1
      : activeIndex ?? -1;
    const currentRow = currentIndex >= 0 ? visibleModel.rows[currentIndex] : null;
    let nextIndex: number | null = null;

    if (event.key === "Home") {
      nextIndex = findNavigableRowIndex(visibleModel.rows, 0, 1);
    } else if (event.key === "End") {
      nextIndex = findNavigableRowIndex(visibleModel.rows, visibleModel.rows.length - 1, -1);
    } else if (event.key === "ArrowDown") {
      nextIndex = findNavigableRowIndex(visibleModel.rows, Math.max(0, currentIndex + 1), 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = findNavigableRowIndex(visibleModel.rows, Math.max(0, currentIndex - 1), -1);
    } else if (currentRow?.kind === "node" && event.key === (direction === "rtl" ? "ArrowLeft" : "ArrowRight")) {
      if (currentRow.node.type === "folder" && !expandedPaths.has(currentRow.path)) {
        event.preventDefault();
        toggleFolder(currentRow.node, true);
        return;
      }
      nextIndex = findNavigableRowIndex(visibleModel.rows, currentIndex + 1, 1);
    } else if (currentRow?.kind === "node" && event.key === (direction === "rtl" ? "ArrowRight" : "ArrowLeft")) {
      if (currentRow.node.type === "folder" && expandedPaths.has(currentRow.path)) {
        event.preventDefault();
        toggleFolder(currentRow.node, false);
        return;
      }
      nextIndex = currentRow.parentPath
        ? visibleModel.pathToIndex.get(currentRow.parentPath) ?? null
        : null;
    }

    if (nextIndex === null || nextIndex < 0) return;
    const nextRow = visibleModel.rows[nextIndex];
    if (!nextRow || nextRow.kind !== "node") return;
    event.preventDefault();
    event.stopPropagation();
    selectNode(nextRow.node);
    focusRowAtIndex(nextIndex);
  }, [activeIndex, direction, expandedPaths, focusRowAtIndex, selectNode, toggleFolder, visibleModel]);

  const handleTreeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    handleClipboardShortcut(event);
    handleTreeNavigation(event);
  }, [handleClipboardShortcut, handleTreeNavigation]);

  return (
    <div
      className={`explorer-tree-shell ${showRoot ? "has-root" : "no-root"} ${scrollable ? "is-scrollable" : ""} ${draggedNodes.length > 0 ? "is-dragging-node" : ""} ${dropTarget && draggedNodes.length === 0 ? "is-importing-files" : ""}`}
      data-workspace-grouping={softWorkspaceGrouping ? "soft" : undefined}
      data-scroll-at-bottom={scrollEdgeState.atBottom ? "true" : "false"}
      data-scroll-at-top={scrollEdgeState.atTop ? "true" : "false"}
      style={{
        "--tree-motion-duration": `${EXPLORER_MOTION_DURATION_MS}ms`,
        "--tree-motion-easing": EXPLORER_MOTION_EASING,
        "--tree-edge-fade-bottom": scrollEdgeState.bottomFade.toFixed(3),
        "--tree-edge-fade-top": scrollEdgeState.topFade.toFixed(3),
      } as CSSProperties}
      onDragEnterCapture={dropEnabled ? enterTree : undefined}
      onDragLeaveCapture={dropEnabled ? leaveTree : undefined}
      onDragEnter={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
      onDragOver={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
      onDrop={dropEnabled ? (event) => dragController.onRowDrop(event, null) : undefined}
      onContextMenu={onRootContextMenu}
      onKeyDown={handleTreeKeyDown}
    >
      {showRoot && (
        <div className="explorer-tree-root-scope">
          {onRootClick ? (
            <button
              className={`tree-row root root-command ${dropTarget?.rowPath === null && dropTarget.valid ? "drop-target" : ""} ${dropTarget?.rowPath === null && !dropTarget.valid ? "drop-invalid" : ""}`}
              type="button"
              style={{ "--depth": 0 } as CSSProperties}
              onDragEnter={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
              onDragOver={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
              onDrop={dropEnabled ? (event) => dragController.onRowDrop(event, null) : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onRootClick(event);
              }}
            >
              {renderRootContent ? renderRootContent() : (
                <span className="tree-row-content">
                  <span className="tree-label">{resolvedRootLabel}</span>
                </span>
              )}
            </button>
          ) : (
            <div
              className={`tree-row root ${dropTarget?.rowPath === null && dropTarget.valid ? "drop-target" : ""} ${dropTarget?.rowPath === null && !dropTarget.valid ? "drop-invalid" : ""}`}
              style={{ "--depth": 0 } as CSSProperties}
              onDragEnter={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
              onDragOver={dropEnabled ? (event) => dragController.onRowDragOver(event, null, null, "folder") : undefined}
              onDrop={dropEnabled ? (event) => dragController.onRowDrop(event, null) : undefined}
            >
              <span className="tree-row-content">
                <span className="tree-label">{resolvedRootLabel}</span>
                {renderRootActions && (
                  <span className="tree-row-actions root-actions" onClick={(event) => event.stopPropagation()}>
                    {renderRootActions()}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {rootError && nodes.length > 0 && (
        <div className="explorer-tree-error-banner" role="alert" dir="auto">
          {rootError}
        </div>
      )}

      <div
        ref={scrollRef}
        className={`explorer-tree-scroll ${scrollable ? "is-scrollable" : ""}`}
        data-po-scrollbar="sidebar"
        role="tree"
        aria-multiselectable="true"
        aria-activedescendant={activeIndex !== null ? getExplorerRowDomId(activeIndex) : undefined}
        onScroll={virtualWindow.onScroll}
      >
        <div className="explorer-tree-list">
          {!initialLoading && renderListStart && (
            <div className="explorer-tree-list-start">
              {renderListStart()}
            </div>
          )}
          {initialLoading ? (
            loadingPresentation === "skeleton"
              ? <ExplorerTreeSkeleton loadingLabel={resolvedLoadingLabel} />
              : loadingPresentation === "dots"
                ? <ExplorerTreeMetaRow depth={0} loading>{resolvedLoadingLabel}</ExplorerTreeMetaRow>
                : null
          ) : rootError && nodes.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>{rootError}</ExplorerTreeMetaRow>
          ) : nodes.length > 0 ? (
            <div
              className="explorer-tree-virtual-canvas"
              style={{ height: `${virtualWindow.totalHeight}px` }}
              data-visible-row-count={visibleModel.rows.length}
              data-mounted-row-count={visibleRows.length + (motionPlan?.ghosts.length ?? 0)}
              data-motion-generation={motionPlan?.generation}
            >
              {visibleRows.map((row) => (
                <div
                  key={row.key}
                  className="explorer-tree-virtual-row"
                  data-depth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                  style={{
                    "--depth": getExplorerPresentationDepth(row.depth, softWorkspaceGrouping),
                    transform: `translateY(${row.index * virtualWindow.rowSize}px)`,
                  } as CSSProperties}
                >
                  <ExplorerVirtualMotionShell
                    depth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                    generation={motionPlan?.generation ?? 0}
                    instruction={motionPlan?.instructions.get(row.key)}
                  >
                    {row.kind === "meta" ? (
                      <ExplorerTreeLoadingRow
                        depth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                        label={row.label}
                        loading={row.loading}
                        presentation={loadingPresentation}
                      />
                    ) : (
                      <TreeNodeRow
                        row={row}
                        presentationDepth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                        softWorkspaceGrouping={softWorkspaceGrouping}
                        isExpanded={row.node.type === "folder" && expandedPaths.has(row.path)}
                        focusable={activePath ? activePath === row.path : row.index === firstNavigableIndex}
                        interaction={selectExplorerRowInteraction(row.path, rowStateSources)}
                        loadingPresentation={loadingPresentation}
                        fileIconTheme={fileIconTheme}
                        onToggleFolder={toggleFolder}
                        onSelectNode={selectNode}
                        dragController={dragController}
                        hasNodeContextMenu={Boolean(onNodeContextMenu)}
                        onNodeContextMenu={openNodeContextMenu}
                        renderRowActions={renderNodeRowActions}
                      />
                    )}
                  </ExplorerVirtualMotionShell>
                </div>
              ))}
              {motionPlan?.ghosts.map(({ row, top, reveal }) => (
                <div
                  key={`exit:${motionPlan.generation}:${row.key}`}
                  className="explorer-tree-virtual-row explorer-tree-exit-ghost"
                  data-depth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                  style={{
                    "--depth": getExplorerPresentationDepth(row.depth, softWorkspaceGrouping),
                    transform: `translateY(${top}px)`,
                  } as CSSProperties}
                  aria-hidden="true"
                >
                  <ExplorerVirtualMotionShell
                    depth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                    generation={motionPlan.generation}
                    exitPhase={reveal}
                  >
                    <ExplorerExitGhostRow
                      row={row}
                      presentationDepth={getExplorerPresentationDepth(row.depth, softWorkspaceGrouping)}
                      softWorkspaceGrouping={softWorkspaceGrouping}
                      expandedPaths={expandedPaths}
                      fileIconTheme={fileIconTheme}
                      loadingPresentation={loadingPresentation}
                    />
                  </ExplorerVirtualMotionShell>
                </div>
              ))}
            </div>
          ) : null}
          {!initialLoading && renderListEnd && (
            <ExplorerListEndMotionShell
              generation={motionPlan?.generation ?? 0}
              offsetY={motionPlan?.listEndOffsetY ?? 0}
            >
              {renderListEnd()}
            </ExplorerListEndMotionShell>
          )}
        </div>
      </div>
    </div>
  );
}

type TreeNodeRowProps = {
  row: ExplorerVisibleNodeRow;
  presentationDepth: number;
  softWorkspaceGrouping: boolean;
  isExpanded: boolean;
  focusable: boolean;
  interaction: ExplorerRowInteractionState;
  loadingPresentation: ExplorerLoadingPresentation;
  fileIconTheme: FileIconThemeId;
  onToggleFolder: (node: DataNode, expanded: boolean) => void;
  onSelectNode: ExplorerTreeProps["onSelectNode"];
  dragController: TreeDragController;
  hasNodeContextMenu: boolean;
  onNodeContextMenu: NonNullable<ExplorerTreeProps["onNodeContextMenu"]>;
  renderRowActions: (node: DataNode) => ReactNode;
};

const TreeNodeRow = memo(function TreeNodeRow({
  row,
  presentationDepth,
  softWorkspaceGrouping,
  isExpanded,
  focusable,
  interaction,
  loadingPresentation,
  fileIconTheme,
  onToggleFolder,
  onSelectNode,
  dragController,
  hasNodeContextMenu,
  onNodeContextMenu,
  renderRowActions,
}: TreeNodeRowProps) {
  const { t } = useLocalization();
  const { node, siblingDisplayNameCounts } = row;
  const isFolder = node.type === "folder";
  const workspaceGroupHeader = softWorkspaceGrouping && Boolean(node.workspaceFolderRoot);
  const hoverExpandTimer = useRef<number | null>(null);
  const rowActions = renderRowActions(node);
  const displayName = useMemo(() => getExplorerDisplayName(node), [node]);
  const showExtensionDisambiguator = Boolean(
    displayName.extension
      && (siblingDisplayNameCounts.get(getDisplayNameKey(displayName.primary)) ?? 0) > 1,
  );

  const toggleCurrentFolder = useCallback(() => {
    if (!isFolder) return;
    onToggleFolder?.(node, !isExpanded);
  }, [isExpanded, isFolder, node, onToggleFolder]);

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimer.current === null) return;
    window.clearTimeout(hoverExpandTimer.current);
    hoverExpandTimer.current = null;
  }, []);

  useLayoutEffect(() => clearHoverExpandTimer, [clearHoverExpandTimer]);

  useLayoutEffect(() => {
    if (!interaction.dropOver) clearHoverExpandTimer();
  }, [clearHoverExpandTimer, interaction.dropOver]);

  const scheduleHoverExpand = useCallback(() => {
    if (!isFolder || isExpanded || hoverExpandTimer.current !== null) return;
    hoverExpandTimer.current = window.setTimeout(() => {
      hoverExpandTimer.current = null;
      onToggleFolder?.(node, true);
    }, FOLDER_HOVER_EXPAND_MS);
  }, [isExpanded, isFolder, node, onToggleFolder]);

  const getDropIntent = useCallback((event: ReactDragEvent<HTMLElement>): {
    targetFolderPath: string | null;
    mode: "folder" | "parent";
  } => {
    if (!isFolder) {
      return { targetFolderPath: getParentPath(node.path), mode: "parent" };
    }

    if (isPointerInFolderPeerDropZone(event)) {
      return { targetFolderPath: getParentPath(node.path), mode: "parent" };
    }

    return { targetFolderPath: node.path, mode: "folder" };
  }, [isFolder, node.path]);

  return (
    <div
      id={getExplorerRowDomId(row.index)}
      className={`tree-row ${isFolder ? "folder" : "file"} ${node.workspaceFolderRoot ? "workspace-folder-root" : ""} ${workspaceGroupHeader ? "workspace-group-header" : ""} ${interaction.selected ? "selected" : ""} ${interaction.active ? "active" : ""} ${interaction.cut ? "clipboard-cut" : ""} ${interaction.loading ? "loading" : ""} ${interaction.dragging ? "dragging" : ""} ${interaction.dropOver ? "drop-target" : ""} ${interaction.dropParentOver ? "drop-parent-target" : ""} ${interaction.dropInvalid ? "drop-invalid" : ""} ${node.status ? `status-${node.status}` : ""}`}
      role="treeitem"
      data-explorer-path={node.path}
      draggable={!node.workspaceFolderRoot && dragController.enabled}
      tabIndex={focusable ? 0 : -1}
      aria-level={row.depth + 1}
      aria-posinset={row.positionInSet}
      aria-setsize={row.setSize}
      aria-current={interaction.active ? "true" : undefined}
      aria-selected={interaction.selected || undefined}
      aria-expanded={isFolder ? isExpanded : undefined}
      aria-busy={interaction.loading || undefined}
      aria-grabbed={interaction.dragging ? "true" : undefined}
      aria-label={interaction.cut
        ? t("shared-ui.explorer.cutLabel", { name: bidiIsolate(node.name) })
        : node.name}
      title={displayName.hidden || showExtensionDisambiguator ? node.name : undefined}
      onDragStart={(event) => dragController.onNodeDragStart(event, node)}
      onDragEnd={dragController.onNodeDragEnd}
      onDragEnter={(event) => {
        const dropIntent = getDropIntent(event);
        const validTarget = dragController.onRowDragOver(event, node.path, dropIntent.targetFolderPath, dropIntent.mode);
        if (isFolder && dropIntent.mode === "folder" && validTarget) scheduleHoverExpand();
      }}
      onDragOver={(event) => {
        const dropIntent = getDropIntent(event);
        const validTarget = dragController.onRowDragOver(event, node.path, dropIntent.targetFolderPath, dropIntent.mode);
        if (isFolder && dropIntent.mode === "folder" && validTarget) scheduleHoverExpand();
      }}
      onDragLeave={clearHoverExpandTimer}
      onDrop={(event) => {
        clearHoverExpandTimer();
        const dropIntent = getDropIntent(event);
        dragController.onRowDrop(event, dropIntent.targetFolderPath);
      }}
      onClick={(event) => {
        event.stopPropagation();
        const intent = getSelectionIntent(event);
        onSelectNode(node, intent);
        if (isFolder && !intent.additive && !intent.range) toggleCurrentFolder();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectNode(node);
        if (isFolder) toggleCurrentFolder();
      }}
      onContextMenu={hasNodeContextMenu && !node.workspaceFolderRoot ? (event) => {
        event.stopPropagation();
        if (!interaction.selected) onSelectNode(node);
        onNodeContextMenu(node, event);
      } : undefined}
      style={{ "--depth": presentationDepth } as CSSProperties}
    >
      <span className="tree-row-content">
        <span
          className="tree-icon-slot"
          data-file-kind={isFolder ? undefined : getFileVisualKind(node.name, node.type)}
          onClick={(event) => {
            if (!isFolder) return;
            event.stopPropagation();
            toggleCurrentFolder();
          }}
        >
          {isFolder ? (
            <TreeDisclosureMarker expanded={isExpanded} size={workspaceGroupHeader ? 10 : 12} />
          ) : (
            <FileGlyphIcon name={node.name} type={node.type} size={18} theme={fileIconTheme} />
          )}
        </span>
        <span className="tree-label">
          <span className="tree-label-primary">{displayName.primary}</span>
          {showExtensionDisambiguator && (
            <span className="tree-label-extension" aria-hidden="true">
              {displayName.extension}
            </span>
          )}
        </span>
        {workspaceGroupHeader && (
          <span className="tree-workspace-group-divider" aria-hidden="true" />
        )}
        {node.status && node.status !== "clean" && (
          <span className={`tree-status ${node.status}`}>{shortStatus(node.status)}</span>
        )}
        {interaction.loading && loadingPresentation === "dots" && (
          <DotsLoader
            size="sm"
            className="tree-loading-indicator"
            ariaHidden
          />
        )}
        {rowActions && (
          <span className="tree-row-actions" onClick={(event) => event.stopPropagation()}>
            {rowActions}
          </span>
        )}
      </span>
    </div>
  );
}, areTreeNodeRowPropsEqual);

function areTreeNodeRowPropsEqual(left: TreeNodeRowProps, right: TreeNodeRowProps): boolean {
  return left.row === right.row
    && left.presentationDepth === right.presentationDepth
    && left.softWorkspaceGrouping === right.softWorkspaceGrouping
    && left.isExpanded === right.isExpanded
    && left.focusable === right.focusable
    && equalExplorerRowInteraction(left.interaction, right.interaction)
    && left.loadingPresentation === right.loadingPresentation
    && left.fileIconTheme === right.fileIconTheme
    && left.onToggleFolder === right.onToggleFolder
    && left.onSelectNode === right.onSelectNode
    && left.dragController === right.dragController
    && left.hasNodeContextMenu === right.hasNodeContextMenu
    && left.onNodeContextMenu === right.onNodeContextMenu
    && left.renderRowActions === right.renderRowActions;
}

function ExplorerVirtualMotionShell({
  depth,
  generation,
  instruction,
  exitPhase,
  children,
}: {
  depth: number;
  generation: number;
  instruction?: ExplorerRowMotionInstruction;
  exitPhase?: ExplorerRevealPhase;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  useExplorerElementMotion({ elementRef, exitPhase, generation, instruction });

  return (
    <div
      ref={elementRef}
      className="explorer-tree-motion-shell"
      data-depth={depth}
      data-explorer-motion={exitPhase ? "exit" : instruction?.kind}
      style={{ "--depth": depth } as CSSProperties}
    >
      {children}
    </div>
  );
}

function ExplorerListEndMotionShell({
  generation,
  offsetY,
  children,
}: {
  generation: number;
  offsetY: number;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const instruction = useMemo<ExplorerRowMotionInstruction | undefined>(
    () => offsetY === 0 ? undefined : { kind: "move", offsetY },
    [offsetY],
  );
  useExplorerElementMotion({ elementRef, generation, instruction });

  return (
    <div
      ref={elementRef}
      className="explorer-tree-list-end-motion"
      data-explorer-motion={instruction?.kind}
    >
      {children}
    </div>
  );
}

function useExplorerElementMotion({
  elementRef,
  generation,
  instruction,
  exitPhase,
}: {
  elementRef: RefObject<HTMLDivElement>;
  generation: number;
  instruction?: ExplorerRowMotionInstruction;
  exitPhase?: ExplorerRevealPhase;
}) {
  useLayoutEffect(() => {
    const element = elementRef.current;
    const definition = createExplorerMotionAnimation({ instruction, exitPhase });
    if (!element || !definition) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      if (!exitPhase) return undefined;
      element.style.visibility = "hidden";
      return () => {
        element.style.visibility = "";
      };
    }
    if (typeof element.animate !== "function") return undefined;

    const animation = element.animate(definition.keyframes, definition.options);
    return () => animation.cancel();
  }, [elementRef, exitPhase, generation, instruction]);
}

function ExplorerExitGhostRow({
  row,
  presentationDepth,
  softWorkspaceGrouping,
  expandedPaths,
  fileIconTheme,
  loadingPresentation,
}: {
  row: ExplorerVisibleRow;
  presentationDepth: number;
  softWorkspaceGrouping: boolean;
  expandedPaths: ReadonlySet<string>;
  fileIconTheme: FileIconThemeId;
  loadingPresentation: ExplorerLoadingPresentation;
}) {
  if (row.kind === "meta") {
    return (
      <ExplorerTreeLoadingRow
        depth={presentationDepth}
        label={row.label}
        loading={row.loading}
        presentation={loadingPresentation}
      />
    );
  }

  const displayName = getExplorerDisplayName(row.node);
  const showExtensionDisambiguator = Boolean(
    displayName.extension
      && (row.siblingDisplayNameCounts.get(getDisplayNameKey(displayName.primary)) ?? 0) > 1,
  );
  const isFolder = row.node.type === "folder";
  const workspaceGroupHeader = softWorkspaceGrouping && Boolean(row.node.workspaceFolderRoot);
  return (
    <div
      className={`tree-row explorer-tree-exit-ghost-row ${isFolder ? "folder" : "file"} ${row.node.workspaceFolderRoot ? "workspace-folder-root" : ""} ${workspaceGroupHeader ? "workspace-group-header" : ""}`}
      style={{ "--depth": presentationDepth } as CSSProperties}
    >
      <span className="tree-row-content">
        <span
          className="tree-icon-slot"
          data-file-kind={isFolder ? undefined : getFileVisualKind(row.node.name, row.node.type)}
        >
          {isFolder ? (
            <TreeDisclosureMarker expanded={expandedPaths.has(row.path)} size={workspaceGroupHeader ? 10 : 12} />
          ) : (
            <FileGlyphIcon name={row.node.name} type={row.node.type} size={18} theme={fileIconTheme} />
          )}
        </span>
        <span className="tree-label">
          <span className="tree-label-primary">{displayName.primary}</span>
          {showExtensionDisambiguator && (
            <span className="tree-label-extension" aria-hidden="true">{displayName.extension}</span>
          )}
        </span>
        {workspaceGroupHeader && (
          <span className="tree-workspace-group-divider" aria-hidden="true" />
        )}
        {row.node.status && row.node.status !== "clean" && (
          <span className={`tree-status ${row.node.status}`}>{shortStatus(row.node.status)}</span>
        )}
      </span>
    </div>
  );
}

function TreeDisclosureMarker({
  expanded = false,
  size = 12,
}: {
  expanded?: boolean;
  size?: number;
}) {
  const { direction } = useLocalization();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="tree-disclosure-marker"
      data-expanded={expanded ? "true" : "false"}
      style={{
        transform: expanded
          ? direction === "rtl" ? "rotate(-90deg)" : "rotate(90deg)"
          : direction === "rtl" ? "scaleX(-1)" : "rotate(0deg)",
      }}
    >
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

function ExplorerTreeMetaRow({
  depth,
  loading = false,
  children,
}: {
  depth: number;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`tree-meta-row ${loading ? "loading" : ""}`} style={{ "--depth": depth } as CSSProperties}>
      {loading ? (
        <InlineLoading
          label={null}
          ariaLabel={typeof children === "string" ? children : undefined}
          size="sm"
          indicator="dots"
          className="tree-meta-loading"
        />
      ) : (
        <span>{children}</span>
      )}
    </div>
  );
}

function ExplorerTreeLoadingRow({
  depth,
  label,
  loading,
  presentation,
}: {
  depth: number;
  label: string;
  loading: boolean;
  presentation: ExplorerLoadingPresentation;
}) {
  if (!loading) return <ExplorerTreeMetaRow depth={depth}>{label}</ExplorerTreeMetaRow>;
  if (presentation === "none") return null;
  if (presentation === "dots") {
    return <ExplorerTreeMetaRow depth={depth} loading>{label}</ExplorerTreeMetaRow>;
  }
  return (
    <div
      className="explorer-tree-skeleton explorer-tree-branch-skeleton"
      role="status"
      aria-label={label}
    >
      <ExplorerTreeSkeletonRow />
    </div>
  );
}

function ExplorerTreeSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div
      className="explorer-tree-skeleton"
      role="status"
      aria-label={loadingLabel}
      data-testid="explorer-tree-skeleton"
    >
      {[0, 1, 1, 0, 1, 1].map((depth, index) => (
        <ExplorerTreeSkeletonRow depth={depth} key={`${depth}-${index}`} />
      ))}
    </div>
  );
}

function ExplorerTreeSkeletonRow({ depth }: { depth?: number }) {
  return (
    <div
      className="explorer-tree-skeleton-row"
      data-depth={depth}
      aria-hidden="true"
    >
      <span className="explorer-tree-skeleton-icon" />
      <span className="explorer-tree-skeleton-label" />
    </div>
  );
}

function shortStatus(status: NonNullable<DataNode["status"]>) {
  if (status === "modified") return "M";
  if (status === "created") return "A";
  if (status === "deleted") return "D";
  if (status === "moved") return "R";
  return "";
}

function isValidMoveTarget(node: DataNode, targetFolderPath: string | null): boolean {
  if (isSameDataResource(getParentPath(node.path), targetFolderPath)) return false;
  if (isSameDataResource(targetFolderPath, node.path)) return false;
  if (isDataResourceDescendant(targetFolderPath, node.path)) return false;
  return true;
}

function isValidMoveTargetForNodes(nodes: DataNode[], targetFolderPath: string | null): boolean {
  if (nodes.length === 0) return false;
  return nodes.every((node) => isValidMoveTarget(node, targetFolderPath));
}

function collectTopLevelSelectedNodes(
  nodeIndex: ReadonlyMap<string, DataNode>,
  selectedPaths: ReadonlySet<string>,
): DataNode[] {
  if (selectedPaths.size === 0) return [];
  const selectedNodes = [...selectedPaths]
    .map((path) => nodeIndex.get(path) ?? null)
    .filter((node): node is DataNode => node !== null);
  return selectedNodes.filter((node) => !selectedNodes.some((candidate) => (
    !isSameDataResource(candidate.path, node.path)
      && isDataResourceDescendant(node.path, candidate.path)
  )));
}

function findNavigableRowIndex(
  rows: readonly ExplorerVisibleRow[],
  startIndex: number,
  direction: 1 | -1,
): number | null {
  for (
    let index = Math.min(Math.max(0, startIndex), Math.max(0, rows.length - 1));
    index >= 0 && index < rows.length;
    index += direction
  ) {
    if (rows[index]?.kind === "node") return index;
  }
  return null;
}

function getExplorerRowDomId(index: number): string {
  return `${EXPLORER_ROW_DOM_ID_PREFIX}-${index}`;
}

function getExplorerPresentationDepth(depth: number, softWorkspaceGrouping: boolean): number {
  return softWorkspaceGrouping ? Math.max(0, depth - 1) : depth;
}

function getSelectionIntent(event: ReactMouseEvent<HTMLElement>): ExplorerSelectionIntent {
  return {
    additive: event.metaKey || event.ctrlKey,
    range: event.shiftKey,
  };
}

function isPrimaryModifierShortcut(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

function getParentPath(path: string): string | null {
  return getDataResourceParent(path);
}

function hasDataTransferFiles(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) return true;
  if (Array.from(dataTransfer.types).includes("Files")) return true;
  return Array.from(dataTransfer.items).some((item) => item.kind === "file");
}

function getDataTransferFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files).filter((file) => file.name.length > 0);
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items)
    .map((item) => (item.kind === "file" ? item.getAsFile() : null))
    .filter((file): file is File => Boolean(file && file.name.length > 0));
}

function isPointerInFolderPeerDropZone(event: ReactDragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  const peerZoneTop = rect.bottom - rect.height * FOLDER_PEER_DROP_ZONE_RATIO;
  return event.clientY >= peerZoneTop;
}

const EMPTY_PATH_SET: ReadonlySet<string> = new Set();
