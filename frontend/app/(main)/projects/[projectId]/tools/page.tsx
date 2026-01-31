'use client';

/**
 * Project Agents Page (Agent Dashboard)
 * 
 * Monitoring dashboard with multiple charts:
 * 1. Sessions per Day (7 days)
 * 2. Active Agents per Day
 * 3. Top Accessed Nodes (placeholder for access_logs)
 */

import { use, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { get } from '@/lib/apiClient';
import { getChatSessions, type ChatSession } from '@/lib/chatApi';

// ================= Types =================

interface TimeSeriesBucket {
  bucket: string;
  count: number;
}

interface Agent {
  id: string;
  name: string;
  icon: string;
  type: string;
  description?: string;
  updated_at?: string;
  accesses?: any[];
  bash_accesses?: any[];
  tools?: any[];
}

// ================= Helpers =================

// Helper: Get local hour key (e.g., "2026-01-31-14" for 2 PM local time)
function getLocalHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}`;
}

// Build hourly time series from sessions (last 24 hours, LOCAL time)
function buildHourlyTimeSeries(sessions: ChatSession[], rangeHours: number = 24): TimeSeriesBucket[] {
  const now = new Date();
  const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);
  
  // Create empty buckets for each hour (LOCAL time)
  const buckets: Map<string, number> = new Map();
  const current = new Date(startTime);
  current.setMinutes(0, 0, 0);
  
  while (current <= now) {
    const key = getLocalHourKey(current);
    buckets.set(key, 0);
    current.setTime(current.getTime() + 60 * 60 * 1000); // +1 hour
  }
  
  // Count sessions per hour
  sessions.forEach(session => {
    const createdAt = new Date(session.created_at);
    if (createdAt >= startTime && createdAt <= now) {
      const key = getLocalHourKey(createdAt);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
    }
  });
  
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, count]) => ({ bucket, count }));
}

// Build active agents per hour (last 24 hours, LOCAL time)
function buildActiveAgentsPerHour(sessions: ChatSession[], rangeHours: number = 24): TimeSeriesBucket[] {
  const now = new Date();
  const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);
  
  // Group sessions by hour, then count unique agents
  const hourAgents: Map<string, Set<string>> = new Map();
  
  const current = new Date(startTime);
  current.setMinutes(0, 0, 0);
  while (current <= now) {
    const key = getLocalHourKey(current);
    hourAgents.set(key, new Set());
    current.setTime(current.getTime() + 60 * 60 * 1000);
  }
  
  sessions.forEach(session => {
    const createdAt = new Date(session.created_at);
    if (createdAt >= startTime && createdAt <= now && session.agent_id) {
      const key = getLocalHourKey(createdAt);
      hourAgents.get(key)?.add(session.agent_id);
    }
  });
  
  return Array.from(hourAgents.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, agents]) => ({ bucket, count: agents.size }));
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  chat: 'Chat',
  schedule: 'Schedule',
  webhook: 'Webhook',
  devbox: 'DevBox',
};

const AGENT_ICONS = ['🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱'];

function parseAgentIcon(icon: string) {
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon || '🤖';
}

function formatRelativeTime(isoString: string | undefined) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Parse local hour key "2026-01-31-14" back to Date
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
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
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
    weekday: 'short',
    month: 'short', 
    day: 'numeric' 
  });
}

// ================= Chart Components =================

interface BarChartProps {
  title: string;
  subtitle?: string;
  data: TimeSeriesBucket[];
  total: number;
  color?: string;
  loading?: boolean;
  showDate?: boolean;
}

function BarChart({ title, subtitle, data, total, color = '#34d399', loading, showDate = false }: BarChartProps) {
  const max = Math.max(...data.map(d => d.count), 1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  // Find indices for x-axis labels (start, middle, end)
  const getXAxisLabels = () => {
    if (data.length === 0) return [];
    const labels: { index: number; label: string }[] = [];
    
    // Always show first
    labels.push({ index: 0, label: formatHourOnly(data[0].bucket) });
    
    // Show middle if we have enough data
    if (data.length >= 6) {
      const midIndex = Math.floor(data.length / 2);
      labels.push({ index: midIndex, label: formatHourOnly(data[midIndex].bucket) });
    }
    
    // Always show last
    if (data.length > 1) {
      labels.push({ index: data.length - 1, label: formatHourOnly(data[data.length - 1].bucket) });
    }
    
    return labels;
  };
  
  const xAxisLabels = getXAxisLabels();
  
  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #27272a',
      borderRadius: 8,
      padding: '16px 20px',
      flex: 1,
      minWidth: 280,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {title}
            </span>
            {showDate && (
              <span style={{ fontSize: 11, color: '#52525b' }}>
                · {formatDateShort()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#f4f4f5', marginTop: 4 }}>
            {loading ? '...' : total}
          </div>
          {subtitle && <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>{subtitle}</div>}
        </div>
        
        {/* Hover tooltip */}
        {hoveredIndex !== null && data[hoveredIndex] && (
          <div style={{ 
            fontSize: 11, 
            color: '#e4e4e7', 
            background: '#27272a', 
            padding: '4px 8px', 
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}>
            {formatHourFull(data[hoveredIndex].bucket)}: <strong>{data[hoveredIndex].count}</strong>
          </div>
        )}
      </div>
      
      {/* Chart */}
      {loading ? (
        <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>
          Loading...
        </div>
      ) : data.length === 0 ? (
        <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>
          No data
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
            {data.map((d, i) => (
              <div
                key={d.bucket}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  flex: 1,
                  height: `${Math.max((d.count / max) * 100, 4)}%`,
                  background: hoveredIndex === i 
                    ? (d.count > 0 ? '#fff' : '#3f3f46') 
                    : (d.count > 0 ? color : '#27272a'),
                  borderRadius: '2px 2px 0 0',
                  minHeight: 4,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
              />
            ))}
          </div>
          
          {/* X-Axis with time markers */}
          <div style={{ position: 'relative', height: 16, marginTop: 8 }}>
            {xAxisLabels.map(({ index, label }) => (
              <span 
                key={index}
                style={{ 
                  position: 'absolute', 
                  left: `${(index / (data.length - 1)) * 100}%`, 
                  transform: 'translateX(-50%)',
                  fontSize: 10, 
                  color: '#52525b',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Simple stat card (no chart)
interface StatCardProps {
  label: string;
  value: number | string;
  subLabel?: string;
}

function StatCard({ label, value, subLabel }: StatCardProps) {
  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #27272a',
      borderRadius: 8,
      padding: '16px 20px',
      minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: '#f4f4f5', lineHeight: 1 }}>
        {value}
      </div>
      {subLabel && (
        <div style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>
          {subLabel}
        </div>
      )}
    </div>
  );
}

// ================= Agents Table =================

interface AgentsTableProps {
  agents: Agent[];
  chatCounts: Record<string, number>;
  lastActive: Record<string, string>;
  maxChatCount: number;
  onDelete?: (id: string) => void;
}

function AgentsTable({ agents, chatCounts, lastActive, maxChatCount, onDelete }: AgentsTableProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gridTemplate = '40px 1.5fr 100px 120px 140px 100px 40px';

  if (agents.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>No agents configured yet.</div>;
  }

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: gridTemplate, padding: '10px 24px',
        borderBottom: '1px solid #27272a', fontSize: 11, fontWeight: 600, color: '#52525b',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <div style={{ textAlign: 'center' }}>#</div>
        <div>Agent Name</div>
        <div>Type</div>
        <div>Data Access</div>
        <div>Sessions</div>
        <div>Last Active</div>
        <div></div>
      </div>

      {agents.map((agent, index) => {
        const isHovered = hoveredId === agent.id;
        const typeLabel = AGENT_TYPE_LABELS[agent.type] || agent.type;
        const resourceCount = (agent.bash_accesses || agent.accesses || []).length;
        const chatCount = chatCounts[agent.id] || 0;
        const lastActiveTime = lastActive[agent.id];
        const usagePercent = maxChatCount > 0 ? (chatCount / maxChatCount) * 100 : 0;

        return (
          <div
            key={agent.id}
            onMouseEnter={() => setHoveredId(agent.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'grid', gridTemplateColumns: gridTemplate, padding: '12px 24px', alignItems: 'center',
              background: isHovered ? '#18181b' : 'transparent', borderBottom: '1px solid #1f1f22', transition: 'background 0.1s',
            }}
          >
            <div style={{ textAlign: 'center', color: '#52525b', fontSize: 12 }}>{index + 1}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                {parseAgentIcon(agent.icon)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{agent.name}</div>
            </div>
            <div style={{ fontSize: 12, color: '#71717a' }}>{typeLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {resourceCount > 0 ? (
                <>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: '#3b82f6' }} />
                  <span style={{ fontSize: 12, color: '#d4d4d8' }}>{resourceCount} sources</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: '#52525b' }}>—</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#e4e4e7', minWidth: 20 }}>{chatCount}</span>
              {chatCount > 0 && (
                <div style={{ flex: 1, height: 4, background: '#27272a', borderRadius: 2, maxWidth: 80 }}>
                  <div style={{ width: `${usagePercent}%`, height: '100%', background: '#10b981', borderRadius: 2 }} />
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: lastActiveTime ? '#a1a1aa' : '#52525b' }}>
              {formatRelativeTime(lastActiveTime)}
            </div>
            <div style={{ opacity: isHovered ? 1 : 0, transition: 'opacity 0.1s' }}>
              {onDelete && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(agent.id); }}
                  style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                >
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path d='M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ================= Main Page =================

export default function ProjectAgentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const { projects } = useProjects();
  const currentProject = projects.find(p => p.id === projectId);
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  const RANGE_HOURS = 12; // Show last 12 hours for more relevant data

  // Chart 1: Sessions per Hour (last 24h)
  const sessionsPerHour = useMemo(() => buildHourlyTimeSeries(chatSessions, RANGE_HOURS), [chatSessions]);
  const totalSessionsInRange = useMemo(() => sessionsPerHour.reduce((sum, b) => sum + b.count, 0), [sessionsPerHour]);

  // Chart 2: Active Agents per Hour (last 24h)
  const activeAgentsPerHour = useMemo(() => buildActiveAgentsPerHour(chatSessions, RANGE_HOURS), [chatSessions]);
  const maxActiveAgents = useMemo(() => {
    return Math.max(...activeAgentsPerHour.map(b => b.count), 0);
  }, [activeAgentsPerHour]);

  // Stats
  const stats = useMemo(() => {
    const agentIds = new Set(agents.map(a => a.id));
    const validSessions = chatSessions.filter(s => s.agent_id && agentIds.has(s.agent_id));
    const activeAgentIds = new Set(validSessions.map(s => s.agent_id));
    return {
      totalSessions: validSessions.length,
      activeAgents: activeAgentIds.size,
      totalAgents: agents.length,
    };
  }, [chatSessions, agents]);

  const chatCountByAgent = useMemo(() => {
    const counts: Record<string, number> = {};
    chatSessions.forEach(s => { if(s.agent_id) counts[s.agent_id] = (counts[s.agent_id] || 0) + 1; });
    return counts;
  }, [chatSessions]);

  const maxChatCount = useMemo(() => {
    const counts = Object.values(chatCountByAgent);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [chatCountByAgent]);

  const lastActiveByAgent = useMemo(() => {
    const times: Record<string, string> = {};
    chatSessions.forEach(s => {
      if(s.agent_id && (!times[s.agent_id] || s.updated_at > times[s.agent_id])) times[s.agent_id] = s.updated_at;
    });
    return times;
  }, [chatSessions]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [agentsData, sessionsData] = await Promise.all([
        get<Agent[]>('/api/v1/agent-config/'),
        getChatSessions(),
      ]);
      setAgents(agentsData);
      setChatSessions(sessionsData);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [projectId]);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      console.log('Delete agent:', id);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      
      {/* Header */}
      <div style={{ padding: '24px 32px 16px', borderBottom: '1px solid #1f1f22', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>Agents</h1>
          <p style={{ fontSize: 13, color: '#71717a', margin: '4px 0 0 0' }}>{currentProject?.name || 'Project'}</p>
        </div>
        <button 
          onClick={fetchData}
          style={{ padding: '8px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 6, color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {/* Charts Row */}
      <div style={{ padding: '20px 32px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Chart 1: Sessions per Hour (12h) */}
        <BarChart 
          title="Sessions"
          subtitle="Last 12 hours"
          data={sessionsPerHour}
          total={totalSessionsInRange}
          color="#34d399"
          loading={loading}
          showDate={true}
        />
        
        {/* Chart 2: Active Agents per Hour (12h) */}
        <BarChart 
          title="Active Agents"
          subtitle={`Peak: ${maxActiveAgents}`}
          data={activeAgentsPerHour}
          total={stats.activeAgents}
          color="#60a5fa"
          loading={loading}
          showDate={true}
        />
        
        {/* Stat Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StatCard 
            label="Total Agents" 
            value={stats.totalAgents}
            subLabel="configured"
          />
          <StatCard 
            label="All-time Sessions" 
            value={stats.totalSessions}
            subLabel="total recorded"
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 32px 32px' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 12, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>Loading...</div>
          ) : (
            <AgentsTable 
              agents={agents} 
              chatCounts={chatCountByAgent} 
              lastActive={lastActiveByAgent}
              maxChatCount={maxChatCount}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}