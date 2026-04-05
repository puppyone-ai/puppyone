'use client';

import React, { use, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { get } from '@/lib/apiClient';
import useSWR from 'swr';
import { listDir, getProjectHistory, type NodeInfo } from '@/lib/contentTreeApi';

// ================= Types =================

interface DashboardProject {
  id: string;
  name: string;
  description: string | null;
}

interface DashboardNodeCounts {
  total: number;
  folders: number;
  files: number;
}

interface DashboardConnection {
  id: string;
  provider: string;
  name: string | null;
  path: string | null;
  direction: string | null;
  status: string;
  access_key: string | null;
  trigger: any;
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string | null;
}

interface DashboardTool {
  id: string;
  name: string;
  type: string | null;
  index_status: string | null;
}

interface ProjectDashboard {
  project: DashboardProject;
  nodes: DashboardNodeCounts;
  access_points: DashboardConnection[];
  tools: DashboardTool[];
  uploads: { id: string; status: string }[];
}

// ================= Constants =================

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Desktop Sync', gmail: 'Gmail', google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar', google_docs: 'Google Docs', github: 'GitHub',
  supabase: 'Supabase', notion: 'Notion', linear: 'Linear',
  hackernews: 'Hacker News', posthog: 'PostHog',
  google_search_console: 'GSC', script: 'Script',
  agent: 'Agent', mcp: 'MCP Server', sandbox: 'Sandbox', url: 'Web Page',
};

const PROVIDER_COLORS: Record<string, string> = {
  agent: '#a78bfa', mcp: '#60a5fa', sandbox: '#f59e0b', filesystem: '#4ade80',
  gmail: '#ef4444', github: '#e4e4e7', google_sheets: '#22c55e', google_docs: '#3b82f6',
  notion: '#e4e4e7', supabase: '#3ECF8E', url: '#71717a',
};

const AGENT_ICONS = ['🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱'];
function parseAgentIcon(icon: string | null) {
  if (!icon) return '🤖';
  if (/^\d+$/.test(icon)) return AGENT_ICONS[parseInt(icon, 10) % AGENT_ICONS.length];
  return icon;
}

// ================= Helpers =================

function formatRelative(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  if (days < 7) return `${days} days ago`;
  if (weeks < 5) return `${weeks} weeks ago`;
  return `${months} months ago`;
}

// ================= Sub-Components =================

function FileIcon({ type }: { type: string }) {
  if (type === 'folder') {
    return (
      <svg aria-label="Directory" color="#79c0ff" fill="currentColor" width="16" height="16" viewBox="0 0 16 16">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
      </svg>
    );
  }
  return (
    <svg aria-label="File" color="#8b949e" fill="currentColor" width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path>
    </svg>
  );
}

function ProviderAvatar({ provider, size = 20, icon }: { provider: string; size?: number; icon?: string | null }) {
  const logos: Record<string, string> = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png',
    google_sheets: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png',
    google_docs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png',
    github: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    notion: 'https://www.notion.so/images/favicon.ico',
  };
  
  if (provider === 'agent') {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.6 }}>
        {parseAgentIcon(icon || null)}
      </div>
    );
  }

  if (logos[provider]) {
    return <img src={logos[provider]} alt={provider} width={size} height={size} style={{ display: 'block', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: '#fff' }} />;
  }
  
  const color = PROVIDER_COLORS[provider] || '#8b949e';
  const label = (PROVIDER_LABELS[provider] || provider).charAt(0).toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.55, fontWeight: 600 }}>
      {label}
    </div>
  );
}

// ================= Activity Chart =================

function ActivityChart({ buckets }: { buckets: { date: string; count: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const cW = 296, cH = 48, pY = 4;
  const mx = Math.max(...buckets.map(b => b.count), 1);
  const pts = buckets.map((b, i) => ({
    x: (i / (buckets.length - 1)) * cW,
    y: pY + (1 - b.count / mx) * (cH - pY * 2),
    ...b,
  }));
  const ln = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const ar = `${ln} L${pts[pts.length - 1].x},${cH} L${pts[0].x},${cH} Z`;
  const total = buckets.reduce((s, b) => s + b.count, 0);

  const dateLabels = useMemo(() => {
    const len = buckets.length;
    if (len < 2) return [];
    const step = len <= 10 ? 3 : len <= 20 ? 5 : 7;
    const labels: { idx: number; label: string }[] = [];
    for (let i = 0; i < len; i += step) {
      const d = buckets[i].date;
      labels.push({ idx: i, label: d.slice(5).replace('-', '/') });
    }
    return labels;
  }, [buckets]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = relX / rect.width;
    const idx = Math.round(ratio * (buckets.length - 1));
    setHoverIdx(Math.max(0, Math.min(buckets.length - 1, idx)));
  };

  const hp = hoverIdx !== null ? pts[hoverIdx] : null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, color: '#52525b', marginBottom: 8 }}>
        {total} commits in the last 30 days
      </div>
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${cW} ${cH}`}
          style={{ width: '100%', height: 48, display: 'block', cursor: 'crosshair' }}
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="sbGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={ar} fill="url(#sbGrad)" />
          <path d={ln} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {pts.filter(p => p.count > 0).map(p => (
            <circle key={p.date} cx={p.x} cy={p.y} r="2" fill="#22c55e" vectorEffect="non-scaling-stroke" />
          ))}
          {hp && (
            <>
              <line x1={hp.x} y1={0} x2={hp.x} y2={cH} stroke="rgba(255,255,255,0.15)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2,2" />
              <circle cx={hp.x} cy={hp.y} r="3.5" fill="#22c55e" stroke="#0e0e0e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {/* Tooltip */}
        {hp && (
          <div style={{
            position: 'absolute', top: -32,
            left: Math.min(Math.max(hp.x / cW * 100, 10), 90) + '%',
            transform: 'translateX(-50%)',
            background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, padding: '4px 8px', pointerEvents: 'none',
            fontSize: 12, whiteSpace: 'nowrap', zIndex: 10,
          }}>
            <span style={{ color: '#c9d1d9', fontWeight: 500 }}>{hp.count} commit{hp.count !== 1 ? 's' : ''}</span>
            <span style={{ color: '#52525b', marginLeft: 6 }}>{hp.date.slice(5).replace('-', '/')}</span>
          </div>
        )}
      </div>
      {/* X-axis date labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, position: 'relative', height: 14 }}>
        {dateLabels.map(dl => (
          <span
            key={dl.idx}
            style={{
              position: 'absolute',
              left: `${(dl.idx / (buckets.length - 1)) * 100}%`,
              transform: 'translateX(-50%)',
              fontSize: 10, color: '#3f3f46',
            }}
          >
            {dl.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ================= Main Page =================

export default function HomePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();

  const { data: dashboard } = useSWR<ProjectDashboard>(
    projectId ? `/api/v1/projects/${projectId}/dashboard` : null,
    (url: string) => get<ProjectDashboard>(url),
    { refreshInterval: 30000 }
  );

  const { data: rootNodes } = useSWR(
    projectId ? ['root-nodes', projectId] : null,
    () => listDir(projectId, '')
  );

  const { data: historyData } = useSWR(
    projectId ? ['project-history-overview', projectId] : null,
    () => getProjectHistory(projectId, 50)
  );

  const commits = historyData?.commits || [];
  const latestCommit = commits.length > 0 ? commits[commits.length - 1] : null;

  const commitBuckets = useMemo(() => {
    const buckets: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    commits.forEach(c => {
      if (!c.created_at) return;
      const day = c.created_at.slice(0, 10);
      const bucket = buckets.find(b => b.date === day);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [commits]);
  const connections = dashboard?.access_points || [];

  const [connectOpen, setConnectOpen] = useState(false);
  const connectDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!connectOpen) return;
    const handler = (e: MouseEvent) => {
      if (connectDropdownRef.current && !connectDropdownRef.current.contains(e.target as Node)) {
        setConnectOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [connectOpen]);

  const apiBase = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin)
    : '';
  const connectMethods = [
    { label: 'CLI', cmd: `puppyone project use ${projectId}` },
    { label: 'MUT Protocol', cmd: `${apiBase}/api/v1/mut/${projectId}` },
  ];
  
  const files = (rootNodes?.nodes || []).sort((a: NodeInfo, b: NodeInfo) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });

  const fileLastCommit = useMemo(() => {
    const map: Record<string, { message: string; created_at: string | null }> = {};
    const reversedCommits = [...commits].reverse();
    for (const node of files) {
      for (const commit of reversedCommits) {
        const touches = commit.changes.some(c =>
          c.path === node.path || c.path.startsWith(node.path + '/')
        );
        if (touches) {
          map[node.path] = { message: commit.message, created_at: commit.created_at };
          break;
        }
      }
    }
    return map;
  }, [commits, files]);

  if (!dashboard) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: 14, background: '#0e0e0e' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e', color: '#c9d1d9', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"' }}>
      
      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: '#0e0e0e', fontSize: 13, fontWeight: 500, color: '#e4e4e7',
      }}>
        Home
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', maxWidth: 1280, margin: '0 auto', width: '100%', padding: '24px 24px', gap: 32 }}>
        
        {/* Left Column: Files */}
        <div style={{ flex: 1, minWidth: 0 }}>
          
          {/* Project title + ID + Connect (Supabase-style) */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 600, color: '#e4e4e7', margin: 0, lineHeight: 1.3 }}>
                  {dashboard.project.name}
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: '#52525b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{projectId}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(projectId)}
                    style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                    title="Copy project ID"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>
                  </button>
                </div>
              </div>
              {/* Connect dropdown */}
              <div style={{ position: 'relative', flexShrink: 0, marginTop: 2 }} ref={connectDropdownRef}>
                <button
                  onClick={() => setConnectOpen(!connectOpen)}
                  style={{
                    background: '#22c55e', border: 'none', borderRadius: 6,
                    padding: '6px 14px', cursor: 'pointer', color: '#fff',
                    fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  Connect <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path></svg>
                </button>
                {connectOpen && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 400, background: '#161618', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13, fontWeight: 600, color: '#c9d1d9' }}>
                      Connect to this ContextBase
                    </div>
                    {/* Access points first */}
                    <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ padding: '4px 16px 6px', fontSize: 11, color: '#52525b', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>Access Points</div>
                      {connections.length > 0 ? connections.map(conn => (
                        <div
                          key={conn.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          onClick={() => { setConnectOpen(false); router.push(`/projects/${projectId}/access`); }}
                        >
                          <ProviderAvatar provider={conn.provider} size={22} icon={(conn as any).icon} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: '#c9d1d9', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {conn.name || PROVIDER_LABELS[conn.provider] || conn.provider}
                            </div>
                          </div>
                          {conn.access_key && (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(conn.access_key!); }}
                              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 6px', color: '#52525b', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
                              title="Copy access key"
                            >
                              Copy key
                            </button>
                          )}
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: conn.status === 'error' ? '#ef4444' : '#22c55e', flexShrink: 0 }} />
                        </div>
                      )) : (
                        <div style={{ padding: '8px 16px', fontSize: 13, color: '#3f3f46' }}>No access points yet</div>
                      )}
                    </div>
                    {/* CLI + MUT Protocol */}
                    <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {connectMethods.map(m => (
                        <div
                          key={m.label}
                          style={{ padding: '8px 16px', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          onClick={() => navigator.clipboard.writeText(m.cmd)}
                        >
                          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>{m.label}</div>
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 4, padding: '6px 10px',
                          }}>
                            <code style={{ fontSize: 12, color: '#c9d1d9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.cmd}
                            </code>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="#52525b" style={{ flexShrink: 0 }}><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#58a6ff', fontSize: 13, fontWeight: 500 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => { setConnectOpen(false); router.push(`/projects/${projectId}/access`); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"></path></svg>
                      Create new access point
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Inline status text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, fontSize: 13, color: '#52525b' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: connections.some(c => c.status === 'error') ? '#ef4444' : '#22c55e', display: 'inline-block' }} />
                {connections.some(c => c.status === 'error') ? 'Unhealthy' : 'Active'}
              </span>
              <span style={{ color: '#3f3f46' }}>·</span>
              <span style={{ cursor: 'pointer' }} onClick={() => router.push(`/projects/${projectId}/history`)}>
                <span style={{ color: '#8b949e', fontWeight: 500 }}>{latestCommit ? `v${latestCommit.version}` : '—'}</span> · {historyData?.total || 0} versions
              </span>
              <span style={{ color: '#3f3f46' }}>·</span>
              <span style={{ cursor: 'pointer' }} onClick={() => router.push(`/projects/${projectId}/access`)}>
                <span style={{ color: '#8b949e', fontWeight: 500 }}>{connections.length}</span> access points
              </span>
              {latestCommit && (
                <>
                  <span style={{ color: '#3f3f46' }}>·</span>
                  <span>{formatRelative(latestCommit.created_at)}</span>
                </>
              )}
            </div>
          </div>

          {/* File Box */}
          <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, overflow: 'hidden', marginBottom: 24 }}>
            
            {/* Latest Commit Header */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {latestCommit ? (
                  <>
                    <ProviderAvatar provider={latestCommit.who === 'system' ? 'agent' : 'filesystem'} size={24} />
                    <span style={{ fontWeight: 600, color: '#c9d1d9', fontSize: 14 }}>{latestCommit.who}</span>
                    <span style={{ color: '#8b949e', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {latestCommit.message || `v${latestCommit.version}`}
                    </span>
                  </>
                ) : (
                  <span style={{ color: '#8b949e', fontSize: 14 }}>No commits yet</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, fontSize: 14 }}>
                {latestCommit && (
                  <>
                    <span style={{ color: '#8b949e', fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace' }}>{latestCommit.root_hash.substring(0, 7)}</span>
                    <span style={{ color: '#8b949e' }}>{formatRelative(latestCommit.created_at)}</span>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#c9d1d9', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push(`/projects/${projectId}/history`)}>
                  <svg color="#8b949e" fill="currentColor" width="16" height="16" viewBox="0 0 16 16"><path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"></path></svg>
                  <strong>{historyData?.total || 0}</strong> <span style={{ color: '#8b949e', fontWeight: 400 }}>Commits</span>
                </div>
              </div>
            </div>

            {/* File Rows */}
            {files.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#8b949e', fontSize: 14 }}>
                This repository is empty.
              </div>
            ) : (
              files.map((node: NodeInfo, i: number) => (
                <div
                  key={node.path}
                  onClick={() => router.push(`/projects/${projectId}/data/${node.path}`)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer',
                    borderBottom: i < files.length - 1 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                    background: '#0e0e0e'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#0e0e0e'}
                >
                  <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileIcon type={node.type} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
                    <span style={{ fontSize: 14, color: '#c9d1d9', textDecoration: 'none' }} onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'} onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                      {node.name}
                    </span>
                  </div>
                  <div style={{ width: '40%', color: '#8b949e', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fileLastCommit[node.path]?.message || ''}
                  </div>
                  <div style={{ width: 100, textAlign: 'right', color: '#8b949e', fontSize: 14, flexShrink: 0 }}>
                    {formatRelative(fileLastCommit[node.path]?.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>


        </div>

        {/* Right Sidebar */}
        <div style={{ width: 296, flexShrink: 0 }}>
          
          {/* History Preview (timeline tree) */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#c9d1d9', margin: 0 }}>
                History <span style={{ background: 'rgba(110,118,129,0.4)', color: '#c9d1d9', borderRadius: 10, padding: '2px 8px', fontSize: 12, marginLeft: 4, fontWeight: 500 }}>{historyData?.total || 0}</span>
              </h2>
              <span onClick={() => router.push(`/projects/${projectId}/history`)} style={{ fontSize: 12, color: '#58a6ff', cursor: 'pointer' }}>View all</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[...commits].reverse().slice(0, 5).map((commit, i) => {
                const isLast = i === Math.min(commits.length, 5) - 1;
                const isHead = i === 0;
                return (
                  <div key={`v${commit.version}`} style={{ display: 'flex', gap: 10, cursor: 'pointer' }} onClick={() => router.push(`/projects/${projectId}/history`)}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isHead ? '#22c55e' : '#0e0e0e', border: `2px solid ${isHead ? '#22c55e' : '#3f3f46'}`, zIndex: 1, flexShrink: 0, marginTop: 3 }} />
                      {!isLast && (
                        <div style={{ width: 2, flex: 1, background: '#3f3f46' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: isLast ? 0 : 8, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {commit.message || `v${commit.version}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#52525b', marginTop: 1 }}>{formatRelative(commit.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              {commits.length === 0 && (
                <div style={{ fontSize: 13, color: '#8b949e' }}>No commits yet</div>
              )}
            </div>
          </div>

          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }}></div>

          {/* Commit Activity Chart */}
          {commitBuckets.length > 1 && <ActivityChart buckets={commitBuckets} />}

          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }}></div>

          {/* Access Points */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#c9d1d9', margin: 0, display: 'flex', alignItems: 'center' }}>
                Access Points <span style={{ background: 'rgba(110,118,129,0.4)', color: '#c9d1d9', borderRadius: 10, padding: '2px 8px', fontSize: 12, marginLeft: 8, fontWeight: 500 }}>{connections.length}</span>
              </h2>
              <span onClick={() => router.push(`/projects/${projectId}/access`)} style={{ fontSize: 12, color: '#58a6ff', cursor: 'pointer' }}>Manage</span>
            </div>
            
            {connections.length === 0 ? (
              <div style={{ fontSize: 13, color: '#8b949e' }}>No access points configured.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {connections.map(conn => {
                  const statusColor = conn.status === 'error' ? '#ef4444' : conn.status === 'paused' ? '#eab308' : conn.status === 'syncing' ? '#3b82f6' : '#22c55e';
                  return (
                    <div key={conn.id} onClick={() => router.push(`/projects/${projectId}/access`)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
                      <ProviderAvatar provider={conn.provider} size={28} icon={(conn as any).icon} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#c9d1d9', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conn.name || PROVIDER_LABELS[conn.provider] || conn.provider}
                        </div>
                        <div style={{ fontSize: 12, color: '#8b949e' }}>
                          {PROVIDER_LABELS[conn.provider] || conn.provider}
                        </div>
                      </div>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
      </div>
    </div>
  );
}
