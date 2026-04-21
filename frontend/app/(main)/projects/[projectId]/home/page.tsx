'use client';

import React, { use, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { get } from '@/lib/apiClient';
import useSWR from 'swr';
import { treeList, getProjectHistory, type TreeEntry } from '@/lib/contentTreeApi';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, position: 'relative', height: 14 }}>
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

// ================= Data Tree =================

interface TreeNode {
  entry: TreeEntry;
  children: TreeNode[];
}

function TreeRows({
  nodes, depth, projectId, router, accessByPath,
}: {
  nodes: TreeNode[];
  depth: number;
  projectId: string;
  router: ReturnType<typeof useRouter>;
  accessByPath: Map<string, DashboardConnection[]>;
}) {
  return (
    <>
      {nodes.map((node, idx) => {
        const { entry, children } = node;
        const isFolder = entry.type === 'folder';
        const isLast = idx === nodes.length - 1;
        const attachedAccess = accessByPath.get(entry.path) || [];
        const encodedPath = entry.path.split('/').map(s => encodeURIComponent(s)).join('/');

        return (
          <React.Fragment key={entry.path}>
            <div
              className="group/row flex items-center gap-0 cursor-pointer hover:bg-[rgba(255,255,255,0.03)] transition-colors"
              style={{ height: 32, paddingRight: 12 }}
              onClick={() => router.push(`/projects/${projectId}/data/${encodedPath}${entry.type ? `?type=${encodeURIComponent(entry.type)}` : ''}`)}
            >
              {/* Tree guides */}
              <div style={{ width: 16 + depth * 20, flexShrink: 0, height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 0 }}>
                {depth > 0 && (
                  <svg width={20} height={32} style={{ position: 'absolute', right: 0, top: 0 }} viewBox="0 0 20 32" fill="none">
                    <line x1="10" y1="0" x2="10" y2={isLast ? 16 : 32} stroke="#2a2a2a" strokeWidth="1" />
                    <line x1="10" y1="16" x2="20" y2="16" stroke="#2a2a2a" strokeWidth="1" />
                  </svg>
                )}
              </div>

              {/* Icon */}
              <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 6 }}>
                <FileIcon type={entry.type} />
              </div>

              {/* Name */}
              <span className="text-[13px] truncate group-hover/row:text-[#e4e4e7] transition-colors" style={{ color: isFolder ? '#c9d1d9' : '#8b949e', fontWeight: isFolder ? 500 : 400 }}>
                {entry.name}
              </span>

              {/* Folder item count */}
              {isFolder && entry.children_count != null && entry.children_count > 0 && (
                <span className="text-[11px] ml-2 flex-shrink-0" style={{ color: '#52525b' }}>
                  {entry.children_count}
                </span>
              )}

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Access point badges */}
              {attachedAccess.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {attachedAccess.map(conn => (
                    <div
                      key={conn.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '2px 8px 2px 5px',
                        borderRadius: 10,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                      title={`${conn.name || PROVIDER_LABELS[conn.provider] || conn.provider} — ${conn.status}`}
                    >
                      <ProviderAvatar provider={conn.provider} size={14} icon={(conn as any).icon} />
                      <span style={{ fontSize: 11, color: '#71717a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {conn.name || PROVIDER_LABELS[conn.provider] || conn.provider}
                      </span>
                      <div style={{
                        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                        background: conn.status === 'error' ? '#ef4444' : conn.status === 'paused' ? '#eab308' : '#22c55e',
                      }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Render children */}
            {children.length > 0 && (
              <div style={{ position: 'relative' }}>
                {/* Vertical continuation line for parent */}
                {depth > 0 && !isLast && (
                  <div style={{
                    position: 'absolute', left: 16 + (depth - 1) * 20 + 10, top: 0, bottom: 0,
                    width: 1, background: '#2a2a2a',
                  }} />
                )}
                <TreeRows nodes={children} depth={depth + 1} projectId={projectId} router={router} accessByPath={accessByPath} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ================= Access Point Row =================
// Each row owns its own `copied` state so we don't need a Map in the parent.
// Copy-key button hover-reveals so the resting state stays calm.

function AccessPointRow({ conn, onSelect }: { conn: DashboardConnection; onSelect: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!conn.access_key) return;
    navigator.clipboard.writeText(conn.access_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const statusColor = conn.status === 'error' ? '#ef4444'
    : conn.status === 'paused' ? '#eab308'
    : conn.status === 'syncing' ? '#3b82f6' : '#22c55e';

  return (
    <div
      onClick={onSelect}
      style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '6px 8px', margin: '-6px -8px', borderRadius: 8 }}
      className="hover:bg-[#1a1a1a] transition-colors group"
    >
      <div className="opacity-80 group-hover:opacity-100 transition-opacity">
        <ProviderAvatar provider={conn.provider} size={28} icon={(conn as any).icon} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#888', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="group-hover:text-[#ccc] transition-colors">
          {conn.name || PROVIDER_LABELS[conn.provider] || conn.provider}
        </div>
        <div style={{ fontSize: 11, color: '#555' }} className="group-hover:text-[#666] transition-colors">
          {PROVIDER_LABELS[conn.provider] || conn.provider}
        </div>
      </div>
      {conn.access_key && (
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4, padding: '3px 7px', color: copied ? '#22c55e' : '#71717a',
            fontSize: 11, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          title={copied ? 'Copied!' : 'Copy access key'}
        >
          {copied ? (
            <>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>
              Copied
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>
              Copy key
            </>
          )}
        </button>
      )}
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 8px ${statusColor}40` }} />
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

  const { data: treeEntries } = useSWR(
    projectId ? ['home-tree', projectId] : null,
    () => treeList(projectId, '', 3)
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
  
  const tree = useMemo(() => {
    const entries = treeEntries || [];
    const sorted = [...entries].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const entry of sorted) {
      nodeMap.set(entry.path, { entry, children: [] });
    }

    for (const entry of sorted) {
      const node = nodeMap.get(entry.path)!;
      const slashIdx = entry.path.lastIndexOf('/');
      if (slashIdx === -1) {
        roots.push(node);
      } else {
        const parentPath = entry.path.substring(0, slashIdx);
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    }
    return roots;
  }, [treeEntries]);

  const accessByPath = useMemo(() => {
    const map = new Map<string, DashboardConnection[]>();
    for (const conn of connections) {
      const key = conn.path || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(conn);
    }
    return map;
  }, [connections]);

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
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 1160, margin: '0 auto', width: '100%', padding: '24px 24px' }}>
        
        {/* Header - Spans full width */}
        <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: '#e4e4e7', margin: 0, lineHeight: 1 }}>
              {dashboard.project.name}
            </h1>
            {/* Inline status text moved to Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#666' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: connections.some(c => c.status === 'error') ? '#ef4444' : '#22c55e', display: 'inline-block' }} />
                {connections.some(c => c.status === 'error') ? 'Unhealthy' : 'Active'}
              </span>
              <span style={{ color: '#333' }}>·</span>
              <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => router.push(`/projects/${projectId}/history`)}>
                <span
                  style={{ color: '#888', fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace' }}
                  title={latestCommit?.commit_id}
                >
                  {latestCommit ? latestCommit.commit_id.slice(0, 8) : '—'}
                </span>
                <span>·</span>
                <span>{historyData?.total || 0} commits</span>
              </span>
              <span style={{ color: '#333' }}>·</span>
              <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => router.push(`/projects/${projectId}/access`)}>
                <span style={{ color: '#888' }}>{connections.length}</span>
                <span>access points</span>
              </span>
              {latestCommit && (
                <>
                  <span style={{ color: '#333' }}>·</span>
                  <span>{formatRelative(latestCommit.created_at)}</span>
                </>
              )}
            </div>
            
            {/* Project ID + ghost Connect link (project-level wire endpoints) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#555', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{projectId}</span>
              <button
                onClick={() => navigator.clipboard.writeText(projectId)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                title="Copy project ID"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>
              </button>
              <span style={{ color: '#333', fontSize: 12, marginLeft: 4, marginRight: 2 }}>·</span>
              <div style={{ position: 'relative', display: 'inline-flex' }} ref={connectDropdownRef}>
                <button
                  onClick={() => setConnectOpen(!connectOpen)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '0 2px', display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontFamily: 'inherit', color: connectOpen ? '#a1a1aa' : '#666',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#a1a1aa'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = connectOpen ? '#a1a1aa' : '#666'; }}
                  title="Project endpoints (CLI / MUT)"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"></path></svg>
                  Connect
                </button>
                {connectOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 380, background: '#161618', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 500, color: '#71717a', letterSpacing: '0.02em' }}>
                      Project endpoints
                    </div>
                    <div style={{ padding: '8px 0' }}>
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
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Two-column Layout Below Header */}
        <div style={{ display: 'flex', gap: 40, width: '100%' }}>
          
          {/* Left Column: Files */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* File Box */}
            <div className="mb-24 w-full bg-[#0a0a0a] border-2 border-[#2a2a2a] rounded-xl relative overflow-hidden">
              {/* Subtle top glare line */}
              <div className="absolute top-0 left-0 right-0 h-px bg-[linear-gradient(to_right,transparent_0%,rgba(255,255,255,0.05)_10%,rgba(255,255,255,0.05)_90%,transparent_100%)] pointer-events-none z-20" />
              
              {/* Data Header */}
              <div className="h-[40px] min-h-[40px] shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-[#0e0e0e] relative z-10">
                <div className="text-[13px] font-medium text-[#71717a] m-0 flex items-center gap-2">Data</div>
                
                {latestCommit && (
                  <div 
                    className="flex items-center gap-3 min-w-0 cursor-pointer group"
                    onClick={() => router.push(`/projects/${projectId}/history`)}
                  >
                    <span className="text-[12px] text-[#71717a] truncate max-w-[400px] text-right group-hover:text-[#a1a1aa] transition-colors">
                      {latestCommit.message || latestCommit.commit_id.slice(0, 8)}
                    </span>
                    <div className="w-px h-3 bg-[#333] mx-1" />
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[9px] font-bold text-[#888] flex-shrink-0">
                        {latestCommit.who?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <span className="text-[12px] font-medium text-[#a1a1aa] whitespace-nowrap">{latestCommit.who || 'User'}</span>
                    </div>
                    <div className="w-px h-3 bg-[#333] mx-1" />
                    <div className="text-[12px] text-[#71717a] whitespace-nowrap flex-shrink-0 font-mono group-hover:text-[#a1a1aa] transition-colors">
                      {formatRelative(latestCommit.created_at)}
                    </div>
                  </div>
                )}
              </div>
              
              {/* File Tree */}
              <div className="py-1">
                {tree.length === 0 ? (
                  <div style={{ padding: '48px 32px', textAlign: 'center', color: '#555', fontSize: 14 }}>
                    Empty project
                  </div>
                ) : (
                  <TreeRows nodes={tree} depth={0} projectId={projectId} router={router} accessByPath={accessByPath} />
                )}
              </div>
            </div>


        </div>

        {/* Right Sidebar */}
        <div style={{ width: 296, flexShrink: 0 }}>
          
          {/* History Module */}
          <div className="bg-[#0a0a0a] border-2 border-[#2a2a2a] rounded-xl mb-6 overflow-hidden">
            <div className="h-[40px] min-h-[40px] shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-[#0e0e0e] relative z-10">
              <div className="text-[13px] font-medium text-[#71717a] m-0 flex items-center gap-2">
                History <span className="bg-[#1c1c1c] text-[#71717a] rounded px-1.5 py-0.5 text-[10px] font-bold border border-[#333] leading-none">{historyData?.total || 0}</span>
              </div>
              <span onClick={() => router.push(`/projects/${projectId}/history`)} className="text-[12px] text-[#71717a] cursor-pointer font-medium hover:text-[#a1a1aa] transition-colors">View all</span>
            </div>
            <div className="p-6">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[...commits].reverse().slice(0, 5).map((commit, i) => {
                const isLast = i === Math.min(commits.length, 5) - 1;
                const isHead = i === 0;
                return (
                  <div key={commit.commit_id} style={{ display: 'flex', gap: 12, cursor: 'pointer', padding: '6px 8px', margin: '0 -8px', borderRadius: 8, position: 'relative' }} onClick={() => router.push(`/projects/${projectId}/history`)} className="group hover:bg-[#1a1a1a] transition-colors">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0, marginTop: 4, position: 'relative', zIndex: 1 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isHead ? '#22c55e' : '#1c1c1c', border: `2px solid ${isHead ? '#22c55e' : '#333'}`, zIndex: 2, flexShrink: 0 }} className="group-hover:border-[#555] transition-colors" />
                      {!isLast && (
                        <div style={{ position: 'absolute', top: 8, bottom: -20, width: 2, background: '#1c1c1c', zIndex: 1 }} className="group-hover:bg-[#333] transition-colors" />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 6, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: isHead ? '#ccc' : '#888', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="group-hover:text-[#eee] transition-colors font-medium">
                        {commit.message || commit.commit_id.slice(0, 8)}
                      </div>
                      <div style={{ fontSize: 11, color: '#555', marginTop: 2 }} className="group-hover:text-[#888] transition-colors">{formatRelative(commit.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              {commits.length === 0 && (
                <div style={{ fontSize: 13, color: '#555' }}>No commits yet</div>
              )}
            </div>

            {/* Commit Activity Chart */}
            {commitBuckets.length > 1 && (
              <div className="mt-12">
                <ActivityChart buckets={commitBuckets} />
              </div>
            )}
            </div>
          </div>

          {/* Access Points Module */}
          <div className="bg-[#0a0a0a] border-2 border-[#2a2a2a] rounded-xl overflow-hidden">
            <div className="h-[40px] min-h-[40px] shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-[#0e0e0e] relative z-10">
              <div className="text-[13px] font-medium text-[#71717a] m-0 flex items-center gap-2">
                Access Points <span className="bg-[#1c1c1c] text-[#71717a] rounded px-1.5 py-0.5 text-[10px] font-bold border border-[#333] leading-none">{connections.length}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push(`/projects/${projectId}/access`)}
                  className="text-[#71717a] hover:text-[#a1a1aa] transition-colors p-0 bg-transparent border-0 cursor-pointer flex items-center"
                  title="Add access point"
                  aria-label="Add access point"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"></path></svg>
                </button>
                <span onClick={() => router.push(`/projects/${projectId}/access`)} className="text-[12px] text-[#71717a] cursor-pointer font-medium hover:text-[#a1a1aa] transition-colors">Manage</span>
              </div>
            </div>
            
            <div className="p-5">
            {connections.length === 0 ? (
              <div style={{ fontSize: 13, color: '#555' }}>No access points configured.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {connections.map(conn => (
                  <AccessPointRow
                    key={conn.id}
                    conn={conn}
                    onSelect={() => router.push(`/projects/${projectId}/access`)}
                  />
                ))}
              </div>
            )}
            </div>
          </div>

        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
