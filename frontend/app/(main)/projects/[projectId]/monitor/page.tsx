'use client';

/**
 * System Monitor — audit-log viewer.
 *
 * This page mirrors the audit_logs record shape. History owns the
 * commit/version story; Monitor should show what the audit table
 * recorded: action, operator, path, metadata, status, and raw detail.
 */

import React, { use, useState, useMemo, useCallback } from 'react';
import { get } from '@/lib/apiClient';
import { PulseGrid, PageLoading } from '@/components/loading';
import useSWR from 'swr';

interface AuditLogEntry {
  id: number;
  action: string;
  path: string | null;
  operator_type: string | null;
  operator_id: string | null;
  status?: string | null;
  strategy?: string | null;
  conflict_details?: string | null;
  metadata: any;
  created_at: string | null;
}

const T = {
  text1: 'var(--po-text)',
  text2: 'var(--po-text-muted)',
  text3: 'var(--po-text-disabled)',
  text4: 'var(--po-filetree-rail)',
  border: 'var(--po-border)',
  fontSans: 'var(--po-font-sans)',
  fontMono: 'var(--po-font-mono)',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/**
 * Day-bucket key for grouping rows under date separators.
 *
 * Returns a stable `YYYY-MM-DD` string per local-day so consecutive
 * rows in the same calendar day share the same key. We deliberately
 * key on the local day (not UTC) — when the user squints at a row at
 * "23:50" they're thinking in their wall clock; bucketing in UTC
 * would scatter "right before midnight local" rows under the next
 * day's heading and feel buggy.
 */
function dayBucketKey(iso: string): string {
  const d = new Date(iso);
  // toLocaleDateString with en-CA gives ISO-shaped YYYY-MM-DD locally.
  return d.toLocaleDateString('en-CA');
}

/**
 * Human-readable day heading for a `YYYY-MM-DD` bucket key.
 *
 * Today / Yesterday get word labels — that's the case 95% of the
 * triage flow lands in, and "Today" reads in 50ms vs the user
 * comparing "May 8" against today's date in their head. Anything
 * older falls back to a short month-day-year format that's
 * unambiguous regardless of locale defaults (the en-CA fallback
 * we used for keys would render as "2026-05-08" which is precise
 * but visually noisy for a heading row).
 */
function formatDayHeading(bucketKey: string): string {
  if (!bucketKey) return '';
  const today = dayBucketKey(new Date().toISOString());
  if (bucketKey === today) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (bucketKey === dayBucketKey(yesterday.toISOString())) return 'Yesterday';

  // bucketKey is "YYYY-MM-DD" → reconstruct a Date in local time.
  const [y, m, d] = bucketKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

type LogStatus = 'recorded' | 'ok' | 'error' | 'warn';

type UnifiedLog = {
  id: string;
  time: string;
  action: string;
  operatorType: string;
  operatorId: string;
  path: string;
  metadataSummary: string;
  statusLabel: string;
  status: LogStatus;
  raw: any;
};

const ACTION_COLORS: Record<string, string> = {
  clone: 'var(--po-success)',
  push: 'var(--po-accent)',
  pull: 'var(--po-file-accent-audio)',
  rollback: 'var(--po-warning)',
  write_file: 'var(--po-accent)',
  delete: 'var(--po-danger)',
  move: 'var(--po-file-accent-html)',
  copy: 'var(--po-file-accent-image)',
  mkdir: 'var(--po-success)',
  rmdir: 'var(--po-danger)',
  push_error: 'var(--po-danger)',
  push_rejected: 'var(--po-danger)',
  merge_conflict: 'var(--po-warning)',
  bash: 'var(--po-success)', tool: 'var(--po-accent)', llm: 'var(--po-file-accent-audio)',
};

const STATUS_STYLES: Record<LogStatus, { label: string; color: string; background: string; border: string }> = {
  recorded: {
    label: 'REC',
    color: 'var(--po-text-disabled)',
    background: 'var(--po-control)',
    border: 'var(--po-border-subtle)',
  },
  ok: {
    label: 'OK',
    color: 'var(--po-text-disabled)',
    background: 'var(--po-control)',
    border: 'var(--po-border-subtle)',
  },
  warn: {
    label: 'WARN',
    color: 'var(--po-warning)',
    background: 'color-mix(in srgb, var(--po-warning) 10%, transparent)',
    border: 'color-mix(in srgb, var(--po-warning) 32%, transparent)',
  },
  error: {
    label: 'ERROR',
    color: 'var(--po-danger)',
    background: 'color-mix(in srgb, var(--po-danger) 10%, transparent)',
    border: 'color-mix(in srgb, var(--po-danger) 32%, transparent)',
  },
};

// Single source of truth for the table grid template — header and rows
// both reference it or columns desync at fractional widths.
const COL_TEMPLATE = '92px minmax(130px, 0.6fr) minmax(230px, 0.95fr) minmax(220px, 0.9fr) minmax(300px, 1.25fr) 86px';
const ROW_HEIGHT = 38;
const DAY_HEADER_HEIGHT = 42;

function shortToken(value: unknown, head = 8, tail = 0): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= head + tail + 1) return raw;
  if (tail > 0) return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
  return `${raw.slice(0, head)}…`;
}

function auditStatus(entry: AuditLogEntry): LogStatus {
  const explicit = String(entry.status || '').toLowerCase();
  if (explicit.includes('error') || explicit.includes('failed') || explicit.includes('rejected')) return 'error';
  if (explicit.includes('warn') || explicit.includes('conflict')) return 'warn';
  if (entry.action.includes('error') || entry.action.includes('rejected')) return 'error';
  if (entry.action.includes('conflict') || entry.conflict_details) return 'warn';
  if (explicit.includes('ok') || explicit.includes('success')) return 'ok';
  return 'recorded';
}

function statusLabel(entry: AuditLogEntry, status: LogStatus): string {
  return entry.status || STATUS_STYLES[status].label;
}

function metadataSummary(metadata: any): string {
  if (!metadata || typeof metadata !== 'object') return '—';
  const entries = Object.entries(metadata);
  if (entries.length === 0) return '{}';
  return entries
    .slice(0, 4)
    .map(([key, value]) => {
      if (value == null) return `${key}=null`;
      if (Array.isArray(value)) return `${key}[${value.length}]`;
      if (typeof value === 'object') return `${key}{…}`;
      return `${key}=${shortToken(value, 16)}`;
    })
    .join(' · ');
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}


export default function MonitorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [refreshing, setRefreshing] = useState(false);
  // Filter only by the stored audit outcome. History owns commit/version
  // interpretation; this screen stays faithful to audit_logs rows.
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: auditData, mutate: mutateAudit } = useSWR<{ logs: AuditLogEntry[]; total: number }>(
    projectId ? `/api/v1/nodes/project-audit-logs?project_id=${projectId}&limit=200` : null,
    (url: string) => get(url),
    { refreshInterval: 15000 },
  );

  const isInitialLoading = auditData === undefined;

  const refreshLogs = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutateAudit();
    } finally {
      setRefreshing(false);
    }
  }, [mutateAudit]);

  const allLogs: UnifiedLog[] = useMemo(() => {
    const logs = (auditData?.logs || []).map(a => {
      const status = auditStatus(a);
      return {
        id: `audit-${a.id}`,
        time: a.created_at || '',
        action: a.action,
        operatorType: a.operator_type || 'system',
        operatorId: a.operator_id || '',
        path: a.path || '',
        metadataSummary: metadataSummary(a.metadata),
        statusLabel: statusLabel(a, status),
        status,
        raw: a,
      };
    });

    logs.sort((a, b) => (b.time ? new Date(b.time).getTime() : 0) - (a.time ? new Date(a.time).getTime() : 0));
    return logs;
  }, [auditData]);

  const filteredLogs = useMemo(() => {
    let list = allLogs;
    if (filter === 'errors') list = list.filter(l => l.status === 'error');
    if (filter === 'warnings') list = list.filter(l => l.status === 'warn');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l =>
        l.action.toLowerCase().includes(q)
        || l.operatorType.toLowerCase().includes(q)
        || l.operatorId.toLowerCase().includes(q)
        || l.path.toLowerCase().includes(q)
        || l.metadataSummary.toLowerCase().includes(q)
        || l.statusLabel.toLowerCase().includes(q));
    }
    return list;
  }, [allLogs, filter, searchQuery]);

  const selectedLog = selectedId ? allLogs.find(l => l.id === selectedId) : null;

  const errorCount = allLogs.filter(l => l.status === 'error').length;
  const warningCount = allLogs.filter(l => l.status === 'warn').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--po-canvas)' }}>

      {/* ── Page header ── */}
      {/*
        46px page header — same geometry as `/history`, `/access`,
        `/settings`, `/toolkit`. The earlier monitor surface ran
        directly into the toolbar (no title bar), so flipping between
        pages caused the content row to shift up by ~46px and the
        title was missing. Now Logs gets the same title-band as every
        other page; the Live indicator is hosted here on the right so
        the live-stream affordance stays visible without re-introducing
        a second band.
      */}
      <div style={{
        height: 46, minHeight: 46, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid var(--po-divider)',
        background: 'var(--po-canvas)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)', fontFamily: T.fontSans }}>
            Audit
          </span>
          <span style={{ fontSize: 12, color: 'var(--po-text-disabled)', fontFamily: T.fontSans }}>
            {allLogs.length} entr{allLogs.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: T.text3,
          fontFamily: T.fontMono, letterSpacing: '0.02em',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--po-success)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--po-success) 65%, transparent)',
            animation: `puppyone-monitor-pulse 1.6s ${T.ease} infinite`,
          }} />
          <span style={{ color: T.text2 }}>Live</span>
          <span style={{ color: T.text4 }}>·</span>
          <span>audit</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Toolbar — filter chips · search · refresh */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '8px 16px', borderBottom: '1px solid var(--po-border-subtle)',
          flexShrink: 0, gap: 12,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--po-panel-raised)', padding: 3, borderRadius: 6,
            border: '1px solid var(--po-border-subtle)',
            flexShrink: 0,
          }}>
            {([
              { key: 'all', label: 'All', count: allLogs.length, accent: 'var(--po-text)' },
              { key: 'errors', label: 'Errors', count: errorCount, accent: 'var(--po-danger)' },
              { key: 'warnings', label: 'Warnings', count: warningCount, accent: 'var(--po-warning)' },
            ] as const).map(f => {
              const isActive = filter === f.key;
              const hasItems = f.count > 0;
              // Status-keyed filters double as a tiny health-at-a-
              // glance signal: when Errors/Warnings have 0 entries we
              // dim the count chip to ~30%, when they have ≥1 we
              // use the corresponding tone (red / amber) so the row
              // becomes a live health indicator the user can scan
              // without clicking. The `All` tab always uses the
              // neutral foreground.
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    background: isActive ? 'var(--po-selected)' : 'transparent',
                    color: isActive ? 'var(--po-text)' : 'var(--po-text-subtle)',
                    border: 'none', borderRadius: 4, height: 30, padding: '0 10px', fontSize: 12,
                    fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontFamily: T.fontSans,
                  }}
                >
                  {f.label}{' '}
                  <span
                    style={{
                      opacity: hasItems ? 0.85 : 0.4,
                      color: hasItems ? f.accent : undefined,
                      fontFamily: T.fontMono,
                      fontSize: 11,
                    }}
                  >
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Spacer pushes search + refresh to the right edge. */}
          <div style={{ flex: 1 }} />

          <div style={{ position: 'relative', width: 220 }}>
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="var(--po-text-disabled)" strokeWidth="2"
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text" placeholder="Search audit..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', background: 'var(--po-panel-raised)',
                border: '1px solid var(--po-border-subtle)',
                borderRadius: 5, padding: '5px 8px 5px 28px',
                fontSize: 12, color: 'var(--po-text)', outline: 'none',
                fontFamily: T.fontSans,
              }}
            />
          </div>

          <button
            onClick={refreshLogs}
            disabled={refreshing}
            style={{
              background: 'transparent',
              border: '1px solid var(--po-border-subtle)',
              borderRadius: 5,
              color: refreshing ? 'var(--po-text-disabled)' : 'var(--po-text-muted)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (refreshing) return;
              e.currentTarget.style.background = 'var(--po-hover)';
              e.currentTarget.style.color = 'var(--po-text)';
            }}
            onMouseLeave={(e) => {
              if (refreshing) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--po-text-muted)';
            }}
            title="Refresh"
          >
            {refreshing ? (
              <PulseGrid size="xs" />
            ) : (
              <svg
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
          </button>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: COL_TEMPLATE,
          height: 28, alignItems: 'center',
          padding: '0 16px',
          borderBottom: `1px solid ${T.border}`,
          background: 'var(--po-panel)',
          fontSize: 9.5, fontWeight: 600,
          color: T.text3, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: T.fontSans,
          flexShrink: 0,
        }}>
          <div>Time</div>
          <div>Action</div>
          <div>Operator</div>
          <div>Path</div>
          <div>Metadata</div>
          <div style={{ textAlign: 'right' }}>Status</div>
        </div>

        {/* Table body */}
        {/*
          Date-grouped row stream. The group header is intentionally
          taller than a normal event row so dates read as section
          dividers, not another low-information row squeezed into the
          stream.
        */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {filteredLogs.length === 0 ? (
            isInitialLoading ? (
              <PageLoading variant="fill" />
            ) : (
              <div style={{
                padding: 60, textAlign: 'center', color: 'var(--po-text-disabled)', fontSize: 13,
                fontFamily: T.fontSans,
                display: 'flex', justifyContent: 'center',
              }}>
                No log entries found
              </div>
            )
          ) : (
            (() => {
              const elements: React.ReactNode[] = [];
              const dayCounts = new Map<string, number>();
              let lastBucket: string | null = null;

              filteredLogs.forEach(log => {
                const bucket = log.time ? dayBucketKey(log.time) : 'unknown';
                dayCounts.set(bucket, (dayCounts.get(bucket) || 0) + 1);
              });

              filteredLogs.forEach((log, i) => {
                const bucket = log.time ? dayBucketKey(log.time) : 'unknown';
                if (bucket !== lastBucket) {
                  const count = dayCounts.get(bucket) || 0;
                  elements.push(
                    <div
                      key={`day-${bucket}-${i}`}
                      style={{
                        position: 'sticky', top: 0, zIndex: 2,
                        height: DAY_HEADER_HEIGHT, padding: '0 16px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'var(--po-canvas)',
                        borderBottom: '1px solid var(--po-divider)',
                        borderTop: i === 0 ? 'none' : '1px solid var(--po-divider)',
                        fontSize: 12, fontWeight: 600,
                        letterSpacing: '0.04em',
                        color: T.text3,
                        fontFamily: T.fontSans,
                      }}
                    >
                      <span style={{ color: T.text2, textTransform: 'uppercase' }}>
                        {log.time ? formatDayHeading(bucket) : 'Unknown date'}
                      </span>
                      <span style={{
                        color: T.text3,
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: 0,
                      }}>
                        {count} entr{count === 1 ? 'y' : 'ies'}
                      </span>
                      <span
                        style={{
                          flex: 1, height: 1,
                          background: 'linear-gradient(to right, var(--po-divider), transparent)',
                        }}
                      />
                    </div>,
                  );
                  lastBucket = bucket;
                }

                const isSelected = log.id === selectedId;
                const actionColor = ACTION_COLORS[log.action] || 'var(--po-text-subtle)';
                const statusStyle = STATUS_STYLES[log.status];
                const dotColor = log.status === 'error' ? 'var(--po-danger)'
                  : log.status === 'warn' ? 'var(--po-warning)'
                  : actionColor;

                elements.push(
                  <div
                    key={log.id}
                    onClick={() => setSelectedId(isSelected ? null : log.id)}
                    style={{
                      display: 'grid', gridTemplateColumns: COL_TEMPLATE,
                      height: ROW_HEIGHT, alignItems: 'center',
                      padding: '0 16px',
                      borderBottom: '1px solid var(--po-divider)',
                      background: isSelected ? 'var(--po-selected)' : 'transparent',
                      cursor: 'pointer',
                      transition: `background 0.2s ${T.ease}`,
                      fontSize: 13, fontFamily: T.fontSans,
                    }}
                    onMouseEnter={e => {
                      if (isSelected) return;
                      e.currentTarget.style.background = 'var(--po-hover)';
                    }}
                    onMouseLeave={e => {
                      if (isSelected) return;
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{
                      color: T.text3, fontFamily: T.fontMono, fontSize: 11,
                      letterSpacing: '0.02em',
                    }}>
                      {log.time ? formatTimestamp(log.time) : '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: dotColor, flexShrink: 0,
                      }} />
                      <span style={{
                        color: T.text1, fontWeight: 500, fontSize: 12,
                        fontFamily: T.fontMono,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={log.action}>
                        {log.action}
                      </span>
                    </div>
                    <div style={{
                      color: T.text2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      minWidth: 0,
                      display: 'flex', alignItems: 'center', gap: 7,
                    }}
                    title={`${log.operatorType}${log.operatorId ? `:${log.operatorId}` : ''}`}>
                      <span style={{
                        color: T.text1,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {log.operatorType}
                      </span>
                      {log.operatorId && (
                        <span style={{
                          color: T.text3,
                          fontFamily: T.fontMono,
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}>
                          {log.operatorId}
                        </span>
                      )}
                    </div>
                    <div style={{
                      color: T.text2, fontFamily: T.fontMono, fontSize: 11.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      letterSpacing: '0.01em',
                    }}
                    title={log.path || '—'}>
                      {log.path || '—'}
                    </div>
                    <div style={{
                      color: T.text2, fontFamily: T.fontMono, fontSize: 11.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      letterSpacing: '0.01em',
                    }}
                    title={prettyJson(log.raw?.metadata)}>
                      {log.metadataSummary}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      minWidth: 0,
                      color: T.text4,
                      fontFamily: T.fontMono,
                      fontSize: 11,
                    }}>
                      <span style={{
                        minWidth: 42,
                        height: 20,
                        padding: '0 7px',
                        borderRadius: 999,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: statusStyle.color,
                        background: statusStyle.background,
                        border: `1px solid ${statusStyle.border}`,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                      }}>
                        {log.statusLabel}
                      </span>
                    </div>
                  </div>,
                );
              });

              return elements;
            })()
          )}
        </div>

        {/* Footer summary strip */}
        <div style={{
          height: 22,
          padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: `1px solid ${T.border}`,
          background: 'var(--po-control)',
          fontSize: 10, color: T.text3,
          fontFamily: T.fontMono, letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          <span>
            {auditData?.total ?? allLogs.length} audit row{(auditData?.total ?? allLogs.length) === 1 ? '' : 's'}
          </span>
          <span>audit_logs · sorted desc</span>
        </div>

        {/* Detail drawer: raw audit row, not a derived commit view. */}
        {selectedLog && (
          <div style={{
            borderTop: '1px solid var(--po-border-subtle)',
            background: 'var(--po-canvas)',
            maxHeight: 340, overflowY: 'auto', flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderBottom: '1px solid var(--po-hover)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: selectedLog.status === 'error' ? 'var(--po-danger)'
                    : selectedLog.status === 'warn' ? 'var(--po-warning)'
                      : ACTION_COLORS[selectedLog.action] || 'var(--po-text-subtle)',
                }} />
                <span style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--po-text)',
                  fontFamily: T.fontSans,
                }}>
                  {selectedLog.action}
                </span>
                <span style={{
                  fontSize: 12,
                  color: T.text3,
                  fontFamily: T.fontMono,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {selectedLog.operatorType}{selectedLog.operatorId ? `:${selectedLog.operatorId}` : ''}
                </span>
                <span style={{
                  minWidth: 42,
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: STATUS_STYLES[selectedLog.status].color,
                  background: STATUS_STYLES[selectedLog.status].background,
                  border: `1px solid ${STATUS_STYLES[selectedLog.status].border}`,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  fontFamily: T.fontMono,
                  flexShrink: 0,
                }}>
                  {selectedLog.statusLabel}
                </span>
                <span style={{ fontSize: 12, color: 'var(--po-text-disabled)', fontFamily: T.fontMono }}>
                  {selectedLog.time ? formatTime(selectedLog.time) : ''}
                </span>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{
                  background: 'none', border: 'none', color: 'var(--po-text-disabled)',
                  cursor: 'pointer', width: 30, height: 30, padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 10,
                marginBottom: 12,
              }}>
                {[
                  ['path', selectedLog.path || '—'],
                  ['operator_type', selectedLog.operatorType],
                  ['operator_id', selectedLog.operatorId || '—'],
                  ['status', selectedLog.statusLabel],
                ].map(([label, value]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={{
                      color: T.text3,
                      fontSize: 10,
                      fontFamily: T.fontSans,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom: 3,
                    }}>
                      {label}
                    </div>
                    <div
                      style={{
                        color: T.text2,
                        fontSize: 12,
                        fontFamily: T.fontMono,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={value}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{
                color: T.text3,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 6,
                fontFamily: T.fontSans,
              }}>
                raw audit row
              </div>
              <pre style={{
                margin: 0, padding: 12, background: 'var(--po-editor-bg)',
                border: '1px solid var(--po-hover)',
                borderRadius: 6, fontSize: 11, color: T.text2, lineHeight: 1.5,
                fontFamily: T.fontMono,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 180, overflow: 'auto',
              }}>
                {prettyJson(selectedLog.raw)}
              </pre>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes puppyone-monitor-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
