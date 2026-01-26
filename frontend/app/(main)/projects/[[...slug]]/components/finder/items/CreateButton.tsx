'use client';

import { useState } from 'react';

export type ViewType = 'grid' | 'list' | 'column';

export interface CreateButtonProps {
  viewType: ViewType;
  label?: string;
  onClick: (e: React.MouseEvent) => void;
}

// === Icon ===

const PlusIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 6V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 12H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// === Grid View ===

function GridVariant({ label = 'New...', onClick }: Omit<CreateButtonProps, 'viewType'>) {
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
        background: 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          border: hovered
            ? '1px dashed rgba(255,255,255,0.3)'
            : '1px dashed rgba(255,255,255,0.15)',
          fontSize: 20,
          color: hovered ? '#fff' : '#52525b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
        }}
      >
        <PlusIcon />
      </div>
      <div
        style={{
          fontSize: 13,
          color: hovered ? '#a1a1aa' : '#52525b',
          textAlign: 'center',
          transition: 'color 0.15s',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// === List View ===

function ListVariant({ label = 'New...', onClick }: Omit<CreateButtonProps, 'viewType'>) {
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
          color: hovered ? '#a1a1aa' : '#52525b',
        }}
      >
        <PlusIcon />
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            color: hovered ? '#fff' : '#71717a',
            fontWeight: 500,
          }}
        >
          {label}
        </div>
      </div>
      <div style={{ color: '#3f3f46', fontSize: 12 }}>Action</div>
    </div>
  );
}

// === Column View ===

function ColumnVariant({ label = 'New...', onClick }: Omit<CreateButtonProps, 'viewType'>) {
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
        padding: '8px 12px',
        cursor: 'pointer',
        color: hovered ? '#a1a1aa' : '#52525b',
        fontSize: 13,
        marginTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.04)',
        transition: 'all 0.1s',
      }}
    >
      <PlusIcon size={14} />
      {label}
    </div>
  );
}

// === Main Export ===

export function CreateButton({ viewType, ...props }: CreateButtonProps) {
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

