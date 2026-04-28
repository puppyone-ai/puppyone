'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { getNodeTypeConfig, getSyncSource, getSyncSourceIcon, isSyncedType } from '@/lib/nodeTypeConfig';
import { useContentNodes } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import type { ContentType } from '../views/GridView';
import { ensureExpanded, toggleExpanded, useIsExpanded } from './explorerState';
import { ItemContextMenu } from './ExplorerRowMenus';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';

export const FolderIcon = ({ expanded }: { expanded?: boolean }) => {
  if (expanded) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.25" />
        <path d="M 9.5 10 L 23 10 Q 24 10 23.5 11 L 19.5 19 Q 19 20 18 20 L 4.5 20 Q 3.5 20 4 19 L 8 11 Q 8.5 10 9.5 10 Z" fill="#60a5fa" fillOpacity="0.55" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.45" />
    </svg>
  );
};

const JsonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v6h6" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 12l-2 2 2 2" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 12l2 2-2 2" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MarkdownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v6h6" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 16v-4l2.5 2.5L13 12v4" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 16v-4h2v4" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 14h2" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlainFileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" stroke="#71717a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v6h6" stroke="#71717a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function FileIcon({
  type,
  syncSource,
  iconSize,
}: {
  type: string;
  syncSource?: string | null;
  iconSize?: number;
}) {
  const config = getNodeTypeConfig(type);
  const actualSource = syncSource || getSyncSource(type);
  const BadgeIcon = getSyncSourceIcon(actualSource) || config.badgeIcon;
  const size = iconSize ?? 16;

  if (BadgeIcon) return <BadgeIcon size={size} />;

  switch (config.renderAs) {
    case 'markdown':
      return <MarkdownIcon />;
    case 'json':
      return <JsonIcon />;
    default:
      return <PlainFileIcon />;
  }
}

function getSyncDirectionArrow(
  type: string,
  direction: 'inbound' | 'outbound' | 'bidirectional' = 'inbound',
): string | null {
  if (!isSyncedType(type)) return null;
  if (direction === 'bidirectional') return ' ⇄';
  if (direction === 'outbound') return ' ←';
  return ' →';
}

function getTypeExtension(type: string): string | null {
  const config = getNodeTypeConfig(type);

  switch (config.renderAs) {
    case 'json':
      return '.json';
    case 'markdown':
      return '.md';
    default:
      return null;
  }
}

function hasFileExtension(name: string): boolean {
  return /\.\w{1,10}$/.test(name);
}

interface ExplorerTreeRowProps {
  item: MillerColumnItem;
  depth: number;
  // True when this row is the LAST among its siblings at this
  // depth.  Drives the L-shape elbow:
  //   ─ last  → vertical stops at the hook level (closing ╰─).
  //   ─ !last → vertical runs full row height so it visually
  //             merges with the next sibling's elbow below.
  // Also gates the ancestor continuation line drawn by THIS
  // row's children-wrapper: only non-last rows thread their
  // column down through their subtree.
  isLastSibling: boolean;
  projectId: string;
  activeId: string | null;
  onNavigate: (item: MillerColumnItem) => void;
  onCreate?: ExplorerSidebarProps['onCreate'];
  onCreateSync?: ExplorerSidebarProps['onCreateSync'];
  onRename?: ExplorerSidebarProps['onRename'];
  onDelete?: ExplorerSidebarProps['onDelete'];
  onMoveNode?: ExplorerSidebarProps['onMoveNode'];
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  createMenuOpenForId?: string | null;
}

export const ExplorerTreeRow = memo(function ExplorerTreeRow({
  item,
  depth,
  isLastSibling,
  projectId,
  activeId,
  onNavigate,
  onCreate,
  onCreateSync,
  onRename,
  onDelete,
  onMoveNode,
  activeSyncNodeId,
  highlightNodeId,
  createMenuOpenForId,
}: ExplorerTreeRowProps) {
  const isFolder = getNodeTypeConfig(item.type).renderAs === 'folder';
  const isSynced = item.is_synced;
  const expanded = useIsExpanded(item.id) && isFolder;
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const isHighlighted = highlightNodeId === item.id;
  const isCreateMenuOpen = createMenuOpenForId === item.id;

  const { isDropTarget, dropHandlers } = useNodeDrop({
    targetFolderId: item.id,
    onMoveNode,
    disabled: !isFolder,
  });

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isHighlighted]);

  const { nodes: children, isLoading: loading } = useContentNodes(
    expanded ? projectId : '',
    expanded ? item.id : undefined,
  );

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (isFolder) ensureExpanded(item.id);
      onNavigate(item);
    },
    [isFolder, item, onNavigate],
  );

  const handleToggleExpand = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      toggleExpanded(item.id);
    },
    [item.id],
  );

  const isActive = activeId === item.id;
  const isSyncActive = activeSyncNodeId === item.id;
  const isRowActive = isActive || isSyncActive;
  const rowPaddingLeft = 8 + depth * 16;
  const childTextPadding = rowPaddingLeft + 22;
  const hasSpecialBg = isDropTarget || isHighlighted || isRowActive || isCreateMenuOpen;
  const staticBg = isDropTarget
    ? 'rgba(59, 130, 246, 0.2)'
    : isHighlighted
      ? 'rgba(59, 130, 246, 0.15)'
      : isRowActive || isCreateMenuOpen
        ? '#2a2a2a'
        : 'transparent';
  const staticColor = isDropTarget
    ? '#93c5fd'
    : isRowActive || isCreateMenuOpen
      ? '#fff'
      : '#a1a1aa';

  const childItems: MillerColumnItem[] = useMemo(
    () =>
      children.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type as ContentType,
        is_synced: node.is_synced,
        sync_source: node.sync_source,
        last_synced_at: node.last_synced_at,
      })),
    [children],
  );

  const hasActions = !!(onCreate || onCreateSync || onRename || onDelete);

  return (
    <div>
      <div
        ref={rowRef}
        data-menu-host="true"
        className={`group/row ${!hasSpecialBg ? 'hover:bg-[rgba(255,255,255,0.06)] hover:text-[#d4d4d4]' : ''}`}
        onClick={handleClick}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/x-puppyone-node',
            JSON.stringify({
              id: item.id,
              name: item.name,
              type: item.type,
              parentId: item.id.includes('/') ? item.id.split('/').slice(0, -1).join('/') : null,
            }),
          );
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        {...dropHandlers}
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '1px 6px',
          height: 30,
          boxSizing: 'border-box',
          borderRadius: 6,
          background: staticBg,
          color: staticColor,
          fontSize: 13,
          userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          boxShadow: isDropTarget ? 'inset 3px 0 0 0 rgba(59, 130, 246, 0.7)' : 'none',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        {/* Tree-line elbow for THIS depth.  Same visual grammar as
            the home page's `TreeRows`, just sized for the sidebar's
            tighter 16px-per-level indent (vs home's 20px):

              ─ vertical stub at row-local x = depth*16 (one indent
                step left of the icon).
              ─ horizontal hook 8px to the icon's left edge.
              ─ vertical stops at y=15 (hook level) when this is the
                last sibling — that's the closing ╰─ shape.  Otherwise
                it spans the full row height so it visually merges
                with the next sibling's elbow below.

            `<rect>` not `<line>`: stroke-1 lines paint a center stroke
            that straddles two pixels, which subpixel-misaligns with
            the integer-bound continuation `<div>` drawn in the
            children-wrapper below — looks crisp on retina with rect.

            Ancestor continuation lines are NOT drawn here.  Each
            ancestor's children-wrapper draws its own (see {expanded}
            block), which is what makes the tree visually CLOSE at
            the right depth (last sibling = no continuation through
            subtree) instead of the old behavior where every per-depth
            line ran full row height regardless of whether the
            ancestor still had siblings below. */}
        {depth > 0 && (
          <svg
            width={depth * 16 + 8}
            height={30}
            viewBox={`0 0 ${depth * 16 + 8} 30`}
            shapeRendering="crispEdges"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            <rect
              x={depth * 16}
              y={0}
              width={1}
              height={isLastSibling ? 15 : 30}
              fill="#27272a"
            />
            <rect
              x={depth * 16}
              y={15}
              width={8}
              height={1}
              fill="#27272a"
            />
          </svg>
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: '100%',
            boxSizing: 'border-box',
            paddingLeft: rowPaddingLeft,
            paddingRight: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <div
            onClick={isFolder ? handleToggleExpand : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              width: 16,
              height: 16,
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {isFolder ? (
              <>
                <div className="flex items-center justify-center group-hover/row:hidden">
                  <FolderIcon expanded={expanded} />
                </div>
                <div className="hidden items-center justify-center group-hover/row:flex" style={{ width: 16, height: 16, borderRadius: 3 }}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </>
            ) : (() => {
              const arrow = getSyncDirectionArrow(item.type);

              if (arrow) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <FileIcon type={item.type} syncSource={item.sync_source} iconSize={10} />
                    <span style={{ color: '#71717a', fontSize: 7, lineHeight: 1 }}>{arrow}</span>
                  </div>
                );
              }

              return <FileIcon type={item.type} syncSource={item.sync_source} />;
            })()}
          </div>

          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {item.name}
            {!isFolder && !hasFileExtension(item.name) && (() => {
              const ext = getTypeExtension(item.type);
              return ext ? <span style={{ color: '#525252', fontSize: 11 }}>{ext}</span> : null;
            })()}
          </span>

          {hasActions && (
            <div
              className={`flex items-center gap-0.5 flex-shrink-0 ml-auto ${menuOpen || isCreateMenuOpen ? 'visible' : 'invisible group-hover/row:visible'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Per-folder action cluster reads left → right:
                    [+]  [link]  [⋮]
                  + is the most-used action (add a child) so it
                  takes the leftmost position in the user's eye
                  scan; link (create access point for this folder)
                  is one step less common; ⋮ catches the long-tail
                  rename / delete / move actions.  Earlier draft
                  put link first, but review feedback flagged that
                  as the wrong grouping — `+` and the access-point
                  link are conceptually peers (both "create"
                  actions, just inside vs outside scopes), and
                  putting + first matches the muscle memory the
                  user already has from every other file manager. */}
              {isFolder && onCreate && (
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isCreateMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreate(e, item.id);
                  }}
                  title="New item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: isCreateMenuOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: isCreateMenuOpen ? '#ddd' : '#999',
                    padding: 0,
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = '#ddd';
                  }}
                  onMouseLeave={(e) => {
                    if (!isCreateMenuOpen) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#999';
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}

              {/* Link icon: "create access point for this folder".
                  Visually paired with the + button (both "create"
                  actions, just for inside vs outside scopes).
                  Same Lucide Link2 SVG used in the Home Data
                  card's ApChip and elsewhere — keeping the icon
                  consistent so users learn one shape, not three. */}
              {isFolder && onCreateSync && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateSync(item.id);
                  }}
                  title="Create access point for this folder"
                  aria-label="Create access point for this folder"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#999',
                    padding: 0,
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = '#ddd';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#999';
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </button>
              )}

              {(onRename || onDelete) && (
                <ItemContextMenu
                  itemId={item.id}
                  itemName={item.name}
                  isSynced={isSynced}
                  onRename={onRename}
                  onDelete={onDelete}
                  onOpenChange={setMenuOpen}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        // `position: relative` so the continuation line below can
        // absolute-position itself against the wrapper's full
        // height, threading my elbow column down through every
        // descendant row (and their sub-subtree wrappers).
        <div style={{ position: 'relative' }}>
          {/* Continuation line — the structural complement to the
              per-row elbow above.  When *I* am not the last sibling,
              my elbow column needs to keep going down through my
              entire subtree so the next sibling's elbow visually
              connects.  Drawn at MY depth's column in OUTER coords:
              the row's 6px left margin + row-local elbow x (depth*16)
              = 6 + depth*16.  The wrapper has no margin so wrapper-x
              == outer-x, no further offset needed.

              Skipped when last sibling so the tree visually CLOSES
              at the right depth instead of running every line off
              the bottom of the subtree.

              Also drawn when there are NO real children (loading /
              empty placeholder): the parent's "more siblings below"
              signal still needs to thread through whatever the
              wrapper renders, otherwise an expanded-but-empty
              parent would visually break the sibling chain. */}
          {depth > 0 && !isLastSibling && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 6 + depth * 16,
                top: 0,
                bottom: 0,
                width: 1,
                background: '#27272a',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
          )}
          {loading && children.length === 0 ? (
            <div style={{ paddingLeft: childTextPadding, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12 }}>
              Loading...
            </div>
          ) : childItems.length > 0 ? (
            childItems.map((child, idx) => (
              <ExplorerTreeRow
                key={child.id}
                item={child}
                depth={depth + 1}
                isLastSibling={idx === childItems.length - 1}
                projectId={projectId}
                activeId={activeId}
                onNavigate={onNavigate}
                onCreate={onCreate}
                onCreateSync={onCreateSync}
                onRename={onRename}
                onDelete={onDelete}
                onMoveNode={onMoveNode}
                activeSyncNodeId={activeSyncNodeId}
                highlightNodeId={highlightNodeId}
                createMenuOpenForId={createMenuOpenForId}
              />
            ))
          ) : !loading ? (
            <div
              style={{
                paddingLeft: childTextPadding,
                paddingTop: 4,
                paddingBottom: 4,
                color: '#666',
                fontSize: 12,
                fontStyle: 'italic',
              }}
            >
              Empty
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
