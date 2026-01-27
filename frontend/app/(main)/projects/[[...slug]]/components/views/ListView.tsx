'use client';

import { useState } from 'react';
import type { ContentType } from '../finder/items';
import type { Tool } from '@/lib/mcpApi';

export interface ListViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  onClick: (e: React.MouseEvent) => void;
}

export interface ListViewProps {
  items: ListViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  createLabel?: string;
  loading?: boolean;
  existingTools?: Tool[];
  onAccessClick?: (item: ListViewItem, e: React.MouseEvent) => void;
}

// Icons
const PawIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="12" height="10" viewBox="0 0 33 26" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const ChevronRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function getIcon(type: ContentType) {
  switch (type) {
    case 'folder': return <FolderIcon />;
    case 'markdown': return <MarkdownIcon />;
    default: return <JsonIcon />;
  }
}

function getIconColor(type: ContentType) {
  switch (type) {
    case 'folder': return '#a1a1aa';
    case 'markdown': return '#60a5fa';
    default: return '#34d399';
  }
}

function ListItem({
  item,
  existingTools,
  onAccessClick,
}: {
  item: ListViewItem;
  existingTools?: Tool[];
  onAccessClick?: (item: ListViewItem, e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [buttonHovered, setButtonHovered] = useState(false);
  const isFolder = item.type === 'folder';

  // Check shell access status
  const hasShell = existingTools?.some(
    t => t.node_id === item.id && (t.type === 'shell_access' || t.type === 'shell_access_readonly')
  );

  // 已配置：始终显示 | 未配置：hover 时显示
  const showButton = hasShell || hovered;

  return (
    <div
      onClick={item.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        padding: '0 12px',
        gap: 10,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        transition: 'background 0.1s',
      }}
    >
      {/* Icon */}
      <div style={{ color: getIconColor(item.type), display: 'flex', alignItems: 'center' }}>
        {getIcon(item.type)}
      </div>

      {/* Name */}
      <div style={{
        flex: 1,
        fontSize: 13,
        color: hovered ? '#fff' : '#d4d4d8',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {item.name}
      </div>

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
  createLabel = 'New...',
  loading,
  existingTools,
  onAccessClick,
}: ListViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16, fontSize: 13 }}>Loading...</div>;
  }

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
          existingTools={existingTools}
          onAccessClick={onAccessClick}
        />
      ))}

      {items.length === 0 && (
        <div style={{
          padding: '24px 12px',
          color: '#666',
          fontSize: 13,
          textAlign: 'center',
        }}>
          No items yet
        </div>
      )}
    </div>
  );
}
