'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useShallowTree } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import type { ContentType } from '../views/GridView';
import type { FileImportTarget } from '../../hooks/useFileImport';
import { ensureExpandedBatch, usePendingActiveId } from './explorerState';
import { ExplorerTreeMetaRow, ExplorerTreeRow, FolderIcon } from './ExplorerTreeRow';
import { ExplorerRowActions } from './ExplorerRowActions';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';
import { Dots } from '@/components/loading';
import { SIDEBAR_ROW_TYPOGRAPHY } from '@/lib/uiTypography';

const FILE_DROP_TARGET_BG = 'var(--po-active)';
const FILE_DROP_ROOT_SCOPE_BG = 'var(--po-hover)';
const FILE_DROP_TARGET_BORDER = 'var(--po-border-strong)';
const FILE_DROP_SCOPE_BORDER = 'var(--po-border)';
const ROOT_DROP_TARGET: FileImportTarget = { path: null, name: 'Root' };

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
  const { rootNodes, isLoading: loading } = useShallowTree(projectId);
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
  }));

  const pendingId = usePendingActiveId();
  const activeId =
    pendingId || activeNodeId || (currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null);
  const isRootActive = !activeId && !activeNodeId;
  const isRootHighlighted = highlightNodeId === '';
  const isRootAccessPointHighlight = isRootHighlighted && highlightVariant === 'access-point';
  const rootOpenMenuAction = createMenuOpenForId === '__root__' ? createMenuOpenAction ?? null : null;
  const rootEndpoints = endpointByNodeId?.get('') ?? [];
  const isRootFileDropTarget = isExternalFileDraggingInSidebar && activeFileDropTarget?.path === null;
  const rootHasSpecialBg = isRootDropTarget || isRootFileDropTarget || isRootHighlighted || isRootActive || rootOpenMenuAction !== null;
  const [isRootHovered, setIsRootHovered] = useState(false);
  const isRootSoftHovered = isRootHovered && !rootHasSpecialBg;

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
      className={className}
      onDragEnterCapture={handleSidebarDragEnterCapture}
      onDragLeaveCapture={handleSidebarDragLeaveCapture}
      onDropCapture={handleSidebarDropCapture}
      style={{ ...style, display: 'flex', flexDirection: 'column' }}
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
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          paddingTop: 6,
          background: isRootFileDropTarget ? FILE_DROP_ROOT_SCOPE_BG : 'transparent',
          boxShadow: isRootFileDropTarget
            ? `inset 0 0 0 1px ${FILE_DROP_SCOPE_BORDER}`
            : 'none',
          transition: 'background 0.12s ease, box-shadow 0.12s ease',
        }}
      >
        <div style={{ padding: '0 0 6px 0', position: 'relative', boxSizing: 'border-box' }}>
          <div
            className="group/row"
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '2px 6px',
              height: 30,
              boxSizing: 'border-box',
              borderRadius: 6,
              background: isRootDropTarget || isRootFileDropTarget
                ? FILE_DROP_TARGET_BG
                : isRootAccessPointHighlight
                  ? 'color-mix(in srgb, var(--po-success) 14%, transparent)'
                : isRootActive || rootOpenMenuAction
                  // Translucent — see ExplorerTreeRow for the full
                  // rationale. tldr: opaque var(--po-border) was visually
                  // indistinguishable from the tree-line colour
                  // var(--po-tree-guide), so selecting a row "ate" the elbow.
                  ? 'var(--po-selected)'
                  : isRootSoftHovered
                    ? 'var(--po-hover)'
                    : 'transparent',
              color: isRootDropTarget || isRootFileDropTarget
                ? 'var(--po-text)'
                : isRootAccessPointHighlight ? 'var(--po-success)' : isRootActive || rootOpenMenuAction ? 'var(--po-text)' : isRootSoftHovered ? 'var(--po-text-muted)' : 'var(--po-text-muted)',
              transition: 'background 0.1s, color 0.1s',
              boxShadow: isRootDropTarget || isRootFileDropTarget
                ? `inset 0 0 0 1px ${FILE_DROP_TARGET_BORDER}`
                : isRootAccessPointHighlight
                ? 'inset 2px 0 0 0 color-mix(in srgb, var(--po-success) 90%, transparent)'
                : 'none',
              position: 'relative',
              cursor: 'pointer',
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
            onMouseEnter={() => setIsRootHovered(true)}
            onMouseLeave={() => setIsRootHovered(false)}
            onClick={() => {
              onNavigate({ id: '', name: 'Root', type: 'folder' as ContentType });
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
                paddingLeft: 8,
                paddingRight: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 16, height: 16, justifyContent: 'center' }}>
                <FolderIcon expanded />
              </div>
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

              {(onCreate || onCreateSync) && (
                <ExplorerRowActions
                  nodeId=""
                  createParentId={null}
                  accessPath=""
                  isFolder
                  endpoints={rootEndpoints}
                  openMenuAction={rootOpenMenuAction}
                  itemName="Root"
                  onCreate={onCreate}
                  onCreateSync={onCreateSync}
                  onOpenAccess={onOpenAccess}
                />
              )}
            </div>
          </div>

          {loading && rootItems.length === 0 ? (
            <ExplorerTreeMetaRow depth={1}>
              <Dots size="xs" />
            </ExplorerTreeMetaRow>
          ) : (
            rootItems.map((item, idx) => (
              <ExplorerTreeRow
                key={item.id}
                item={item}
                depth={1}
                isLastSibling={idx === rootItems.length - 1}
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
