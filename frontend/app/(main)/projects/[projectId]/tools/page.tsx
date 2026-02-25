'use client';

/**
 * Project Access Dashboard
 * 
 * Unified monitoring for all access points: agents + sync endpoints.
 * Charts track agent activity (bash, tool, messages, sessions).
 * Access Points table lists both agents and data sync endpoints.
 */

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import { getDashboardData, type DashboardData } from '@/lib/chatApi';
import { get } from '@/lib/apiClient';
import useSWR from 'swr';

// ================= Types =================

interface TimeSeriesBucket {
  bucket: string;
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
  chat: 'Chat Agent',
  schedule: 'Schedule',
  webhook: 'Webhook',
};

const PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  gmail: 'Gmail',
  google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar',
  google_docs: 'Google Docs',
  github: 'GitHub',
  supabase: 'Supabase',
  notion: 'Notion',
  linear: 'Linear',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: '← Inbound',
  outbound: '→ Outbound',
  bidirectional: '↔ Bidirectional',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  syncing: '#3b82f6',
  paused: '#eab308',
  error: '#ef4444',
};

const AGENT_ICONS = ['🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱'];

function parseAgentIcon(icon: string) {
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon || '🤖';
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

  if (provider === 'openclaw') {
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

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
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

// ================= Access Points Table =================

function AccessPointsTable({ points }: { points: AccessPoint[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const gridTemplate = '40px 1.5fr 140px 100px 140px 100px';

  if (points.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>No access points configured yet.</div>;
  }

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
        const statusColor = point.kind === 'sync'
          ? (STATUS_COLORS[point.status] || '#52525b')
          : (point.sessionCount > 0 ? '#22c55e' : '#52525b');

        return (
          <div
            key={point.id}
            onMouseEnter={() => setHoveredId(point.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'grid', gridTemplateColumns: gridTemplate, padding: '12px 24px', alignItems: 'center',
              background: isHovered ? '#18181b' : 'transparent', borderBottom: '1px solid #1f1f22', transition: 'background 0.1s',
            }}
          >
            <div style={{ textAlign: 'center', color: '#52525b', fontSize: 12 }}>{index + 1}</div>

            {/* Name + Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: point.kind === 'sync' ? '#18181b' : '#27272a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                border: point.kind === 'sync' ? '1px solid #27272a' : 'none',
              }}>
                {point.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{point.name}</div>
                {point.direction && (
                  <div style={{ fontSize: 11, color: '#52525b', marginTop: 1 }}>
                    {DIRECTION_LABELS[point.direction] || point.direction}
                  </div>
                )}
              </div>
            </div>

            {/* Type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: point.kind === 'sync' ? 'rgba(59,130,246,0.1)' : 'rgba(113,113,122,0.1)',
                color: point.kind === 'sync' ? '#60a5fa' : '#a1a1aa',
                fontWeight: 500,
              }}>
                {point.typeLabel}
              </span>
            </div>

            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
              <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'capitalize' }}>
                {point.status}
              </span>
            </div>

            {/* Activity */}
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
                <span style={{ fontSize: 12, color: point.errorMessage ? '#ef4444' : '#71717a' }}>
                  {point.errorMessage || (point.status === 'syncing' ? 'Syncing…' : '—')}
                </span>
              )}
            </div>

            {/* Last Active */}
            <div style={{ fontSize: 12, color: point.lastActive ? '#a1a1aa' : '#52525b' }}>
              {formatRelativeTime(point.lastActive || undefined)}
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
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const RANGE_HOURS = 24;

  // Fetch sync status from backend API
  const { data: syncData } = useSWR<ProjectSyncStatus>(
    projectId ? ['sync-status-dashboard', projectId] : null,
    () => get<ProjectSyncStatus>(`/api/v1/sync/status?project_id=${projectId}`),
    { refreshInterval: 30000, revalidateOnFocus: true },
  );

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

  const maxChatCount = useMemo(() => {
    if (!dashboardData?.agents) return 0;
    const counts = dashboardData.agents.map(a => a.chat_count);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [dashboardData?.agents]);

  // Build unified access points list: agents + sync endpoints
  const accessPoints = useMemo<AccessPoint[]>(() => {
    const points: AccessPoint[] = [];

    // Agents
    (dashboardData?.agents || []).forEach(agent => {
      points.push({
        id: agent.id,
        kind: 'agent',
        name: agent.name,
        icon: <span style={{ fontSize: 16 }}>{parseAgentIcon(agent.icon || '')}</span>,
        typeLabel: AGENT_TYPE_LABELS[agent.agent_type] || agent.agent_type,
        status: agent.chat_count > 0 ? 'active' : 'idle',
        lastActive: agent.last_active,
        sessionCount: agent.chat_count,
        maxSessionCount: maxChatCount,
      });
    });

    // Sync endpoints
    (syncData?.syncs || []).forEach(sync => {
      points.push({
        id: sync.id,
        kind: 'sync',
        name: sync.node_name || PROVIDER_LABELS[sync.provider] || sync.provider,
        icon: <ProviderIcon provider={sync.provider} size={16} />,
        typeLabel: PROVIDER_LABELS[sync.provider] || sync.provider,
        status: sync.status,
        lastActive: sync.last_synced_at,
        sessionCount: 0,
        maxSessionCount: 0,
        direction: sync.direction,
        provider: sync.provider,
        errorMessage: sync.error_message,
      });
    });

    return points;
  }, [dashboardData?.agents, syncData?.syncs, maxChatCount]);

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

          {/* Section: Access Points - Agents + Sync Endpoints */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 500, color: '#71717a', margin: 0 }}>
                Access Points
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: '#a1a1aa' }} />
                  <span style={{ fontSize: 11, color: '#52525b' }}>
                    {accessPoints.filter(p => p.kind === 'agent').length} Agents
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: '#60a5fa' }} />
                  <span style={{ fontSize: 11, color: '#52525b' }}>
                    {accessPoints.filter(p => p.kind === 'sync').length} Sync Endpoints
                  </span>
                </div>
              </div>
            </div>
            <div style={{ background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 12, overflow: 'hidden' }}>
            {loading && !dashboardData ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#52525b' }}>Loading...</div>
            ) : (
              <AccessPointsTable points={accessPoints} />
            )}
            </div>
          </div>
        
        </div>
      </div>
    </div>
  );
}
