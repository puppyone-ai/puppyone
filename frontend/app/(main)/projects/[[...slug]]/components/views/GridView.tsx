'use client';

import { useState } from 'react';
import { ContentType } from '../finder/items';
import { ItemActionMenu } from './ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, getSyncSource, LockIcon } from '@/lib/nodeTypeConfig';

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

// GitHub Repo 专用图标 - 代码仓库样式
// const GithubRepoIconLarge = ({ color = '#6366f1' }: { color?: string }) => (
//   <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
//     ...
//   </svg>
// );

// 带 Logo 的通用图标 (支持 Folder, Markdown, Json)
// 只显示 Logo，不显示文字（文字标签移到名称下方）
const BrandedIcon = ({ 
  BaseIcon,
  BadgeIcon,
  color = '#a1a1aa',
  badgeSize = 20
}: { 
  BaseIcon: React.ElementType;
  BadgeIcon?: React.ElementType;
  color?: string;
  badgeSize?: number;
}) => (
  <div style={{ position: 'relative', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {/* 底层图标 - 降低透明度作为背景轮廓 */}
    <div style={{ opacity: 0.4 }}>
      <BaseIcon color={color} />
    </div>
    
    {/* 顶层 Logo - 无背景，浅色，带柔和发光 */}
    {BadgeIcon && (
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#e4e4e7',
        filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.25)) drop-shadow(0 2px 3px rgba(0,0,0,0.5))',
        zIndex: 10,
      }}>
        <BadgeIcon size={badgeSize} />
      </div>
    )}
  </div>
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
  sync_url?: string | null;
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
  onRefresh?: (id: string) => void;
  loading?: boolean;
  agentResources?: AgentResource[];
}

function GridItem({
  item,
  agentResource,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
}: {
  item: GridViewItem;
  agentResource?: AgentResource;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Check if this item has agent access
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  // Get type config for synced items
  const typeConfig = getNodeTypeConfig(item.type);
  const isSynced = item.is_synced || isSyncedType(item.type);
  const BadgeIcon = typeConfig.badgeIcon;
  const syncSource = getSyncSource(item.type);
  
  // 格式化来源名称
  const formatSourceName = (source: string | null) => {
    if (!source) return null;
    const names: Record<string, string> = {
      'github': 'GitHub',
      'notion': 'Notion',
      'airtable': 'Airtable',
      'linear': 'Linear',
      'sheets': 'Sheets',
    };
    return names[source] || source;
  };

  // Get icon and color based on type
  const getTypeIcon = () => {
    const config = getNodeTypeConfig(item.type);
    
    // 对于所有同步类型 (GitHub Repo, Notion Page/Database, Airtable, etc.)
    // 都使用 "图标 + Logo + 标签" 的 Branded 样式
    if (isSyncedType(item.type) || item.is_synced) {
      // 确定基础图标
      let BaseIcon = JsonIconLarge;
      if (item.type === 'github_repo' || item.type === 'notion_database' || config.renderAs === 'folder') {
        BaseIcon = FolderIconLarge;
      } else if (config.renderAs === 'markdown') {
        BaseIcon = MarkdownIconLarge;
      }

      // 统一使用中性灰色作为底层图标颜色（和普通文件夹一致）
      const neutralColor = hovered ? '#a1a1aa' : '#71717a';

      return (
        <BrandedIcon 
          BaseIcon={BaseIcon} 
          BadgeIcon={config.badgeIcon}
          color={neutralColor} 
        />
      );
    }
    
    // 普通类型（非同步）使用各自的颜色
    const iconColor = hovered ? '#e4e4e7' : config.color;
    switch (config.renderAs) {
      case 'folder': return <FolderIconLarge color={hovered ? '#a1a1aa' : '#71717a'} />;
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
        transition: 'background 0.15s', // 只对背景色过渡，outline (权限框) 瞬时切换
        position: 'relative',
        // 使用 outline 不影响内部布局，橙色系
        outline: hasAgentAccess ? '2px solid rgba(249, 115, 22, 0.5)' : 'none',
        outlineOffset: -2,
      }}
    >
      {/* 图标区域 */}
      <div 
        style={{ 
          flex: 1,
          display: 'flex', 
          alignItems: 'flex-end', // 图标靠下，给标题留更多空间
          justifyContent: 'center',
          position: 'relative',
          minHeight: 0,
          paddingBottom: 10, // 增加与标题的间距
        }}
      >
        {/* 图标 */}
        <div style={{ position: 'relative' }}>
          {getTypeIcon()}
          
          {/* Source Badge - 右下角角标 (仅非同步类型或无中心Logo时显示，防止重复) */}
          {syncSource && BadgeIcon && !isSynced && (
            <div
              style={{
                position: 'absolute',
                bottom: -8,
                right: -8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32, // 增大尺寸到 32px
                height: 32,
                background: '#27272a',
                border: '3px solid #18181b', // 加粗边框，增加隔离感
                borderRadius: 8, // 稍微加大圆角
                color: '#e4e4e7',
                boxShadow: '0 4px 8px rgba(0,0,0,0.4)',
                zIndex: 10,
              }}
              title={`Source: ${formatSourceName(syncSource)}`}
            >
              <BadgeIcon size={20} /> {/* 图标增大到 20px */}
            </div>
          )}
        </div>
        
        {/* Action Menu - 右上角 */}
        {(onRename || onDelete || onDuplicate || (isSynced && onRefresh)) && (
          <div style={{ position: 'absolute', top: 4, right: 4 }}>
            <ItemActionMenu
              itemId={item.id}
              itemName={item.name}
              itemType={item.type}
              onRename={onRename}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onRefresh={isSynced ? onRefresh : undefined}
              syncUrl={item.sync_url}
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

        {/* Agent Access Badge - 左上角 */}
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

      {/* Name - 底部区域，固定高度保证两行 */}
      <div
        style={{
          flexShrink: 0,
          height: 40, // 固定高度，足够两行
          padding: '0 6px 6px 6px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        {/* 文件名 + 来源标签 */}
        <div
          style={{
            fontSize: 13,
            color: hovered ? '#fff' : '#a1a1aa',
            wordBreak: 'break-word',
            lineHeight: 1.35,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            textAlign: 'center',
          }}
        >
          {item.name}
          {/* 来源标签 - 紧跟在名字后面 */}
          {isSynced && syncSource && (
            <span style={{ color: '#52525b', fontSize: 11 }}> · {formatSourceName(syncSource)}</span>
          )}
        </div>
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
  onRefresh,
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
          onRefresh={onRefresh}
        />
      ))}

      {onCreateClick && (
        <CreateButton onClick={onCreateClick} />
      )}
    </div>
  );
}
