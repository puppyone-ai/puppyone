'use client';

import { useState } from 'react';

export type ViewType = 'grid' | 'list' | 'column';

export interface FolderItemProps {
  viewType: ViewType;
  name: string;
  description?: string;
  onClick: (e: React.MouseEvent) => void;
}

// === Icons ===

const FolderIconLarge = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
      fill="currentColor"
      fillOpacity="0.1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 9C2 7.89543 2.89543 7 4 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V9Z"
      fill="currentColor"
      fillOpacity="0.1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FolderIconSmall = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

// === Grid View ===

function GridVariant({ name, onClick }: Omit<FolderItemProps, 'viewType'>) {
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
        justifyContent: 'flex-start',
        width: 120,
        height: 136,
        padding: '22px 10px 10px 10px',
        gap: 10,
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <div
        style={{
          fontSize: 48,
          color: hovered ? '#e4e4e7' : '#a1a1aa',
          opacity: hovered ? 1 : 0.9,
          transition: 'all 0.15s',
        }}
      >
        <FolderIconLarge />
      </div>
      <div
        style={{
          fontSize: 16,
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
        {name}
      </div>
    </div>
  );
}

// === List View ===

function ListVariant({ name, description, onClick }: Omit<FolderItemProps, 'viewType'>) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        gap: 12,
        borderRadius: 6,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        transition: 'all 0.1s',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hovered ? '#e4e4e7' : '#a1a1aa',
        }}
      >
        <FolderIconSmall />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            color: hovered ? '#fff' : '#d4d4d8',
            fontWeight: 500,
          }}
        >
          {name}
        </div>
        {description && (
          <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ color: '#52525b', fontSize: 12 }}>Folder</div>
    </div>
  );
}

// === Column View (Sidebar item) ===

function ColumnVariant({ name, onClick }: Omit<FolderItemProps, 'viewType'>) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'all 0.1s',
      }}
    >
      <div style={{ color: hovered ? '#e4e4e7' : '#a1a1aa' }}>
        <FolderIconSmall />
      </div>
      <div
        style={{
          flex: 1,
          fontSize: 16,
          color: hovered ? '#fff' : '#d4d4d8',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
    </div>
  );
}

// === Main Export ===

export function FolderItem({ viewType, ...props }: FolderItemProps) {
  switch (viewType) {
    case 'grid':
      return <GridVariant {...props} />;
    case 'list':
      return <ListVariant {...props} />;
    case 'column':
      return <ColumnVariant {...props} />;
    default:
      return <GridVariant {...props} />;
  }
}


