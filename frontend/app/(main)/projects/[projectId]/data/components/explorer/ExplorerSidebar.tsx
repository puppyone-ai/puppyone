'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useExplorerRootNodes } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import type { ContentType } from '../views/GridView';
import type { FileImportTarget } from '../../hooks/useFileImport';
import { ensureExpandedBatch, usePendingActiveId } from './explorerState';
import {
  EXPLORER_TREE_CONTENT_INSET,
  EXPLORER_TREE_ROW_HEIGHT,
  EXPLORER_TREE_ROW_MARGIN_X,
  EXPLORER_TREE_ROW_MARGIN_Y,
  ExplorerTreeMetaRow,
  ExplorerTreeRow,
} from './ExplorerTreeRow';
import {
  ExplorerRowActions,
  getExplorerRowActionLayerWidth,
} from './ExplorerRowActions';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';
import { Dots } from '@/components/loading';
import { SIDEBAR_META_TYPOGRAPHY, SIDEBAR_ROW_TYPOGRAPHY } from '@/lib/uiTypography';

const FILE_DROP_TARGET_BG = 'var(--po-active)';
const FILE_DROP_ROOT_SCOPE_BG = 'var(--po-hover)';
const FILE_DROP_TARGET_BORDER = 'var(--po-border-strong)';
const FILE_DROP_SCOPE_BORDER = 'var(--po-border)';
const ROOT_DROP_TARGET: FileImportTarget = { path: null, name: 'Root' };
const ROOT_HEADER_TOP_PADDING = 5;

function hasExternalFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export const ExplorerSidebar = memo(function ExplorerSidebar({
  projectId,
  currentPath,
  activeNodeId,
  onNavigate,
  onCreate,
  onCreateSync,
  onOpenAccess,
  endpointByNodeId,
  onRename,
  onDelete,
  onDownload,
  onFilesDrop,
  onMoveNode,
  activeSyncNodeId,
  highlightNodeId,
  highlightVariant = 'default',
  createMenuOpenForId,
  createMenuOpenAction,
  className,
  style,
}: ExplorerSidebarProps) {
  const {
    rootNodes,
    isLoading: loading,
    error: rootLoadError,
  } = useExplorerRootNodes(projectId);
  const sidebarFileDragCounterRef = useRef(0);
  const [isExternalFileDraggingInSidebar, setIsExternalFileDraggingInSidebar] = useState(false);
  const [activeFileDropTarget, setActiveFileDropTarget] = useState<FileImportTarget | null>(null);
  const { isDropTarget: isRootDropTarget, dropHandlers: rootDropHandlers } = useNodeDrop({
    targetFolderId: null,
    onMoveNode,
  });

  const currentPathIds = currentPath.map((p) => p.id);
  const currentPathKey = currentPathIds.join('\0');

  useEffect(() => {
    if (currentPathIds.length > 0) {
      ensureExpandedBatch(currentPathIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPathKey]);

  const rootItems: MillerColumnItem[] = rootNodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type as ContentType,
    is_synced: node.is_synced,
    sync_source: node.sync_source,
    last_synced_at: node.last_synced_at,
    integrity_status: node.integrity_status,
  }));

  const pendingId = usePendingActiveId();
  const activeId = pendingId || activeNodeId || null;
  const isRootHighlighted = highlightNodeId === '';
  const isRootAccessPointHighlight = isRootHighlighted && highlightVariant === 'access-point';
  const rootOpenMenuAction = createMenuOpenForId === '__root__' ? createMenuOpenAction ?? null : null;
  const rootEndpoints = endpointByNodeId?.get('') ?? [];
  const rootHasConfiguredAccess = rootEndpoints.length > 0 && !!onOpenAccess;
  const isRootFileDropTarget = isExternalFileDraggingInSidebar && activeFileDropTarget?.path === null;
  const showRootLoadError = !!rootLoadError && rootItems.length === 0 && !loading;

  const handleSidebarDragEnterCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return;
    sidebarFileDragCounterRef.current += 1;
    setIsExternalFileDraggingInSidebar(true);
    setActiveFileDropTarget((current) => current ?? ROOT_DROP_TARGET);
  }, []);

  const handleSidebarDragLeaveCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return;
    sidebarFileDragCounterRef.current -= 1;
    if (sidebarFileDragCounterRef.current <= 0) {
      sidebarFileDragCounterRef.current = 0;
      setIsExternalFileDraggingInSidebar(false);
      setActiveFileDropTarget(null);
    }
  }, []);

  const handleSidebarDropCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return;
    sidebarFileDragCounterRef.current = 0;
    setIsExternalFileDraggingInSidebar(false);
    setActiveFileDropTarget(null);
  }, []);

  const activateRootDropTarget = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasExternalFiles(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsExternalFileDraggingInSidebar(true);
    setActiveFileDropTarget(ROOT_DROP_TARGET);
    return true;
  }, []);

  const handleRootFileDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasExternalFiles(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    sidebarFileDragCounterRef.current = 0;
    setIsExternalFileDraggingInSidebar(false);
    setActiveFileDropTarget(null);

    // Snapshot the DataTransfer SYNCHRONOUSLY — see lib/dropFiles.ts.
    // Reading items after this handler returns yields null entries
    // in Safari/Firefox, which would silently drop folder contents.
    const snapshot = snapshotDataTransfer(event.nativeEvent);
    void resolveDataTransferSnapshot(snapshot).then((files) => {
      if (files.length > 0) onFilesDrop?.(files, ROOT_DROP_TARGET);
    });
    return true;
  }, [onFilesDrop]);

  return (
    <div
      data-explorer-sidebar-root="true"
      className={className}
      onDragEnterCapture={handleSidebarDragEnterCapture}
      onDragLeaveCapture={handleSidebarDragLeaveCapture}
      onDropCapture={handleSidebarDropCapture}
      style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      {/* Header used to live here as its own "Workspace" label bar.
          That created two stacked headers on the data page (this one
          + the page-level ProjectsHeader to the right). The unified
          design now hoists ProjectsHeader to span the full column row,
          so this sidebar starts directly with the file tree — no
          duplicate label, no broken hairline at the boundary. */}
      <div
        onDragOver={activateRootDropTarget}
        onDrop={handleRootFileDrop}
        style={{
          flexShrink: 0,
          boxSizing: 'border-box',
          paddingTop: ROOT_HEADER_TOP_PADDING,
          background: isRootFileDropTarget ? FILE_DROP_ROOT_SCOPE_BG : 'var(--po-canvas)',
          boxShadow: isRootFileDropTarget
            ? `inset 0 0 0 1px ${FILE_DROP_SCOPE_BORDER}`
            : 'none',
          transition: 'background 0.12s ease, box-shadow 0.12s ease',
        }}
      >
        <div
          className="group/row"
          style={{
            display: 'flex',
            alignItems: 'center',
            margin: `${EXPLORER_TREE_ROW_MARGIN_Y}px ${EXPLORER_TREE_ROW_MARGIN_X}px`,
            height: EXPLORER_TREE_ROW_HEIGHT,
            boxSizing: 'border-box',
            borderRadius: 6,
            background: isRootDropTarget || isRootFileDropTarget
              ? FILE_DROP_TARGET_BG
              : isRootAccessPointHighlight
                ? 'color-mix(in srgb, var(--po-success) 14%, transparent)'
              : rootOpenMenuAction
                // Translucent — see ExplorerTreeRow for the full
                // rationale. tldr: opaque var(--po-border) was visually
                // indistinguishable from the tree-line colour
                // var(--po-tree-guide), so selecting a row "ate" the elbow.
                ? 'var(--po-selected)'
                : 'transparent',
            color: isRootDropTarget || isRootFileDropTarget
              ? 'var(--po-text)'
              : isRootAccessPointHighlight ? 'var(--po-success)' : rootOpenMenuAction ? 'var(--po-text)' : 'var(--po-text-muted)',
            transition: 'background 0.1s, color 0.1s',
            boxShadow: isRootDropTarget || isRootFileDropTarget
              ? `inset 0 0 0 1px ${FILE_DROP_TARGET_BORDER}`
              : isRootAccessPointHighlight
              ? 'inset 2px 0 0 0 color-mix(in srgb, var(--po-success) 90%, transparent)'
              : 'none',
            position: 'relative',
            cursor: 'default',
          }}
          onDragEnter={(e) => {
            if (!activateRootDropTarget(e)) rootDropHandlers.onDragEnter(e);
          }}
          onDragOver={(e) => {
            if (!activateRootDropTarget(e)) rootDropHandlers.onDragOver(e);
          }}
          onDragLeave={(e) => {
            rootDropHandlers.onDragLeave(e);
          }}
          onDrop={(e) => {
            if (!handleRootFileDrop(e)) rootDropHandlers.onDrop(e);
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: '100%',
              boxSizing: 'border-box',
              paddingLeft: EXPLORER_TREE_CONTENT_INSET,
              paddingRight: (onCreate || onCreateSync || rootHasConfiguredAccess)
                ? getExplorerRowActionLayerWidth(rootHasConfiguredAccess) + 6
                : 6,
            }}
          >
            <span
              style={{
                ...SIDEBAR_ROW_TYPOGRAPHY,
                flex: 1,
                minWidth: 0,
                color: 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Root
            </span>

            {(onCreate || onCreateSync || rootHasConfiguredAccess) && (
              <ExplorerRowActions
                nodeId=""
                createParentId={null}
                accessPath=""
                isFolder
                endpoints={rootEndpoints}
                openMenuAction={rootOpenMenuAction}
                alwaysVisible
                itemName="Root"
                onCreate={onCreate}
                onCreateSync={onCreateSync}
                onOpenAccess={onOpenAccess}
              />
            )}
          </div>
        </div>
      </div>

      <div
        data-explorer-scroll="true"
        onDragOver={activateRootDropTarget}
        onDrop={handleRootFileDrop}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          overflowX: 'hidden',
          scrollbarGutter: 'auto',
          position: 'relative',
          background: isRootFileDropTarget ? FILE_DROP_ROOT_SCOPE_BG : 'transparent',
          transition: 'background 0.12s ease',
        }}
      >
        <div
          style={{
            width: '100%',
            padding: '0 0 6px 0',
            position: 'relative',
            boxSizing: 'border-box',
          }}
        >
          {showRootLoadError ? (
            <ExplorerTreeMetaRow depth={0}>
              <span title={rootLoadError instanceof Error ? rootLoadError.message : undefined}>
                Unable to load folders. Retrying...
              </span>
            </ExplorerTreeMetaRow>
          ) : loading && rootItems.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>
              <Dots size="xs" />
            </ExplorerTreeMetaRow>
          ) : rootItems.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>
              <span
                style={{
                  ...SIDEBAR_META_TYPOGRAPHY,
                  color: 'var(--po-text-disabled)',
                }}
              >
                Empty folder
              </span>
            </ExplorerTreeMetaRow>
          ) : (
            rootItems.map((item) => (
              <ExplorerTreeRow
                key={item.id}
                item={item}
                depth={0}
                projectId={projectId}
                activeId={activeId}
                onNavigate={onNavigate}
                onCreate={onCreate}
                onCreateSync={onCreateSync}
                onOpenAccess={onOpenAccess}
                endpointByNodeId={endpointByNodeId}
                onRename={onRename}
                onDelete={onDelete}
                onDownload={onDownload}
                onFilesDrop={onFilesDrop}
                activeFileDropTargetPath={activeFileDropTarget?.path}
                onFileDragTarget={setActiveFileDropTarget}
                onMoveNode={onMoveNode}
                activeSyncNodeId={activeSyncNodeId}
                highlightNodeId={highlightNodeId}
                highlightVariant={highlightVariant}
                createMenuOpenForId={createMenuOpenForId}
                createMenuOpenAction={createMenuOpenAction}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
});
