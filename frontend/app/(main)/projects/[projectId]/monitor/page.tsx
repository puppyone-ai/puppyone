'use client';

/**
 * System Monitor — audit-log viewer.
 *
 * This page mirrors the audit_logs record shape. History owns the
 * commit/version story; Monitor should show what the audit table
 * recorded: action, operator, path, metadata, status, and raw detail.
 */

import React, { use, useState, useMemo } from 'react';
import { get } from '@/lib/apiClient';
import { PageLoading } from '@/components/loading';
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
  // V1 typed columns (migration 20260516010000). May be null on
  // pre-V1 rows that the J1 backfill couldn't derive a value for.
  transaction_id?: number | null;
  canonical_commit_id?: string | null;
  original_commit_id?: string | null;
  project_view_commit_id?: string | null;
  scope_view_commit_id?: string | null;
  scope_path?: string | null;
  source_channel?: string | null;
  policy?: string | null;
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
const COL_TEMPLATE = '92px 160px 300px minmax(260px, 0.8fr) minmax(320px, 1.2fr) 86px';
const ROW_HEIGHT = 30;

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
  // V1 receive-pack emits status="pending_resolution" when a push lands
  // in mut_conflicts awaiting manual review — surface it as 'warn' so it
  // stands out from green "committed" rows.
  if (explicit.includes('warn') || explicit.includes('conflict') || explicit.includes('pending')) return 'warn';
  if (entry.action.includes('error') || entry.action.includes('rejected')) return 'error';
  if (entry.action.includes('conflict') || entry.conflict_details) return 'warn';
  if (explicit.includes('ok') || explicit.includes('success') || explicit.includes('committed')) return 'ok';
  return 'recorded';
}

function statusLabel(entry: AuditLogEntry, status: LogStatus): string {
  return entry.status || STATUS_STYLES[status].label;
}

function metadataSummary(entry: AuditLogEntry): string {
  // Prefer the V1 typed columns when present — they're populated by
  // the new publish RPC and the J1 backfill, so historical and recent
  // events all read the same way in the activity feed.
  const v1Bits: string[] = [];
  if (entry.source_channel) v1Bits.push(`channel=${entry.source_channel}`);
  if (entry.scope_path) v1Bits.push(`scope=${entry.scope_path || '/'}`);
  if (entry.policy) v1Bits.push(`policy=${entry.policy}`);
  if (entry.transaction_id != null) v1Bits.push(`txn=${entry.transaction_id}`);
  if (entry.canonical_commit_id) {
    v1Bits.push(`commit=${shortToken(entry.canonical_commit_id, 8)}`);
  }

  const metadata = entry.metadata;
  let metaBits: string[] = [];
  if (metadata && typeof metadata === 'object') {
    metaBits = Object.entries(metadata)
      // Drop the keys we already lifted into the typed columns so the
      // summary doesn't double-render them.
      .filter(([key]) => !['source_channel', 'scope', 'scope_path', 'policy',
                            'transaction_id', 'commit_id'].includes(key))
      .slice(0, Math.max(0, 4 - v1Bits.length))
      .map(([key, value]) => {
        if (value == null) return `${key}=null`;
        if (Array.isArray(value)) return `${key}[${value.length}]`;
        if (typeof value === 'object') return `${key}{…}`;
        return `${key}=${shortToken(value, 16)}`;
      });
  }

  const all = [...v1Bits, ...metaBits];
  if (all.length === 0) return '{}';
  return all.join(' · ');
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: auditData } = useSWR<{ logs: AuditLogEntry[]; total: number }>(
    projectId ? `/api/v1/nodes/project-audit-logs?project_id=${projectId}&limit=200` : null,
    (url: string) => get(url),
    { refreshInterval: 15000 },
  );

  const isInitialLoading = auditData === undefined;

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
        metadataSummary: metadataSummary(a),
        statusLabel: statusLabel(a, status),
        status,
        raw: a,
      };
    });

    logs.sort((a, b) => (b.time ? new Date(b.time).getTime() : 0) - (a.time ? new Date(a.time).getTime() : 0));
    return logs;
  }, [auditData]);

  const selectedLog = selectedId ? allLogs.find(l => l.id === selectedId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--po-canvas)' }}>

      {/* ── Page header ── */}
      <div style={{
        height: 44, minHeight: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '1px solid var(--po-border-subtle)',
        background: 'var(--po-canvas)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--po-text)',
            fontFamily: T.fontSans,
            letterSpacing: 0,
          }}>
            System Monitor
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: T.text2,
          fontFamily: T.fontMono, letterSpacing: '0.03em',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--po-success)',
            animation: `puppyone-monitor-pulse 1.6s ${T.ease} infinite`,
          }} />
          <span style={{ color: T.text2 }}>Live</span>
          <span style={{ color: T.text4 }}>·</span>
          <span>{allLogs.length} event{allLogs.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: COL_TEMPLATE,
          height: ROW_HEIGHT, alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--po-border-subtle)',
          background: 'var(--po-canvas)',
          fontSize: 10.5, fontWeight: 600,
          color: T.text3, letterSpacing: '0.09em',
          textTransform: 'uppercase',
          fontFamily: T.fontMono,
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
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {allLogs.length === 0 ? (
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
            allLogs.map(log => {
                const isSelected = log.id === selectedId;
                const actionColor = ACTION_COLORS[log.action] || 'var(--po-text-subtle)';
                const dotColor = log.status === 'error' ? 'var(--po-danger)'
                  : log.status === 'warn' ? 'var(--po-warning)'
                  : actionColor;

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedId(isSelected ? null : log.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: COL_TEMPLATE,
                      height: ROW_HEIGHT,
                      alignItems: 'center',
                      padding: '0 20px',
                      borderBottom: '1px solid var(--po-border-subtle)',
                      background: isSelected ? 'var(--po-selected)' : 'transparent',
                      cursor: 'pointer',
                      transition: `background 0.16s ${T.ease}`,
                      fontSize: 12,
                      fontFamily: T.fontMono,
                      color: T.text2,
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
                      color: T.text3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {log.time ? formatTimestamp(log.time) : '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: dotColor,
                        flexShrink: 0,
                      }} />
                      <span
                        style={{
                          color: actionColor,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={log.action}
                      >
                        {log.action}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                      title={`${log.operatorType}${log.operatorId ? `:${log.operatorId}` : ''}`}
                    >
                      <span style={{
                        color: T.text2,
                        fontFamily: T.fontSans,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {log.operatorType}
                      </span>
                      {log.operatorId && (
                        <span style={{
                          color: T.text3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}>
                          {log.operatorId}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        color: T.text2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={log.path || '—'}
                    >
                      {log.path || '—'}
                    </div>
                    <div
                      style={{
                        color: T.text2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={prettyJson(log.raw?.metadata)}
                    >
                      {log.metadataSummary}
                    </div>
                    <div style={{
                      color: log.status === 'error' ? 'var(--po-danger)'
                        : log.status === 'warn' ? 'var(--po-warning)'
                          : T.text3,
                      overflow: 'hidden',
                      textAlign: 'right',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {log.statusLabel}
                    </div>
                  </div>
                );
              })
          )}
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
