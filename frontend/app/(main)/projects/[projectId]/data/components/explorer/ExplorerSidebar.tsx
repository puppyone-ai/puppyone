'use client';

import { memo, useEffect, useState } from 'react';
import { useShallowTree } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import type { ContentType } from '../views/GridView';
import { ensureExpandedBatch, usePendingActiveId } from './explorerState';
import { ExplorerTreeRow, FolderIcon } from './ExplorerTreeRow';
import { ExplorerRowActions } from './ExplorerRowActions';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';

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
  const rootHasSpecialBg = isRootDropTarget || isRootHighlighted || isRootActive || rootOpenMenuAction !== null;
  const [isRootHovered, setIsRootHovered] = useState(false);
  const isRootSoftHovered = isRootHovered && !rootHasSpecialBg;

  return (
    <div className={className} style={{ ...style, display: 'flex', flexDirection: 'column' }}>
      {/* Header used to live here as its own "Workspace" label bar.
          That created two stacked headers on the data page (this one
          + the page-level ProjectsHeader to the right). The unified
          design now hoists ProjectsHeader to span the full column row,
          so this sidebar starts directly with the file tree — no
          duplicate label, no broken hairline at the boundary. */}
      <div style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', position: 'relative', paddingTop: 6 }}>
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
              background: isRootDropTarget
                ? 'rgba(59, 130, 246, 0.15)'
                : isRootAccessPointHighlight
                  ? 'rgba(52, 211, 153, 0.14)'
                : isRootActive || rootOpenMenuAction
                  ? '#2a2a2a'
                  : isRootSoftHovered
                    ? 'rgba(255,255,255,0.045)'
                    : 'transparent',
              color: isRootAccessPointHighlight ? '#d1fae5' : isRootActive || rootOpenMenuAction ? '#fff' : isRootSoftHovered ? '#d4d4d8' : '#a1a1aa',
              transition: 'background 0.1s, color 0.1s',
              boxShadow: isRootAccessPointHighlight
                ? 'inset 2px 0 0 0 rgba(52, 211, 153, 0.9)'
                : 'none',
              position: 'relative',
              cursor: 'pointer',
            }}
            {...rootDropHandlers}
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
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'inherit',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Root
              </span>
            </div>

            {(onCreate || onCreateSync) && (
              <div style={{ marginRight: 8 }}>
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
              </div>
            )}
          </div>

          {loading && rootItems.length === 0 ? (
            <div style={{ padding: '0 16px', color: '#666', fontSize: 13 }}>Loading...</div>
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
