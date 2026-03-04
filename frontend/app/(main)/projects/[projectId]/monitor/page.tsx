'use client';

/**
 * System Monitor Page
 * 
 * Unified observability dashboard combining:
 * - Overview: Global stats, charts, and status of all access points (Agents & Sync Endpoints)
 * - Event Logs: Detailed audit trace, timeline, and drill-down logs.
 */

import React, { use, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getDashboardData, getAgentLogs, type DashboardData, type AgentLog } from '@/lib/chatApi';
import { get } from '@/lib/apiClient';
import useSWR from 'swr';
import { getSyncChangelog, type SyncChangelogItem } from '@/lib/contentNodesApi';

// ================= Types =================

interface TimeSeriesBucket {
  bucket: string;
  count: number;
}

interface Agent {
  id: string;
  name: string;
  icon: string | null;
  agent_type?: string;
  type?: string;
}

interface SyncStatusItem {
  id: string;
  node_id: string;
  node_name: string | null;
  node_type: string | null;
  provider: string;
  direction: string;
  status: string;
  last_synced_at: string | null;
  error_message: string | null;
}

interface ProjectSyncStatus {
  syncs: SyncStatusItem[];
  uploads: { id: string; status: string }[];
}

type AccessPointKind = 'agent' | 'sync';

interface AccessPoint {
  id: string;
  kind: AccessPointKind;
  name: string;
  icon: React.ReactNode;
  typeLabel: string;
  status: string;
  lastActive: string | null;
  sessionCount: number;
  maxSessionCount: number;
  direction?: string;
  provider?: string;
  errorMessage?: string | null;
}

// ================= Helpers =================

function getLocalHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}`;
}

function convertToLocalTimeSeries(
  rpcData: { bucket: string; count: number }[] | null,
  rangeHours: number = 24
): TimeSeriesBucket[] {
  const now = new Date();
  const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);
  
  const buckets: Map<string, number> = new Map();
  const current = new Date(startTime);
  current.setMinutes(0, 0, 0);
  
  while (current <= now) {
    const key = getLocalHourKey(current);
    buckets.set(key, 0);
    current.setTime(current.getTime() + 60 * 60 * 1000);
  }
  
  if (rpcData && Array.isArray(rpcData)) {
    rpcData.forEach(item => {
      const utcDate = new Date(item.bucket);
      const localKey = getLocalHourKey(utcDate);
      if (buckets.has(localKey)) {
        buckets.set(localKey, (buckets.get(localKey) || 0) + item.count);
      }
    });
  }
  
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, count]) => ({ bucket, count }));
}

function parseLocalHourKey(key: string): Date {
  const parts = key.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  const hour = parseInt(parts[3]);
  return new Date(year, month, day, hour, 0, 0);
}

function formatHourFull(dateStr: string) {
  const date = parseLocalHourKey(dateStr);
  return date.toLocaleString(undefined, { 
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true 
  });
}

function formatHourOnly(dateStr: string) {
  const date = parseLocalHourKey(dateStr);
  const hour = date.getHours();
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function formatDateShort() {
  return new Date().toLocaleDateString(undefined, { 
    weekday: 'short', month: 'short', day: 'numeric' 
  });
}

function formatRelativeTime(isoString: string | undefined) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatFullTime(isoString: string) {
  const date = new Date(isoString);
  const baseFormat = date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${baseFormat}.${ms}`;
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  chat: 'Chat Agent', schedule: 'Schedule', webhook: 'Webhook',
};

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Desktop Folder', gmail: 'Gmail', google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar', google_docs: 'Google Docs', github: 'GitHub',
  supabase: 'Supabase', notion: 'Notion', linear: 'Linear',
  hackernews: 'Hacker News', posthog: 'PostHog',
  google_search_console: 'Google Search Console',
  script: 'Custom Script',
  agent: 'Agent', mcp: 'MCP Server', sandbox: 'Sandbox', url: 'Web Page',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: '→ Inbound', outbound: '← Outbound', bidirectional: '↔ Bidirectional',
};

const DIRECTION_ARROWS: Record<string, string> = {
  inbound: '←', outbound: '→', bidirectional: '↔',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e', syncing: '#3b82f6', paused: '#eab308', error: '#ef4444',
};

const AGENT_ICONS = ['🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱'];

function parseAgentIcon(icon: string | null) {
  if (!icon) return '🤖';
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon;
}

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const logos: Record<string, string> = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png',
    google_sheets: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png',
    google_docs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png',
    github: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    notion: 'https://www.notion.so/images/favicon.ico',
  };

  if (logos[provider]) {
    return <img src={logos[provider]} alt={provider} width={size} height={size} style={{ display: 'block', borderRadius: 2 }} />;
  }

  if (provider === 'filesystem') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }

  if (provider === 'supabase') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M13.5 21.3c-.4.5-1.2.1-1.2-.6V13h8.1c.7 0 1.1.8.6 1.3L13.5 21.3z" fill="#3ECF8E" />
        <path d="M10.5 2.7c.4-.5 1.2-.1 1.2.6V11H3.6c-.7 0-1.1-.8-.6-1.3L10.5 2.7z" fill="#3ECF8E" opacity=".6" />
      </svg>
    );
  }

  const emojiProviders: Record<string, string> = {
    url: '🌐', hackernews: '🟠', posthog: '🦔',
    google_search_console: '📊', script: '📜',
  };
  if (emojiProviders[provider]) {
    return <span style={{ fontSize: size * 0.85 }}>{emojiProviders[provider]}</span>;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ================= Shared Components =================

function SidebarItem({ active, label, icon, count, onClick }: { active: boolean; label: string; icon: React.ReactNode; count?: number; onClick: () => void; }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', cursor: 'pointer',
        background: active ? '#18181b' : 'transparent',
        color: active ? '#e4e4e7' : '#71717a',
        fontSize: 13, borderRadius: 6, marginBottom: 2,
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.color = '#a1a1aa')}
      onMouseLeave={(e) => !active && (e.currentTarget.style.color = '#71717a')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>{label}</span>
      </div>
      {count !== undefined && (
        <span style={{ fontSize: 11, color: active ? '#52525b' : '#3f3f46' }}>{count}</span>
      )}
    </div>
  );
}

function LogHistogram({ logs }: { logs: AgentLog[] }) {
  const buckets = useMemo(() => {
    if (logs.length === 0) return Array(24).fill(0);
    const times = logs.map(l => new Date(l.created_at).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const range = Math.max(maxTime - minTime, 60 * 60 * 1000);
    const bucketCount = 40;
    const bucketSize = range / bucketCount;
    const counts = Array(bucketCount).fill(0);
    times.forEach(t => {
      const bucketIndex = Math.floor((t - minTime) / bucketSize);
      if (bucketIndex >= 0 && bucketIndex < bucketCount) {
        counts[bucketIndex]++;
      }
    });
    return counts;
  }, [logs]);

  const maxCount = Math.max(...buckets, 1);

  return (
    <div style={{ height: 40, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 4px' }}>
      {buckets.map((count, i) => (
        <div key={i} title={`${count} events`} style={{
            flex: 1, height: `${(count / maxCount) * 100}%`,
            background: count > 0 ? '#34d399' : 'transparent',
            minHeight: count > 0 ? 2 : 0, opacity: 0.6, borderRadius: '1px 1px 0 0',
          }} />
      ))}
    </div>
  );
}

function BarChart({ title, data, total, color = '#34d399', loading, showDate = false }: { title: string, data: TimeSeriesBucket[], total: number, color?: string, loading?: boolean, showDate?: boolean }) {
  const max = Math.max(...data.map(d => d.count), 16);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  const getXAxisLabels = () => {
    if (data.length === 0) return [];
    const labels: { index: number; label: string }[] = [];
    labels.push({ index: 0, label: formatHourOnly(data[0].bucket) });
    if (data.length >= 6) {
      const midIndex = Math.floor(data.length / 2);
      labels.push({ index: midIndex, label: formatHourOnly(data[midIndex].bucket) });
    }
    if (data.length > 1) {
      labels.push({ index: data.length - 1, label: formatHourOnly(data[data.length - 1].bucket) });
    }
    return labels;
  };
  
  const xAxisLabels = getXAxisLabels();
  
  return (
    <div style={{
      background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 8, padding: '20px 24px',
      minHeight: 240, display: 'flex', flexDirection: 'column', position: 'relative',
    }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</span>
          {showDate && <span style={{ fontSize: 11, color: '#3f3f46' }}>{formatDateShort()}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontSize: 32, fontWeight: 500, color: '#f4f4f5', letterSpacing: '-0.02em', lineHeight: 1 }}>{loading ? '...' : total}</div>
          {hoveredIndex !== null && data[hoveredIndex] && (
            <div style={{ 
              position: 'absolute', top: 20, right: 24, fontSize: 11, color: '#e4e4e7', 
              background: '#27272a', padding: '4px 8px', borderRadius: 4, whiteSpace: 'nowrap',
              border: '1px solid #3f3f46', zIndex: 10, pointerEvents: 'none', 
            }}>
              {formatHourFull(data[hoveredIndex].bucket)}: <strong>{data[hoveredIndex].count}</strong>
            </div>
          )}
        </div>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {loading ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>Loading...</div>
        ) : data.length === 0 ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>No data</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
              {data.map((d, i) => {
                const isHovered = hoveredIndex === i;
                const count = d.count;
                const isMosaic = count > 0 && count <= 14; 
                return (
                  <div key={d.bucket} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}
                    style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}>
                    {isMosaic ? (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
                        {Array.from({ length: count }).map((_, idx) => (
                          <div key={idx} style={{
                              width: '100%', height: 8, background: isHovered ? '#fff' : color,
                              opacity: isHovered ? 1 : 0.8 + (idx * 0.02), borderRadius: 1, transition: 'background 0.1s',
                            }} />
                        ))}
                      </div>
                    ) : (
                      <div style={{
                          width: '100%', height: d.count === 0 ? 2 : `${Math.max((d.count / max) * 100, 8)}%`,
                          background: isHovered ? (d.count > 0 ? '#fff' : '#3f3f46') : (d.count > 0 ? color : '#27272a'),
                          borderRadius: d.count === 0 ? 1 : '2px 2px 0 0', minHeight: d.count === 0 ? 2 : 8,
                          transition: 'background 0.1s', opacity: d.count === 0 ? 0.5 : 1,
                        }} />
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ position: 'relative', height: 16, marginTop: 8 }}>
              {xAxisLabels.map(({ index, label }) => (
                <span key={index} style={{ 
                    position: 'absolute', left: `${(index / (data.length - 1)) * 100}%`, 
                    transform: 'translateX(-50%)', fontSize: 10, color: '#52525b', whiteSpace: 'nowrap',
                  }}>{label}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AccessPointsTable({ points, onDrillDown }: { points: AccessPoint[], onDrillDown: (kind: string, id: string) => void }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gridTemplate = '40px 1.5fr 140px 100px 140px 100px';

  if (points.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>No access points configured yet.</div>;

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate, padding: '10px 24px',
        borderBottom: '1px solid #27272a', fontSize: 11, fontWeight: 600, color: '#52525b',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <div style={{ textAlign: 'center' }}>#</div>
        <div>Endpoint</div>
        <div>Type</div>
        <div>Status</div>
        <div>Activity</div>
        <div>Last Active</div>
      </div>

      {points.map((point, index) => {
        const isHovered = hoveredId === point.id;
        const statusColor = point.kind === 'sync' ? (STATUS_COLORS[point.status] || '#52525b') : (point.sessionCount > 0 ? '#22c55e' : '#52525b');
        return (
          <div key={point.id} onClick={() => onDrillDown(point.kind, point.id)} onMouseEnter={() => setHoveredId(point.id)} onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'grid', gridTemplateColumns: gridTemplate, padding: '12px 24px', alignItems: 'center', cursor: 'pointer',
              background: isHovered ? '#18181b' : 'transparent', borderBottom: '1px solid #1f1f22', transition: 'background 0.1s',
            }}
          >
            <div style={{ textAlign: 'center', color: '#52525b', fontSize: 12 }}>{index + 1}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: point.kind === 'sync' ? '#18181b' : '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, border: point.kind === 'sync' ? '1px solid #27272a' : 'none' }}>
                {point.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{point.name}</div>
                {point.direction && <div style={{ fontSize: 11, color: '#52525b', marginTop: 1 }}>{DIRECTION_LABELS[point.direction] || point.direction}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: point.kind === 'sync' ? 'rgba(59,130,246,0.1)' : 'rgba(113,113,122,0.1)', color: point.kind === 'sync' ? '#60a5fa' : '#a1a1aa', fontWeight: 500 }}>
                {point.typeLabel}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
              <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'capitalize' }}>{point.status}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {point.kind === 'agent' ? (
                <>
                  <span style={{ fontSize: 12, color: '#e4e4e7', minWidth: 20 }}>{point.sessionCount}</span>
                  {point.sessionCount > 0 && point.maxSessionCount > 0 && (
                    <div style={{ flex: 1, height: 4, background: '#27272a', borderRadius: 2, maxWidth: 80 }}>
                      <div style={{ width: `${(point.sessionCount / point.maxSessionCount) * 100}%`, height: '100%', background: '#10b981', borderRadius: 2 }} />
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: '#52525b' }}>sessions</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: point.errorMessage ? '#ef4444' : '#71717a' }}>{point.errorMessage || (point.status === 'syncing' ? 'Syncing…' : '—')}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: point.lastActive ? '#a1a1aa' : '#52525b' }}>
              {formatRelativeTime(point.lastActive || undefined)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LogRow({ log, agent, onClick, active }: { log: AgentLog; agent?: Agent; onClick: () => void; active: boolean; }) {
  const isSuccess = log.success;
  const details = log.details as Record<string, any> || {};
  let content = '';
  if (log.call_type === 'bash') content = details.command || '';
  else if (log.call_type === 'tool') content = `${details.tool_name}(...)`;
  else if (log.call_type === 'llm') content = details.model || 'LLM call';
  if (content.length > 80) content = content.substring(0, 80) + '...';

  const StatusIcon = isSuccess ? <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>200</span> : <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>ERR</span>;

  return (
    <div onClick={onClick} onMouseEnter={(e) => !active && (e.currentTarget.style.background = '#09090b')} onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'grid', gridTemplateColumns: '140px 100px 50px 1fr 60px', gap: 16, height: 32, padding: '0 16px',
        borderBottom: '1px solid #27272a', cursor: 'pointer', fontSize: 13, alignItems: 'center',
        background: active ? '#18181b' : 'transparent', color: active ? '#e4e4e7' : '#a1a1aa',
      }}
    >
      <span style={{ fontFamily: 'monospace', color: '#71717a', fontSize: 12 }}>{formatFullTime(log.created_at).split(',')[1].trim()}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        <span>{parseAgentIcon(agent?.icon || null)}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent?.name || 'Unknown'}</span>
      </div>
      <div>{StatusIcon}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? '#e4e4e7' : '#d4d4d8' }}>
        {content}
      </div>
      <div style={{ textAlign: 'right', color: '#52525b', fontSize: 12 }}>{log.latency_ms ? `${log.latency_ms}ms` : '-'}</div>
    </div>
  );
}

function SyncChangelogRow({ entry }: { entry: SyncChangelogItem }) {
  const ACTION_COLORS: Record<string, string> = { create: '#22c55e', update: '#3b82f6', delete: '#ef4444' };
  const ACTION_ICONS: Record<string, string> = { create: '+', update: '~', delete: '-' };
  const actionColor = ACTION_COLORS[entry.action] || '#71717a';
  const actionIcon = ACTION_ICONS[entry.action] || '?';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 70px 1fr 80px 60px', gap: 16, height: 32, padding: '0 16px',
      borderBottom: '1px solid #1a1a1a', fontSize: 13, alignItems: 'center', color: '#a1a1aa',
    }}>
      <span style={{ fontFamily: 'monospace', color: '#71717a', fontSize: 12 }}>
        {entry.created_at ? formatFullTime(entry.created_at).split(',').pop()?.trim() || '' : '-'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 3, background: `${actionColor}15`, color: actionColor, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
          {actionIcon}
        </span>
        <span style={{ fontSize: 11, color: actionColor, textTransform: 'capitalize' }}>{entry.action}</span>
      </div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#d4d4d8' }}>
        {entry.filename || entry.node_id.substring(0, 8)}
        {entry.node_type && <span style={{ color: '#52525b', marginLeft: 6, fontSize: 10 }}>.{entry.node_type}</span>}
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#71717a' }}>v{entry.version}</span>
      <span style={{ textAlign: 'right', color: '#52525b', fontSize: 11 }}>{entry.size_bytes > 0 ? formatSize(entry.size_bytes) : '-'}</span>
    </div>
  );
}

function SyncChangelogList({ projectId }: { projectId: string }) {
  const { data: changelog, error, isLoading } = useSWR(
    projectId ? ['sync-changelog', projectId] : null,
    () => getSyncChangelog(projectId, 0, 200),
    { refreshInterval: 15000, revalidateOnFocus: true },
  );

  const entries = changelog?.entries ?? [];

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>Loading sync events...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>Failed to load sync events</div>;
  if (entries.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#3f3f46' }}><p style={{ marginBottom: 4 }}>No sync events yet.</p><p style={{ fontSize: 11, color: '#27272a' }}>Events will appear here when files are synced between PuppyOne and your connected services.</p></div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 70px 1fr 80px 60px', gap: 16, padding: '8px 16px', borderBottom: '1px solid #27272a', background: '#0a0a0a', fontSize: 11, fontWeight: 600, color: '#52525b', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>TIMESTAMP</div><div>ACTION</div><div>FILE</div><div>VERSION</div><div style={{ textAlign: 'right' }}>SIZE</div>
      </div>
      {entries.map(entry => <SyncChangelogRow key={entry.id} entry={entry} />)}
      {changelog?.has_more && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#52525b' }}>Showing latest {entries.length} events. More events available.</div>}
    </div>
  );
}

// ================= Main Page =================

export default function MonitorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Dashboard & Logs are now fetched together
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  
  // Single inline filter state for logs instead of URL view/filter
  const [logFilter, setLogFilter] = useState<string>('all'); 
  
  const RANGE_HOURS = 24;

  const { data: syncData, mutate: mutateSync } = useSWR<ProjectSyncStatus>(
    projectId ? ['sync-status-monitor', projectId] : null,
    () => get<ProjectSyncStatus>(`/api/v1/sync/status?project_id=${projectId}`),
    { revalidateOnFocus: true },
  );

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashData, logsData, agentsData] = await Promise.all([
        getDashboardData(projectId, RANGE_HOURS).catch(() => null),
        getAgentLogs(projectId).catch(() => []),
        get<Agent[]>(`/api/v1/agent-config/?project_id=${projectId}`).catch(() => [])
      ]);
      if (dashData) setDashboardData(dashData);
      setLogs(logsData);
      setAgents(agentsData);
      mutateSync();
    } catch (err) {
      console.error('Failed to fetch monitor data', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, mutateSync]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Derived Dashboard Data
  const bashPerHour = useMemo(() => convertToLocalTimeSeries(dashboardData?.bashPerHour || null, RANGE_HOURS), [dashboardData]);
  const toolsPerHour = useMemo(() => convertToLocalTimeSeries(dashboardData?.toolsPerHour || null, RANGE_HOURS), [dashboardData]);
  const messagesPerHour = useMemo(() => convertToLocalTimeSeries(dashboardData?.messagesPerHour || null, RANGE_HOURS), [dashboardData]);
  const sessionsPerHour = useMemo(() => convertToLocalTimeSeries(dashboardData?.sessionsPerHour || null, RANGE_HOURS), [dashboardData]);
  const maxChatCount = useMemo(() => {
    const counts = (dashboardData?.agents || []).map(a => a.chat_count);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [dashboardData]);

  const accessPoints = useMemo<AccessPoint[]>(() => {
    const points: AccessPoint[] = [];
    (dashboardData?.agents || []).forEach(agent => {
      points.push({
        id: agent.id, kind: 'agent', name: agent.name, icon: <span style={{ fontSize: 16 }}>{parseAgentIcon(agent.icon || '')}</span>,
        typeLabel: AGENT_TYPE_LABELS[agent.agent_type] || agent.agent_type, status: agent.chat_count > 0 ? 'active' : 'idle',
        lastActive: agent.last_active, sessionCount: agent.chat_count, maxSessionCount: maxChatCount,
      });
    });
    (syncData?.syncs || []).forEach(sync => {
      points.push({
        id: sync.id, kind: 'sync', name: sync.node_name || PROVIDER_LABELS[sync.provider] || sync.provider,
        icon: <ProviderIcon provider={sync.provider} size={16} />, typeLabel: PROVIDER_LABELS[sync.provider] || sync.provider,
        status: sync.status, lastActive: sync.last_synced_at, sessionCount: 0, maxSessionCount: 0,
        direction: sync.direction, provider: sync.provider, errorMessage: sync.error_message,
      });
    });
    return points;
  }, [dashboardData, syncData, maxChatCount]);

  // Derived Logs Data
  const agentMap = useMemo(() => {
    const map: Record<string, Agent> = {};
    agents.forEach(a => { map[a.id] = a; });
    return map;
  }, [agents]);
  
  const syncEndpoints = syncData?.syncs || [];

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (logFilter === 'bash' && log.call_type !== 'bash') return false;
      if (logFilter === 'tool' && log.call_type !== 'tool') return false;
      if (logFilter === 'llm' && log.call_type !== 'llm') return false;
      if (logFilter !== 'all' && logFilter !== 'bash' && logFilter !== 'tool' && logFilter !== 'llm' && !logFilter.startsWith('sync:') && log.agent_id !== logFilter) return false;
      
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const details = JSON.stringify(log.details).toLowerCase();
        const agentName = (log.agent_id ? agentMap[log.agent_id]?.name || '' : '').toLowerCase();
        if (!details.includes(query) && !agentName.includes(query)) return false;
      }
      return true;
    });
  }, [logs, logFilter, searchQuery, agentMap]);

  const selectedLog = useMemo(() => selectedLogId ? logs.find(l => l.id === selectedLogId) : null, [logs, selectedLogId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      
      {/* Header */}
      <div style={{ 
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#0e0e0e', flexShrink: 0 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif', fontSize: 13, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>System Monitor</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={fetchAllData} disabled={loading} style={{ background: 'transparent', border: 'none', borderRadius: 4, color: loading ? '#52525b' : '#a1a1aa', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', padding: 6, transition: 'color 0.2s, background 0.2s' }} title="Refresh" onMouseEnter={e => !loading && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)', e.currentTarget.style.color = '#e4e4e7')} onMouseLeave={e => !loading && (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#a1a1aa')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            <style jsx>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </button>
        </div>
      </div>

      {/* Main Single Column Scroll Area */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 40 }}>
          
          {/* Section: Overview Charts */}
          <section>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e4e4e7', marginBottom: 16, letterSpacing: '-0.01em' }}>Access Monitor</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <BarChart title="Bash Executions" data={bashPerHour} total={dashboardData?.bashInRange ?? 0} color="#34d399" loading={loading} showDate={true} />
              <BarChart title="Tool Usage" data={toolsPerHour} total={dashboardData?.toolsInRange ?? 0} color="#3b82f6" loading={loading} showDate={true} />
              <BarChart title="Messages" data={messagesPerHour} total={dashboardData?.messagesInRange ?? 0} color="#a855f7" loading={loading} showDate={true} />
              <BarChart title="Sessions" data={sessionsPerHour} total={dashboardData?.sessionsInRange ?? 0} color="#f59e0b" loading={loading} showDate={true} />
            </div>
          </section>

          {/* Section: Logs */}
          <section id="event-logs-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e4e4e7', margin: 0, letterSpacing: '-0.01em' }}>System Logs</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                
                {/* Endpoint Filter Dropdown */}
                <select
                  value={logFilter.startsWith('sync:') || agents.some(a => a.id === logFilter) ? logFilter : ''}
                  onChange={(e) => {
                    if (e.target.value) setLogFilter(e.target.value);
                    else setLogFilter('all');
                  }}
                  style={{
                    height: 32, background: '#111113', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
                    color: (logFilter.startsWith('sync:') || agents.some(a => a.id === logFilter)) ? '#e4e4e7' : '#71717a',
                    padding: '0 10px', fontSize: 13, outline: 'none', cursor: 'pointer', marginRight: 12
                  }}
                >
                  <option value="">All Endpoints</option>
                  {agents.length > 0 && (
                    <optgroup label="Agents">
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </optgroup>
                  )}
                  {syncEndpoints.length > 0 && (
                    <optgroup label="Sync Endpoints">
                      {syncEndpoints.map(s => <option key={s.id} value={`sync:${s.id}`}>{s.node_name || PROVIDER_LABELS[s.provider] || s.provider}</option>)}
                    </optgroup>
                  )}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111113', padding: 4, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'bash', label: 'Bash' },
                    { id: 'tool', label: 'Tools' },
                    { id: 'llm', label: 'LLM' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setLogFilter(f.id)}
                      style={{
                        background: logFilter === f.id ? '#27272a' : 'transparent',
                        color: logFilter === f.id ? '#e4e4e7' : '#71717a',
                        border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => { if(logFilter !== f.id) e.currentTarget.style.color = '#a1a1aa'; }}
                      onMouseLeave={e => { if(logFilter !== f.id) e.currentTarget.style.color = '#71717a'; }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, display: 'flex', flexDirection: 'column', height: 600, overflow: 'hidden' }}>
              
              {/* Toolbar */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <input type="text" placeholder="Search events..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '6px 10px 6px 32px', fontSize: 13, color: '#e4e4e7', outline: 'none', height: 32, transition: 'border 0.2s' }} onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'} onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'} />
                  </div>
                </div>
                {!logFilter.startsWith('sync:') && (
                  <div>
                    <LogHistogram logs={filteredLogs} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#52525b', marginTop: 4 }}><span>Oldest</span><span>Latest</span></div>
                  </div>
                )}
              </div>

              {/* Log List */}
              <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {logFilter.startsWith('sync:') ? (
                    <SyncChangelogList projectId={projectId} />
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 50px 1fr 60px', gap: 16, padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.02)', fontSize: 11, fontWeight: 600, color: '#71717a', position: 'sticky', top: 0, zIndex: 10 }}>
                        <div>TIMESTAMP</div><div>SOURCE</div><div>STAT</div><div>EVENT</div><div style={{ textAlign: 'right' }}>DUR</div>
                      </div>
                      
                      {loading && logs.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#52525b' }}>Loading logs...</div>
                      ) : filteredLogs.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#52525b' }}>No events found for current filter.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {filteredLogs.map(log => <LogRow key={log.id} log={log} agent={log.agent_id ? agentMap[log.agent_id] : undefined} onClick={() => setSelectedLogId(log.id === selectedLogId ? null : log.id)} active={selectedLogId === log.id} />)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Event Details Side Panel */}
                {selectedLog && !logFilter.startsWith('sync:') && (
                  <div style={{ width: 320, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Event Details</span>
                      <button onClick={() => setSelectedLogId(null)} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#a1a1aa', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                      <pre style={{ margin: 0, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#d4d4d8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {JSON.stringify(selectedLog, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

