'use client';

import { useState, useRef, useEffect } from 'react';
import { ItemActionMenu } from '@/components/ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, getSyncSource, getSyncSourceIcon, LockIcon } from '@/lib/nodeTypeConfig';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';

// Content type definition
export type ContentType = 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file' | 'sync' | 'github_repo' | 'notion_page' | 'notion_database' | 'airtable_base' | 'linear_project' | 'google_sheets';

// --- Finder-style Preview Icons ---

// Document shell: paper shape with fold corner, content area for preview
const DocShell = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ position: 'relative', width: 64, height: 72 }}>
    <svg width="64" height="72" viewBox="0 0 64 72" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
      {/* Shadow */}
      <path
        d="M10 6C10 4.89543 10.8954 4 12 4H43L57 18V69C57 70.1046 56.1046 71 55 71H12C10.8954 71 10 70.1046 10 69V6Z"
        fill="black" fillOpacity="0.25"
      />
      {/* Paper body */}
      <path
        d="M8 4C8 2.89543 8.89543 2 10 2H42L56 16V68C56 69.1046 55.1046 70 54 70H10C8.89543 70 8 69.1046 8 68V4Z"
        fill="#222225"
        stroke="#3a3a3d"
        strokeWidth="1"
      />
      {/* Fold corner */}
      <path d="M42 2V16H56" stroke="#3a3a3d" strokeWidth="1" strokeLinejoin="round" />
      <path d="M42 2V16H56L42 2Z" fill="#2a2a2d" />
    </svg>
    <div style={{
      position: 'absolute',
      top: 18,
      left: 12,
      right: 10,
      bottom: 6,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  </div>
);

// Folder icon with children count badge
const FolderIconLarge = ({ childrenCount }: { childrenCount?: number | null }) => (
  <div style={{ position: 'relative', width: 64, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img src="/icons/folder.svg" alt="Folder" width={64} height={64} style={{ display: 'block' }} />
    {childrenCount != null && childrenCount > 0 && (
      <div style={{
        position: 'absolute',
        bottom: 2,
        right: 0,
        background: '#3f3f46',
        border: '1px solid #52525b',
        borderRadius: 8,
        padding: '1px 5px',
        fontSize: 10,
        fontWeight: 600,
        color: '#a1a1aa',
        lineHeight: '14px',
        minWidth: 18,
        textAlign: 'center',
      }}>
        {childrenCount}
      </div>
    )}
  </div>
);

// Markdown preview: actual text content at tiny size
const MarkdownPreviewIcon = ({ snippet }: { snippet?: string | null }) => (
  <DocShell>
    {snippet ? (
      <div style={{
        fontSize: 5,
        lineHeight: 1.45,
        color: '#8a8a8e',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        height: '100%',
      }}>
        {snippet}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3.5, paddingTop: 1 }}>
        {[92, 58, 78, 48, 85, 62, 72, 52].map((w, i) => (
          <div key={i} style={{ height: 2, background: '#52525b', borderRadius: 1, width: `${w}%` }} />
        ))}
      </div>
    )}
  </DocShell>
);

// JSON preview: render actual content text (like Markdown), green monospace
const JsonPreviewIcon = ({ snippet }: { snippet?: string | null }) => (
  <DocShell>
    {snippet ? (
      <div style={{
        fontSize: 5,
        lineHeight: 1.5,
        color: '#6ee7b7',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        height: '100%',
      }}>
        {snippet}
      </div>
    ) : (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%',
        fontSize: 8, fontWeight: 600,
        color: '#3f6b56',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        letterSpacing: '0.5px',
      }}>
        {'{ }'}
      </div>
    )}
  </DocShell>
);

// File icon: document shell with extension in center
const FileIconLarge = ({ ext }: { ext: string }) => (
  <DocShell>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    }}>
      <span style={{
        fontSize: 12,
        fontWeight: 800,
        color: '#71717a',
        fontFamily: 'ui-monospace, monospace',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
      }}>
        {ext}
      </span>
    </div>
  </DocShell>
);

// Branded icon for synced sources (Notion, GitHub, etc.)
// Design principle: App logo centered + type badge (JSON/MD/folder) bottom-right
const UnifiedBrandedIcon = ({
  BadgeIcon,
  type,
  badgeSize = 32,
  showWarning = false,
  snippet,
  direction = 'inbound' as 'inbound' | 'outbound' | 'bidirectional',
}: {
  BadgeIcon?: React.ElementType;
  type: string;
  badgeSize?: number;
  showWarning?: boolean;
  snippet?: string | null;
  direction?: 'inbound' | 'outbound' | 'bidirectional';
}) => {
  const typeConfig = getNodeTypeConfig(type);

  const badgeLines = (snippet || '').split('\n').slice(0, 5);
  const truncated = (s: string, max: number) => s.length > max ? s.slice(0, max) : s;

  const isJson = typeConfig.renderAs !== 'markdown' && typeConfig.renderAs !== 'folder';
  const badgeColor = isJson ? '#6ee7b7' : '#8a8a8e';

  const DataBadge = () => (
    <svg width="30" height="36" viewBox="0 0 30 36" fill="none">
      <path d="M2 3C2 1.895 2.895 1 4 1H19L28 10V33C28 34.105 27.105 35 26 35H4C2.895 35 2 34.105 2 33V3Z" fill="#222225" stroke="#52525b" strokeWidth="1" />
      <path d="M19 1V10H28" stroke="#52525b" strokeWidth="1" strokeLinejoin="round" />
      <path d="M19 1V10H28L19 1Z" fill="#2a2a2d" />
      {badgeLines.length > 0 ? (
        <text x="4" y="14" fontSize="3.4" fill={badgeColor} fontFamily={isJson ? 'ui-monospace, monospace' : '-apple-system, sans-serif'}>
          {(isJson ? badgeLines : (snippet || '').split(/\s+/).reduce<string[]>((lines, word) => {
            const last = lines[lines.length - 1] || '';
            if (lines.length === 0 || last.length + word.length > 9) lines.push(word);
            else lines[lines.length - 1] = last + ' ' + word;
            return lines;
          }, [])).slice(0, 5).map((line, i) => (
            <tspan key={i} x="4" dy={i === 0 ? 0 : 4}>{truncated(line, 10)}</tspan>
          ))}
        </text>
      ) : (
        <g transform="translate(4, 13)">
          {[10, 17, 12, 15, 8].map((w, i) => (
            <rect key={i} y={i * 3.5} width={w} height="1.2" rx="0.4" fill={badgeColor} opacity={0.9 - i * 0.1} />
          ))}
        </g>
      )}
    </svg>
  );

  const FolderBadge = () => (
    <img src="/icons/folder.svg" alt="Folder" width={24} height={24} style={{ display: 'block', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }} />
  );

  const ConnectorArrow = () => {
    const color = '#71717a';
    const elbowPath = 'M 16 30 L 16 42 Q 16 46, 20 46 L 32 46';
    const elbowPathReversed = 'M 32 46 L 20 46 Q 16 46, 16 42 L 16 30';
    return (
      <svg
        width="64" height="64" viewBox="0 0 64 64" fill="none"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
      >
        <defs>
          <marker id="arr-r" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L0,5 L5,2.5 z" fill={color} />
          </marker>
          <marker id="arr-u" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L0,5 L5,2.5 z" fill={color} />
          </marker>
        </defs>

        {direction === 'inbound' && (
          <path d={elbowPath} stroke={color} strokeWidth="1.3" fill="none" markerEnd="url(#arr-r)" />
        )}

        {direction === 'outbound' && (
          <path d={elbowPathReversed} stroke={color} strokeWidth="1.3" fill="none" markerEnd="url(#arr-u)" />
        )}

        {direction === 'bidirectional' && (
          <>
            <path d={elbowPath} stroke={color} strokeWidth="1.3" fill="none" markerEnd="url(#arr-r)" />
            <path d={elbowPathReversed} stroke={color} strokeWidth="1.3" fill="none" markerEnd="url(#arr-u)" />
          </>
        )}
      </svg>
    );
  };

  return (
    <div style={{ position: 'relative', width: 64, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* 64x64 square content, vertically centered in 64x72 wrapper */}
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        {/* App Logo - top-left, max 28x28 */}
        <div style={{
          position: 'absolute',
          top: 2,
          left: 2,
          zIndex: 10,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
        }}>
          {BadgeIcon && (
            <div style={{ maxWidth: 28, maxHeight: 28 }}>
              <BadgeIcon size={28} />
            </div>
          )}
        </div>

        {/* Directional connector */}
        <ConnectorArrow />

        {/* Data badge - bottom-right, full size */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          zIndex: 10,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
        }}>
          {typeConfig.renderAs === 'folder' ? <FolderBadge /> : <DataBadge />}
        </div>

        {/* Warning indicator */}
        {showWarning && (
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#f59e0b',
          border: '2px solid #18181b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
        }}>
          <span style={{ color: '#000', fontSize: 10, fontWeight: 800 }}>!</span>
        </div>
      )}
      </div>
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
  type: ContentType;  // type 直接决定渲染方式
  description?: string;
  rowCount?: number;
  sync_url?: string | null;
  thumbnailUrl?: string;
  onClick: (e: React.MouseEvent) => void;
  // 同步相关字段
  is_synced?: boolean;
  sync_source?: string | null;  // 从 type 提取，如 github_repo → github
  sync_status?: 'not_connected' | 'idle' | 'syncing' | 'error';
  last_synced_at?: string | null;
  // Finder-style preview data
  preview_snippet?: string | null;
  children_count?: number | null;
}

export interface GridViewProps {
  items: GridViewItem[];
  parentFolderId?: string | null;
  onCreateClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onMove?: (id: string, name: string) => void;
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  onCreateTool?: (id: string, name: string, type: string) => void;
  loading?: boolean;
  agentResources?: AgentResource[];
  highlightNodeId?: string | null;
}

function GridItem({
  item,
  parentFolderId,
  agentResource,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  onMove,
  onMoveNode,
  onCreateTool,
  isHighlighted,
}: {
  item: GridViewItem;
  parentFolderId?: string | null;
  agentResource?: AgentResource;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  onMove?: (id: string, name: string) => void;
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  onCreateTool?: (id: string, name: string, type: string) => void;
  isHighlighted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const typeConfig = getNodeTypeConfig(item.type);
  const isFolder = typeConfig.renderAs === 'folder';
  const { isDropTarget, dropHandlers } = useNodeDrop({
    targetFolderId: item.id,
    onMoveNode,
    disabled: !isFolder,
  });

  useEffect(() => {
    if (isHighlighted && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isHighlighted]);

  // Check if this item has agent access
  const hasAgentAccess = !!agentResource;
  const accessMode = agentResource?.terminalReadonly ? 'read' : 'write';

  // 判断是否为同步类型
  const isSynced = item.is_synced || isSyncedType(item.type);
  // 从 sync_source 或 type 获取来源，用于显示 Logo
  const syncSource = item.sync_source || getSyncSource(item.type);
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

  const getTypeIcon = () => {
    if (isSynced) {
      return (
        <UnifiedBrandedIcon
          BadgeIcon={BadgeIcon}
          type={item.type}
          badgeSize={32}
          showWarning={isPlaceholder}
          snippet={item.preview_snippet}
        />
      );
    }

    switch (typeConfig.renderAs) {
      case 'folder':
        return <FolderIconLarge childrenCount={item.children_count} />;
      case 'markdown':
        return <MarkdownPreviewIcon snippet={item.preview_snippet} />;
      case 'file':
      case 'image': {
        const ext = item.name.split('.').pop()?.slice(0, 4) || 'FILE';
        return <FileIconLarge ext={ext} />;
      }
      default:
        return <JsonPreviewIcon snippet={item.preview_snippet} />;
    }
  };

  return (
    <div
      ref={itemRef}
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={!isPlaceholder}
      onDragStart={(e) => {
        if (isPlaceholder) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('application/x-puppyone-node', JSON.stringify({
          id: item.id,
          name: item.name,
          type: item.type,
          parentId: parentFolderId ?? null,
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      {...dropHandlers}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 112,
        height: 128,
        borderRadius: 8,
        cursor: 'pointer',
        background: isDropTarget ? 'rgba(59, 130, 246, 0.15)' : isHighlighted ? 'rgba(59, 130, 246, 0.12)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
        position: 'relative',
        outline: isDropTarget
            ? '2px solid rgba(59, 130, 246, 0.6)'
            : isHighlighted
            ? '2px solid rgba(59, 130, 246, 0.5)'
            : hasAgentAccess
            ? '2px solid rgba(249, 115, 22, 0.5)'
            : 'none',
        outlineOffset: -2,
        opacity: 1,
        gap: 4,
        padding: '6px 6px 8px',
        animation: isHighlighted ? 'gridItemHighlight 2s ease-out' : undefined,
      }}
    >
      {/* 图标区域 */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} title={isPlaceholder ? "Click to connect" : undefined}>
        {getTypeIcon()}
      </div>
      
      {/* Action Menu - 右上角 (absolute 定位相对于 GridItem) */}
      {(onRename || onDelete || onDuplicate || onMove || onCreateTool || (isSynced && onRefresh)) && !isPlaceholder && (
        <div style={{ position: 'absolute', top: 4, right: 4 }}>
          <ItemActionMenu
            itemId={item.id}
            itemName={item.name}
            itemType={item.type}
            onRename={onRename}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onMove={onMove}
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

      {/* Name */}
      <div
        style={{
          fontSize: 11,
          color: hovered ? '#e5e5e5' : '#a1a1aa',
          wordBreak: 'break-word',
          lineHeight: 1.3,
          maxHeight: 30,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          textAlign: 'center',
          transition: 'color 0.15s',
          width: '100%',
          padding: '0 2px',
        }}
      >
        {item.name}
        {isSynced && syncSource && !isPlaceholder && (
          <span style={{ color: '#52525b', fontSize: 10 }}> · {formatSourceName(syncSource)}</span>
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
        width: 112,
        height: 128,
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
  parentFolderId,
  onCreateClick,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  onMove,
  onMoveNode,
  onCreateTool,
  loading,
  agentResources,
  highlightNodeId,
}: GridViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  const resourceMap = new Map(agentResources?.map(r => [r.nodeId, r]) ?? []);

  return (
    <>
      <style>{`
        @keyframes gridItemHighlight {
          0% { background: rgba(59, 130, 246, 0.2); outline-color: rgba(59, 130, 246, 0.6); }
          100% { background: transparent; outline-color: transparent; }
        }
      `}</style>
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
            parentFolderId={parentFolderId}
            agentResource={resourceMap.get(item.id)}
            onRename={onRename}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onRefresh={onRefresh}
            onMove={onMove}
            onMoveNode={onMoveNode}
            onCreateTool={onCreateTool}
            isHighlighted={highlightNodeId === item.id}
          />
        ))}

        {onCreateClick && (
          <CreateButton onClick={onCreateClick} />
        )}
      </div>
    </>
  );
}
