'use client';

import { useState } from 'react';

export type ViewType = 'grid' | 'list' | 'column';

export interface MarkdownItemProps {
  viewType: ViewType;
  name: string;
  description?: string;
  onClick: (e: React.MouseEvent) => void;
}

// === Icons ===

const MarkdownIconLarge = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="currentColor"
      fillOpacity="0.05"
    />
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 13H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8 17H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const MarkdownIconSmall = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="currentColor"
      fillOpacity="0.08"
    />
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// === Grid View ===

function GridVariant({ name, onClick }: Omit<MarkdownItemProps, 'viewType'>) {
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
          color: '#60a5fa', // Blue for Markdown
          opacity: hovered ? 1 : 0.9,
          transition: 'all 0.15s',
        }}
      >
        <MarkdownIconLarge />
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

function ListVariant({ name, description, onClick }: Omit<MarkdownItemProps, 'viewType'>) {
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
          color: '#60a5fa',
        }}
      >
        <MarkdownIconSmall />
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
        {description && (
          <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ color: '#52525b', fontSize: 12 }}>Markdown</div>
    </div>
  );
}

// === Column View ===

function ColumnVariant({ name, onClick }: Omit<MarkdownItemProps, 'viewType'>) {
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
      <div style={{ color: '#60a5fa' }}>
        <MarkdownIconSmall />
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

export function MarkdownItem({ viewType, ...props }: MarkdownItemProps) {
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

