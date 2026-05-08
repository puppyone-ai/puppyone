'use client';

/**
 * System Monitor — pixel migration of the puppyone-web showcase's
 * MonitorView with the product's existing functionality kept intact.
 *
 * What changed visually:
 *   - Header gains a "Live · N events" indicator (animated dot)
 *     instead of a refresh button. Live status reads as ambient
 *     instead of a manual control.
 *   - Column template tightened to `74 / 86 / 150 / 1fr / 60` to
 *     match the showcase, plus a 28px table header strip with the
 *     same uppercase tracking as the showcase.
 *   - Newest row gets a subtle green tint to reinforce "live".
 *   - 22px bottom footer summarising "streaming from N access
 *     points · last 24h · sorted desc".
 *
 * What's preserved from the product (the showcase deliberately drops
 * these for the marketing surface, but they're load-bearing in the
 * real app):
 *   - Filter tabs (All / Protocol / Agent) — we still need the type
 *     split because the unified table mixes audit-log entries and
 *     agent-call entries from two different sources.
 *   - Search box — power-user affordance for incident triage.
 *   - JSON detail drawer at the bottom — debuggability.
 */

import React, { use, useEffect, useState, useMemo, useCallback } from 'react';
import { getAgentLogs, type AgentLog } from '@/lib/chatApi';
import { get } from '@/lib/apiClient';
import { listConnectors } from '@/lib/repoApi';
import { PulseGrid, PageLoading } from '@/components/loading';
import useSWR from 'swr';

interface AuditLogEntry {
  id: number;
  action: string;
  path: string | null;
  operator_type: string;
  operator_id: string | null;
  metadata: any;
  created_at: string | null;
}

const T = {
  text1: '#fafafa',
  text2: '#a1a1aa',
  text3: '#52525b',
  text4: '#27272a',
  border: 'rgba(255,255,255,0.08)',
  fontSans: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
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

type UnifiedLog = {
  id: string;
  time: string;
  type: 'protocol' | 'agent';
  action: string;
  source: string;
  detail: string;
  status: 'ok' | 'error' | 'warn';
  duration?: number;
  raw: any;
};

const ACTION_COLORS: Record<string, string> = {
  clone: '#22c55e', push: '#3b82f6', pull: '#a78bfa', rollback: '#f59e0b',
  push_error: '#ef4444', push_rejected: '#ef4444', merge_conflict: '#f59e0b',
  bash: '#34d399', tool: '#60a5fa', llm: '#c084fc',
};

// Single source of truth for the table grid template — header and
// rows both reference it or columns desync at fractional widths.
const COL_TEMPLATE = '74px 86px 150px 1fr 60px';

export default function MonitorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  // Filter axis is by *outcome* (the actionable triage axis), not by
  // event source-type. Earlier this was `'all' | 'protocol' | 'agent'`,
  // which leaked the internal MUT-vs-agent split into the chrome:
  //   - "Protocol" was jargon for "anything written via mut_engine"
  //   - When agent activity was 0 the Protocol tab equalled All and
  //     the segmented control read as decorative rather than useful.
  // Status filter (All / Errors / Warnings) means a one-click jump
  // to the rows that actually need attention, regardless of which
  // subsystem wrote them.
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: auditData } = useSWR<{ logs: AuditLogEntry[]; total: number }>(
    projectId ? `/api/v1/nodes/project-audit-logs?project_id=${projectId}&limit=200` : null,
    (url: string) => get(url),
    { refreshInterval: 15000 },
  );

  // Connector count drives the footer's "Streaming from N access
  // points" line. Cheap to fetch, already cached by /access.
  const { data: connectors } = useSWR(
    projectId ? ['repo-connectors', projectId] : null,
    () => listConnectors(projectId),
    { refreshInterval: 60000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  // The empty-state branch below renders when `filteredLogs.length === 0`.
  // The naive guard (`loading ? <PageLoading /> : <Empty />`) reads only
  // `loading`, which is the *agent-logs* fetch flag — it ignores SWR's
  // `auditData` fetch entirely. Audit logs are usually the much bigger
  // source, and on slower networks `loading` flips to false (agent logs
  // arrive empty / fast) before `auditData` lands, producing a brief
  // "No events found" flash that reads as "did the entire log stream
  // just disappear?".
  //
  // Treating the page as still-loading until *both* sources have
  // settled at least once eliminates that flash. SWR keeps `data`
  // populated across revalidations after the first delivery, so this
  // flag stays false during background refreshes (no spinner thrash).
  const isInitialLoading = loading || auditData === undefined;

  const fetchAgentLogs = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await getAgentLogs(projectId).catch(() => []);
      setAgentLogs(logs);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchAgentLogs(); }, [fetchAgentLogs]);

  const allLogs: UnifiedLog[] = useMemo(() => {
    const logs: UnifiedLog[] = [];

    (auditData?.logs || []).forEach(a => {
      const meta = a.metadata || {};
      logs.push({
        id: `audit-${a.id}`,
        time: a.created_at || '',
        type: 'protocol',
        action: a.action,
        source: a.operator_id || a.operator_type || 'system',
        detail: (() => {
          const short = (cid?: string) => (cid ? String(cid).slice(0, 8) : '?');
          if (a.action === 'clone') return `Clone scope ${meta.scope || '/'} (${meta.files || 0} files)`;
          if (a.action === 'push') return `Push ${short(meta.commit_id)} to ${meta.scope || '/'} (${meta.snapshots || 1} snapshot${meta.snapshots !== 1 ? 's' : ''})`;
          if (a.action === 'pull') return `Pull ${short(meta.commit_id)} from ${meta.scope || '/'}`;
          if (a.action === 'rollback') return `Rollback ${meta.scope || '/'} to ${short(meta.target_commit_id)}`;
          if (a.action === 'push_error') return `Push error: ${meta.error || 'unknown'}`;
          if (a.action === 'push_rejected') return `Push rejected: paths outside scope`;
          if (a.action === 'merge_conflict') return `Merge conflict in ${meta.scope || '/'} (${meta.conflicts?.length || 0} conflicts)`;
          return a.action;
        })(),
        status: a.action.includes('error') || a.action.includes('rejected') ? 'error'
          : a.action.includes('conflict') ? 'warn' : 'ok',
        raw: a,
      });
    });

    agentLogs.forEach(log => {
      logs.push({
        id: log.id,
        time: log.created_at || '',
        type: 'agent',
        action: log.call_type || 'call',
        source: log.agent_id || 'agent',
        detail: (() => {
          const d = log.details || {};
          if (log.call_type === 'bash') return d.command || 'bash execution';
          if (log.call_type === 'tool') return `${d.tool_name || 'tool'} call`;
          if (log.call_type === 'llm') return `${d.model || 'llm'} · ${d.tokens_total || 0} tokens`;
          return log.call_type || 'event';
        })(),
        status: log.success ? 'ok' : 'error',
        duration: log.latency_ms || undefined,
        raw: log,
      });
    });

    logs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return logs;
  }, [auditData, agentLogs]);

  const filteredLogs = useMemo(() => {
    let list = allLogs;
    if (filter === 'errors') list = list.filter(l => l.status === 'error');
    if (filter === 'warnings') list = list.filter(l => l.status === 'warn');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l =>
        l.detail.toLowerCase().includes(q)
        || l.action.toLowerCase().includes(q)
        || l.source.toLowerCase().includes(q));
    }
    return list;
  }, [allLogs, filter, searchQuery]);

  const selectedLog = selectedId ? allLogs.find(l => l.id === selectedId) : null;

  const errorCount = allLogs.filter(l => l.status === 'error').length;
  const warningCount = allLogs.filter(l => l.status === 'warn').length;
  const apCount = connectors?.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e' }}>

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
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: '#0e0e0e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', fontFamily: T.fontSans }}>
            Logs
          </span>
          <span style={{ fontSize: 12, color: '#52525b', fontFamily: T.fontSans }}>
            {allLogs.length} event{allLogs.length === 1 ? '' : 's'}
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: T.text3,
          fontFamily: T.fontMono, letterSpacing: '0.02em',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#4ade80',
            boxShadow: '0 0 6px #4ade80aa',
            animation: `puppyone-monitor-pulse 1.6s ${T.ease} infinite`,
          }} />
          <span style={{ color: T.text2 }}>Live</span>
          <span style={{ color: T.text4 }}>·</span>
          <span>last 24h</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Toolbar — filter chips · search · refresh */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0, gap: 12,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#111113', padding: 3, borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            {([
              { key: 'all', label: 'All', count: allLogs.length, accent: '#e4e4e7' },
              { key: 'errors', label: 'Errors', count: errorCount, accent: '#f87171' },
              { key: 'warnings', label: 'Warnings', count: warningCount, accent: '#fbbf24' },
            ] as const).map(f => {
              const isActive = filter === f.key;
              const hasItems = f.count > 0;
              // Status-keyed filters double as a tiny health-at-a-
              // glance signal: when Errors/Warnings have 0 events we
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
                    background: isActive ? '#27272a' : 'transparent',
                    color: isActive ? '#e4e4e7' : '#71717a',
                    border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 12,
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
              fill="none" stroke="#52525b" strokeWidth="2"
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text" placeholder="Search logs..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', background: '#111113',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 5, padding: '5px 8px 5px 28px',
                fontSize: 12, color: '#e4e4e7', outline: 'none',
                fontFamily: T.fontSans,
              }}
            />
          </div>

          <button
            onClick={fetchAgentLogs}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 5,
              color: loading ? '#52525b' : '#a1a1aa',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (loading) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.color = '#e4e4e7';
            }}
            onMouseLeave={(e) => {
              if (loading) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#a1a1aa';
            }}
            title="Refresh"
          >
            {loading ? (
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
          background: 'rgba(255,255,255,0.02)',
          fontSize: 9.5, fontWeight: 600,
          color: T.text3, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: T.fontSans,
          flexShrink: 0,
        }}>
          <div>Time</div>
          <div>Action</div>
          <div>Source</div>
          <div>Event</div>
          <div style={{ textAlign: 'right' }}>Dur</div>
        </div>

        {/* Table body */}
        {/*
          Date-grouped row stream.

          Pre-pass over `filteredLogs` collects, for every consecutive
          run of rows in the same calendar day, the bucket key + heading
          + count. We emit a 26px sticky header before each run; rows
          within a run reuse the existing 30px grid template so column
          alignment is preserved end-to-end.

          The headers are `position: sticky; top: 0` so the active day
          remains pinned to the top of the scroll container as the user
          scrolls down — which solves the original gripe ("times have no
          date") without bloating the Time column with a per-row date
          prefix that would either truncate or push the table wider.
        */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {filteredLogs.length === 0 ? (
            isInitialLoading ? (
              <PageLoading variant="fill" />
            ) : (
              <div style={{
                padding: 60, textAlign: 'center', color: '#3f3f46', fontSize: 13,
                fontFamily: T.fontSans,
                display: 'flex', justifyContent: 'center',
              }}>
                No events found
              </div>
            )
          ) : (
            (() => {
              // Walk the list once, emitting [Header, ...rows] groups.
              // We render flat children (not nested wrappers) so the
              // sticky positioning is anchored to the scroll container
              // rather than a per-group div, which would let each
              // header be replaced by the next instead of stacking
              // weirdly when groups straddle the viewport.
              const elements: React.ReactNode[] = [];
              let lastBucket: string | null = null;

              filteredLogs.forEach((log, i) => {
                const bucket = log.time ? dayBucketKey(log.time) : 'unknown';
                if (bucket !== lastBucket) {
                  elements.push(
                    <div
                      key={`day-${bucket}-${i}`}
                      style={{
                        position: 'sticky', top: 0, zIndex: 2,
                        height: 26, padding: '0 16px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        // Solid background so rows scrolling underneath
                        // don't bleed through the sticky header.
                        background: 'rgba(20,20,22,0.96)',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                        borderBottom: `1px solid ${T.border}`,
                        borderTop: i === 0 ? 'none' : `1px solid ${T.border}`,
                        fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: T.text3,
                        fontFamily: T.fontSans,
                      }}
                    >
                      <span style={{ color: T.text2 }}>
                        {log.time ? formatDayHeading(bucket) : 'Unknown date'}
                      </span>
                      {/* Subtle divider line so the heading reads as a
                          section break, not an in-row label. */}
                      <span
                        style={{
                          flex: 1, height: 1,
                          background: 'linear-gradient(to right, rgba(255,255,255,0.06), rgba(255,255,255,0))',
                        }}
                      />
                    </div>,
                  );
                  lastBucket = bucket;
                }

                const isSelected = log.id === selectedId;
                const isFirst = i === 0;
                const actionColor = ACTION_COLORS[log.action] || '#71717a';
                const dotColor = log.status === 'error' ? '#ef4444'
                  : log.status === 'warn' ? '#f59e0b'
                  : actionColor;

                elements.push(
                  <div
                    key={log.id}
                    onClick={() => setSelectedId(isSelected ? null : log.id)}
                    style={{
                      display: 'grid', gridTemplateColumns: COL_TEMPLATE,
                      height: 30, alignItems: 'center',
                      padding: '0 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: isSelected
                        ? 'rgba(255,255,255,0.05)'
                        : isFirst ? 'rgba(74,222,128,0.04)' : 'transparent',
                      cursor: 'pointer',
                      transition: `background 0.2s ${T.ease}`,
                      fontSize: 12, fontFamily: T.fontSans,
                    }}
                    onMouseEnter={e => {
                      if (isSelected) return;
                      e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                    }}
                    onMouseLeave={e => {
                      if (isSelected) return;
                      e.currentTarget.style.background = isFirst ? 'rgba(74,222,128,0.04)' : 'transparent';
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
                        width: 5, height: 5, borderRadius: '50%',
                        background: dotColor, flexShrink: 0,
                      }} />
                      <span style={{
                        color: actionColor, fontWeight: 500, fontSize: 11,
                        fontFamily: T.fontMono, letterSpacing: '0.01em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {log.action}
                      </span>
                    </div>
                    <div style={{
                      color: T.text2, fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}>
                      {log.source.length > 16 ? log.source.slice(0, 14) + '…' : log.source}
                    </div>
                    <div style={{
                      color: T.text2, fontFamily: T.fontMono, fontSize: 11.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      letterSpacing: '0.01em',
                    }}>
                      {log.detail}
                    </div>
                    <div style={{
                      textAlign: 'right', color: T.text4,
                      fontFamily: T.fontMono, fontSize: 11,
                    }}>
                      {log.duration ? `${log.duration}ms` : ''}
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
          background: 'rgba(255,255,255,0.015)',
          fontSize: 10, color: T.text3,
          fontFamily: T.fontMono, letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          <span>
            Streaming from {apCount} access point{apCount === 1 ? '' : 's'}
          </span>
          <span>last 24h · sorted desc</span>
        </div>

        {/* Detail drawer (preserved from existing product) */}
        {selectedLog && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: '#0c0c0e',
            maxHeight: 300, overflowY: 'auto', flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: selectedLog.status === 'error' ? '#ef4444'
                    : ACTION_COLORS[selectedLog.action] || '#71717a',
                }} />
                <span style={{
                  fontSize: 13, fontWeight: 500, color: '#e4e4e7',
                  fontFamily: T.fontSans,
                }}>
                  {selectedLog.action}
                </span>
                <span style={{ fontSize: 12, color: T.text3, fontFamily: T.fontSans }}>
                  {selectedLog.source}
                </span>
                <span style={{ fontSize: 12, color: '#3f3f46', fontFamily: T.fontMono }}>
                  {selectedLog.time ? formatTime(selectedLog.time) : ''}
                </span>
                {selectedLog.duration && (
                  <span style={{ fontSize: 11, color: T.text3, fontFamily: T.fontMono }}>
                    {selectedLog.duration}ms
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{
                  background: 'none', border: 'none', color: '#52525b',
                  cursor: 'pointer', padding: 4,
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
                fontSize: 13, color: '#c9d1d9', marginBottom: 12,
                fontFamily: T.fontMono,
              }}>
                {selectedLog.detail}
              </div>
              <pre style={{
                margin: 0, padding: 12, background: '#09090b',
                border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: 6, fontSize: 11, color: T.text2, lineHeight: 1.5,
                fontFamily: T.fontMono,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 180, overflow: 'auto',
              }}>
                {JSON.stringify(selectedLog.raw, null, 2)}
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
