'use client';

/**
 * Logs Page - Activity Audit & Debugging
 * 
 * Redesigned to match Supabase Logs Explorer layout:
 * - Left Sidebar: Collections (Event Types, Agents)
 * - Right Content: Timeline Chart + Log List
 */

import React, { use, useEffect, useState, useMemo, useCallback } from 'react';
import { getAgentLogs, type AgentLog } from '@/lib/chatApi';
import { get } from '@/lib/apiClient';

// ================= Types =================

interface Agent {
  id: string;
  name: string;
  icon: string | null;
  type: string;
}

type LogFilterType = 'all' | 'bash' | 'tool' | 'llm' | string; // 'all', type, or agent_id

// ================= Helpers =================

const AGENT_ICONS = ['🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱'];

function parseAgentIcon(icon: string | null) {
  if (!icon) return '🤖';
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon;
}

function formatRelativeTime(isoString: string) {
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  // Add milliseconds manually for precision
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${baseFormat}.${ms}`;
}

// ================= Components =================

// 1. Sidebar Item
function SidebarItem({ 
  active, 
  label, 
  icon, 
  count,
  onClick 
}: { 
  active: boolean; 
  label: string; 
  icon: React.ReactNode; 
  count?: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        cursor: 'pointer',
        background: active ? '#18181b' : 'transparent',
        color: active ? '#e4e4e7' : '#71717a',
        fontSize: 13,
        borderRadius: 6,
        marginBottom: 2,
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.color = '#a1a1aa')}
      onMouseLeave={(e) => !active && (e.currentTarget.style.color = '#71717a')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span>{label}</span>
      </div>
      {count !== undefined && (
        <span style={{ fontSize: 11, color: active ? '#52525b' : '#3f3f46' }}>{count}</span>
      )}
    </div>
  );
}

// 2. Timeline Chart (Sparkline Style)
function LogHistogram({ logs }: { logs: AgentLog[] }) {
  // Bucketing logs by hour/minute depending on range. For now, fixed 24 bars.
  const buckets = useMemo(() => {
    if (logs.length === 0) return Array(24).fill(0);
    
    // Find min/max time
    const times = logs.map(l => new Date(l.created_at).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const range = Math.max(maxTime - minTime, 60 * 60 * 1000); // Min 1 hour range
    
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
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(count / maxCount) * 100}%`,
            background: count > 0 ? '#34d399' : 'transparent',
            minHeight: count > 0 ? 2 : 0,
            opacity: 0.6,
            borderRadius: '1px 1px 0 0',
          }}
          title={`${count} events`}
        />
      ))}
    </div>
  );
}

// 3. Log Table Row
function LogRow({ 
  log, 
  agent, 
  onClick, 
  active 
}: { 
  log: AgentLog; 
  agent?: Agent; 
  onClick: () => void; 
  active: boolean; 
}) {
  const isSuccess = log.success;
  const details = log.details as Record<string, any> || {};
  
  // Parse command/content
  let content = '';
  if (log.call_type === 'bash') content = details.command || '';
  else if (log.call_type === 'tool') content = `${details.tool_name}(...)`;
  else if (log.call_type === 'llm') content = details.model || 'LLM call';
  
  // Truncate content
  if (content.length > 80) content = content.substring(0, 80) + '...';

  // Status Badge
  const StatusIcon = isSuccess ? (
    <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>200</span>
  ) : (
    <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>ERR</span>
  );

  return (
    <div 
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 100px 50px 1fr 60px', // Time | Agent | Status | Content | Duration
        gap: 16,
        height: 32,
        padding: '0 16px',
        borderBottom: '1px solid #27272a',
        cursor: 'pointer',
        fontSize: 13,
        alignItems: 'center',
        background: active ? '#18181b' : 'transparent',
        color: active ? '#e4e4e7' : '#a1a1aa',
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.background = '#09090b')} // Slightly lighter hover
      onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
    >
      {/* Time */}
      <span style={{ fontFamily: 'monospace', color: '#71717a', fontSize: 12 }}>
        {formatFullTime(log.created_at).split(',')[1].trim()}
      </span>

      {/* Agent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        <span>{parseAgentIcon(agent?.icon || null)}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent?.name || 'Unknown'}
        </span>
      </div>

      {/* Status */}
      <div>{StatusIcon}</div>

      {/* Content */}
      <div style={{ 
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 
        fontSize: 12,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: active ? '#e4e4e7' : '#d4d4d8'
      }}>
        {content}
      </div>

      {/* Duration */}
      <div style={{ textAlign: 'right', color: '#52525b', fontSize: 12 }}>
        {log.latency_ms ? `${log.latency_ms}ms` : '-'}
      </div>
    </div>
  );
}

// ================= Main Page =================

export default function ProjectLogsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  // Data State
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [selectedFilter, setSelectedFilter] = useState<LogFilterType>('all'); // 'all', 'bash', 'tool', 'llm', or agent_id
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // Fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [logsData, agentsData] = await Promise.all([
        getAgentLogs(),
        get<Agent[]>('/api/v1/agent-config/'),
      ]);
      setLogs(logsData);
      setAgents(agentsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derived Data
  const agentMap = useMemo(() => {
    const map: Record<string, Agent> = {};
    agents.forEach(a => { map[a.id] = a; });
    return map;
  }, [agents]);

  // Filtering Logic
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Sidebar Filter
      if (selectedFilter === 'bash' && log.call_type !== 'bash') return false;
      if (selectedFilter === 'tool' && log.call_type !== 'tool') return false;
      if (selectedFilter === 'llm' && log.call_type !== 'llm') return false;
      if (
        selectedFilter !== 'all' && 
        selectedFilter !== 'bash' && 
        selectedFilter !== 'tool' && 
        selectedFilter !== 'llm' &&
        log.agent_id !== selectedFilter // Agent ID check
      ) return false;

      // 2. Search Query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const details = JSON.stringify(log.details).toLowerCase();
        const agentName = (log.agent_id ? agentMap[log.agent_id]?.name || '' : '').toLowerCase();
        if (!details.includes(query) && !agentName.includes(query)) return false;
      }

      return true;
    });
  }, [logs, selectedFilter, searchQuery, agentMap]);

  const selectedLog = useMemo(() => 
    selectedLogId ? logs.find(l => l.id === selectedLogId) : null,
  [logs, selectedLogId]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      
      {/* Top Header - Global context */}
      <div style={{ 
        height: 48, 
        minHeight: 48,
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0 16px',
        background: '#141414',
        flexShrink: 0 
      }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>Logs & Analytics</h1>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* Left Sidebar - Collections */}
        <div style={{ 
          width: 240, 
          borderRight: '1px solid rgba(255,255,255,0.06)', 
          background: '#09090b',
          display: 'flex', 
          flexDirection: 'column',
          padding: '16px 8px'
        }}>
          {/* Section: Collections */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: '#52525b', padding: '0 12px', marginBottom: 8, letterSpacing: '0.05em' }}>COLLECTIONS</h3>
            
            <SidebarItem 
              active={selectedFilter === 'all'} 
              label="All Events" 
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>}
              onClick={() => setSelectedFilter('all')}
              count={logs.length}
            />
            <SidebarItem 
              active={selectedFilter === 'bash'} 
              label="Bash Executions" 
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>}
              onClick={() => setSelectedFilter('bash')}
              count={logs.filter(l => l.call_type === 'bash').length}
            />
            <SidebarItem 
              active={selectedFilter === 'tool'} 
              label="Tool Usage" 
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>}
              onClick={() => setSelectedFilter('tool')}
              count={logs.filter(l => l.call_type === 'tool').length}
            />
            <SidebarItem 
              active={selectedFilter === 'llm'} 
              label="LLM Calls" 
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>}
              onClick={() => setSelectedFilter('llm')}
              count={logs.filter(l => l.call_type === 'llm').length}
            />
          </div>

          {/* Section: Agents */}
          <div>
            <h3 style={{ fontSize: 11, fontWeight: 600, color: '#52525b', padding: '0 12px', marginBottom: 8, letterSpacing: '0.05em' }}>AGENTS</h3>
            {agents.map(agent => (
              <SidebarItem
                key={agent.id}
                active={selectedFilter === agent.id}
                label={agent.name}
                icon={<span>{parseAgentIcon(agent.icon)}</span>}
                onClick={() => setSelectedFilter(agent.id)}
                count={logs.filter(l => l.agent_id === agent.id).length}
              />
            ))}
          </div>
        </div>

        {/* Right Main Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* 1. Filter & Chart Header */}
          <div style={{ 
            padding: '16px 24px', 
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            {/* Top Row: Search & Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
                <svg 
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    padding: '6px 10px 6px 32px',
                    fontSize: 13,
                    color: '#e4e4e7',
                    outline: 'none',
                    height: 32
                  }}
                />
              </div>

              {/* Refresh */}
              <button 
                onClick={fetchData}
                disabled={loading}
                style={{ 
                  background: '#09090b', 
                  border: '1px solid #27272a', 
                  borderRadius: 6, 
                  width: 32,
                  height: 32,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: loading ? '#52525b' : '#a1a1aa', 
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                </svg>
              </button>
            </div>

            {/* Bottom Row: Histogram */}
            <div style={{ marginTop: 4 }}>
              <LogHistogram logs={filteredLogs} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#52525b', marginTop: 4 }}>
                <span>Oldest</span>
                <span>Latest</span>
              </div>
            </div>
          </div>

          {/* 2. Log List / Table */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Table Header */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '140px 100px 50px 1fr 60px',
              gap: 16,
              padding: '8px 16px', 
              borderBottom: '1px solid #27272a',
              background: '#0a0a0a',
              fontSize: 11,
              fontWeight: 600,
              color: '#52525b',
              position: 'sticky',
              top: 0,
              zIndex: 10
            }}>
              <div>TIMESTAMP</div>
              <div>AGENT</div>
              <div>STAT</div>
              <div>EVENT</div>
              <div style={{ textAlign: 'right' }}>DUR</div>
            </div>

            {loading && logs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>Loading...</div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#3f3f46' }}>No events found</div>
            ) : (
              filteredLogs.map(log => (
                <LogRow 
                  key={log.id} 
                  log={log} 
                  agent={log.agent_id ? agentMap[log.agent_id] : undefined} 
                  onClick={() => setSelectedLogId(log.id === selectedLogId ? null : log.id)}
                  active={selectedLogId === log.id}
                />
              ))
            )}
          </div>

          {/* 3. Detail Panel (Bottom Split or Drawer? Let's use Bottom Split for now if selected) */}
          {selectedLog && (
            <div style={{ 
              height: 300, 
              borderTop: '1px solid #27272a', 
              background: '#0c0c0d',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ 
                padding: '8px 16px', 
                borderBottom: '1px solid #27272a', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#e4e4e7' }}>Event Details</span>
                <button 
                  onClick={() => setSelectedLogId(null)}
                  style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', color: '#a1a1aa' }}>
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
