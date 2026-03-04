'use client';

import React from 'react';

interface PanelShellProps {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function PanelShell({ title, icon, onClose, onBack, headerRight, children }: PanelShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        height: 40, minHeight: 40, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer',
              padding: '2px 4px', fontSize: 13, display: 'flex', alignItems: 'center',
              borderRadius: 4, transition: 'color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e4e4e7'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#a1a1aa'; }}
          >
            ←
          </button>
        )}
        {icon && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {headerRight}
        <button
          onClick={onClose}
          title="Close panel"
          style={{
            background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
            padding: '4px 6px', fontSize: 16, lineHeight: 1, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e4e4e7'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}
