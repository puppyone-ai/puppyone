'use client';

import type { EndpointEntry } from './types';

function ChainIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export function AccessPointsHeaderButton({
  entries,
  isOpen,
  onClick,
}: {
  entries: EndpointEntry[];
  isOpen: boolean;
  onClick: () => void;
}) {
  const count = entries.length;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Integrations"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 10px',
        borderRadius: 6,
        border: `1px solid ${isOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)'}`,
        background: isOpen ? '#2a2a2a' : '#242424',
        color: '#ededed',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#2a2a2a';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
      }}
      onMouseLeave={(e) => {
        if (!isOpen) {
          e.currentTarget.style.background = '#242424';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
        }
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          background: 'rgba(34,211,238,0.08)',
          color: isOpen ? '#a5f3fc' : '#67e8f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ChainIcon />
      </span>
      <span>Integrations</span>
      <span
        style={{
          minWidth: 18,
          height: 18,
          padding: '0 5px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.08)',
          color: '#a1a1aa',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {count}
      </span>
    </button>
  );
}
