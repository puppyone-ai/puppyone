'use client';

import { useState } from 'react';
import type { ContentType, AgentResource } from './GridView';
import { ItemActionMenu } from '@/components/ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, LockIcon } from '@/lib/nodeTypeConfig';

export interface ListViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  onClick: (e: React.MouseEvent) => void;
  // 同步相关字段
  is_synced?: boolean;
  sync_source?: string | null;
  sync_url?: string | null;
  sync_status?: 'not_connected' | 'idle' | 'syncing' | 'error';
  last_synced_at?: string | null;
}

export interface ListViewProps {
  items: ListViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onCreateTool?: (id: string, name: string, type: string) => void;
  createLabel?: string;
  loading?: boolean;
  agentResources?: AgentResource[];
}

// Icons
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const JsonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
    <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 3V21" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const MarkdownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 13H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8 17H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Agent Access Tag
const AgentAccessTag = ({ mode }: { mode: 'read' | 'write' }) => (
  <div
    style={{
      padding: '2px 6px',
      borderRadius: 4,
      background: mode === 'write' ? 'rgba(249, 115, 22, 0.12)' : 'rgba(100, 100, 100, 0.15)',
      fontSize: 11,
      fontWeight: 500,
      color: mode === 'write' ? '#fb923c' : '#a1a1aa',
    }}
  >
    {mode === 'write' ? 'Edit' : 'View'}
  </div>
);

function getIcon(type: string, previewType?: string | null) {
  const config = getNodeTypeConfig(type, previewType);
  switch (config.renderAs) {
    case 'folder': return <FolderIcon />;
    case 'markdown': return <MarkdownIcon />;
    case 'file':
    case 'image': return <FileIcon />;
    default: return <JsonIcon />;
  }
}

function getIconColor(type: string, previewType?: string | null) {
  const config = getNodeTypeConfig(type, previewType);
  return config.color;
}

// Sync Status indicator (只显示 syncing/error，占位符不显示任何东西)
const SyncStatusIndicator = ({ status }: { status?: string }) => {
  if (!status || status === 'idle' || status === 'not_connected') return null;

  const configs: Record<string, { color: string; label: string }> = {
    'syncing': { color: '#3b82f6', label: 'Syncing...' },
    'error': { color: '#ef4444', label: 'Error' },
  };
  
  const config = configs[status];
  if (!config) return null;
  
  return (
    <span style={{
      marginLeft: 8,
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      background: `${config.color}20`,
      color: config.color,
    }}>
      {config.label}
    </span>
  );
};

function ListItem({
  item,
  agentResource,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  onCreateTool,
}: {
  item: ListViewItem;
  agentResource?: AgentResource;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onCreateTool?: (id: string, name: string, type: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  
  // Get type config - uses preview_type to decide rendering for OCR'd files
  const typeConfig = getNodeTypeConfig(item.type, item.preview_type);
  const isFolder = typeConfig.renderAs === 'folder';
  const BadgeIcon = typeConfig.badgeIcon;
  const isPlaceholder = item.sync_status === 'not_connected';

  // Check if this item has agent access
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  return (
    <div
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={!typeConfig.isReadOnly && !isPlaceholder}
      onDragStart={(e) => {
        if (typeConfig.isReadOnly || isPlaceholder) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('application/x-puppyone-node', JSON.stringify({
          id: item.id,
          name: item.name,
          type: item.type
        }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        padding: '0 12px',
        gap: 10,
        cursor: 'pointer',
        background: hasAgentAccess 
          ? hovered 
            ? 'rgba(249, 115, 22, 0.08)' 
            : 'rgba(249, 115, 22, 0.04)'
          : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        // 左边橙色边条表示 agent access
        borderLeft: hasAgentAccess 
            ? '3px solid rgba(249, 115, 22, 0.6)' 
            : '3px solid transparent',
        transition: 'all 0.15s',
        // 占位符：只用透明度，hover 时恢复
        opacity: isPlaceholder ? (hovered ? 1 : 0.45) : 1,
      }}
    >
      {/* Icon with Sync Badge */}
      <div style={{ 
        color: getIconColor(item.type), 
        display: 'flex', 
        alignItems: 'center',
        position: 'relative',
      }}>
        {getIcon(item.type, item.preview_type)}
        {/* Sync Badge (SaaS Logo) */}
        {BadgeIcon && (
          <div style={{
            position: 'absolute',
            bottom: -3,
            right: -5,
            background: '#18181b',
            borderRadius: 4,
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <BadgeIcon size={12} />
          </div>
        )}
      </div>

      {/* Name + Sync Status */}
      <div style={{
        flex: 1,
        fontSize: 14,
        color: hovered ? '#fff' : '#d4d4d8',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'flex',
        alignItems: 'center',
        transition: 'color 0.15s',
      }}>
        {item.name}
        <SyncStatusIndicator status={item.sync_status} />
      </div>

      {/* Action Menu (不显示给占位符) */}
      {!isPlaceholder && (onRename || onDelete || onDuplicate || onCreateTool || (isSyncedType(item.type) && onRefresh)) && (
        <ItemActionMenu
          itemId={item.id}
          itemName={item.name}
          itemType={item.type}
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onRefresh={isSyncedType(item.type) ? onRefresh : undefined}
          onCreateTool={onCreateTool}
          syncUrl={item.sync_url}
          visible={hovered}
          compact
        />
      )}

      {/* 占位符状态：小圆点提示 */}
      {isPlaceholder && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#ca8a04', // 土黄色
            flexShrink: 0,
          }}
          title="Click to connect"
        />
      )}

      {/* Read-only Lock Icon for synced items */}
      {typeConfig.isReadOnly && (
        <div style={{ 
          color: '#525252',
          display: 'flex',
          alignItems: 'center',
        }}>
          <LockIcon size={10} />
        </div>
      )}

      {/* Agent Access Tag */}
      {hasAgentAccess && <AgentAccessTag mode={accessMode} />}

      {/* Chevron for folders */}
      {isFolder && (
        <div style={{ color: '#525252', display: 'flex', alignItems: 'center' }}>
          <ChevronRightIcon />
        </div>
      )}
    </div>
  );
}

export function ListView({
  items,
  onCreateClick,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  onCreateTool,
  createLabel = 'New...',
  loading,
  agentResources,
}: ListViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16, fontSize: 13 }}>Loading...</div>;
  }

  // Create a map for quick lookup
  const resourceMap = new Map(agentResources?.map(r => [r.nodeId, r]) ?? []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        margin: 8,
        marginTop: 0,
        overflow: 'hidden',
      }}
    >
      {items.map(item => (
        <ListItem
          key={item.id}
          item={item}
          agentResource={resourceMap.get(item.id)}
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onRefresh={onRefresh}
          onCreateTool={onCreateTool}
        />
      ))}

      {items.length === 0 && (
        <div style={{
          padding: '24px 12px',
          color: '#666',
          fontSize: 14,
          textAlign: 'center',
        }}>
          No items yet
        </div>
      )}
    </div>
  );
}

