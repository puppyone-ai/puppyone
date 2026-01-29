'use client';

import { useState } from 'react';
import { ContentType } from '../finder/items';
import { ItemActionMenu } from './ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, LockIcon } from '@/lib/nodeTypeConfig';

// Type icons - 实色填充 + 保留线条语言
const FolderIconLarge = ({ color = '#a1a1aa' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.5" />
  </svg>
);

const JsonIconLarge = ({ color = '#34d399' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    {/* 背景填充 */}
    <rect x="3" y="3" width="18" height="18" rx="2" fill={color} fillOpacity="0.2" />
    {/* 网格线条 */}
    <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
    <path d="M3 9H21" stroke={color} strokeWidth="1.5" />
    <path d="M9 3V21" stroke={color} strokeWidth="1.5" />
  </svg>
);

const MarkdownIconLarge = ({ color = '#60a5fa' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    {/* 文档主体填充 */}
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill={color} fillOpacity="0.2" />
    {/* 文档边框 */}
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" fill="none" />
    {/* 折角 */}
    <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" />
  </svg>
);

const CreateIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 5V19M5 12H19" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Agent resource type for props
export interface AgentResource {
  nodeId: string;
  terminalReadonly: boolean;
}

export interface GridViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  thumbnailUrl?: string;
  onClick: (e: React.MouseEvent) => void;
  // 同步相关字段
  is_synced?: boolean;
  sync_source?: string | null;
  last_synced_at?: string | null;
}

export interface GridViewProps {
  items: GridViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  loading?: boolean;
  agentResources?: AgentResource[];
}

function GridItem({
  item,
  agentResource,
  onRename,
  onDelete,
  onDuplicate,
}: {
  item: GridViewItem;
  agentResource?: AgentResource;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Check if this item has agent access
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  // Get type config for synced items
  const typeConfig = getNodeTypeConfig(item.type);
  const isSynced = item.is_synced || isSyncedType(item.type);
  const BadgeIcon = typeConfig.badgeIcon;

  // Get icon and color based on type
  const getTypeIcon = () => {
    const config = getNodeTypeConfig(item.type);
    const iconColor = hovered ? '#e4e4e7' : config.color;
    switch (config.renderAs) {
      case 'folder': return <FolderIconLarge color={iconColor} />;
      case 'markdown': return <MarkdownIconLarge color={hovered ? '#93c5fd' : config.color} />;
      default: return <JsonIconLarge color={hovered ? '#6ee7b7' : config.color} />;
    }
  };

  return (
    <div
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={!typeConfig.isReadOnly}
      onDragStart={(e) => {
        if (typeConfig.isReadOnly) {
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
        flexDirection: 'column',
        width: 120,
        height: 120,
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
        position: 'relative',
        // 使用 outline 不影响内部布局，橙色系
        outline: hasAgentAccess ? '2px solid rgba(249, 115, 22, 0.5)' : 'none',
        outlineOffset: -2,
      }}
    >
      {/* 图标区域 - 占据主要空间，图标居中 */}
      <div 
        style={{ 
          flex: 1,
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          position: 'relative',
          minHeight: 0,
        }}
      >
        <div style={{ position: 'relative' }}>
          {getTypeIcon()}
          {/* Sync Badge (SaaS Logo) - 图标右下角 */}
          {BadgeIcon && (
            <div style={{
              position: 'absolute',
              bottom: -4,
              right: -6,
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
        
        {/* Action Menu - 右上角 (only for non-readonly) */}
        {(onRename || onDelete || onDuplicate) && !typeConfig.isReadOnly && (
          <div style={{ position: 'absolute', top: 4, right: 4 }}>
            <ItemActionMenu
              itemId={item.id}
              itemName={item.name}
              itemType={item.type}
              onRename={onRename}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              visible={hovered}
            />
          </div>
        )}

        {/* Read-only Lock Icon - 右上角 (for synced items) */}
        {typeConfig.isReadOnly && (
          <div style={{ 
            position: 'absolute', 
            top: 4, 
            right: 4,
            color: '#525252',
            display: 'flex',
            alignItems: 'center',
          }}>
            <LockIcon size={12} />
          </div>
        )}

        {/* Agent Access Badge - 相对于图标区域定位在左上角（如果有菜单的话） */}
        {hasAgentAccess && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              padding: '2px 6px',
              borderRadius: 3,
              background: accessMode === 'write' ? 'rgba(249, 115, 22, 0.2)' : 'rgba(100, 100, 100, 0.25)',
              fontSize: 10,
              fontWeight: 500,
              color: accessMode === 'write' ? '#fb923c' : '#a1a1aa',
            }}
          >
            {accessMode === 'write' ? 'Edit' : 'View'}
          </div>
        )}
      </div>

      {/* Name - 固定高度底部区域 */}
      <div
        style={{
          flexShrink: 0,
          padding: '0 6px 8px 6px',
          fontSize: 13,
          color: hovered ? '#fff' : '#a1a1aa',
          textAlign: 'center',
          wordBreak: 'break-word',
          lineHeight: '1.3em',
          height: '2.6em',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {item.name}
      </div>
    </div>
  );
}

function CreateButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 120,
        height: 120,
        cursor: 'pointer',
      }}
    >
      {/* 小圆角框 + 加号 */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          border: '1.5px dashed',
          borderColor: hovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hovered ? '#a1a1aa' : '#525252',
          transition: 'all 0.15s',
        }}
      >
        <CreateIcon />
      </div>
      <div style={{ 
        marginTop: 8,
        fontSize: 13, 
        color: hovered ? '#a1a1aa' : '#525252',
        transition: 'color 0.15s',
      }}>
        New
      </div>
    </div>
  );
}

export function GridView({
  items,
  onCreateClick,
  onRename,
  onDelete,
  onDuplicate,
  loading,
  agentResources,
}: GridViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  // Create a map for quick lookup
  const resourceMap = new Map(agentResources?.map(r => [r.nodeId, r]) ?? []);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        alignContent: 'flex-start',
      }}
    >
      {items.map(item => (
        <GridItem
          key={item.id}
          item={item}
          agentResource={resourceMap.get(item.id)}
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ))}

      {onCreateClick && (
        <CreateButton onClick={onCreateClick} />
      )}
    </div>
  );
}
