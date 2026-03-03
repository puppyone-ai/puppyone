'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import type { ContentType } from './GridView';
import { getNodeTypeConfig, getSyncSourceIcon, getSyncSource, isSyncedType } from '@/lib/nodeTypeConfig';
import { useContentNodes } from '@/lib/hooks/useData';
import { useSyncExternalStore } from 'react';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';

// === Persistent expanded state (survives component re-mounts) ===
const expandedSet = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
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

// === Pending active ID store (instant sidebar highlight, survives remounts) ===
let _pendingActiveId: string | null = null;
let _pendingVersion = 0;
const _pendingListeners = new Set<() => void>();

export function setPendingActiveId(id: string | null) {
  _pendingActiveId = id;
  _pendingVersion++;
  _pendingListeners.forEach(cb => cb());
}

export function usePendingActiveId() {
  useSyncExternalStore(
    (cb) => { _pendingListeners.add(cb); return () => _pendingListeners.delete(cb); },
    () => _pendingVersion,
    () => 0,
  );
  return _pendingActiveId;
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
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  onSyncClick?: (item: MillerColumnItem, pathToItem: string[]) => void;
  onEndpointClick?: (item: MillerColumnItem, endpoint: SyncEndpointInfo, pathToItem: string[]) => void;
  activeSyncNodeId?: string | null;
  syncEndpoints?: Map<string, SyncEndpointInfo>;
  nodeEndpointMap?: Map<string, SyncEndpointInfo[]>;
  highlightNodeId?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

// === Icons ===
const FolderIcon = ({ expanded }: { expanded?: boolean }) => {
  if (expanded) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        {/* Back flap */}
        <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.25" />
        {/* Front flap (wide parallelogram skewed to the right) */}
        <path d="M 9.5 10 L 23 10 Q 24 10 23.5 11 L 19.5 19 Q 19 20 18 20 L 4.5 20 Q 3.5 20 4 19 L 8 11 Q 8.5 10 9.5 10 Z" fill="#60a5fa" fillOpacity="0.55" />
      </svg>
    );
  }
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
      <path
        d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
        fill='#60a5fa'
        fillOpacity='0.45'
      />
    </svg>
  );
};

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

// === Sync Source Icon (left column) ===
function SyncSourceIcon({ size = 14 }: { size?: number }) {
  // 极简的“插头”图标 (Plug)，类似 Supabase 的连接隐喻
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255, 255, 255, 0.25)' }}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
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
      case 'filesystem': return <span style={{ fontSize: 10, lineHeight: 1 }}>🦞</span>;
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
// === Endpoint Hover Menu ===
function EndpointHoverMenu({ 
  endpoints, 
  onEndpointClick, 
  item, 
  ancestors,
  defaultClick 
}: { 
  endpoints: SyncEndpointInfo[], 
  onEndpointClick: (item: MillerColumnItem, endpoint: SyncEndpointInfo, pathToItem: string[]) => void, 
  item: MillerColumnItem, 
  ancestors: string[],
  defaultClick: () => void 
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (endpoints.length <= 1) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ x: rect.right + 4, y: rect.top });
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  const defaultEndpoint = endpoints[0];
  const isAgent = defaultEndpoint?.provider.startsWith('agent:');
  const isMcp = defaultEndpoint?.provider === 'mcp';
  const isSandbox = defaultEndpoint?.provider === 'sandbox';

  const iconColor = isAgent ? 'rgba(167, 139, 250, 0.7)' 
    : isMcp ? 'rgba(96, 165, 250, 0.8)' 
    : isSandbox ? 'rgba(245, 158, 11, 0.8)' 
    : 'rgba(255, 255, 255, 0.4)';

  const dotColor = isAgent ? '#a78bfa' : isMcp ? '#60a5fa' : isSandbox ? '#f59e0b' : '#10b981';

  return (
    <div 
      style={{ display: 'flex', position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={triggerRef}
        title={endpoints.length > 1 ? `Multiple endpoints (${endpoints.length}). Click for default, hover for all.` : `${defaultEndpoint?.provider} (Click to configure)`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
          defaultClick();
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
          position: 'relative',
          opacity: 1,
          background: 'transparent',
          transition: 'background 0.15s, opacity 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {isAgent ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: iconColor }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ) : isMcp ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: iconColor }}>
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
        ) : isSandbox ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: iconColor }}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        ) : (
          <SyncSourceIcon size={14} />
        )}
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: dotColor,
          boxShadow: '0 0 0 1.5px #1a1a1a',
        }} />
        {endpoints.length > 1 && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#f59e0b', color: '#fff',
            fontSize: 9, fontWeight: 700,
            width: 14, height: 14, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 0 1.5px #1a1a1a',
            zIndex: 10
          }}>
            {endpoints.length}
          </div>
        )}
      </div>

      {open && pos && endpoints.length > 1 && (
        <div
          style={{
            position: 'fixed', top: pos.y, left: pos.x, zIndex: 10000,
            background: '#222', border: '1px solid #333', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 160,
            padding: '4px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div style={{ padding: '4px 8px 6px 8px', fontSize: 11, color: '#888', borderBottom: '1px solid #333', marginBottom: 4 }}>
            Select Endpoint
          </div>
          {endpoints.map((ep, i) => {
            const epIsAgent = ep.provider.startsWith('agent:');
            const epIsMcp = ep.provider === 'mcp';
            const epIsSandbox = ep.provider === 'sandbox';
            const Icon = epIsAgent ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#a78bfa' }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            ) : epIsMcp ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#60a5fa' }}><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
            ) : epIsSandbox ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#f59e0b' }}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            ) : (
              <SyncSourceIcon size={14} />
            );

            return (
              <div
                key={ep.syncId}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onEndpointClick(item, ep, [...ancestors, item.id]);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                  color: '#ccc'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {Icon}
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {epIsAgent ? 'Chat Agent' : epIsMcp ? 'MCP Server' : epIsSandbox ? 'Sandbox' : 'Data Sync'}
                </span>
                {i === 0 && <span style={{ fontSize: 10, color: '#666', background: 'rgba(255,255,255,0.05)', padding: '2px 4px', borderRadius: 4 }}>Default</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  onSyncClick?: (item: MillerColumnItem, pathToItem: string[]) => void;
  onEndpointClick?: (item: MillerColumnItem, endpoint: SyncEndpointInfo, pathToItem: string[]) => void;
  activeSyncNodeId?: string | null;
  ancestors: string[];
  syncEndpoints?: Map<string, SyncEndpointInfo>;
  nodeEndpointMap?: Map<string, SyncEndpointInfo[]>;
  highlightNodeId?: string | null;
}

function TreeItem({ item, depth, projectId, activeId, onNavigate, onCreate, onRename, onDelete, onMoveNode, onSyncClick, onEndpointClick, activeSyncNodeId, ancestors, syncEndpoints, nodeEndpointMap, highlightNodeId }: TreeItemProps) {
  const isFolder = getNodeTypeConfig(item.type).renderAs === 'folder';
  const isSynced = item.is_synced;
  const syncEndpoint = syncEndpoints?.get(item.id);
  const { isExpanded } = useExpandedFolders();
  const expanded = isFolder && isExpanded(item.id);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const isHighlighted = highlightNodeId === item.id;

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
  const rowPaddingLeft = 8 + (depth * 16);
  const LEFT_STATUS_COL_WIDTH = 30;
  // childTextPadding aligns the "Empty/Loading" with child row text.
  const childTextPadding = LEFT_STATUS_COL_WIDTH + rowPaddingLeft + 22;

  const isSyncActive = activeSyncNodeId === item.id;
  const isEndpointActive = isSyncActive;
  const isRowActive = isActive || isEndpointActive;
  const getBackground = (h: boolean) => {
    if (isDropTarget) return 'rgba(59, 130, 246, 0.2)';
    if (isHighlighted) return 'rgba(59, 130, 246, 0.15)';
    if (isRowActive) return '#2a2a2a';
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
            parentId: ancestors.length > 0 ? ancestors[ancestors.length - 1] : null,
          }));
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        {...dropHandlers}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center',
          margin: '1px 6px',
          height: 30, boxSizing: 'border-box',
          borderRadius: 6,
          background: getBackground(hovered),
          color: isDropTarget ? '#93c5fd' : isRowActive ? '#fff' : hovered ? '#d4d4d4' : '#a1a1aa',
          fontSize: 13, userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          boxShadow: isDropTarget ? 'inset 3px 0 0 0 rgba(59, 130, 246, 0.7)' : 'none',
          cursor: 'pointer',
        }}
      >
        {/* Left dedicated status column (sync plug only) */}
        <div
          style={{
            width: LEFT_STATUS_COL_WIDTH,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            boxSizing: 'border-box',
            background: 'transparent',
          }}
        >
          {syncEndpoint && nodeEndpointMap?.get(item.id) ? (
            <EndpointHoverMenu
              endpoints={nodeEndpointMap.get(item.id)!}
              onEndpointClick={(it, ep, path) => onEndpointClick?.(it, ep, path)}
              item={item}
              ancestors={ancestors}
              defaultClick={() => onSyncClick?.(item, [...ancestors, item.id])}
            />
          ) : syncEndpoint ? (
            <div
              title={`${syncEndpoint.provider} (Click to configure)`}
              onClick={(e) => {
                e.stopPropagation();
                onSyncClick?.(item, [...ancestors, item.id]);
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                position: 'relative',
                opacity: isEndpointActive || hovered ? 1 : 0.85,
                background: isEndpointActive ? 'rgba(255,255,255,0.12)' : 'transparent',
                transition: 'background 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = isEndpointActive ? 'rgba(255,255,255,0.12)' : 'transparent'; }}
            >
              <SyncSourceIcon size={14} />
              <div style={{
                position: 'absolute', bottom: 3, right: 3,
                width: 5, height: 5, borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 0 1.5px #1a1a1a',
              }} />
            </div>
          ) : null}
        </div>

        {/* File row content */}
        <div
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 6, height: '100%', boxSizing: 'border-box',
            paddingLeft: rowPaddingLeft, paddingRight: 6,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 16, height: 16, justifyContent: 'center' }}>
            {isFolder ? <FolderIcon expanded={expanded} /> : (() => {
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

          {/* Right area — actions only */}
          <div style={{ 
            display: 'flex', alignItems: 'center', 
            justifyContent: 'flex-end', flexShrink: 0, 
            marginLeft: 'auto',
          }} onClick={e => e.stopPropagation()}>
            
            {/* Actions */}
            {showActions && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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
          </div>
        </div>
      </div>

      {expanded && (
        <div>
          {loading && children.length === 0 ? (
            <div style={{ paddingLeft: childTextPadding, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12 }}>Loading...</div>
          ) : childItems.length > 0 ? (
            childItems.map(child => (
              <TreeItem key={child.id} item={child} depth={depth + 1} projectId={projectId}
                activeId={activeId} onNavigate={onNavigate} onCreate={onCreate} onRename={onRename} onDelete={onDelete} onMoveNode={onMoveNode} onSyncClick={onSyncClick} onEndpointClick={onEndpointClick} activeSyncNodeId={activeSyncNodeId}
                ancestors={[...ancestors, item.id]} syncEndpoints={syncEndpoints} nodeEndpointMap={nodeEndpointMap} highlightNodeId={highlightNodeId} />
            ))
          ) : !loading ? (
            <div style={{ paddingLeft: childTextPadding, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12, fontStyle: 'italic' }}>Empty</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// === Main Component ===
export function ExplorerSidebar({ projectId, currentPath, activeNodeId, onNavigate, onCreate, onRename, onDelete, onMoveNode, onSyncClick, onEndpointClick, activeSyncNodeId, syncEndpoints, nodeEndpointMap, highlightNodeId, className, style }: ExplorerSidebarProps) {
  const { nodes: rootNodes, isLoading: loading } = useContentNodes(projectId, null);

  const { isDropTarget: isRootDropTarget, dropHandlers: rootDropHandlers } = useNodeDrop({
    targetFolderId: null,
    onMoveNode,
  });

  useEffect(() => {
    if (currentPath.length > 0) {
      currentPath.forEach(p => ensureExpanded(p.id));
    }
  }, [currentPath]);

  const rootItems: MillerColumnItem[] = rootNodes.map(n => ({
    id: n.id, name: n.name, type: n.type as ContentType,
    is_synced: n.is_synced, sync_source: n.sync_source, last_synced_at: n.last_synced_at,
  }));

  const pendingId = usePendingActiveId();
  const activeId = pendingId || activeNodeId || (currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null);

  return (
    <div className={className} style={{ ...style, display: 'flex', flexDirection: 'column' }}>
      {/* Top operation row (separate from tree hierarchy) */}
      <div
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#71717a', fontSize: 13, fontWeight: 500, fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif' }}>
          Workspace
        </div>
        {onCreate && (
          <button
            onClick={(e) => onCreate(e, null)}
            title="Add file/folder"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#888', padding: 0, transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#ddd'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>
      
      {/* Sidebar Content (Scrollable) */}
      <div style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', position: 'relative' }}>
        {/* Continuous vertical line for the left status column */}
        <div style={{
          position: 'absolute',
          left: 36, // 6px (margin) + 30px (status col width)
          top: 0,
          bottom: 0,
          width: 1,
          background: 'rgba(255,255,255,0.06)',
          zIndex: 10,
          pointerEvents: 'none'
        }} />
        
        <div style={{ padding: '0 0 6px 0', position: 'relative', boxSizing: 'border-box' }}>

          {/* The true Root node */}
          <div style={{ 
            display: 'flex', alignItems: 'center',
            margin: '2px 6px 2px 6px',
            height: 30, boxSizing: 'border-box',
            borderRadius: 6,
            background: isRootDropTarget ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            transition: 'background 0.1s',
            position: 'relative',
          }}
            {...rootDropHandlers}
          >
            {/* Simulated left status column to extend the plug line */}
            <div
              style={{
                width: 30, // MATCHES LEFT_STATUS_COL_WIDTH
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                boxSizing: 'border-box',
              }}
            ></div>
            
            {/* Root content */}
            <div style={{ 
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', gap: 6, height: '100%', boxSizing: 'border-box',
              paddingLeft: 8, // Equivalent to depth 0 padding
              paddingRight: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 16, height: 16, justifyContent: 'center' }}>
                <FolderIcon expanded={true} />
              </div>
              <span style={{
                fontSize: 13, fontWeight: 500, color: '#a1a1aa',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Root
              </span>
            </div>
          </div>
          {loading && rootItems.length === 0 ? (
            <div style={{ padding: '0 16px', color: '#666', fontSize: 13 }}>Loading...</div>
          ) : (
            rootItems.map(item => (
              <TreeItem key={item.id} item={item} depth={1} projectId={projectId}
                activeId={activeId} onNavigate={onNavigate} onCreate={onCreate} onRename={onRename} onDelete={onDelete} onMoveNode={onMoveNode} onSyncClick={onSyncClick} onEndpointClick={onEndpointClick} activeSyncNodeId={activeSyncNodeId}
                ancestors={[]} syncEndpoints={syncEndpoints} nodeEndpointMap={nodeEndpointMap} highlightNodeId={highlightNodeId} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
