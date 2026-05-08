'use client';

/**
 * SelectionActionBar — floats above the grid view while one or more
 * items are multi-selected.
 *
 * Anchored bottom-center so it doesn't fight with the per-item action
 * menu (top-right) or the breadcrumb (top). Bypasses the BottomBar
 * (view/editor switches) by sitting just above it.
 *
 * Visible only when ``count > 0``. The Esc / Delete hotkeys are wired
 * by the parent — this component is purely presentational.
 */

import { useEffect, useState } from 'react';

interface SelectionActionBarProps {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  /** Optional: when ``true``, the Delete button shows a spinner and
   *  is disabled. Lets the parent block double-submits while the
   *  bulk-delete request is in flight. */
  busy?: boolean;
  /** OS detection for the keyboard-shortcut hint. */
  shortcutHint?: string;
}

export function SelectionActionBar({
  count,
  onClear,
  onDelete,
  busy = false,
  shortcutHint,
}: SelectionActionBarProps) {
  // Animate in/out with a short delay so flicking selections on/off
  // doesn't strobe the bar. We mount immediately when count > 0 and
  // unmount after a short fade-out when it drops to 0.
  const [visible, setVisible] = useState(count > 0);
  useEffect(() => {
    if (count > 0) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 140);
    return () => clearTimeout(t);
  }, [count]);

  if (!visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px 8px 16px',
        background: '#1f1f22',
        border: '1px solid #2f2f33',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
        color: '#e5e5e7',
        fontSize: 13,
        fontWeight: 500,
        zIndex: 60,
        opacity: count > 0 ? 1 : 0,
        transition: 'opacity 140ms ease, transform 140ms ease',
        transform: count > 0
          ? 'translate(-50%, 0)'
          : 'translate(-50%, 6px)',
        pointerEvents: count > 0 ? 'auto' : 'none',
      }}
    >
      <span style={{ color: '#a1a1aa' }}>
        <span style={{ color: '#fafafa', fontWeight: 600 }}>{count}</span>
        {' '}
        selected
      </span>

      <span aria-hidden style={{ width: 1, height: 18, background: '#2f2f33' }} />

      <button
        type="button"
        onClick={onClear}
        title={shortcutHint ? `Clear selection (Esc)` : 'Clear selection'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 10px',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 7,
          color: '#a1a1aa',
          fontSize: 12.5,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 120ms ease, color 120ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#27272a';
          (e.currentTarget as HTMLButtonElement).style.color = '#e5e5e7';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = '#a1a1aa';
        }}
      >
        Clear
        <span style={{ opacity: 0.6, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>Esc</span>
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        title="Delete selected items (Delete)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 12px',
          background: busy ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.85)',
          border: '1px solid rgba(239, 68, 68, 0.55)',
          borderRadius: 7,
          color: '#fff',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
          transition: 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          if (busy) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'rgb(220, 38, 38)';
        }}
        onMouseLeave={(e) => {
          if (busy) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.85)';
        }}
      >
        {busy ? 'Deleting…' : 'Delete'}
        {!busy && (
          <span style={{ opacity: 0.7, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>⌫</span>
        )}
      </button>
    </div>
  );
}
