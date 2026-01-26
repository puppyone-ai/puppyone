'use client';

import { useState } from 'react';

export type ViewType = 'grid' | 'list' | 'column';

export interface ImageItemProps {
  viewType: ViewType;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  onClick: (e: React.MouseEvent) => void;
}

// === Icons ===

const ImageIconLarge = () => (
  <svg
    width='48'
    height='48'
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect
      x='3'
      y='3'
      width='18'
      height='18'
      rx='2'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.05'
    />
    <circle cx='8.5' cy='8.5' r='1.5' fill='currentColor' />
    <path
      d='M21 15L16 10L5 21'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const ImageIconSmall = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect
      x='3'
      y='3'
      width='18'
      height='18'
      rx='2'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.08'
    />
    <circle cx='8.5' cy='8.5' r='1.5' fill='currentColor' />
    <path d='M21 15L16 10L5 21' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

// === Grid View ===

function GridVariant({
  name,
  thumbnailUrl,
  onClick,
}: Omit<ImageItemProps, 'viewType'>) {
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
          width: 48,
          height: 48,
          borderRadius: 6,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#f472b6', // Pink for images
          background: thumbnailUrl ? 'transparent' : 'rgba(244, 114, 182, 0.1)',
        }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <ImageIconLarge />
        )}
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

function ListVariant({
  name,
  description,
  onClick,
}: Omit<ImageItemProps, 'viewType'>) {
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
          color: '#f472b6',
        }}
      >
        <ImageIconSmall />
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
      <div style={{ color: '#52525b', fontSize: 12 }}>Image</div>
    </div>
  );
}

// === Column View ===

function ColumnVariant({ name, onClick }: Omit<ImageItemProps, 'viewType'>) {
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
      <div style={{ color: '#f472b6' }}>
        <ImageIconSmall />
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

export function ImageItem({ viewType, ...props }: ImageItemProps) {
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
