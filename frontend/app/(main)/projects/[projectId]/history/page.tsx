'use client';

import { use, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  getProjectHistory,
  getVersionContent,
  type MutCommitInfo,
  type MutCommitChange,
  type FileVersionDetail,
} from '@/lib/contentTreeApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { InlineLoading, PageLoading } from '@/components/loading';
import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';
import { useCommitUpdates } from '@/contexts/MutWebSocketContext';

// ─── Line diff utility ───────────────────────────────────────────────
//
// Standard LCS-based diff. Produces an interleaved list of
// {add, remove, context} rows that reads top-to-bottom like a unified
// patch. O(m*n) memory — safe for typical file sizes (<10k lines);
// guarded by a hard length cap below to avoid pathological pages.

type DiffLineKind = 'add' | 'remove' | 'context';
interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

const DIFF_MAX_LINES = 4000;

function lineDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length + b.length > DIFF_MAX_LINES) {
    return [
      ...a.map((text) => ({ kind: 'remove' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }

  const m = a.length;
  const n = b.length;
  const dp: Uint16Array = new Uint16Array((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[idx(i, j)] =
        a[i - 1] === b[j - 1]
          ? dp[idx(i - 1, j - 1)] + 1
          : Math.max(dp[idx(i - 1, j)], dp[idx(i, j - 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.push({ kind: 'context', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[idx(i, j - 1)] >= dp[idx(i - 1, j)])) {
      out.push({ kind: 'add', text: b[j - 1] });
      j--;
    } else {
      out.push({ kind: 'remove', text: a[i - 1] });
      i--;
    }
  }
  out.reverse();
  return out;
}

// Pull lines out of the commit-content response. Backend returns
// either `content_text` (raw decoded text — markdown / yaml / source)
// or `content` (already-parsed JSON for JSON files). The earlier
// version of this fn looked at `content_json`, which the endpoint
// never returns — so JSON-file diffs always silently fell through to
// the "Binary file" placeholder. Keep both fallbacks so the function
// stays robust if the wire shape ever shifts.
function fileToLines(detail: FileVersionDetail): string[] | null {
  if (detail.is_binary) {
    return null;
  }
  if (detail.content_text != null) {
    return detail.content_text.split('\n');
  }
  if (detail.content != null) {
    try {
      return JSON.stringify(detail.content, null, 2).split('\n');
    } catch {
      return null;
    }
  }
  return null;
}

function fileExtClass(path: string): 'json' | 'markdown' | 'plain' {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown';
  return 'plain';
}

interface HistoryPageProps {
  params: Promise<{ projectId: string }>;
}

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

function formatOperatorLabel(type: string): string {
  if (type === 'user') return 'User';
  if (type === 'agent') return 'Agent';
  if (type === 'sync') return 'Sync';
  return 'System';
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
  
  // Left side for the short commit id
  const VERSION_WIDTH = 60;
  // X position of the single straight line
  const LINE_X = VERSION_WIDTH + 14; 
  const activeColor = isSelected ? currentInfo.color : '#52525b';
  const svgWidth = LINE_X + 10;

  const shortId = commit.commit_id ? commit.commit_id.slice(0, 12) : '';

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
          {/* Fixed-width Commit ID Column on the Left */}
          <div
            title={commit.commit_id}
            style={{
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
            }}
          >
            {shortId}
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

// ─── DiffRow + FileDiffBlock (showcase parity) ───────────────────────

const OP_TONE: Record<string, { bg: string; fg: string }> = {
  added:    { bg: 'rgba(34,197,94,0.15)',  fg: '#22c55e' },
  modified: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
  deleted:  { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444' },
};

function DiffRow({ line, lineNum }: { line: DiffLine; lineNum: number }) {
  const isAdd = line.kind === 'add';
  const isRem = line.kind === 'remove';
  const bg = isAdd
    ? 'rgba(34,197,94,0.08)'
    : isRem
    ? 'rgba(239,68,68,0.08)'
    : 'transparent';
  const numColor = isAdd ? '#22c55e' : isRem ? '#ef4444' : '#52525b';
  const prefix = isAdd ? '+' : isRem ? '-' : ' ';
  const textColor = isAdd ? '#86efac' : isRem ? '#fca5a5' : '#a1a1aa';
  return (
    <div
      style={{
        display: 'flex',
        background: bg,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5,
        lineHeight: '20px',
        minHeight: 20,
      }}
    >
      <span
        style={{
          width: 44,
          textAlign: 'right',
          paddingRight: 10,
          color: numColor,
          opacity: 0.7,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {lineNum}
      </span>
      <span
        style={{
          width: 14,
          textAlign: 'center',
          color: numColor,
          flexShrink: 0,
          fontWeight: 600,
        }}
      >
        {prefix}
      </span>
      <span
        style={{
          color: textColor,
          whiteSpace: 'pre',
          paddingLeft: 4,
          paddingRight: 12,
        }}
      >
        {line.text}
      </span>
    </div>
  );
}

interface FileDiffBlockProps {
  change: MutCommitChange;
  projectId: string;
  commitId: string;
  parentCommitId: string | null;
}

function FileDiffBlock({ change, projectId, commitId, parentCommitId }: FileDiffBlockProps) {
  const op = change.op;
  const tone = OP_TONE[op] ?? OP_TONE.modified;
  const ext = fileExtClass(change.path);

  // Fetch current content for added/modified; previous content for
  // modified/deleted. SWR keys are scoped per (path, commit) so a
  // parent fetch can be reused across rows.
  const needsCurrent = op === 'added' || op === 'modified';
  const needsParent = (op === 'modified' || op === 'deleted') && !!parentCommitId;

  const { data: currentDetail, error: currentErr } = useSWR(
    needsCurrent ? ['ver-content', projectId, change.path, commitId] : null,
    () => getVersionContent(change.path, commitId, projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: parentDetail, error: parentErr } = useSWR(
    needsParent ? ['ver-content', projectId, change.path, parentCommitId] : null,
    () => getVersionContent(change.path, parentCommitId!, projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const isLoading =
    (needsCurrent && !currentDetail && !currentErr) ||
    (needsParent && !parentDetail && !parentErr);

  let lines: DiffLine[] | null = null;
  let placeholder: string | null = null;

  if (currentErr || parentErr) {
    placeholder = 'Failed to load diff';
  } else if (!isLoading) {
    if (op === 'added') {
      const cur = currentDetail ? fileToLines(currentDetail) : null;
      if (cur) lines = cur.map((text) => ({ kind: 'add' as const, text }));
      else placeholder = 'Binary file or unchanged metadata';
    } else if (op === 'deleted') {
      const prev = parentDetail ? fileToLines(parentDetail) : null;
      if (prev) lines = prev.map((text) => ({ kind: 'remove' as const, text }));
      else if (!parentCommitId) placeholder = 'No previous version available';
      else placeholder = 'Binary file or unchanged metadata';
    } else {
      const prev = parentDetail ? fileToLines(parentDetail) : null;
      const cur = currentDetail ? fileToLines(currentDetail) : null;
      if (prev && cur) lines = lineDiff(prev, cur);
      else placeholder = 'Binary file or unchanged metadata';
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* File header */}
      <div
        style={{
          height: 32,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,0.025)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          stroke={ext === 'json' ? '#34d399' : ext === 'markdown' ? '#a1a1aa' : '#71717a'}
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          style={{ flexShrink: 0 }}
        >
          <path d='M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z' />
          <path d='M14 2v6h6' />
        </svg>
        <span
          style={{
            fontSize: 11.5,
            color: '#fff',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {change.path}
        </span>
        <span
          style={{
            padding: '1px 6px',
            fontSize: 9.5,
            fontWeight: 600,
            borderRadius: 3,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            background: tone.bg,
            color: tone.fg,
          }}
        >
          {op}
        </span>
      </div>

      {/* Diff body */}
      {isLoading ? (
        <div
          style={{
            padding: '14px 16px',
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          <InlineLoading label="Loading diff…" />
        </div>
      ) : placeholder ? (
        <div
          style={{
            padding: '14px 16px',
            fontSize: 11,
            color: '#71717a',
            background: 'rgba(0,0,0,0.2)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontStyle: 'italic',
          }}
        >
          {placeholder}
        </div>
      ) : lines && lines.length > 0 ? (
        <div style={{ padding: '6px 0', background: 'rgba(0,0,0,0.25)' }}>
          {lines.map((line, j) => (
            <DiffRow key={j} line={line} lineNum={j + 1} />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '14px 16px',
            fontSize: 11,
            color: '#71717a',
            background: 'rgba(0,0,0,0.2)',
            fontStyle: 'italic',
          }}
        >
          No textual changes
        </div>
      )}
    </div>
  );
}

function CommitDetail({
  commit,
  projectId,
  parentCommitId,
}: {
  commit: MutCommitInfo;
  projectId: string;
  parentCommitId: string | null;
}) {
  const { type, id } = parseOperator(commit.who);
  const opColors: Record<string, { bg: string; text: string; border: string }> = {
    user: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
    agent: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
    sync: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    system: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' },
  };
  const opColor = opColors[type] || opColors.system;

  return (
    <div className="p-6 md:p-8 mx-auto" style={{ maxWidth: PROJECT_CONTENT_RAIL_WIDTH }}>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span
            className="text-lg font-medium text-white font-mono"
            title={commit.commit_id}
          >
            {commit.commit_id.slice(0, 8)}
          </span>
          <span className="text-sm text-zinc-400">
            {commit.message || '(no message)'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border ${opColor.bg} ${opColor.text} ${opColor.border} font-medium`}>
            {formatOperatorLabel(type)}
            {id && <span className="opacity-70 font-normal font-mono">{id.slice(0, 8)}</span>}
          </span>

          <span
            className="text-xs text-zinc-500 font-medium"
            title={formatFullTime(commit.created_at)}
          >
            {formatTime(commit.created_at)}
          </span>

          {commit.root_hash && (
            <span className="text-xs text-zinc-600 font-mono bg-white/[0.03] px-2 py-1 rounded border border-white/[0.05]">
              {commit.root_hash.slice(0, 10)}
            </span>
          )}
        </div>
      </div>

      {commit.changes.length > 0 ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: '#71717a',
              marginBottom: 16,
              paddingBottom: 14,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span>
              {commit.changes.length} file
              {commit.changes.length !== 1 ? 's' : ''} changed
            </span>
          </div>
          {commit.changes.map((change, i) => (
            <FileDiffBlock
              key={`${change.path}-${i}`}
              change={change}
              projectId={projectId}
              commitId={commit.commit_id}
              parentCommitId={parentCommitId}
            />
          ))}
        </>
      ) : (
        <div className="px-6 py-12 text-center text-zinc-500 text-sm border border-white/[0.06] rounded-xl">
          No file changes in this commit
        </div>
      )}

      {commit.conflicts.length > 0 && (
        <div className="mt-4 bg-amber-500/[0.02] border border-amber-500/20 rounded-xl p-4">
          <div className="text-xs font-medium text-amber-500 mb-3 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Merge Conflicts ({commit.conflicts.length})
          </div>
          <div className="space-y-1.5">
            {commit.conflicts.map((conflict, i) => (
              <div key={i} className="text-xs font-mono text-zinc-400 flex items-center gap-2 bg-black/20 p-2 rounded border border-white/[0.02]">
                <span className="text-zinc-300">{conflict.path}</span>
                <span className="text-zinc-600">-</span>
                <span className="text-amber-500/80">{conflict.strategy}</span>
                {conflict.kept && <span className="text-zinc-500">(kept: {conflict.kept})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───

export default function HistoryPage({ params }: HistoryPageProps) {
  const { projectId } = use(params);
  const { session } = useAuth();

  const { data: history, error, mutate: mutateHistory } = useSWR(
    session ? ['project-history', projectId] : null,
    () => getProjectHistory(projectId, 100),
    { revalidateOnFocus: false },
  );

  // Refetch the commit list whenever the server pushes a commit_update
  // for this project. Replaces the old "wait for the user to refocus
  // the tab" behaviour — pushes/imports/exports from any other client
  // (sandbox, agent, GitHub webhook) now show up live.
  //
  // The per-commit content cache (``['ver-content', projectId, path,
  // commitId]``) is content-addressable and immutable: a specific
  // commit at a specific path doesn't change when a *newer* commit
  // lands, so we deliberately don't invalidate it here.
  const onCommitUpdate = useCallback(() => {
    void mutateHistory();
  }, [mutateHistory]);
  useCommitUpdates(onCommitUpdate);

  // We deliberately ignore SWR's `isLoading` here: it's only true
  // *while a fetch is in flight*. Before the SWR key becomes truthy
  // (auth still resolving, project not yet selected, etc.) SWR
  // returns `isLoading=false` even though `data` is still undefined.
  // Combined with the empty-state branch below this produced a brief
  // "No commits yet" flash on initial mount before the real fetch
  // had even started — the user reads it as "did everything just get
  // wiped?". Using "has data ever arrived?" (`history !== undefined`)
  // closes the gap: the loading view stays mounted until SWR has
  // actually delivered a payload (or raised an error), so the empty
  // branch only fires once we *know* the API returned zero commits.
  const isInitialLoading = !error && history === undefined;

  const commits = useMemo(() => history?.commits ?? [], [history]);
  // Reverse commits so newest is on top
  const sortedCommits = useMemo(() => [...commits].reverse(), [commits]);

  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

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

  const activeAccessPoint = useMemo(
    () => accessPoints.find(ap => ap.who === activeFilter) ?? null,
    [accessPoints, activeFilter],
  );

  useEffect(() => {
    if (!filterMenuOpen) return;

    function closeOnOutside(event: MouseEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [filterMenuOpen]);

  const filteredCommits = useMemo(() => {
    let filtered = sortedCommits;
    if (activeFilter) {
      filtered = sortedCommits.filter(c => c.who === activeFilter);
    }
    return filtered;
  }, [sortedCommits, activeFilter]);

  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

  const headCommitId = history?.head_commit_id ?? '';

  // Auto-select the HEAD commit when history first lands (or switches projects).
  useEffect(() => {
    if (!selectedCommitId) {
      if (headCommitId) {
        setSelectedCommitId(headCommitId);
      } else if (commits.length > 0) {
        setSelectedCommitId(commits[0].commit_id);
      }
    }
  }, [commits, selectedCommitId, headCommitId]);

  const selectedCommit = useMemo(
    () => commits.find(c => c.commit_id === selectedCommitId) ?? null,
    [commits, selectedCommitId]
  );

  // Parent commit = the commit immediately preceding the selected one
  // in chronological order. The API returns commits oldest-first, so
  // the parent of `commits[i]` is `commits[i - 1]`.
  const parentCommitId = useMemo(() => {
    if (!selectedCommit) return null;
    const idx = commits.findIndex(c => c.commit_id === selectedCommit.commit_id);
    if (idx <= 0) return null;
    return commits[idx - 1].commit_id;
  }, [commits, selectedCommit]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0e0e0e' }}>

      {/* ── Header ── */}
      <div style={{
        height: 46, minHeight: 46, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: '#0e0e0e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>
            Commit History
          </span>
          {history && (
            <span style={{ fontSize: 12, color: '#52525b' }}>
              {history.total} commit{history.total !== 1 ? 's' : ''}
              {history.head_commit_id && (
                <> · <span
                  title={history.head_commit_id}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                >
                  {history.head_commit_id.slice(0, 12)}
                </span></>
              )}
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
      {isInitialLoading && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PageLoading variant="fill" />
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#ef4444', fontSize: 13 }}>
          Failed to load history
        </div>
      )}

      {!isInitialLoading && !error && commits.length === 0 && (
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
      {!isInitialLoading && !error && commits.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* Left: Timeline List — wrapped in `ResizableSidebarColumn`
              so users can widen the timeline when commit messages or
              author IDs would otherwise truncate aggressively. Default
              340 matches the previous fixed width. */}
          <ResizableSidebarColumn
            storageKey='history-timeline:history'
            defaultWidth={340}
            minWidth={260}
            maxWidth={520}
            className="border-r border-white/[0.06] bg-[#0e0e0e] z-10"
          >
            
            {/* Filter Header */}
            {accessPoints.length > 1 && (
              <div className="flex flex-col border-b border-white/[0.04] bg-[#0e0e0e]">
                <div className="px-3 h-[44px] min-h-[44px] flex items-center gap-2">
                  <button
                    onClick={() => {
                      setActiveFilter(null);
                      setFilterMenuOpen(false);
                    }}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      activeFilter === null 
                        ? 'bg-white/[0.1] text-zinc-100' 
                        : 'bg-transparent text-zinc-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    All
                  </button>

                  <div ref={filterMenuRef} className="relative min-w-0 flex-1">
                    <button
                      onClick={() => setFilterMenuOpen(open => !open)}
                      className={`w-full min-w-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                        activeFilter
                          ? 'bg-white/[0.1] text-zinc-100 border-white/[0.05]'
                          : 'bg-transparent text-zinc-400 border-white/[0.04] hover:bg-white/[0.06]'
                      }`}
                      title={activeAccessPoint?.who ?? 'Filter by actor'}
                      aria-haspopup="menu"
                      aria-expanded={filterMenuOpen}
                    >
                      {activeAccessPoint ? (
                        <>
                          <span style={{ color: getTrackInfo(activeAccessPoint.who).color, fontSize: 8 }}>●</span>
                          <span className="truncate">
                            {formatOperatorLabel(activeAccessPoint.type)}
                            {activeAccessPoint.id && (
                              <span className="ml-1 opacity-70 font-mono font-normal">
                                {activeAccessPoint.id.slice(0, 8)}
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="truncate text-zinc-400">
                          Actors
                          <span className="ml-1 font-mono opacity-60">{accessPoints.length}</span>
                        </span>
                      )}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`ml-auto flex-shrink-0 opacity-60 transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {filterMenuOpen && (
                      <div
                        role="menu"
                        className="absolute left-0 right-0 top-[30px] z-50 overflow-hidden rounded-md border border-white/[0.08] bg-[#151515] shadow-xl"
                      >
                        <div className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
                          {accessPoints.map(ap => {
                            const { color } = getTrackInfo(ap.who);
                            const isSelected = activeFilter === ap.who;
                            return (
                              <button
                                key={ap.who}
                                role="menuitemradio"
                                aria-checked={isSelected}
                                onClick={() => {
                                  setActiveFilter(ap.who);
                                  setFilterMenuOpen(false);
                                }}
                                className={`w-full min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                                  isSelected
                                    ? 'bg-white/[0.08] text-zinc-100'
                                    : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                                }`}
                              >
                                <span style={{ color, fontSize: 8 }}>●</span>
                                <span className="min-w-0 flex-1 truncate">
                                  {formatOperatorLabel(ap.type)}
                                  {ap.id && (
                                    <span className="ml-1 opacity-70 font-mono font-normal">
                                      {ap.id.slice(0, 8)}
                                    </span>
                                  )}
                                </span>
                                <span className="flex-shrink-0 font-mono text-[10px] opacity-50">
                                  {ap.count}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-2 pb-12 custom-scrollbar">
              {filteredCommits.map((commit, i) => (
                <VerticalCommitNode
                  key={commit.commit_id}
                  commit={commit}
                  nextCommit={i < filteredCommits.length - 1 ? filteredCommits[i + 1] : undefined}
                  isSelected={selectedCommitId === commit.commit_id}
                  isHead={commit.commit_id === headCommitId}
                  onClick={() => setSelectedCommitId(commit.commit_id)}
                />
              ))}
            </div>
          </ResizableSidebarColumn>

          {/* Right: Commit Detail */}
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar bg-[#0e0e0e]">
            {selectedCommit ? (
              <CommitDetail
                commit={selectedCommit}
                projectId={projectId}
                parentCommitId={parentCommitId}
              />
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: '#52525b', fontSize: 13,
              }}>
                Select a commit
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
