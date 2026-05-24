'use client';

import React, { useState } from 'react';
import { listFailedSyncRuns, retrySyncAccessPoint } from '@/lib/syncApi';
import { snoozeUntil } from '@/lib/needsActionSnooze';
import {
  registerKind,
  type FailedSyncItem,
  type NeedsActionRenderContext,
} from '@/lib/needsActionRegistry';
import { Dots } from '@/components/loading';

/**
 * Failed sync kind: a sync_run row with ``status='failed'``. Fills
 * PUP-5 gap G1 — sync jobs always existed in the connectors layer
 * but had no list endpoint exposed to the frontend.
 *
 * The row shows the access point name + provider; the detail pane
 * shows the captured ``error`` so the user can see what broke. The
 * primary action is "Retry" (POST resume on the access point); the
 * secondary is "Snooze 24h" (client-only — sync runs naturally clear
 * from the list as new successful runs arrive).
 */

const KIND_LABEL = 'Failed sync';
const ACCENT_VAR = 'var(--po-danger, #d14545)';

async function fetchItems(projectId: string): Promise<FailedSyncItem[]> {
  const rows = await listFailedSyncRuns(projectId);
  return rows.map<FailedSyncItem>((r) => ({
    kind: 'failed-sync',
    id: r.id,
    // Scope path on the row is the access-point's local path. Falls
    // back to the provider label so the row never renders blank when
    // a sync was configured without an explicit path.
    scope_path: r.access_point_path || `(${r.provider})`,
    created_at: r.started_at || r.finished_at || undefined,
    source: r,
  }));
}

function renderRow(item: FailedSyncItem, ctx: NeedsActionRenderContext): React.ReactNode {
  return <FailedSyncRow item={item} ctx={ctx} />;
}

function renderDetail(item: FailedSyncItem, ctx: NeedsActionRenderContext): React.ReactNode {
  return <FailedSyncDetail item={item} ctx={ctx} />;
}

registerKind<FailedSyncItem>({
  kind: 'failed-sync',
  label: KIND_LABEL,
  description: 'Sync runs that failed and need a retry or fix',
  accentVar: ACCENT_VAR,
  fetchItems,
  refreshIntervalMs: 60_000,
  renderRow,
  renderDetail,
});

// ── Row ──────────────────────────────────────────────────────────────

function FailedSyncRow({
  item,
  ctx,
}: {
  item: FailedSyncItem;
  ctx: NeedsActionRenderContext;
}) {
  const apName = item.source.access_point_name || item.source.provider;
  return (
    <button
      type="button"
      onClick={ctx.onSelect}
      className={`group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        ctx.isSelected ? 'bg-[var(--po-selected)]' : 'hover:bg-[var(--po-hover)]'
      }`}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: ACCENT_VAR,
          flexShrink: 0,
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--po-text)]">
          {apName}
        </div>
        <div className="truncate text-[11px] text-[var(--po-text-subtle)]">
          {item.source.direction || 'sync'}
          {item.source.access_point_path ? ` · ${item.source.access_point_path}` : ''}
          {item.created_at ? ` · ${formatRelative(item.created_at)}` : ''}
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--po-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100">
        Retry
      </span>
    </button>
  );
}

// ── Detail ───────────────────────────────────────────────────────────

function FailedSyncDetail({
  item,
  ctx,
}: {
  item: FailedSyncItem;
  ctx: NeedsActionRenderContext;
}) {
  const [busy, setBusy] = useState<'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    setBusy('retry');
    setError(null);
    try {
      await retrySyncAccessPoint(item.source.access_point_id);
      // Resume returns immediately; the run kicks off async. Treat
      // this as "dismissed" — the row will reappear if the new run
      // also fails, and disappear when a successful run lands.
      ctx.onResolved({ reason: 'dismissed' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retry failed');
      setBusy(null);
    }
  };

  const handleSnooze = () => {
    snoozeUntil({ projectId: ctx.projectId, kind: 'failed-sync', id: item.id });
    ctx.onSnoozed();
  };

  const apName = item.source.access_point_name || item.source.provider;

  return (
    <div className="flex h-full flex-col">
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--po-divider)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            color: ACCENT_VAR,
            background: `color-mix(in srgb, ${ACCENT_VAR} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${ACCENT_VAR} 25%, transparent)`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT_VAR }} />
          {KIND_LABEL}
        </span>
        <span style={{ fontSize: 13, color: 'var(--po-text)' }}>{apName}</span>
        <span style={{ fontSize: 12, color: 'var(--po-text-subtle)' }}>
          #{item.id.slice(0, 8)}
        </span>
        {item.created_at && (
          <span style={{ fontSize: 12, color: 'var(--po-text-subtle)' }}>
            · {formatRelative(item.created_at)}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 20 }}>
        <section style={{ marginBottom: 18 }}>
          <h3 style={sectionTitleStyle}>Run details</h3>
          <ul style={kvListStyle}>
            <KV label="Provider" value={item.source.provider} />
            <KV label="Direction" value={item.source.direction} />
            {item.source.access_point_path && (
              <KV label="Path" value={item.source.access_point_path} mono />
            )}
            {item.source.started_at && (
              <KV label="Started" value={item.source.started_at} />
            )}
            {item.source.finished_at && (
              <KV label="Finished" value={item.source.finished_at} />
            )}
            {item.source.duration_ms != null && (
              <KV label="Duration" value={`${item.source.duration_ms} ms`} />
            )}
            {item.source.trigger_type && (
              <KV label="Trigger" value={item.source.trigger_type} />
            )}
          </ul>
        </section>

        {item.source.error && (
          <section style={{ marginBottom: 18 }}>
            <h3 style={sectionTitleStyle}>Error</h3>
            <pre
              style={{
                margin: 0,
                padding: 12,
                fontSize: 12,
                lineHeight: 1.5,
                background: 'var(--po-canvas-subtle)',
                color: 'var(--po-text)',
                border: '1px solid var(--po-divider)',
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {item.source.error}
            </pre>
          </section>
        )}

        {item.source.result_summary && (
          <section>
            <h3 style={sectionTitleStyle}>Result summary</h3>
            <div style={{ fontSize: 12, color: 'var(--po-text-muted)', whiteSpace: 'pre-wrap' }}>
              {item.source.result_summary}
            </div>
          </section>
        )}

        {error && (
          <div className="mt-3 text-[13px] text-[var(--po-danger)]" role="alert">
            {error}
          </div>
        )}
      </div>

      <footer
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--po-divider)',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
          background: 'var(--po-canvas)',
        }}
      >
        <button
          type="button"
          onClick={handleRetry}
          disabled={busy !== null}
          style={primaryButtonStyle(busy === 'retry')}
        >
          {busy === 'retry' ? <Dots size="xs" /> : null}
          {busy === 'retry' ? 'Retrying…' : 'Retry sync'}
        </button>
        <button
          type="button"
          onClick={handleSnooze}
          disabled={busy !== null}
          style={ghostButtonStyle(busy !== null)}
        >
          Snooze 24h
        </button>
      </footer>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--po-text-subtle)', minWidth: 90 }}>{label}</span>
      <span
        style={{
          color: 'var(--po-text)',
          fontFamily: mono ? 'var(--po-font-mono, ui-monospace, monospace)' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--po-text-subtle)',
  margin: '0 0 8px 0',
};

const kvListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--po-text)',
    color: 'var(--po-text-inverse)',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
}

function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 12px',
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'var(--po-text-subtle)',
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    marginLeft: 'auto',
  };
}
