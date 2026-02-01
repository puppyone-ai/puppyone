'use client';

import { useState, useEffect } from 'react';
import type { ContentType, AgentResource } from './GridView';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';

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

export interface ExplorerSidebarProps {
  currentPath: { id: string; name: string }[];
  onLoadChildren: (folderId: string | null) => Promise<MillerColumnItem[]>;
  onNavigate: (item: MillerColumnItem, pathToItem: string[]) => void;
  agentResources?: AgentResource[];
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
      fill='currentColor'
      fillOpacity='0.15'
      stroke='currentColor'
      strokeWidth='1.5'
    />
  </svg>
);

const FileIcon = ({ type }: { type: string }) => {
  const config = getNodeTypeConfig(type);
  if (config.renderAs === 'markdown') {
    return (
      <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
        <path
          d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
          stroke='currentColor'
          strokeWidth='1.5'
          fill='currentColor'
          fillOpacity='0.08'
        />
        <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
        <path d='M8 13H16' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
        <path d='M8 17H12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      </svg>
    );
  }
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
      <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' fill='currentColor' fillOpacity='0.08' />
      <path d='M3 9H21' stroke='currentColor' strokeWidth='1.5' />
      <path d='M9 3V21' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
};

// === Tree Item Component ===
interface TreeItemProps {
  item: MillerColumnItem;
  depth: number;
  currentPathIds: Set<string>;
  activeId: string | null;
  onLoadChildren: (folderId: string | null) => Promise<MillerColumnItem[]>;
  onNavigate: (item: MillerColumnItem, ancestors: string[]) => void;
  ancestors: string[];
  agentResourceMap?: Map<string, AgentResource>;
}

function TreeItem({ 
  item, 
  depth, 
  currentPathIds, 
  activeId, 
  onLoadChildren, 
  onNavigate,
  ancestors,
  agentResourceMap
}: TreeItemProps) {
  const isFolder = getNodeTypeConfig(item.type).renderAs === 'folder';
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<MillerColumnItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Check if this item has agent access
  const agentResource = agentResourceMap?.get(item.id);
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  // Auto-expand if in current path
  useEffect(() => {
    if (isFolder && currentPathIds.has(item.id) && !expanded) {
      setExpanded(true);
    }
  }, [currentPathIds, item.id, isFolder]);

  // Load children when expanded
  useEffect(() => {
    if (expanded && children === null && !loading) {
      setLoading(true);
      onLoadChildren(item.id)
        .then(items => {
          setChildren(items);
        })
        .finally(() => setLoading(false));
    }
  }, [expanded, item.id, children, loading, onLoadChildren]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFolder) {
      setExpanded(!expanded);
    }
    onNavigate(item, [...ancestors, item.id]);
  };

  const isActive = activeId === item.id;
  const paddingLeft = 12 + (depth * 16);

  // Background colors based on agent access and state
  const getBackground = (hovered: boolean) => {
    if (isActive) {
      return hasAgentAccess ? 'rgba(249, 115, 22, 0.15)' : '#2a2a2a';
    }
    if (hasAgentAccess) {
      return hovered ? 'rgba(249, 115, 22, 0.08)' : 'rgba(249, 115, 22, 0.04)';
    }
    return hovered ? 'rgba(255,255,255,0.04)' : 'transparent';
  };

  return (
    <div>
      <div 
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          paddingLeft,
          cursor: 'pointer',
          background: getBackground(false),
          color: isActive ? '#fff' : '#a1a1aa',
          fontSize: 13,
          userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          // 左边橙色边条表示 agent access
          borderLeft: hasAgentAccess 
            ? '3px solid rgba(249, 115, 22, 0.6)' 
            : '3px solid transparent',
        }}
        onMouseEnter={e => {
          if (!isActive) {
            e.currentTarget.style.background = getBackground(true);
            e.currentTarget.style.color = '#d4d4d4';
          }
        }}
        onMouseLeave={e => {
          if (!isActive) {
            e.currentTarget.style.background = getBackground(false);
            e.currentTarget.style.color = '#a1a1aa';
          }
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          width: 16, 
          height: 16, 
          flexShrink: 0,
          color: '#666'
        }}>
          {isFolder && <ChevronRightIcon expanded={expanded} />}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', color: isFolder ? '#eab308' : '#60a5fa' }}>
          {isFolder ? <FolderIcon /> : <FileIcon type={item.type} />}
        </div>
        
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </span>

        {/* Agent access indicator */}
        {hasAgentAccess && (
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              fontSize: 10, 
              color: accessMode === 'write' ? '#f97316' : '#fb923c',
              opacity: 0.8,
              flexShrink: 0
            }}
            title={accessMode === 'write' ? 'Agent can read & write' : 'Agent can read only'}
          >
            {accessMode === 'write' ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div>
          {loading ? (
            <div style={{ paddingLeft: paddingLeft + 22, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12 }}>
              Loading...
            </div>
          ) : children && children.length > 0 ? (
            children.map(child => (
              <TreeItem
                key={child.id}
                item={child}
                depth={depth + 1}
                currentPathIds={currentPathIds}
                activeId={activeId}
                onLoadChildren={onLoadChildren}
                onNavigate={onNavigate}
                ancestors={[...ancestors, item.id]}
                agentResourceMap={agentResourceMap}
              />
            ))
          ) : (
            children && (
              <div style={{ paddingLeft: paddingLeft + 22, paddingTop: 4, paddingBottom: 4, color: '#666', fontSize: 12, fontStyle: 'italic' }}>
                Empty
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// === Main Component ===
export function ExplorerSidebar({ 
  currentPath, 
  onLoadChildren, 
  onNavigate,
  agentResources,
  className,
  style 
}: ExplorerSidebarProps) {
  const [rootItems, setRootItems] = useState<MillerColumnItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Load root items
  useEffect(() => {
    setLoading(true);
    onLoadChildren(null)
      .then(items => setRootItems(items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const currentPathIds = new Set(currentPath.map(p => p.id));
  const activeId = currentPath.length > 0 ? currentPath[currentPath.length - 1].id : null;

  // Create a map for quick agent resource lookup
  const agentResourceMap = new Map<string, AgentResource>();
  if (agentResources) {
    for (const r of agentResources) {
      agentResourceMap.set(r.nodeId, r);
    }
  }

  return (
    <div className={className} style={{ ...style, overflow: 'auto' }}>
      <div style={{ padding: '8px 0' }}>
        <div style={{ 
          padding: '0 16px 8px 16px', 
          fontSize: 11, 
          fontWeight: 600, 
          color: '#666', 
          textTransform: 'uppercase', 
          letterSpacing: '0.05em' 
        }}>
          Explorer
        </div>
        
        {loading ? (
          <div style={{ padding: '0 16px', color: '#666', fontSize: 13 }}>Loading...</div>
        ) : (
          rootItems.map(item => (
            <TreeItem
              key={item.id}
              item={item}
              depth={0}
              currentPathIds={currentPathIds}
              activeId={activeId}
              onLoadChildren={onLoadChildren}
              onNavigate={(item, ancestors) => onNavigate(item, ancestors)}
              ancestors={[]}
              agentResourceMap={agentResourceMap}
            />
          ))
        )}
      </div>
    </div>
  );
}

