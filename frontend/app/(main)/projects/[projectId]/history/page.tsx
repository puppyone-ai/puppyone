'use client';

import { use, useState, useMemo, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  getProjectHistory,
  type MutCommitInfo,
  type MutCommitChange,
} from '@/lib/contentTreeApi';

interface HistoryPageProps {
  params: Promise<{ projectId: string }>;
}

const OP_COLORS: Record<string, string> = {
  added: '#22c55e',
  modified: '#3b82f6',
  deleted: '#ef4444',
};

const OP_ICONS: Record<string, string> = {
  added: '+',
  modified: '~',
  deleted: '-',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatFullTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatTimeShort(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseOperator(who: string): { type: string; id: string } {
  if (who.includes(':')) {
    const [type, ...rest] = who.split(':');
    return { type, id: rest.join(':') };
  }
  return { type: who || 'system', id: '' };
}

// ─── Build a tree structure from flat change paths ───

interface FileTreeNode {
  name: string;
  path: string;
  op?: string;
  children: FileTreeNode[];
  isFile: boolean;
}

function buildFileTree(changes: MutCommitChange[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', children: [], isFile: false };

  for (const change of changes) {
    const parts = change.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: fullPath,
          children: [],
          isFile: isLast,
          op: isLast ? change.op : undefined,
        };
        current.children.push(child);
      }
      if (isLast) {
        child.op = change.op;
        child.isFile = true;
      }
      current = child;
    }
  }

  root.children.sort(sortTreeNodes);
  return root.children;
}

function sortTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
  return a.name.localeCompare(b.name);
}

// ─── File tree node component ───

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const color = node.op ? OP_COLORS[node.op] || '#a1a1aa' : '#a1a1aa';

  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          paddingLeft: 8 + depth * 20,
          borderRadius: 4,
          cursor: hasChildren ? 'pointer' : 'default',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Expand/collapse or file icon */}
        {hasChildren ? (
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="#52525b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s', flexShrink: 0,
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : (
          <div style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Folder / File icon */}
        {node.isFile ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        )}

        {/* Name */}
        <span style={{
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: node.isFile ? color : '#d4d4d8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.name}
        </span>

        {/* Op badge */}
        {node.op && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            padding: '1px 5px', borderRadius: 3,
            background: `${color}18`,
            color,
            marginLeft: 'auto', flexShrink: 0,
          }}>
            {node.op}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.sort(sortTreeNodes).map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Vertical commit node (Linear Audit Trail) ───

function getTrackInfo(who: string) {
  const { type } = parseOperator(who);
  switch (type) {
    case 'user': return { color: '#60a5fa' }; // blue-400
    case 'agent': return { color: '#c084fc' }; // purple-400
    case 'sync': return { color: '#34d399' }; // emerald-400
    default: return { color: '#a1a1aa' }; // zinc-400
  }
}

function VerticalCommitNode({
  commit,
  nextCommit,
  isSelected,
  isHead,
  onClick,
}: {
  commit: MutCommitInfo;
  nextCommit?: MutCommitInfo;
  isSelected: boolean;
  isHead: boolean;
  onClick: () => void;
}) {
  const { type, id } = parseOperator(commit.who);
  const currentInfo = getTrackInfo(commit.who);

  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const ITEM_HEIGHT = 30;
  const MARGIN_Y = 1;
  const ROW_HEIGHT = ITEM_HEIGHT + MARGIN_Y * 2; // 32px total row space
  
  // Left side for version number
  const VERSION_WIDTH = 32;
  // X position of the single straight line
  const LINE_X = VERSION_WIDTH + 14; 
  const activeColor = isSelected ? currentInfo.color : '#52525b';
  const svgWidth = LINE_X + 10;

  return (
    <div style={{ position: 'relative', height: ROW_HEIGHT }}>
      {/* ExplorerSidebar TreeItem Style Row */}
      <div
        ref={rowRef}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center',
          margin: `${MARGIN_Y}px 6px`,
          height: ITEM_HEIGHT, boxSizing: 'border-box',
          borderRadius: 6,
          background: isSelected ? '#2a2a2a' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
          color: isSelected ? '#fff' : hovered ? '#d4d4d4' : '#a1a1aa',
          fontSize: 13, userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          cursor: 'pointer',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Straight Line Track SVG */}
        <svg 
          style={{ position: 'absolute', left: -6, top: -MARGIN_Y, width: svgWidth, height: ROW_HEIGHT, overflow: 'visible', pointerEvents: 'none', zIndex: 20 }}
        >
          {/* Straight line to the next (older) commit below */}
          {nextCommit && (
            <line
              x1={LINE_X}
              y1={ROW_HEIGHT / 2}
              x2={LINE_X}
              y2={ROW_HEIGHT + ROW_HEIGHT / 2}
              stroke={activeColor}
              strokeWidth={1.5}
              strokeOpacity={isSelected ? 0.8 : 0.3}
              style={{ transition: 'stroke 0.2s, stroke-opacity 0.2s' }}
            />
          )}

          {/* Outline ring for selected node to make it pop against the dark background */}
          {isSelected && (
            <circle
              cx={LINE_X}
              cy={ROW_HEIGHT / 2}
              r={5.5}
              fill="transparent"
              stroke={currentInfo.color}
              strokeWidth={1.5}
              opacity={0.4}
            />
          )}

          {/* The Node Dot */}
          <circle
            cx={LINE_X}
            cy={ROW_HEIGHT / 2}
            r={3}
            fill={isSelected ? currentInfo.color : (isSelected ? '#2a2a2a' : hovered ? '#1e1e1e' : '#0e0e0e')}
            stroke={activeColor}
            strokeWidth={1.5}
            style={{ transition: 'all 0.2s' }}
          />
        </svg>

        <div
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', height: '100%', boxSizing: 'border-box',
            paddingLeft: 6,
            paddingRight: 6,
          }}
        >
          {/* Fixed-width Version Column on the Left */}
          <div style={{
            width: VERSION_WIDTH,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            fontFamily: 'monospace',
            fontSize: 11,
            color: isSelected ? '#fff' : '#71717a',
            transition: 'color 0.1s',
            zIndex: 30, // Above SVG
          }}>
            v{commit.version}
          </div>

          {/* The content container starts AFTER the single line graph */}
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 6, height: '100%',
            paddingLeft: svgWidth - VERSION_WIDTH + 6, // Compensate for SVG width properly
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {/* Actor Prefix (Optional context) */}
            <span style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 4, 
              color: currentInfo.color, fontSize: 11, fontWeight: 500,
              opacity: isSelected ? 1 : 0.8,
            }}>
              [{type === 'user' ? 'User' : type === 'agent' ? 'Agent' : type === 'sync' ? 'Sync' : 'System'}]
            </span>

            {/* Commit Message */}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {commit.message || `(no message)`}
            </span>

            {/* Right area actions/meta */}
            <div style={{ 
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: 'flex-end', flexShrink: 0, 
              marginLeft: 'auto',
            }}>
              {isHead && (
                <span style={{
                  fontSize: 9, fontWeight: 600, color: '#22c55e',
                  border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.1)',
                  padding: '0 4px', borderRadius: 3, display: 'inline-flex', alignItems: 'center', height: 16
                }}>
                  HEAD
                </span>
              )}
              
              {/* Minimal Time */}
              <div style={{ 
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: hovered || isSelected ? 1 : 0.7,
                transition: 'opacity 0.2s',
              }}>
                <span style={{ fontSize: 11, color: '#71717a', minWidth: 28, textAlign: 'right' }}>
                  {formatTimeShort(commit.created_at)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───

export default function HistoryPage({ params }: HistoryPageProps) {
  const { projectId } = use(params);
  const { session } = useAuth();

  const { data: history, error, isLoading } = useSWR(
    session ? ['project-history', projectId] : null,
    () => getProjectHistory(projectId, 100),
    { revalidateOnFocus: false },
  );

  const commits = useMemo(() => history?.commits ?? [], [history]);
  // Reverse commits so newest is on top
  const sortedCommits = useMemo(() => [...commits].reverse(), [commits]);

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const accessPoints = useMemo(() => {
    const counts = new Map<string, number>();
    commits.forEach(c => {
      counts.set(c.who, (counts.get(c.who) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([who, count]) => {
      const { type, id } = parseOperator(who);
      return { who, type, id, count };
    }).sort((a, b) => b.count - a.count);
  }, [commits]);

  const filteredCommits = useMemo(() => {
    let filtered = sortedCommits;
    if (activeFilter) {
      filtered = sortedCommits.filter(c => c.who === activeFilter);
    }
    return filtered;
  }, [sortedCommits, activeFilter]);

  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Auto-select the latest (HEAD) commit
  useEffect(() => {
    if (commits.length > 0 && selectedVersion === null) {
      setSelectedVersion(commits[commits.length - 1].version);
    }
  }, [commits, selectedVersion]);

  const selectedCommit = useMemo(
    () => commits.find(c => c.version === selectedVersion) ?? null,
    [commits, selectedVersion]
  );

  const fileTree = useMemo(
    () => selectedCommit ? buildFileTree(selectedCommit.changes) : [],
    [selectedCommit]
  );

  const headVersion = commits.length > 0 ? commits[commits.length - 1].version : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0e0e0e' }}>

      {/* ── Header ── */}
      <div style={{
        height: 40, minHeight: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: '#0e0e0e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>
            Commit History
          </span>
          {history && (
            <span style={{ fontSize: 12, color: '#52525b' }}>
              {history.total} commit{history.total !== 1 ? 's' : ''} · v{history.current_version}
            </span>
          )}
        </div>
        {history?.root_hash && (
          <span style={{
            fontSize: 10, color: '#3f3f46',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            tree {history.root_hash.slice(0, 12)}
          </span>
        )}
      </div>

      {/* ── Loading / Error / Empty ── */}
      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#52525b', fontSize: 13 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite', marginRight: 8 }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
          </svg>
          Loading...
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#ef4444', fontSize: 13 }}>
          Failed to load history
        </div>
      )}

      {!isLoading && !error && commits.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 12, color: '#3f3f46',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: 14 }}>No commits yet</span>
          <span style={{ fontSize: 12, color: '#27272a' }}>Changes to your context space will appear here</span>
        </div>
      )}

      {/* ── Main Layout (Left/Right Split) ── */}
      {!isLoading && !error && commits.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* Left: Timeline List */}
          <div className="w-[340px] flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0e0e0e] z-10">
            
            {/* Filter Header */}
            {accessPoints.length > 1 && (
              <div className="flex flex-col border-b border-white/[0.04] bg-[#0e0e0e]">
                {/* Access Point Tabs */}
                <div className="px-3 py-3 flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
                  <button
                    onClick={() => setActiveFilter(null)}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      activeFilter === null 
                        ? 'bg-white/[0.1] text-zinc-100' 
                        : 'bg-transparent text-zinc-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    All
                  </button>
                  {accessPoints.map(ap => {
                    const { color } = getTrackInfo(ap.who);
                    const label = ap.type === 'user' ? 'User' : ap.type === 'agent' ? 'Agent' : ap.type === 'sync' ? 'Sync' : 'System';
                    const isSelected = activeFilter === ap.who;
                    return (
                      <button
                        key={ap.who}
                        onClick={() => setActiveFilter(ap.who)}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                          isSelected 
                            ? 'bg-white/[0.1] text-zinc-100 border-white/[0.05]' 
                            : 'bg-transparent text-zinc-400 border-white/[0.04] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span style={{ color, fontSize: 8 }}>●</span>
                        {label} {ap.id && <span className="opacity-70 font-mono font-normal">{ap.id.slice(0, 4)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-2 pb-12 custom-scrollbar">
              {filteredCommits.map((commit, i) => (
                <VerticalCommitNode
                  key={commit.version}
                  commit={commit}
                  nextCommit={i < filteredCommits.length - 1 ? filteredCommits[i + 1] : undefined}
                  isSelected={commit.version === selectedVersion}
                  isHead={commit.version === headVersion}
                  onClick={() => setSelectedVersion(commit.version)}
                />
              ))}
            </div>
          </div>

          {/* Right: Detail panel: commit info + file tree */}
          <div className="flex-1 overflow-auto bg-[#0e0e0e]">
            {selectedCommit ? (
              <div className="p-6 md:p-8 max-w-5xl mx-auto">
                {/* Commit info header */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-medium text-white font-mono">
                      v{selectedCommit.version}
                    </span>
                    <span className="text-sm text-zinc-400">
                      {selectedCommit.message || '(no message)'}
                    </span>
                  </div>
                  
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    {/* Operator badge */}
                    {(() => {
                      const { type, id } = parseOperator(selectedCommit.who);
                      const opColors: Record<string, { bg: string; text: string; border: string }> = {
                        user: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
                        agent: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
                        sync: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
                        system: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' },
                      };
                      const c = opColors[type] || opColors.system;
                      return (
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border ${c.bg} ${c.text} ${c.border} font-medium`}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                          {id && <span className="opacity-70 font-normal font-mono">{id.slice(0, 8)}</span>}
                        </span>
                      );
                    })()}
                    
                    <span
                      className="text-xs text-zinc-500 font-medium"
                      title={formatFullTime(selectedCommit.created_at)}
                    >
                      {formatTime(selectedCommit.created_at)}
                    </span>
                    
                    {selectedCommit.root_hash && (
                      <span className="text-xs text-zinc-600 font-mono bg-white/[0.03] px-2 py-1 rounded border border-white/[0.05]">
                        {selectedCommit.root_hash.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>

                {/* File changes tree */}
                <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2 bg-white/[0.01]">
                    <span className="text-xs font-medium text-zinc-300">
                      Changed files
                    </span>
                    <span className="text-[11px] font-medium text-zinc-500 bg-white/[0.05] px-1.5 py-0.5 rounded">
                      {selectedCommit.changes.length}
                    </span>
                  </div>

                  {fileTree.length > 0 ? (
                    <div className="p-2">
                      {fileTree.map(node => (
                        <TreeNode key={node.path} node={node} depth={0} />
                      ))}
                    </div>
                  ) : (
                    <div className="px-6 py-12 text-center text-zinc-500 text-sm">
                      No file changes in this commit
                    </div>
                  )}
                </div>

                {/* Conflicts section */}
                {selectedCommit.conflicts.length > 0 && (
                  <div className="mt-4 bg-amber-500/[0.02] border border-amber-500/20 rounded-xl p-4">
                    <div className="text-xs font-medium text-amber-500 mb-3 flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      Merge Conflicts ({selectedCommit.conflicts.length})
                    </div>
                    <div className="space-y-1.5">
                      {selectedCommit.conflicts.map((c, i) => (
                        <div key={i} className="text-xs font-mono text-zinc-400 flex items-center gap-2 bg-black/20 p-2 rounded border border-white/[0.02]">
                          <span className="text-zinc-300">{c.path}</span>
                          <span className="text-zinc-600">—</span>
                          <span className="text-amber-500/80">{c.strategy}</span>
                          {c.kept && <span className="text-zinc-500">(kept: {c.kept})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                Select a commit to view changes
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
