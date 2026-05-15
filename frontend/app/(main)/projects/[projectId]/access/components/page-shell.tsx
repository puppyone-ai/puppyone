'use client';

/**
 * Page shell components — chrome that wraps the master/detail body.
 *
 *   AccessHeader       : 46px top bar with title + count badge
 *   LoadingState       : full-area loader (delegates to PageLoading)
 *   NoConnectorsState  : empty-project CTA pointing at /data
 *
 * Co-located because they're all "page-level" framing concerns —
 * none of them need ConnectorCard / ScopeDetailPanel internals.
 */

import { PageLoading } from '@/components/loading';
import { CHROME_LABEL_TYPOGRAPHY } from '@/lib/uiTypography';
import { T } from '../lib/tokens';

// ─── Header ──────────────────────────────────────────────────────────

export function AccessHeader({ count }: { readonly count: number }) {
  return (
    <div
      style={{
        height: 46,
        minHeight: 46,
        borderBottom: '1px solid var(--po-active)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'var(--po-canvas)',
        flexShrink: 0,
        fontFamily: T.fontSans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...CHROME_LABEL_TYPOGRAPHY, color: T.text1 }}>Access</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: T.fontSans,
            padding: '1px 7px',
            borderRadius: 999,
            background: 'var(--po-border-subtle)',
            color: T.text2,
          }}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

// ─── Empty / loading states ──────────────────────────────────────────

export function LoadingState() {
  return <PageLoading variant="fill" />;
}

export function NoConnectorsState({ onCreateScope }: { readonly onCreateScope: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: T.text3,
        textAlign: 'center',
        padding: '0 32px',
        fontFamily: T.fontSans,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: T.text2 }}>No access points yet.</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 420, color: T.text3 }}>
        Access points let agents, CLIs, and third-party services read or write
        your workspace. Open the Data view to bind a folder as a scope and add
        your first integration.
      </div>
      <button
        type="button"
        onClick={onCreateScope}
        style={{
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 30,
          padding: '0 14px',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: T.fontSans,
          color: T.text2,
          background: 'transparent',
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--po-hover)';
          e.currentTarget.style.borderColor = 'var(--po-border-strong)';
          e.currentTarget.style.color = T.text1;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = T.border;
          e.currentTarget.style.color = T.text2;
        }}
      >
        Open Data view
      </button>
    </div>
  );
}
