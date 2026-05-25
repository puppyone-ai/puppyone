'use client';

import { use, useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  getProjectHistory,
  getVersionContent,
  type VersionCommitInfo,
  type VersionCommitChange,
  type FileVersionDetail,
} from '@/lib/contentTreeApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { SIDEBAR_ROW_TYPOGRAPHY } from '@/lib/uiTypography';
import { PageLoading } from '@/components/loading';
import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';
import { useCommitUpdates } from '@/contexts/VersionWebSocketContext';
import {
  NeedsActionSection,
  getKind as getNeedsActionKind,
  type NeedsActionItem,
  type NeedsActionSummary,
} from './components/NeedsActionSection';
import type { NeedsActionSelection } from './components/NeedsActionSection';
import type {
  NeedsActionRenderContext,
  ResolvedResult,
} from '@/lib/needsActionRegistry';

// ─── Needs Action detail-pane router ────────────────────────────────
//
// Looks up the kind in the registry and delegates to its
// ``renderDetail``. Kept tiny so the page doesn't import per-kind
// modules directly — the registry is the single dispatch point.
function NeedsActionDetailPane({
  projectId,
  selection,
  item,
  onRemoved,
}: {
  projectId: string;
  selection: NeedsActionSelection;
  item: NeedsActionItem;
  onRemoved: (selection: NeedsActionSelection, result: ResolvedResult) => void;
}) {
  const def = getNeedsActionKind(selection.kind);
  if (!def) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--po-text-disabled)', fontSize: 13,
      }}>
        Unknown item kind: {selection.kind}
      </div>
    );
  }
  const ctx: NeedsActionRenderContext = {
    projectId,
    isSelected: true,
    onSelect: () => {},
    onResolved: (result) => onRemoved(selection, result),
    onSnoozed: () => onRemoved(selection, { reason: 'dismissed' }),
  };
  return <>{def.renderDetail(item, ctx)}</>;
}

// ─── Line diff utility ───────────────────────────────────────────────
//
// Standard LCS-based diff. Produces an interleaved list of
// {add, remove, context} rows that reads top-to-bottom like a unified
// patch. O(m*n) memory — safe for typical file sizes (<10k lines);
// guarded by a hard length cap below to avoid pathological pages.

type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk';
interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const DIFF_MAX_LINES = 4000;
const HISTORY_DIFF_HEADER_BG = 'color-mix(in srgb, var(--po-canvas) 84%, var(--po-text) 4%)';
const HISTORY_ROW_ITEM_HEIGHT = 30;
const HISTORY_ROW_MARGIN_Y = 1;
const HISTORY_ROW_HEIGHT = HISTORY_ROW_ITEM_HEIGHT + HISTORY_ROW_MARGIN_Y * 2;
const HISTORY_GRAPH_WIDTH = 20;
const HISTORY_LINE_X = HISTORY_GRAPH_WIDTH / 2;

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

function addLineNumbers(lines: DiffLine[]): DiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return lines.map((line) => {
    if (line.kind === 'remove') {
      return { ...line, oldLine: oldLine++ };
    }
    if (line.kind === 'add') {
      return { ...line, newLine: newLine++ };
    }
    if (line.kind === 'context') {
      return { ...line, oldLine: oldLine++, newLine: newLine++ };
    }
    return line;
  });
}

function compactDiffLines(lines: DiffLine[], contextRadius = 3): DiffLine[] {
  const changedIndexes = lines
    .map((line, index) => (line.kind === 'add' || line.kind === 'remove' ? index : -1))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) return lines;

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextRadius);
    const end = Math.min(lines.length - 1, index + contextRadius);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const compacted: DiffLine[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const hiddenCount = range.start - cursor;
    if (hiddenCount > 0) {
      compacted.push({
        kind: 'hunk',
        text: hiddenCount === 1 ? '@@ 1 unchanged line @@' : `@@ ${hiddenCount} unchanged lines @@`,
      });
    }
    compacted.push(...lines.slice(range.start, range.end + 1));
    cursor = range.end + 1;
  }

  const trailingHidden = lines.length - cursor;
  if (trailingHidden > 0) {
    compacted.push({
      kind: 'hunk',
      text: trailingHidden === 1 ? '@@ 1 unchanged line @@' : `@@ ${trailingHidden} unchanged lines @@`,
    });
  }

  return compacted;
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

function formatScopeLabel(scopePath: string): string {
  const normalized = normalizeScopePath(scopePath);
  if (!normalized || normalized === '/') return 'Root scope';
  return normalized;
}

function normalizeScopePath(scopePath: string): string {
  return (scopePath || '').trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function scopeIncludesCommit(scopePath: string, commitScopePath: string): boolean {
  const scope = normalizeScopePath(scopePath);
  const commitScope = normalizeScopePath(commitScopePath);
  if (!scope) return true;
  return commitScope === scope || commitScope.startsWith(`${scope}/`);
}

function scopeLineage(scopePath: string): string[] {
  const scope = normalizeScopePath(scopePath);
  if (!scope) return [''];
  const parts = scope.split('/').filter(Boolean);
  const lineage = [''];
  for (let index = 0; index < parts.length; index += 1) {
    lineage.push(parts.slice(0, index + 1).join('/'));
  }
  return lineage;
}

function HistoryFilterGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div style={{ minWidth: 0, padding: '4px 0' }}>
      <div
        style={{
          padding: '4px 8px 5px',
          color: 'var(--po-text-disabled)',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {children}
      </div>
    </div>
  );
}

function HistoryFilterOption({
  selected,
  label,
  count,
  markerColor,
  showMarkerSlot = false,
  onClick,
}: {
  readonly selected: boolean;
  readonly label: string;
  readonly count: number;
  readonly markerColor?: string;
  readonly showMarkerSlot?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`w-full min-w-0 rounded-md px-2 text-left transition-colors ${
        selected
          ? 'bg-[var(--po-selected)] text-[var(--po-text)]'
          : 'text-[var(--po-text-muted)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)]'
      }`}
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {showMarkerSlot ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: markerColor ?? 'transparent',
            flexShrink: 0,
          }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        style={{
          color: 'var(--po-text-disabled)',
          fontSize: 10,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {count}
      </span>
      {selected ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </button>
  );
}

// ─── Vertical commit node (Linear Audit Trail) ───

function getTrackInfo(who: string) {
  const { type } = parseOperator(who);
  switch (type) {
    case 'user': return { color: 'var(--po-accent)' };
    case 'agent': return { color: 'var(--po-file-accent-audio)' };
    case 'sync': return { color: 'var(--po-success)' };
    default: return { color: 'var(--po-text-muted)' };
  }
}

function VerticalCommitNode({
  commit,
  hasPrevious,
  hasNext,
  isSelected,
  isHead,
  onClick,
}: {
  commit: VersionCommitInfo;
  hasPrevious: boolean;
  hasNext: boolean;
  isSelected: boolean;
  isHead: boolean;
  onClick: () => void;
}) {
  const { type, id } = parseOperator(commit.who);
  const currentInfo = getTrackInfo(commit.who);
  const actorLabel = formatOperatorLabel(type);

  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const trackColor = 'var(--po-filetree-rail)';
  const dotStroke = hovered ? 'var(--po-text-subtle)' : 'var(--po-text-disabled)';
  const dotRadius = isSelected ? 4 : 3;

  return (
    <div style={{ position: 'relative', height: HISTORY_ROW_HEIGHT }}>
      {/* ExplorerSidebar TreeItem Style Row */}
      <div
        ref={rowRef}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center',
          margin: `${HISTORY_ROW_MARGIN_Y}px 6px`,
          height: HISTORY_ROW_ITEM_HEIGHT, boxSizing: 'border-box',
          borderRadius: 6,
          background: isSelected ? 'var(--po-selected)' : hovered ? 'var(--po-hover)' : 'transparent',
          color: isSelected ? 'var(--po-text)' : hovered ? 'var(--po-text)' : 'var(--po-text-muted)',
          ...SIDEBAR_ROW_TYPOGRAPHY,
          userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          cursor: 'pointer',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', height: '100%', boxSizing: 'border-box',
            paddingLeft: 6,
            paddingRight: 6,
          }}
        >
          <svg
            width={HISTORY_GRAPH_WIDTH}
            height={HISTORY_ROW_HEIGHT}
            viewBox={`0 0 ${HISTORY_GRAPH_WIDTH} ${HISTORY_ROW_HEIGHT}`}
            style={{
              flexShrink: 0,
              marginTop: -HISTORY_ROW_MARGIN_Y,
              marginBottom: -HISTORY_ROW_MARGIN_Y,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            {hasPrevious && (
              <line
                x1={HISTORY_LINE_X}
                y1={0}
                x2={HISTORY_LINE_X}
                y2={HISTORY_ROW_HEIGHT / 2}
                stroke={trackColor}
                strokeWidth={1.5}
              />
            )}
            {hasNext && (
              <line
                x1={HISTORY_LINE_X}
                y1={HISTORY_ROW_HEIGHT / 2}
                x2={HISTORY_LINE_X}
                y2={HISTORY_ROW_HEIGHT}
                stroke={trackColor}
                strokeWidth={1.5}
              />
            )}
            <circle
              cx={HISTORY_LINE_X}
              cy={HISTORY_ROW_HEIGHT / 2}
              r={dotRadius}
              fill={isSelected ? currentInfo.color : hovered ? 'var(--po-panel)' : 'var(--po-canvas)'}
              stroke={isSelected ? 'none' : dotStroke}
              strokeWidth={isSelected ? 0 : 1.5}
              style={{ transition: 'fill 0.12s, stroke 0.12s' }}
            />
          </svg>

          {/* The content container starts AFTER the single line graph */}
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: 6, height: '100%',
            paddingLeft: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {isHead && (
              <span style={{
                fontSize: 9, fontWeight: 600, color: 'var(--po-success)',
                border: '1px solid color-mix(in srgb, var(--po-success) 25%, transparent)', background: 'color-mix(in srgb, var(--po-success) 12%, transparent)',
                padding: '0 4px', borderRadius: 3, display: 'inline-flex', alignItems: 'center', height: 16,
                flexShrink: 0,
              }}>
                HEAD
              </span>
            )}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {commit.message || `(no message)`}
            </span>

            {/* Right area actions/meta */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: 'flex-end', flexShrink: 0,
              marginLeft: 'auto',
            }}>
              <span
                title={id ? `${actorLabel} ${id}` : actorLabel}
                style={{
                  color: isSelected ? currentInfo.color : 'var(--po-text-subtle)',
                  fontSize: 11,
                  fontWeight: 500,
                  opacity: hovered || isSelected ? 1 : 0.75,
                  transition: 'opacity 0.2s, color 0.12s',
                }}
              >
                {actorLabel}
              </span>

              {/* Minimal Time */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: hovered || isSelected ? 1 : 0.7,
                transition: 'opacity 0.2s',
              }}>
                <span style={{ fontSize: 11, color: 'var(--po-text-subtle)', minWidth: 28, textAlign: 'right' }}>
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

function HistoryMoreRow({
  count,
  expanded,
  onClick,
}: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const trackColor = 'var(--po-filetree-rail)';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: `${HISTORY_ROW_MARGIN_Y}px 6px`,
        height: HISTORY_ROW_ITEM_HEIGHT,
        width: 'calc(100% - 12px)',
        boxSizing: 'border-box',
        border: 0,
        borderRadius: 6,
        background: hovered ? 'var(--po-hover)' : 'transparent',
        color: hovered ? 'var(--po-text-muted)' : 'var(--po-text-subtle)',
        cursor: 'pointer',
        padding: '0 6px',
        textAlign: 'left',
        ...SIDEBAR_ROW_TYPOGRAPHY,
      }}
    >
      <svg
        width={HISTORY_GRAPH_WIDTH}
        height={HISTORY_ROW_HEIGHT}
        viewBox={`0 0 ${HISTORY_GRAPH_WIDTH} ${HISTORY_ROW_HEIGHT}`}
        style={{
          flexShrink: 0,
          marginTop: -HISTORY_ROW_MARGIN_Y,
          marginBottom: -HISTORY_ROW_MARGIN_Y,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <line
          x1={HISTORY_LINE_X}
          y1={0}
          x2={HISTORY_LINE_X}
          y2={HISTORY_ROW_HEIGHT / 2}
          stroke={trackColor}
          strokeWidth={1.5}
        />
        <circle
          cx={HISTORY_LINE_X}
          cy={HISTORY_ROW_HEIGHT / 2}
          r={2.5}
          fill="var(--po-canvas)"
          stroke={hovered ? 'var(--po-text-subtle)' : 'var(--po-text-disabled)'}
          strokeWidth={1.5}
        />
      </svg>
      <span
        style={{
          minWidth: 0,
          paddingLeft: 4,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {expanded ? 'Show less' : `${count} more`}
      </span>
    </button>
  );
}

// ─── DiffRow + FileDiffBlock (showcase parity) ───────────────────────

const OP_TONE: Record<string, { bg: string; fg: string }> = {
  added:    { bg: 'color-mix(in srgb, var(--po-success) 15%, transparent)',  fg: 'var(--po-success)' },
  modified: { bg: 'color-mix(in srgb, var(--po-accent) 15%, transparent)', fg: 'var(--po-accent)' },
  deleted:  { bg: 'color-mix(in srgb, var(--po-danger) 15%, transparent)',  fg: 'var(--po-danger)' },
};

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 24,
          paddingLeft: 14,
          background: HISTORY_DIFF_HEADER_BG,
          color: 'var(--po-text-disabled)',
          fontFamily: 'var(--po-font-sans)',
          fontSize: 11,
          borderTop: '1px solid var(--po-hover)',
          borderBottom: '1px solid var(--po-hover)',
        }}
      >
        {line.text}
      </div>
    );
  }

  const isAdd = line.kind === 'add';
  const isRem = line.kind === 'remove';
  const bg = isAdd
    ? 'var(--po-diff-added-bg)'
    : isRem
    ? 'var(--po-diff-removed-bg)'
    : 'transparent';
  const numColor = isAdd ? 'var(--po-success)' : isRem ? 'var(--po-danger)' : 'var(--po-text-disabled)';
  const prefix = isAdd ? '+' : isRem ? '-' : ' ';
  const textColor = isAdd ? 'var(--po-diff-added-text)' : isRem ? 'var(--po-diff-removed-text)' : 'var(--po-text-muted)';
  const lineNum = isRem ? line.oldLine : line.newLine ?? line.oldLine;
  return (
    <div
      style={{
        display: 'flex',
        background: bg,
        fontFamily: 'var(--po-font-sans)',
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
        {lineNum ?? ''}
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
  change: VersionCommitChange;
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
      if (cur) lines = cur.map((text, index) => ({ kind: 'add' as const, text, newLine: index + 1 }));
      else placeholder = 'Binary file or unchanged metadata';
    } else if (op === 'deleted') {
      const prev = parentDetail ? fileToLines(parentDetail) : null;
      if (prev) lines = prev.map((text, index) => ({ kind: 'remove' as const, text, oldLine: index + 1 }));
      else if (!parentCommitId) placeholder = 'No previous version available';
      else placeholder = 'Binary file or unchanged metadata';
    } else {
      const prev = parentDetail ? fileToLines(parentDetail) : null;
      const cur = currentDetail ? fileToLines(currentDetail) : null;
      if (prev && cur) lines = compactDiffLines(addLineNumbers(lineDiff(prev, cur)));
      else placeholder = 'Binary file or unchanged metadata';
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--po-border-subtle)',
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
          background: HISTORY_DIFF_HEADER_BG,
          borderBottom: '1px solid var(--po-border-subtle)',
        }}
      >
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          stroke={ext === 'json' ? 'var(--po-success)' : ext === 'markdown' ? 'var(--po-text-muted)' : 'var(--po-text-subtle)'}
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
            color: 'var(--po-text-muted)',
            fontFamily: 'var(--po-font-sans)',
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
            fontFamily: 'var(--po-font-sans)',
            letterSpacing: 0,
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
            height: 56,
            display: 'flex',
            background: 'var(--po-inset)',
          }}
        >
          <PageLoading variant="fill" label="Loading diff" />
        </div>
      ) : placeholder ? (
        <div
          style={{
            padding: '14px 16px',
            fontSize: 11,
            color: 'var(--po-text-subtle)',
            background: 'var(--po-inset)',
            fontFamily: 'var(--po-font-sans)',
            fontStyle: 'italic',
          }}
        >
          {placeholder}
        </div>
      ) : lines && lines.length > 0 ? (
        <div style={{ padding: '6px 0', background: 'var(--po-inset)' }}>
          {lines.map((line, j) => (
            <DiffRow key={j} line={line} />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '14px 16px',
            fontSize: 11,
            color: 'var(--po-text-subtle)',
            background: 'var(--po-inset)',
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
  commit: VersionCommitInfo;
  projectId: string;
  parentCommitId: string | null;
}) {
  const { type, id } = parseOperator(commit.who);
  const opColors: Record<string, { background: string; color: string; borderColor: string }> = {
    user: {
      background: 'color-mix(in srgb, var(--po-accent) 10%, transparent)',
      color: 'var(--po-accent)',
      borderColor: 'color-mix(in srgb, var(--po-accent) 20%, transparent)',
    },
    agent: {
      background: 'color-mix(in srgb, var(--po-purple) 10%, transparent)',
      color: 'var(--po-purple)',
      borderColor: 'color-mix(in srgb, var(--po-purple) 20%, transparent)',
    },
    sync: {
      background: 'color-mix(in srgb, var(--po-success) 10%, transparent)',
      color: 'var(--po-success)',
      borderColor: 'color-mix(in srgb, var(--po-success) 20%, transparent)',
    },
    system: {
      background: 'var(--po-control)',
      color: 'var(--po-text-muted)',
      borderColor: 'var(--po-border)',
    },
  };
  const opColor = opColors[type] || opColors.system;

  return (
    <div className="p-6 md:p-8 mx-auto" style={{ maxWidth: PROJECT_CONTENT_RAIL_WIDTH }}>
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span
            className="text-lg font-medium text-[var(--po-text)] font-sans"
            title={commit.commit_id}
          >
            {commit.commit_id.slice(0, 8)}
          </span>
          <span className="text-sm text-[var(--po-text-muted)]">
            {commit.message || '(no message)'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border font-medium"
            style={opColor}
          >
            {formatOperatorLabel(type)}
            {id && <span className="opacity-70 font-normal font-sans">{id.slice(0, 8)}</span>}
          </span>

          <span
            className="text-xs text-[var(--po-text-subtle)] font-medium"
            title={formatFullTime(commit.created_at)}
          >
            {formatTime(commit.created_at)}
          </span>

          {commit.root_hash && (
            <span className="text-xs text-[var(--po-text-subtle)] font-sans bg-[var(--po-control)] px-2 py-1 rounded border border-[var(--po-border-subtle)]">
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
              fontFamily: 'var(--po-font-sans)',
              color: 'var(--po-text-subtle)',
              marginBottom: 16,
              paddingBottom: 14,
              borderBottom: '1px solid var(--po-border-subtle)',
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
        <div className="px-6 py-12 text-center text-[var(--po-text-subtle)] text-sm border border-[var(--po-border-subtle)] rounded-xl">
          No file changes in this commit
        </div>
      )}

      {commit.conflicts.length > 0 && (
        <div
          className="mt-4 rounded-xl border p-4"
          style={{
            background: 'color-mix(in srgb, var(--po-warning) 3%, transparent)',
            borderColor: 'color-mix(in srgb, var(--po-warning) 22%, transparent)',
          }}
        >
          <div className="text-xs font-medium text-[var(--po-warning)] mb-3 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Merge Conflicts ({commit.conflicts.length})
          </div>
          <div className="space-y-1.5">
            {commit.conflicts.map((conflict, i) => (
              <div key={i} className="text-xs font-sans text-[var(--po-text-muted)] flex items-center gap-2 bg-[var(--po-inset)] p-2 rounded border border-[var(--po-border-subtle)]">
                <span className="text-[var(--po-text)]">{conflict.path}</span>
                <span className="text-[var(--po-text-subtle)]">-</span>
                <span style={{ color: 'color-mix(in srgb, var(--po-warning) 80%, var(--po-text-muted))' }}>{conflict.strategy}</span>
                {conflict.kept && <span className="text-[var(--po-text-subtle)]">(kept: {conflict.kept})</span>}
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

  const [activeScopeFilter, setActiveScopeFilter] = useState<string>('');
  const [activeActorFilter, setActiveActorFilter] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState<'filters' | null>(null);
  const [historySectionOpen, setHistorySectionOpen] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [needsActionSummary, setNeedsActionSummary] = useState<NeedsActionSummary>({
    count: 0,
    loading: true,
    hasErrors: false,
  });
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const scopeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    commits.forEach(c => {
      scopeLineage(c.scope_path || '').forEach(scope => {
        counts.set(scope, (counts.get(scope) || 0) + 1);
      });
    });
    if (!counts.has('')) counts.set('', 0);
    return Array.from(counts.entries())
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => {
        if (a.scope === '') return -1;
        if (b.scope === '') return 1;
        const depthDiff = a.scope.split('/').length - b.scope.split('/').length;
        if (depthDiff !== 0) return depthDiff;
        return b.count - a.count;
      });
  }, [commits]);

  const scopeFilteredCommits = useMemo(
    () => sortedCommits.filter(c => scopeIncludesCommit(activeScopeFilter, c.scope_path || '')),
    [sortedCommits, activeScopeFilter],
  );
  const scopeChronologicalCommits = useMemo(
    () => commits.filter(c => scopeIncludesCommit(activeScopeFilter, c.scope_path || '')),
    [commits, activeScopeFilter],
  );

  const actorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    scopeFilteredCommits.forEach(c => {
      const { type } = parseOperator(c.who);
      counts.set(type, (counts.get(type) || 0) + 1);
    });
    const order = ['user', 'agent', 'sync', 'system'];
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => {
        const ai = order.indexOf(a.type);
        const bi = order.indexOf(b.type);
        if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return b.count - a.count;
      });
  }, [scopeFilteredCommits]);

  const activeActor = useMemo(
    () => actorOptions.find(option => option.type === activeActorFilter) ?? null,
    [actorOptions, activeActorFilter],
  );

  const activeScope = useMemo(
    () => scopeOptions.find(option => option.scope === activeScopeFilter) ?? null,
    [scopeOptions, activeScopeFilter],
  );

  useEffect(() => {
    if (!activeScopeFilter) return;
    if (!scopeOptions.some(option => option.scope === activeScopeFilter)) {
      setActiveScopeFilter('');
    }
  }, [activeScopeFilter, scopeOptions]);

  useEffect(() => {
    if (!activeActorFilter) return;
    if (!actorOptions.some(option => option.type === activeActorFilter)) {
      setActiveActorFilter(null);
    }
  }, [activeActorFilter, actorOptions]);

  useEffect(() => {
    if (!filterMenuOpen) return;

    function closeOnOutside(event: MouseEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setFilterMenuOpen(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFilterMenuOpen(null);
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
    let filtered = scopeFilteredCommits;
    if (activeActorFilter) {
      filtered = filtered.filter(c => parseOperator(c.who).type === activeActorFilter);
    }
    return filtered;
  }, [scopeFilteredCommits, activeActorFilter]);
  const hasPendingWork = needsActionSummary.count > 0;
  const collapsedHistoryLimit = hasPendingWork ? 5 : 9;
  const visibleHistoryCommits = historyExpanded
    ? filteredCommits
    : filteredCommits.slice(0, collapsedHistoryLimit);
  const hiddenHistoryCount = Math.max(0, filteredCommits.length - visibleHistoryCommits.length);
  const showsHistoryMoreRow = filteredCommits.length > collapsedHistoryLimit;

  useEffect(() => {
    setHistoryExpanded(false);
  }, [activeScopeFilter, activeActorFilter]);

  const handleNeedsActionSummaryChange = useCallback((summary: NeedsActionSummary) => {
    setNeedsActionSummary((current) => {
      if (
        current.count === summary.count
        && current.loading === summary.loading
        && current.hasErrors === summary.hasErrors
      ) {
        return current;
      }
      return summary;
    });
  }, []);

  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  // The right pane shows EITHER a commit detail OR a needs-action item
  // detail. Holding both selections in parallel state (rather than a
  // discriminated union) keeps the existing commit-selection effects
  // untouched — they auto-select HEAD when the project changes, and
  // I don't want to entangle that with the new flow. When a
  // needs-action item is selected we clear the commit selection, and
  // vice versa.
  const [selectedNeedsAction, setSelectedNeedsAction] = useState<NeedsActionSelection | null>(null);
  const [selectedNeedsActionItem, setSelectedNeedsActionItem] = useState<NeedsActionItem | null>(null);

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

  useEffect(() => {
    if (filteredCommits.length === 0) {
      if (selectedCommitId) setSelectedCommitId(null);
      return;
    }
    if (!selectedCommitId || !filteredCommits.some(commit => commit.commit_id === selectedCommitId)) {
      setSelectedCommitId(filteredCommits[0].commit_id);
    }
  }, [filteredCommits, selectedCommitId]);

  const selectedCommit = useMemo(
    () => commits.find(c => c.commit_id === selectedCommitId) ?? null,
    [commits, selectedCommitId]
  );

  // Parent commit = the commit immediately preceding the selected one
  // in chronological order. The API returns commits oldest-first, so
  // the parent of `commits[i]` is `commits[i - 1]`.
  const parentCommitId = useMemo(() => {
    if (!selectedCommit) return null;
    const idx = scopeChronologicalCommits.findIndex(c => c.commit_id === selectedCommit.commit_id);
    if (idx <= 0) return null;
    return scopeChronologicalCommits[idx - 1].commit_id;
  }, [scopeChronologicalCommits, selectedCommit]);

  // ── Needs Action wiring ─────────────────────────────────────────
  // Selecting a needs-action item makes it the right pane content;
  // we drop the commit selection so the views never both render.
  const handleNeedsActionSelect = useCallback(
    (selection: NeedsActionSelection, item: NeedsActionItem) => {
      setSelectedNeedsAction(selection);
      setSelectedNeedsActionItem(item);
      setSelectedCommitId(null);
    },
    [],
  );

  // Item removed (resolved / rejected / dismissed). If a real commit
  // landed (``commit_id``) refresh history so it shows up at the top
  // and select it so the user sees the result. Otherwise jump back
  // to HEAD.
  const handleNeedsActionRemoved = useCallback(
    (selection: NeedsActionSelection, result: ResolvedResult) => {
      // Clear our selection IF the removed item is the one currently
      // shown — otherwise a background snooze on a different item
      // shouldn't kick the user off whatever they're reading.
      if (
        selectedNeedsAction
        && selectedNeedsAction.kind === selection.kind
        && selectedNeedsAction.itemId === selection.itemId
      ) {
        setSelectedNeedsAction(null);
        setSelectedNeedsActionItem(null);
      }
      if (result.commit_id) {
        void mutateHistory();
        // Highlight the new commit. The history list refresh will
        // pull it in; ``selectedCommitId`` settles on it, and the
        // existing auto-pick effect (lines around 1025) leaves it
        // alone because it is present in ``filteredCommits``.
        setSelectedCommitId(result.commit_id);
      } else if (!result.commit_id && selectedCommitId === null && headCommitId) {
        setSelectedCommitId(headCommitId);
      }
    },
    [mutateHistory, selectedNeedsAction, selectedCommitId, headCommitId],
  );

  // When the user clicks a commit, we drop the needs-action selection
  // so the right pane re-renders CommitDetail instead of the item
  // detail.
  const selectCommit = useCallback((commitId: string) => {
    setSelectedCommitId(commitId);
    setSelectedNeedsAction(null);
    setSelectedNeedsActionItem(null);
  }, []);

  const activeFilterCount =
    (activeScopeFilter ? 1 : 0) + (activeActorFilter ? 1 : 0);
  const filterTitle = [
    activeScope ? formatScopeLabel(activeScope.scope) : null,
    activeActor ? formatOperatorLabel(activeActor.type) : null,
  ].filter(Boolean).join(' · ') || 'Filter history';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--po-canvas)' }}>

      {/* ── Header ── */}
      <div style={{
        height: 46, minHeight: 46, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid var(--po-divider)',
        background: 'var(--po-canvas)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>
            Changes
          </span>
          {history && (
            <span style={{ fontSize: 12, color: 'var(--po-text-disabled)' }}>
              {history.total} commit{history.total !== 1 ? 's' : ''}
              {history.head_commit_id && (
                <> · <span
                  title={history.head_commit_id}
                  style={{ fontFamily: 'var(--po-font-sans)' }}
                >
                  {history.head_commit_id.slice(0, 12)}
                </span></>
              )}
            </span>
          )}
        </div>
        {history?.root_hash && (
          <span style={{
            fontSize: 10, color: 'var(--po-text-subtle)',
            fontFamily: 'var(--po-font-sans)',
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--po-danger)', fontSize: 13 }}>
          Failed to load changes
        </div>
      )}

      {/* ── Main Layout (Left/Right Split) ── */}
      {!isInitialLoading && !error && (
        <div className="flex flex-1 min-h-0">
          {/* Left: Timeline List — wrapped in `ResizableSidebarColumn`
              so users can widen the timeline when commit messages or
              author IDs would otherwise truncate aggressively. Starts
              at the compact minimum to keep the diff surface dominant. */}
          <ResizableSidebarColumn
            storageKey='history-timeline:history'
            defaultWidth={260}
            minWidth={260}
            maxWidth={520}
            className="border-r border-[var(--po-divider)] bg-[var(--po-canvas)] z-10"
          >
            <NeedsActionSection
              projectId={projectId}
              selected={selectedNeedsAction}
              onSelect={handleNeedsActionSelect}
              onItemRemoved={handleNeedsActionRemoved}
              onSummaryChange={handleNeedsActionSummaryChange}
            />

            {/* History */}
            <div
              ref={filterMenuRef}
              className="relative flex min-h-[280px] flex-1 flex-col bg-[var(--po-canvas)]"
            >
              <div
                style={{
                  height: 40,
                  minHeight: 40,
                  padding: '0 10px 0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => setHistorySectionOpen((open) => !open)}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <svg
                    aria-hidden
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      color: 'var(--po-text-subtle)',
                      flexShrink: 0,
                      transform: historySectionOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 120ms ease',
                    }}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span
                    style={{
                      color: 'var(--po-text)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    History
                  </span>
                  <span
                    style={{
                      color: 'var(--po-text-disabled)',
                      fontSize: 11,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {commits.length} commit{commits.length === 1 ? '' : 's'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterMenuOpen(open => open === 'filters' ? null : 'filters')}
                  title={filterTitle}
                  aria-haspopup="menu"
                  aria-expanded={filterMenuOpen === 'filters'}
                  style={{
                    height: 30,
                    width: 30,
                    minWidth: 0,
                    flexShrink: 0,
                    display: 'inline-flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 0,
                    padding: 0,
                    borderRadius: 6,
                    border: 0,
                    background: activeFilterCount > 0 ? 'var(--po-selected)' : 'transparent',
                    color: activeFilterCount > 0 ? 'var(--po-text)' : 'var(--po-text-muted)',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 5h18" />
                    <path d="M7 12h10" />
                    <path d="M10 19h4" />
                  </svg>
                  <span className="sr-only">Filter</span>
                  {activeFilterCount > 0 ? (
                    <span
                      style={{
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        borderRadius: 999,
                        background: 'var(--po-control)',
                        color: 'var(--po-text-subtle)',
                        fontSize: 10,
                        lineHeight: '16px',
                        textAlign: 'center',
                      }}
                    >
                      {activeFilterCount}
                    </span>
                  ) : null}
                </button>

                {filterMenuOpen === 'filters' && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: 36,
                      zIndex: 10000,
                      width: 250,
                      maxHeight: 360,
                      overflowY: 'auto',
                      padding: 6,
                      borderRadius: 8,
                      border: '1px solid var(--po-border)',
                      background: 'var(--po-overlay)',
                      boxShadow: '0 12px 32px var(--po-shadow)',
                    }}
                    className="custom-scrollbar"
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                        gap: 8,
                      }}
                    >
                      <HistoryFilterGroup label="Scope">
                        {scopeOptions.map(option => {
                          const isSelected = activeScopeFilter === option.scope;
                          return (
                            <HistoryFilterOption
                              key={option.scope || '__root__'}
                              selected={isSelected}
                              label={formatScopeLabel(option.scope)}
                              count={option.count}
                              onClick={() => {
                                setActiveScopeFilter(option.scope);
                                setFilterMenuOpen(null);
                              }}
                            />
                          );
                        })}
                      </HistoryFilterGroup>

                      <HistoryFilterGroup label="User">
                        <HistoryFilterOption
                          selected={activeActorFilter === null}
                          label="All users"
                          count={scopeFilteredCommits.length}
                          showMarkerSlot
                          onClick={() => {
                            setActiveActorFilter(null);
                            setFilterMenuOpen(null);
                          }}
                        />
                        {actorOptions.map(option => (
                          <HistoryFilterOption
                            key={option.type}
                            selected={activeActorFilter === option.type}
                            label={formatOperatorLabel(option.type)}
                            count={option.count}
                            markerColor={getTrackInfo(option.type).color}
                            showMarkerSlot
                            onClick={() => {
                              setActiveActorFilter(option.type);
                              setFilterMenuOpen(null);
                            }}
                          />
                        ))}
                      </HistoryFilterGroup>
                    </div>
                  </div>
                )}
              </div>

              {historySectionOpen ? (
                <div
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 custom-scrollbar"
                >
                {commits.length === 0 ? (
                  <div
                    style={{
                      padding: '18px 14px',
                      color: 'var(--po-text-disabled)',
                      fontSize: 12,
                      lineHeight: '18px',
                    }}
                  >
                    No committed changes yet.
                  </div>
                ) : filteredCommits.length === 0 ? (
                  <div
                    style={{
                      padding: '18px 14px',
                      color: 'var(--po-text-disabled)',
                      fontSize: 12,
                      lineHeight: '18px',
                    }}
                  >
                    No changes match these filters.
                  </div>
                ) : (
                  <>
                    {visibleHistoryCommits.map((commit, i) => (
                      <VerticalCommitNode
                        key={commit.commit_id}
                        commit={commit}
                        hasPrevious={i > 0}
                        hasNext={
                          i < visibleHistoryCommits.length - 1
                            || (!historyExpanded && hiddenHistoryCount > 0)
                            || (historyExpanded && showsHistoryMoreRow)
                        }
                        isSelected={selectedCommitId === commit.commit_id}
                        isHead={commit.commit_id === headCommitId}
                        onClick={() => selectCommit(commit.commit_id)}
                      />
                    ))}
                    {showsHistoryMoreRow ? (
                      <HistoryMoreRow
                        count={hiddenHistoryCount}
                        expanded={historyExpanded}
                        onClick={() => setHistoryExpanded((open) => !open)}
                      />
                    ) : null}
                  </>
                )}
              </div>
              ) : null}
            </div>
          </ResizableSidebarColumn>

          {/* Right: Either a Needs Action item detail OR the
              commit detail. Needs Action wins when an item is
              selected (the page's selection handlers keep at most
              one of {commit, item} active). */}
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar bg-[var(--po-canvas)]">
            {selectedNeedsAction && selectedNeedsActionItem ? (
              <NeedsActionDetailPane
                projectId={projectId}
                selection={selectedNeedsAction}
                item={selectedNeedsActionItem}
                onRemoved={handleNeedsActionRemoved}
              />
            ) : selectedCommit ? (
              <CommitDetail
                commit={selectedCommit}
                projectId={projectId}
                parentCommitId={parentCommitId}
              />
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 10,
                color: 'var(--po-text-disabled)',
                fontSize: 13,
              }}>
                {commits.length === 0 ? (
                  <>
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.42 }}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span style={{ color: 'var(--po-text-subtle)' }}>No changes yet</span>
                    <span style={{ fontSize: 12 }}>Pending reviews and conflicts appear in Needs action.</span>
                  </>
                ) : (
                  'Select a commit'
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
