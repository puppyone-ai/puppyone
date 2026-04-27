'use client';

import { memo, useEffect } from 'react';
import { useShallowTree } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import type { ContentType } from '../views/GridView';
import { ensureExpandedBatch, usePendingActiveId } from './explorerState';
import { ExplorerTreeRow, FolderIcon } from './ExplorerTreeRow';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';

export const ExplorerSidebar = memo(function ExplorerSidebar({
  projectId,
  currentPath,
  activeNodeId,
  onNavigate,
  onCreate,
  onRename,
  onDelete,
  onMoveNode,
  activeSyncNodeId,
  highlightNodeId,
  createMenuOpenForId,
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
  const isRootCreateMenuOpen = createMenuOpenForId === '__root__';
  const rootHasSpecialBg = isRootDropTarget || isRootActive;

  return (
    <div className={className} style={{ ...style, display: 'flex', flexDirection: 'column' }}>
      <div
        data-menu-host="true"
        style={{
          height: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: '#0e0e0e',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: '#71717a',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          Workspace
        </div>

        {onCreate && (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isRootCreateMenuOpen}
            onClick={(e) => onCreate(e, null)}
            title="Add file/folder"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 4,
              background: isRootCreateMenuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isRootCreateMenuOpen ? '#ddd' : '#888',
              padding: 0,
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#ddd';
            }}
            onMouseLeave={(e) => {
              if (!isRootCreateMenuOpen) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#888';
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', position: 'relative', paddingTop: 6 }}>
        <div style={{ padding: '0 0 6px 0', position: 'relative', boxSizing: 'border-box' }}>
          <div
            className={`group/row ${!rootHasSpecialBg ? 'hover:bg-[rgba(255,255,255,0.06)] hover:text-[#d4d4d4]' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '2px 6px',
              height: 30,
              boxSizing: 'border-box',
              borderRadius: 6,
              background: isRootDropTarget ? 'rgba(59, 130, 246, 0.15)' : isRootActive ? '#2a2a2a' : 'transparent',
              color: isRootActive ? '#fff' : '#a1a1aa',
              transition: 'background 0.1s, color 0.1s',
              position: 'relative',
              cursor: 'pointer',
            }}
            {...rootDropHandlers}
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
                onRename={onRename}
                onDelete={onDelete}
                onMoveNode={onMoveNode}
                activeSyncNodeId={activeSyncNodeId}
                highlightNodeId={highlightNodeId}
                createMenuOpenForId={createMenuOpenForId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
});
