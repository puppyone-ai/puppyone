'use client';

import { useState } from 'react';
import { ItemActionMenu } from '@/components/ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, getSyncSource, getSyncSourceIcon, LockIcon } from '@/lib/nodeTypeConfig';

// Content type definition
export type ContentType = 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file' | 'sync' | 'github_repo' | 'notion_page' | 'notion_database' | 'airtable_base' | 'linear_project' | 'google_sheets';

// --- Rich Icons (拟物化图标) ---

// 1. 文件夹 (使用外部 SVG)
const FolderIconLarge = () => (
  <img src="/icons/folder.svg" alt="Folder" width={64} height={64} style={{ display: 'block' }} />
);

// 通用文档背景 (Paper Base)
const DocBase = ({ children }: { children?: React.ReactNode }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    {/* 纸张阴影 */}
    <rect x="12" y="6" width="40" height="52" rx="3" fill="black" fillOpacity="0.3" transform="translate(2, 2)" />
    {/* 纸张主体 */}
    <rect x="12" y="6" width="40" height="52" rx="3" fill="#27272a" stroke="#3f3f46" strokeWidth="1" />
    {/* 内容区 */}
    {children}
  </svg>
);

// 2. JSON 文档图标 (使用外部 SVG)
const JsonIconLarge = () => (
  <img src="/icons/json-doc.svg" alt="JSON" width={64} height={64} style={{ display: 'block' }} />
);

// 3. Markdown 文档图标 (使用外部 SVG)
const MarkdownIconLarge = () => (
  <img src="/icons/markdown-doc.svg" alt="Markdown" width={64} height={64} style={{ display: 'block' }} />
);

// 4. File 图标 (纯 S3 存储的文件)
// 设计逻辑：与 JSON/Markdown 图标相同的文档外框，中间显示后缀名
const FileIconLarge = ({ ext }: { ext: string }) => (
  <div style={{ position: 'relative', width: 64, height: 64 }}>
    {/* 文档外框 - 与 json-doc.svg 相同的样式 */}
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      {/* 文档主体 */}
      <path 
        d="M12 8C12 5.79086 13.7909 4 16 4H40L52 16V56C52 58.2091 50.2091 60 48 60H16C13.7909 60 12 58.2091 12 56V8Z" 
        fill="#27272A" 
        stroke="#3F3F46" 
        strokeWidth="2"
      />
      {/* 折角 */}
      <path 
        d="M40 4V16H52" 
        stroke="#3F3F46" 
        strokeWidth="2" 
        strokeLinejoin="round"
      />
    </svg>
    
    {/* 中心显示后缀名 */}
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 6,
    }}>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#71717a',
        fontFamily: 'monospace',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
      }}>
        {ext}
      </span>
    </div>
  </div>
);

// 5. 网格背景 (Grid Base) - 用于 Sheets
const GridBase = ({ children }: { children?: React.ReactNode }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    {/* 纸张阴影 */}
    <rect x="12" y="6" width="40" height="52" rx="3" fill="black" fillOpacity="0.3" transform="translate(2, 2)" />
    {/* 纸张主体 */}
    <rect x="12" y="6" width="40" height="52" rx="3" fill="#27272a" stroke="#3f3f46" strokeWidth="1" />
    
    {/* 极简网格线 - 降低透明度，减少视觉噪音 */}
    <path d="M12 22H52" stroke="#3f3f46" strokeWidth="1" strokeOpacity="0.4" />
    <path d="M12 36H52" stroke="#3f3f46" strokeWidth="1" strokeOpacity="0.4" />
    <path d="M12 50H52" stroke="#3f3f46" strokeWidth="1" strokeOpacity="0.4" />
    <path d="M32 6V58" stroke="#3f3f46" strokeWidth="1" strokeOpacity="0.4" />

    {children}
  </svg>
);

// 5. Branded Doc - JSON 图标 + 右下角来源 Logo
const BrandedIcon = ({ 
  BadgeIcon,
  type,
  badgeSize = 20,
  showWarning = false,
}: { 
  BadgeIcon?: React.ElementType;
  type: string;
  badgeSize?: number;
  showWarning?: boolean;
}) => {
  return (
    <div style={{ position: 'relative', width: 64, height: 64 }}>
      {/* 
        底板：使用 JSON 图标显示数据格式
        如果是 placeholder，应用灰度，表示"文件未生成"
      */}
      <img 
        src="/icons/json-doc.svg" 
        alt="Data" 
        width={64} 
        height={64} 
        style={{ 
          display: 'block',
          filter: showWarning ? 'grayscale(100%) opacity(0.5)' : 'none',
          transition: 'all 0.3s ease'
        }} 
      />
      
      {/* 右下角来源 Logo - 保持原色，方便识别 */}
      {BadgeIcon && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          right: -2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#e4e4e7',
          // 如果是 placeholder，稍微降低一点透明度，不那么"跳"，但保留颜色
          opacity: showWarning ? 0.8 : 1,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
          zIndex: 10,
          transition: 'opacity 0.3s ease'
        }}>
          <BadgeIcon size={badgeSize} />
        </div>
      )}

      {/* 警告徽章 - 独立于主体，鲜艳突出 */}
      {showWarning && BadgeIcon && (
        <div style={{
          position: 'absolute',
          bottom: 12,
          right: -4,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#f59e0b',
          border: '2px solid #18181b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          animation: 'pulse-badge 2s infinite'
        }}>
          <span style={{ 
            color: '#000', 
            fontSize: 10, 
            fontWeight: 800,
            lineHeight: 1,
            marginBottom: 1 
          }}>!</span>
        </div>
      )}
      <style jsx>{`
        @keyframes pulse-badge {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

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
  sync_source?: string | null;  // 来源（github, notion, gmail 等）
  source?: string | null;        // 数据库 source 字段
  sync_status?: 'not_connected' | 'idle' | 'syncing' | 'error';
  last_synced_at?: string | null;
}

export interface GridViewProps {
  items: GridViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onCreateTool?: (id: string, name: string, type: string) => void;
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
  onCreateTool,
}: {
  item: GridViewItem;
  agentResource?: AgentResource;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onCreateTool?: (id: string, name: string, type: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Check if this item has agent access
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  // Get type config for synced items
  const typeConfig = getNodeTypeConfig(item.type, item.preview_type);
  // 判断是否为同步类型：新架构使用 type === 'sync' 或 is_synced 字段
  const isSynced = item.is_synced || item.type === 'sync' || isSyncedType(item.type);
  // 从 source 或 sync_source 获取来源，用于显示 Logo
  const syncSource = item.source || item.sync_source || getSyncSource(item.type);
  // 根据 source 获取对应的 Logo 图标
  const BadgeIcon = getSyncSourceIcon(syncSource) || typeConfig.badgeIcon;
  const isPlaceholder = item.sync_status === 'not_connected';
  
  // 格式化来源名称
  const formatSourceName = (source: string | null) => {
    if (!source) return null;
    const names: Record<string, string> = {
      'github': 'GitHub',
      'notion': 'Notion',
      'airtable': 'Airtable',
      'linear': 'Linear',
      'sheets': 'Sheets',
      'gmail': 'Gmail',
      'drive': 'Drive',
      'calendar': 'Calendar',
      'docs': 'Docs',
    };
    return names[source] || source;
  };

  // Get icon and color based on type
  const getTypeIcon = () => {
    const config = getNodeTypeConfig(item.type, item.preview_type);
    
    // 对于所有同步类型 (GitHub Repo, Notion Page/Database, Airtable, etc.)
    // 使用拟物化的 "文档 + Logo"
    if (isSynced) {
      return (
        <BrandedIcon 
          BadgeIcon={BadgeIcon}
          type={item.type} // 传入类型以决定底板
          showWarning={isPlaceholder} // 如果是占位符，显示警告
        />
      );
    }
    
    // 普通类型（非同步）使用拟物化图标
    switch (config.renderAs) {
      case 'folder': return <FolderIconLarge />;
      case 'markdown': return <MarkdownIconLarge />;
      case 'file':
      case 'image': 
        // 提取文件后缀名 (最多显示4个字符)
        const ext = item.name.split('.').pop()?.slice(0, 4) || 'FILE';
        return <FileIconLarge ext={ext} />;
      default: return <JsonIconLarge />;
    }
  };

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
        flexDirection: 'column',
        alignItems: 'center', // 整体水平居中
        justifyContent: 'center', // 整体垂直居中 (Finder 风格)
        width: 120,
        height: 120,
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
        position: 'relative',
        outline: hasAgentAccess 
            ? '2px solid rgba(249, 115, 22, 0.5)' 
            : 'none',
        outlineOffset: -2,
        // 移除 opacity 控制，由 BrandedIcon 内部处理视觉状态
        opacity: 1, 
        gap: 8, // 图标和文字的间距
        padding: 8,
      }}
    >
      {/* 图标区域 */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} title={isPlaceholder ? "Click to connect" : undefined}>
        {getTypeIcon()}
      </div>
      
      {/* Action Menu - 右上角 (absolute 定位相对于 GridItem) */}
      {(onRename || onDelete || onDuplicate || onCreateTool || (isSynced && onRefresh)) && !isPlaceholder && (
        <div style={{ position: 'absolute', top: 4, right: 4 }}>
          <ItemActionMenu
            itemId={item.id}
            itemName={item.name}
            itemType={item.type}
            onRename={onRename}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onRefresh={isSynced ? onRefresh : undefined}
            onCreateTool={onCreateTool}
            syncUrl={item.sync_url}
            visible={hovered}
          />
        </div>
      )}

      {/* Read-only Lock Icon - 右上角 */}
      {typeConfig.isReadOnly && !isPlaceholder && (
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

      {/* Name - 紧贴图标下方 */}
      <div
        style={{
          fontSize: 13,
          color: hovered ? '#fff' : '#a1a1aa',
          wordBreak: 'break-word',
          lineHeight: 1.3,
          maxHeight: 34, // 限制高度，最多两行
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          textAlign: 'center',
          transition: 'color 0.15s',
          width: '100%',
          padding: '0 4px',
        }}
      >
        {item.name}
        {/* 来源标签 - 紧跟在名字后面 */}
        {isSynced && syncSource && !isPlaceholder && (
          <span style={{ color: '#52525b', fontSize: 11 }}> · {formatSourceName(syncSource)}</span>
        )}
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
  onCreateTool,
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
          onCreateTool={onCreateTool}
        />
      ))}

      {onCreateClick && (
        <CreateButton onClick={onCreateClick} />
      )}
    </div>
  );
}
