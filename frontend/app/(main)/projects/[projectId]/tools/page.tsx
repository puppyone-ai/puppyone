'use client';

/**
 * Project Agents Page (Agent Dashboard)
 * 
 * Monitoring dashboard with multiple charts:
 * 1. Bash Executions (24h)
 * 2. Tool Usage (24h)
 * 3. Messages (24h)
 * 4. Sessions (24h)
 * 
 * Uses a single RPC call to fetch all dashboard data for optimal performance.
 */

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { getDashboardData, type DashboardData } from '@/lib/chatApi';

// ================= Types =================

interface TimeSeriesBucket {
  bucket: string;  // Local hour key like "2026-01-31-14"
  count: number;
}

interface DashboardAgent {
  id: string;
  name: string;
  icon: string | null;
  agent_type: string;
  created_at: string;
  chat_count: number;
  last_active: string | null;
  bash_count: number;
  data_access_count: number;
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

/**
 * Convert RPC time series (UTC buckets) to local time buckets
 * RPC returns: [{ bucket: "2026-01-31T14:00:00+00:00", count: 5 }, ...]
 * We need: [{ bucket: "2026-01-31-22", count: 5 }, ...] (local time keys)
 */
function convertToLocalTimeSeries(
  rpcData: { bucket: string; count: number }[] | null,
  rangeHours: number = 24
): TimeSeriesBucket[] {
  const now = new Date();
  const startTime = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);
  
  // Create empty buckets for each hour (LOCAL time)
  const buckets: Map<string, number> = new Map();
  const current = new Date(startTime);
  current.setMinutes(0, 0, 0);
  
  while (current <= now) {
    const key = getLocalHourKey(current);
    buckets.set(key, 0);
    current.setTime(current.getTime() + 60 * 60 * 1000);
  }
  
  // Map RPC data (UTC) to local buckets
  if (rpcData && Array.isArray(rpcData)) {
    rpcData.forEach(item => {
      // Parse UTC timestamp and convert to local
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
  // Base max for Y-axis scale. 
  const max = Math.max(...data.map(d => d.count), 16);
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
      padding: '20px 24px',
      minHeight: 240,       // Increased total height significantly
      display: 'flex',
      flexDirection: 'column',
      position: 'relative', // For absolute tooltip
    }}>
      {/* Header - Optimized Layout */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            {title}
          </span>
          {showDate && (
            <span style={{ fontSize: 11, color: '#3f3f46' }}>
              {formatDateShort()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontSize: 32, fontWeight: 500, color: '#f4f4f5', letterSpacing: '-0.02em', lineHeight: 1 }}>
            {loading ? '...' : total}
          </div>
          
          {/* Hover tooltip - Absolute Positioned */}
          {hoveredIndex !== null && data[hoveredIndex] && (
            <div style={{ 
              position: 'absolute',
              top: 20,
              right: 24,
              fontSize: 11, 
              color: '#e4e4e7', 
              background: '#27272a', 
              padding: '4px 8px', 
              borderRadius: 4,
              whiteSpace: 'nowrap',
              border: '1px solid #3f3f46',
              zIndex: 10,
              pointerEvents: 'none', 
            }}>
              {formatHourFull(data[hoveredIndex].bucket)}: <strong>{data[hoveredIndex].count}</strong>
            </div>
          )}
        </div>
      </div>
      
      {/* Chart */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {loading ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>
            No data
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
              {data.map((d, i) => {
                const isHovered = hoveredIndex === i;
                const count = d.count;
                // Threshold: If count <= 14, show as mosaic blocks. 
                const isMosaic = count > 0 && count <= 14; 
                
                return (
                  <div
                    key={d.bucket}
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={{
                      flex: 1,
                      height: '100%', 
                      display: 'flex',
                      alignItems: 'flex-end',
                      cursor: 'pointer',
                    }}
                  >
                    {isMosaic ? (
                      // Mosaic Mode: Stack of distinct blocks
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
                        {Array.from({ length: count }).map((_, idx) => (
                          <div 
                            key={idx}
                            style={{
                              width: '100%',
                              height: 8, // Refined height: 8px (Balanced)
                              background: isHovered ? '#fff' : color,
                              opacity: isHovered ? 1 : 0.8 + (idx * 0.02),
                              borderRadius: 1,
                              transition: 'background 0.1s',
                            }} 
                          />
                        ))}
                      </div>
                    ) : (
                      // Bar Mode: Continuous bar (or tiny placeholder for 0)
                      <div
                        style={{
                          width: '100%',
                          // If 0, show tiny 2px placeholder. If > threshold, show percentage.
                          height: d.count === 0 ? 2 : `${Math.max((d.count / max) * 100, 8)}%`,
                          background: isHovered 
                            ? (d.count > 0 ? '#fff' : '#3f3f46') 
                            : (d.count > 0 ? color : '#27272a'),
                          borderRadius: d.count === 0 ? 1 : '2px 2px 0 0',
                          minHeight: d.count === 0 ? 2 : 8,
                          transition: 'background 0.1s',
                          opacity: d.count === 0 ? 0.5 : 1, // Dim the zero placeholder
                        }}
                      />
                    )}
                  </div>
                );
              })}
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
    </div>
  );
}

// ================= Agents Table =================

interface AgentsTableProps {
  agents: DashboardAgent[];
  maxChatCount: number;
  onDelete?: (id: string) => void;
}

function AgentsTable({ agents, maxChatCount, onDelete }: AgentsTableProps) {
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
        const typeLabel = AGENT_TYPE_LABELS[agent.agent_type] || agent.agent_type;
        const usagePercent = maxChatCount > 0 ? (agent.chat_count / maxChatCount) * 100 : 0;

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
                {parseAgentIcon(agent.icon || '')}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{agent.name}</div>
            </div>
            <div style={{ fontSize: 12, color: '#71717a' }}>{typeLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {agent.data_access_count > 0 ? (
                <>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: '#3b82f6' }} />
                  <span style={{ fontSize: 12, color: '#d4d4d8' }}>{agent.data_access_count} sources</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: '#52525b' }}>—</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#e4e4e7', minWidth: 20 }}>{agent.chat_count}</span>
              {agent.chat_count > 0 && (
                <div style={{ flex: 1, height: 4, background: '#27272a', borderRadius: 2, maxWidth: 80 }}>
                  <div style={{ width: `${usagePercent}%`, height: '100%', background: '#10b981', borderRadius: 2 }} />
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: agent.last_active ? '#a1a1aa' : '#52525b' }}>
              {formatRelativeTime(agent.last_active || undefined)}
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
  
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const RANGE_HOURS = 24; // Show last 24 hours

  // Convert RPC time series to local time buckets
  const bashPerHour = useMemo(() => 
    convertToLocalTimeSeries(dashboardData?.bashPerHour || null, RANGE_HOURS), 
    [dashboardData?.bashPerHour]
  );
  const toolsPerHour = useMemo(() => 
    convertToLocalTimeSeries(dashboardData?.toolsPerHour || null, RANGE_HOURS), 
    [dashboardData?.toolsPerHour]
  );
  const messagesPerHour = useMemo(() => 
    convertToLocalTimeSeries(dashboardData?.messagesPerHour || null, RANGE_HOURS), 
    [dashboardData?.messagesPerHour]
  );
  const sessionsPerHour = useMemo(() => 
    convertToLocalTimeSeries(dashboardData?.sessionsPerHour || null, RANGE_HOURS), 
    [dashboardData?.sessionsPerHour]
  );

  // Max chat count for usage bar scaling
  const maxChatCount = useMemo(() => {
    if (!dashboardData?.agents) return 0;
    const counts = dashboardData.agents.map(a => a.chat_count);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [dashboardData?.agents]);

  // Fetch dashboard data for this project
  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboardData(projectId, RANGE_HOURS);
      setDashboardData(data);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      console.log('Delete agent:', id);
      // TODO: Implement delete and refresh
    }
  };

  // Error state
  if (error && !loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b' }}>
        <div style={{ textAlign: 'center', color: '#ef4444' }}>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <button 
            onClick={fetchData}
            style={{ padding: '8px 16px', background: '#18181b', border: '1px solid #27272a', borderRadius: 6, color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      
      {/* Context Header - Aligned with ProjectsHeader */}
      <div style={{ 
        height: 48, 
        minHeight: 48,
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '0 16px',
        background: '#141414',
        flexShrink: 0 
      }}>
        {/* Left: Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>Context Access Dashboard</h1>
        </div>
        
        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            onClick={fetchData}
            disabled={loading}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              borderRadius: 4, 
              color: loading ? '#52525b' : '#a1a1aa', 
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 6,
              transition: 'color 0.2s, background 0.2s',
            }}
            title="Refresh"
            onMouseEnter={e => !loading && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)', e.currentTarget.style.color = '#e4e4e7')}
            onMouseLeave={e => !loading && (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#a1a1aa')}
          >
            <svg 
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <style jsx>{`
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
          </button>
        </div>
      </div>

      {/* Main Content (Scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>

          {/* Section: Access Monitor - L2 */}
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ 
              fontSize: 16, 
              fontWeight: 500, 
              color: '#71717a', 
              margin: '0 0 16px 0',
            }}>
              Access Monitor
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <BarChart 
              title="Bash Executions"
              data={bashPerHour}
              total={dashboardData?.bashInRange ?? 0}
              color="#34d399"
              loading={loading}
              showDate={true}
            />
            
            <BarChart 
              title="Tool Usage"
              data={toolsPerHour}
              total={dashboardData?.toolsInRange ?? 0}
              color="#34d399"
              loading={loading}
              showDate={true}
            />
            
            <BarChart 
              title="Messages"
              data={messagesPerHour}
              total={dashboardData?.messagesInRange ?? 0}
              color="#34d399"
              loading={loading}
              showDate={true}
            />

            <BarChart 
              title="Sessions"
              data={sessionsPerHour}
              total={dashboardData?.sessionsInRange ?? 0}
              color="#34d399"
              loading={loading}
              showDate={true}
            />
            </div>
          </div>

          {/* Section: Access Points - L3 */}
          <div style={{ marginBottom: 48 }}>
            <h3 style={{ 
              fontSize: 16, 
              fontWeight: 500, 
              color: '#71717a', 
              margin: '0 0 16px 0',
            }}>
              Access Points
            </h3>
            <div style={{ background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 12, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>Loading...</div>
            ) : (
              <AgentsTable 
                agents={dashboardData?.agents ?? []} 
                maxChatCount={maxChatCount}
                onDelete={handleDelete}
              />
            )}
            </div>
          </div>
        
        </div>
      </div>
    </div>
  );
}
