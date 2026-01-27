'use client';

import { useState } from 'react';
import type { ContentType } from '../finder/items';

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
}

// Icons
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.5"
    />
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
    <path
      d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="currentColor"
      fillOpacity="0.08"
    />
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
    case 'folder':
      return <FolderIcon />;
    case 'markdown':
      return <MarkdownIcon />;
    default:
      return <JsonIcon />;
  }
}

function getIconColor(type: ContentType) {
  switch (type) {
    case 'folder':
      return '#a1a1aa';
    case 'markdown':
      return '#60a5fa';
    default:
      return '#34d399';
  }
}

function ListItem({ item }: { item: ListViewItem }) {
  const [hovered, setHovered] = useState(false);
  const isFolder = item.type === 'folder';

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
        <ListItem key={item.id} item={item} />
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

