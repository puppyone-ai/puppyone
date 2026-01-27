'use client';

import { useState } from 'react';

export type ViewType = 'grid' | 'list' | 'column';

export interface JsonItemProps {
  viewType: ViewType;
  name: string;
  description?: string;
  rowCount?: number;
  onClick: (e: React.MouseEvent) => void;
}

// === Icons (Table/JSON style) ===

const JsonIconLarge = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="currentColor"
      fillOpacity="0.05"
    />
    <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 15H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 3V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const JsonIconSmall = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
    <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 3V21" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// === Grid View ===

function GridVariant({ name, onClick }: Omit<JsonItemProps, 'viewType'>) {
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
          color: '#34d399', // Green for JSON/Context
          opacity: hovered ? 1 : 0.9,
          transition: 'all 0.15s',
        }}
      >
        <JsonIconLarge />
      </div>
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
        {name}
      </div>
    </div>
  );
}

// === List View ===

function ListVariant({ name, description, rowCount, onClick }: Omit<JsonItemProps, 'viewType'>) {
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
          color: '#34d399',
        }}
      >
        <JsonIconSmall />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: hovered ? '#fff' : '#d4d4d8',
            fontWeight: 500,
          }}
        >
          {name}
        </div>
        {(description || rowCount !== undefined) && (
          <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
            {description || `${rowCount} rows`}
          </div>
        )}
      </div>
      <div style={{ color: '#52525b', fontSize: 12 }}>Context</div>
    </div>
  );
}

// === Column View (Sidebar item) ===

function ColumnVariant({ name, onClick }: Omit<JsonItemProps, 'viewType'>) {
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
      <div style={{ color: '#34d399' }}>
        <JsonIconSmall />
      </div>
      <div
        style={{
          flex: 1,
          fontSize: 13,
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

export function JsonItem({ viewType, ...props }: JsonItemProps) {
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


