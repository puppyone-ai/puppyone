'use client';

import React, { use, useEffect, useState, useMemo, useCallback } from 'react';
import { getAgentLogs, type AgentLog } from '@/lib/chatApi';
import { get } from '@/lib/apiClient';
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${ms}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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

export default function MonitorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'protocol' | 'agent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: auditData } = useSWR<{ logs: AuditLogEntry[]; total: number }>(
    projectId ? `/api/v1/nodes/project-audit-logs?project_id=${projectId}&limit=200` : null,
    (url: string) => get(url),
    { refreshInterval: 15000 },
  );

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
    if (filter === 'protocol') list = list.filter(l => l.type === 'protocol');
    if (filter === 'agent') list = list.filter(l => l.type === 'agent');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l => l.detail.toLowerCase().includes(q) || l.action.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
    }
    return list;
  }, [allLogs, filter, searchQuery]);

  const selectedLog = selectedId ? allLogs.find(l => l.id === selectedId) : null;

  const protocolCount = allLogs.filter(l => l.type === 'protocol').length;
  const agentCount = allLogs.filter(l => l.type === 'agent').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e' }}>

      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
        background: '#0e0e0e', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>System Monitor</span>
        <button
          onClick={fetchAgentLogs}
          disabled={loading}
          style={{ background: 'transparent', border: 'none', borderRadius: 4, color: loading ? '#52525b' : '#a1a1aa', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', padding: 6 }}
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
            <path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </button>
      </div>

      {/* Main: table layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0, gap: 12,
        }}>
          {/* Filter tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#111113', padding: 3, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
            {[
              { key: 'all', label: 'All', count: allLogs.length },
              { key: 'protocol', label: 'Protocol', count: protocolCount },
              { key: 'agent', label: 'Agent', count: agentCount },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key as any)}
                style={{
                  background: filter === f.key ? '#27272a' : 'transparent',
                  color: filter === f.key ? '#e4e4e7' : '#71717a',
                  border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 12,
                  fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {f.label} <span style={{ opacity: 0.5, fontFamily: 'monospace', fontSize: 11 }}>{f.count}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', width: 220 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text" placeholder="Search logs..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 5, padding: '5px 8px 5px 28px', fontSize: 12, color: '#e4e4e7', outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '90px 70px 80px 1fr 50px',
          gap: 0, padding: '6px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)', fontSize: 10, fontWeight: 600,
          color: '#52525b', letterSpacing: '0.05em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          <div>TIME</div>
          <div>ACTION</div>
          <div>SOURCE</div>
          <div>EVENT</div>
          <div style={{ textAlign: 'right' }}>DUR</div>
        </div>

        {/* Table body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#3f3f46', fontSize: 13 }}>
              {loading ? 'Loading...' : 'No events found'}
            </div>
          ) : (
            filteredLogs.map(log => {
              const isSelected = log.id === selectedId;
              const actionColor = ACTION_COLORS[log.action] || '#71717a';
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedId(isSelected ? null : log.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '90px 70px 80px 1fr 50px',
                    gap: 0, padding: '0 16px', height: 32, alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.1s',
                    fontSize: 12,
                  }}
                  onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background = isSelected ? 'rgba(255,255,255,0.04)' : 'transparent'; }}
                >
                  <div style={{ color: '#52525b', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                    {log.time ? formatTimestamp(log.time) : '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                      background: log.status === 'error' ? '#ef4444' : log.status === 'warn' ? '#f59e0b' : actionColor,
                    }} />
                    <span style={{ color: actionColor, fontWeight: 500, fontSize: 11 }}>{log.action}</span>
                  </div>
                  <div style={{ color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.source.length > 10 ? log.source.slice(0, 8) + '..' : log.source}
                  </div>
                  <div style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.detail}
                  </div>
                  <div style={{ textAlign: 'right', color: '#3f3f46', fontSize: 11 }}>
                    {log.duration ? `${log.duration}ms` : ''}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail panel (bottom drawer when selected) */}
        {selectedLog && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)', background: '#0c0c0e',
            maxHeight: 300, overflowY: 'auto', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: selectedLog.status === 'error' ? '#ef4444' : ACTION_COLORS[selectedLog.action] || '#71717a',
                }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{selectedLog.action}</span>
                <span style={{ fontSize: 12, color: '#52525b' }}>{selectedLog.source}</span>
                <span style={{ fontSize: 12, color: '#3f3f46' }}>{selectedLog.time ? formatTime(selectedLog.time) : ''}</span>
                {selectedLog.duration && <span style={{ fontSize: 11, color: '#52525b' }}>{selectedLog.duration}ms</span>}
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: 4 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 13, color: '#c9d1d9', marginBottom: 12 }}>{selectedLog.detail}</div>
              <pre style={{
                margin: 0, padding: 12, background: '#09090b', border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: 6, fontSize: 11, color: '#71717a', lineHeight: 1.5,
                fontFamily: "ui-monospace, 'JetBrains Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 180, overflow: 'auto',
              }}>
                {JSON.stringify(selectedLog.raw, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
