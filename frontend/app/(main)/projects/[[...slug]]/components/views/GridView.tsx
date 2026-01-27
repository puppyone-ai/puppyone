'use client';

import { useState } from 'react';
import { ContentType } from '../finder/items';
import type { Tool } from '@/lib/mcpApi';

// Icons
const PawIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="14" height="11" viewBox="0 0 33 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.00824" transform="rotate(26.6366 27.9463 11.0849)" fill={color} />
    <ellipse cx="21.2389" cy="5.4036" rx="3.49034" ry="4.00826" transform="rotate(9.17161 21.2389 5.4036)" fill={color} />
    <ellipse cx="12.3032" cy="5.36893" rx="3.5075" ry="4.00823" transform="rotate(-9.17161 12.3032 5.36893)" fill={color} />
    <ellipse cx="5.54689" cy="10.6915" rx="3.5075" ry="4.00823" transform="rotate(-26.1921 5.54689 10.6915)" fill={color} />
    <path d="M23.0469 15.6875C25.0899 18.8127 25.0469 22.2809 23.0469 24.1875C19.5 27.5625 13.5 27.5625 10 24.1875C8.02148 22.2246 8.04694 18.8127 10 15.6875C12.0469 12.4062 13.5 11.1875 16.5469 11.1875C19.5938 11.1875 21.0039 12.5623 23.0469 15.6875Z" fill={color} />
  </svg>
);

const BashIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

// Type icons
const FolderIconLarge = ({ color = '#a1a1aa' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill={color} fillOpacity="0.1" stroke={color} strokeWidth="1.5" />
  </svg>
);

const JsonIconLarge = ({ color = '#34d399' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.08" />
    <path d="M3 9H21" stroke={color} strokeWidth="1.5" />
    <path d="M9 3V21" stroke={color} strokeWidth="1.5" />
  </svg>
);

const MarkdownIconLarge = ({ color = '#60a5fa' }: { color?: string }) => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.08" />
    <path d="M14 2V8H20" stroke={color} strokeWidth="1.5" />
  </svg>
);

const CreateIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 5V19M5 12H19" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface GridViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  thumbnailUrl?: string;
  onClick: (e: React.MouseEvent) => void;
}

export interface GridViewProps {
  items: GridViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  createLabel?: string;
  loading?: boolean;
  existingTools?: Tool[];
  onAccessClick?: (item: GridViewItem, e: React.MouseEvent) => void;
}

function GridItem({
  item,
  existingTools,
  onAccessClick,
}: {
  item: GridViewItem;
  existingTools?: Tool[];
  onAccessClick?: (item: GridViewItem, e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [buttonHovered, setButtonHovered] = useState(false);

  // Check shell access status
  const hasShell = existingTools?.some(
    t => t.node_id === item.id && (t.type === 'shell_access' || t.type === 'shell_access_readonly')
  );

  // Get icon and color based on type
  const getTypeIcon = () => {
    const iconColor = hovered ? '#e4e4e7' : '#a1a1aa';
    switch (item.type) {
      case 'folder': return <FolderIconLarge color={iconColor} />;
      case 'markdown': return <MarkdownIconLarge color={hovered ? '#93c5fd' : '#60a5fa'} />;
      default: return <JsonIconLarge color={hovered ? '#6ee7b7' : '#34d399'} />;
    }
  };

  // 已配置：始终显示 | 未配置：hover 时显示
  const showButton = hasShell || hovered;

  return (
    <div
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 120,
        height: 136,
        padding: '12px 10px 10px 10px',
        gap: 8,
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {/* Top row: icon area with access button */}
      <div style={{ 
        width: '100%', 
        display: 'flex', 
        justifyContent: 'flex-end',
        height: 22,
        marginBottom: -8,
      }}>
        {/* Access button (小爪子 or Bash 图标) */}
        {onAccessClick && (
          <div
            style={{
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 5,
              cursor: 'pointer',
              opacity: showButton ? 1 : 0,
              transition: 'all 0.15s',
              background: hasShell
                ? buttonHovered
                  ? 'rgba(255, 167, 61, 0.3)'
                  : 'rgba(255, 167, 61, 0.2)'
                : buttonHovered
                  ? 'rgba(255, 255, 255, 0.12)'
                  : 'rgba(255, 255, 255, 0.06)',
              pointerEvents: showButton ? 'auto' : 'none',
            }}
            onMouseEnter={() => setButtonHovered(true)}
            onMouseLeave={() => setButtonHovered(false)}
            onClick={(e) => {
              e.stopPropagation();
              onAccessClick(item, e);
            }}
            title="Configure Agent Access"
          >
            {hasShell ? (
              // 已配置：显示 Bash 图标
              <BashIcon color={buttonHovered ? '#f97316' : '#ffa73d'} />
            ) : (
              // 未配置：显示小爪子
              <PawIcon color={buttonHovered ? '#d4d4d8' : '#6b7280'} />
            )}
          </div>
        )}
      </div>

      {/* Type icon */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        {getTypeIcon()}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: 13,
          color: hovered ? '#fff' : '#a1a1aa',
          textAlign: 'center',
          wordBreak: 'break-word',
          lineHeight: '1.4em',
          height: '2.8em',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          padding: '0 2px',
        }}
      >
        {item.name}
      </div>
    </div>
  );
}

function CreateButton({
  label,
  onClick,
}: {
  label: string;
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
        height: 136,
        padding: '12px 10px 10px 10px',
        gap: 8,
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px dashed',
        borderColor: hovered ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
        background: hovered ? 'rgba(255,255,255,0.02)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ color: hovered ? '#a1a1aa' : '#525252' }}>
        <CreateIcon />
      </div>
      <div style={{ fontSize: 12, color: hovered ? '#a1a1aa' : '#525252' }}>
        {label}
      </div>
    </div>
  );
}

export function GridView({
  items,
  onCreateClick,
  createLabel = 'New...',
  loading,
  existingTools,
  onAccessClick,
}: GridViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 16,
      }}
    >
      {items.map(item => (
        <GridItem
          key={item.id}
          item={item}
          existingTools={existingTools}
          onAccessClick={onAccessClick}
        />
      ))}

      {onCreateClick && (
        <CreateButton label={createLabel} onClick={onCreateClick} />
      )}
    </div>
  );
}
