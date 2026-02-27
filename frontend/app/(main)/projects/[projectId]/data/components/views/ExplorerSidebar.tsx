'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import type { ContentType, AgentResource } from './GridView';
import { getNodeTypeConfig, getSyncSourceIcon, getSyncSource, isSyncedType } from '@/lib/nodeTypeConfig';
import { useContentNodes } from '@/lib/hooks/useData';
import { useSyncExternalStore } from 'react';

// === Persistent expanded state (survives component re-mounts) ===
const expandedSet = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return expandedSet;
}

function toggleExpanded(id: string) {
  if (expandedSet.has(id)) {
    expandedSet.delete(id);
  } else {
    expandedSet.add(id);
  }
  listeners.forEach(cb => cb());
}

export function ensureExpanded(id: string) {
  if (!expandedSet.has(id)) {
    expandedSet.add(id);
    listeners.forEach(cb => cb());
  }
}

function useExpandedFolders() {
  const snap = useSyncExternalStore(subscribe, () => expandedSet.size, () => expandedSet.size);
  return { isExpanded: (id: string) => expandedSet.has(id), version: snap };
}

// === Types ===
export interface MillerColumnItem {
  id: string;
  name: string;
  type: ContentType;
  is_synced?: boolean;
  sync_source?: string | null;
  sync_url?: string | null;
  last_synced_at?: string | null;
}

export interface SyncEndpointInfo {
  syncId: string;
  provider: string;
  direction: string;
  status: string;
}

export interface ExplorerSidebarProps {
  projectId: string;
  currentPath: { id: string; name: string }[];
  activeNodeId?: string;
  onNavigate: (item: MillerColumnItem, pathToItem: string[]) => void;
  onCreate?: (e: React.MouseEvent, parentId: string | null) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onSyncClick?: (nodeId: string, syncInfo: SyncEndpointInfo) => void;
  activeSyncNodeId?: string | null;
  agentResources?: AgentResource[];
  syncEndpoints?: Map<string, SyncEndpointInfo>;
  highlightNodeId?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

// === Icons ===
const ChevronRightIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 24 24'
    fill='none'
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s'
    }}
  >
    <path d='M9 6L15 12L9 18' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const FolderIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
      fill='#60a5fa'
      fillOpacity='0.45'
    />
  </svg>
);

const JsonIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <rect x='3' y='3' width='18' height='18' rx='2' stroke='#34d399' strokeWidth='1.5' fill='#34d399' fillOpacity='0.08' />
    <path d='M3 9H21' stroke='#34d399' strokeWidth='1.5' />
    <path d='M9 3V21' stroke='#34d399' strokeWidth='1.5' />
  </svg>
);

const MarkdownIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
      stroke='#a1a1aa' strokeWidth='1.5' fill='#a1a1aa' fillOpacity='0.08'
    />
    <path d='M14 2V8H20' stroke='#a1a1aa' strokeWidth='1.5' />
    <path d='M8 13H16' stroke='#a1a1aa' strokeWidth='1.5' strokeLinecap='round' />
    <path d='M8 17H12' stroke='#a1a1aa' strokeWidth='1.5' strokeLinecap='round' />
  </svg>
);

const PlainFileIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z' stroke='#71717a' strokeWidth='1.5' />
    <path d='M14 2V8H20' stroke='#71717a' strokeWidth='1.5' />
  </svg>
);

const FileIcon = ({ type, syncSource, iconSize }: { type: string; syncSource?: string | null; iconSize?: number }) => {
  const config = getNodeTypeConfig(type);
  const actualSource = syncSource || getSyncSource(type);
  const BadgeIcon = getSyncSourceIcon(actualSource) || config.badgeIcon;
  const sz = iconSize ?? 16;

  if (BadgeIcon) return <BadgeIcon size={sz} />;

  switch (config.renderAs) {
    case 'markdown': return <MarkdownIcon />;
    case 'json': return <JsonIcon />;
    default: return <PlainFileIcon />;
  }
};

function getSyncDirectionArrow(type: string, direction: 'inbound' | 'outbound' | 'bidirectional' = 'inbound'): string | null {
  if (!isSyncedType(type)) return null;
  if (direction === 'bidirectional') return ' ⇄';
  if (direction === 'outbound') return ' ←';
  return ' →';
}

function getTypeExtension(type: string): string | null {
  const config = getNodeTypeConfig(type);
  switch (config.renderAs) {
    case 'json': return '.json';
    case 'markdown': return '.md';
    default: return null;
  }
}

function hasFileExtension(name: string): boolean {
  return /\.\w{1,10}$/.test(name);
}

// === Sync Provider Badge (subtle inline icon) ===
function SyncBadge({ provider, direction, active }: { provider: string; direction: string; active?: boolean }) {
  const sz = 12;
  const icon = (() => {
    switch (provider) {
      case 'gmail': return <img src="/icons/gmail.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'google_calendar': return <img src="/icons/google_calendar.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'google_sheets': return <img src="/icons/google_sheet.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'google_drive':
      case 'google_docs': return <img src="/icons/google_doc.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'github': return (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="#9ca3af">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
        </svg>
      );
      case 'notion': return <img src="/icons/notion.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'linear': return <img src="/icons/linear.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'airtable': return <img src="/icons/airtable.svg" width={sz} height={sz} style={{ display: 'block' }} />;
      case 'filesystem':
      case 'openclaw': return <span style={{ fontSize: 10, lineHeight: 1 }}>🦞</span>;
      default: return <span style={{ color: '#71717a', fontSize: 10 }}>⟳</span>;
    }
  })();

  const arrowColor = '#6b7280';
  const arrowSvg = direction === 'bidirectional' ? (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke={arrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5h12M10 1l4 4-4 4" /><path d="M14 11H2M6 15l-4-4 4-4" />
    </svg>
  ) : direction === 'outbound' ? (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke={arrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 8H2M6 12l-4-4 4-4" />
    </svg>
  ) : (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke={arrowColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h12M10 4l4 4-4 4" />
    </svg>
  );

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: '0 5px', borderRadius: 4, height: 20,
      background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
      transition: 'background 0.15s ease',
    }}>
      {arrowSvg}
      {icon}
    </div>
  );
}

// === Context Menu (three dots) ===
function ItemContextMenu({ itemId, itemName, isSynced, onRename, onDelete, onOpenChange }: {
  itemId: string;
  itemName: string;
  isSynced?: boolean;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string, name: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback((v: boolean) => {
    setOpenRaw(v);
    onOpenChange?.(v);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPos({ x: rect.right, y: rect.bottom + 4 });
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4,
          background: open ? 'rgba(255,255,255,0.1)' : 'transparent',
          border: 'none', cursor: 'pointer', color: '#999', padding: 0,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.y, left: pos.x, zIndex: 9999,
            transform: 'translateX(-100%)',
            background: '#222', border: '1px solid #333', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 120,
            padding: '4px 0', fontSize: 12,
          }}
        >
          {onRename && !isSynced && (
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(itemId, itemName); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '6px 12px', background: 'transparent', border: 'none',
                color: '#ccc', cursor: 'pointer', fontSize: 12, textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Rename
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(itemId, itemName); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '6px 12px', background: 'transparent', border: 'none',
                color: '#ef4444', cursor: 'pointer', fontSize: 12, textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete
            </button>
          )}
        </div>
      )}
    </>
  );
}

// === Tree Item ===
interface TreeItemProps {
  item: MillerColumnItem;
  depth: number;
  projectId: string;
  activeId: string | null;
  onNavigate: (item: MillerColumnItem, ancestors: string[]) => void;
  onCreate?: (e: React.MouseEvent, parentId: string | null) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string, name: string) => void;
  onSyncClick?: (nodeId: string, syncInfo: SyncEndpointInfo) => void;
  activeSyncNodeId?: string | null;
  ancestors: string[];
  agentResourceMap?: Map<string, AgentResource>;
  syncEndpoints?: Map<string, SyncEndpointInfo>;
  highlightNodeId?: string | null;
}

function TreeItem({ item, depth, projectId, activeId, onNavigate, onCreate, onRename, onDelete, onSyncClick, activeSyncNodeId, ancestors, agentResourceMap, syncEndpoints, highlightNodeId }: TreeItemProps) {
  const isFolder = getNodeTypeConfig(item.type).renderAs === 'folder';
  const isSynced = item.is_synced;
  const syncEndpoint = syncEndpoints?.get(item.id);
  const { isExpanded } = useExpandedFolders();
  const expanded = isFolder && isExpanded(item.id);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const isHighlighted = highlightNodeId === item.id;

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isHighlighted]);

  const agentResource = agentResourceMap?.get(item.id);
  const hasAgentAccess = !!agentResource;

  const { nodes: children, isLoading: loading } = useContentNodes(
    expanded ? projectId : '',
    expanded ? item.id : undefined
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFolder) {
      toggleExpanded(item.id);
    } else {
      onNavigate(item, [...ancestors, item.id]);
    }
  }, [isFolder, item, ancestors, onNavigate]);

  const isActive = activeId === item.id;
  const paddingLeft = 12 + (depth * 16);

  const isSyncActive = activeSyncNodeId === item.id;
  const getBackground = (h: boolean) => {
    if (isHighlighted) return 'rgba(59, 130, 246, 0.15)';
    if (isSyncActive) return 'rgba(249, 115, 22, 0.22)';
    if (isActive) return hasAgentAccess ? 'rgba(249, 115, 22, 0.18)' : '#2a2a2a';
    if (hasAgentAccess) return h ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.05)';
    return h ? 'rgba(255,255,255,0.06)' : 'transparent';
  };

  const childItems: MillerColumnItem[] = children.map(n => ({
    id: n.id, name: n.name, type: n.type as ContentType,
    is_synced: n.is_synced, sync_source: n.sync_source, last_synced_at: n.last_synced_at,
  }));

  const showActions = (hovered || menuOpen) && (onCreate || onRename || onDelete);

  return (
    <div>
      <div
        ref={rowRef}
        onClick={handleClick}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-puppyone-node', JSON.stringify({
            id: item.id,
            name: item.name,
            type: item.type,
          }));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box',
          padding: '0 8px', paddingLeft, paddingRight: 6, cursor: 'pointer',
          background: getBackground(hovered),
          color: isActive ? '#fff' : hovered ? '#d4d4d4' : '#a1a1aa',
          fontSize: 13, userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          borderLeft: hasAgentAccess ? '3px solid rgba(249, 115, 22, 0.7)' : '3px solid transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, color: '#666' }}>
          {isFolder && <ChevronRightIcon expanded={expanded} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 16, height: 16, justifyContent: 'center' }}>
          {isFolder ? <FolderIcon /> : (() => {
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

        {/* Right area */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, flexShrink: 0, marginLeft: 'auto' }}>
          {/* Hover: action buttons in fixed position */}
          {showActions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
              {isFolder && onCreate && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreate(e, item.id); }}
                  title="New item"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 4,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#999', padding: 0, transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
          {/* Sync badge: always visible, becomes clickable bubble on hover */}
          {syncEndpoint && (
            <div
              title={`${syncEndpoint.provider} · ${syncEndpoint.direction}`}
              onClick={(e) => { e.stopPropagation(); onSyncClick?.(item.id, syncEndpoint); }}
              style={{
                display: 'flex', alignItems: 'center', cursor: onSyncClick ? 'pointer' : 'default',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                ...(hovered ? { transform: 'scale(1.08)' } : {}),
              }}
            >
              <SyncBadge provider={syncEndpoint.provider} direction={syncEndpoint.direction} active={hovered} />
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div>
          {loading && children.length === 0 ? (
            <div style={{ paddingLeft: paddingLeft + 22, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12 }}>Loading...</div>
          ) : childItems.length > 0 ? (
            childItems.map(child => (
              <TreeItem key={child.id} item={child} depth={depth + 1} projectId={projectId}
                activeId={activeId} onNavigate={onNavigate} onCreate={onCreate} onRename={onRename} onDelete={onDelete} onSyncClick={onSyncClick} activeSyncNodeId={activeSyncNodeId}
                ancestors={[...ancestors, item.id]} agentResourceMap={agentResourceMap} syncEndpoints={syncEndpoints} highlightNodeId={highlightNodeId} />
            ))
          ) : !loading ? (
            <div style={{ paddingLeft: paddingLeft + 22, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12, fontStyle: 'italic' }}>Empty</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// === Main Component ===
export function ExplorerSidebar({ projectId, currentPath, activeNodeId, onNavigate, onCreate, onRename, onDelete, onSyncClick, activeSyncNodeId, agentResources, syncEndpoints, highlightNodeId, className, style }: ExplorerSidebarProps) {
  const { nodes: rootNodes, isLoading: loading } = useContentNodes(projectId, null);

  if (currentPath.length > 0) {
    currentPath.forEach(p => ensureExpanded(p.id));
  }

  const rootItems: MillerColumnItem[] = rootNodes.map(n => ({
    id: n.id, name: n.name, type: n.type as ContentType,
    is_synced: n.is_synced, sync_source: n.sync_source, last_synced_at: n.last_synced_at,
  }));

  const activeId = activeNodeId || (currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null);

  const agentResourceMap = new Map<string, AgentResource>();
  if (agentResources) {
    for (const r of agentResources) agentResourceMap.set(r.nodeId, r);
  }

  return (
    <div className={className} style={{ ...style, overflow: 'auto' }}>
      <div style={{ padding: '6px 0' }}>
        {/* Root folder header + create button */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 6px 4px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <FolderIcon />
            <span style={{
              fontSize: 13, fontWeight: 500, color: '#a1a1aa',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              Root
            </span>
          </div>
          {onCreate && (
            <button
              onClick={(e) => onCreate(e, null)}
              title="New item in root"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 4,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#666', padding: 0, transition: 'all 0.1s', flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#aaa'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#666'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
        {loading && rootItems.length === 0 ? (
          <div style={{ padding: '0 16px', color: '#666', fontSize: 13 }}>Loading...</div>
        ) : (
          rootItems.map(item => (
            <TreeItem key={item.id} item={item} depth={0} projectId={projectId}
              activeId={activeId} onNavigate={onNavigate} onCreate={onCreate} onRename={onRename} onDelete={onDelete} onSyncClick={onSyncClick} activeSyncNodeId={activeSyncNodeId}
              ancestors={[]} agentResourceMap={agentResourceMap} syncEndpoints={syncEndpoints} highlightNodeId={highlightNodeId} />
          ))
        )}
      </div>
    </div>
  );
}
