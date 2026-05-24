'use client';

import { use, useState, useCallback } from 'react';
import useSWR from 'swr';
import { ProjectPageLoadingShell } from '@/components/loading';
import {
  listPendingConflicts,
  getPendingConflict,
  resolveConflict,
  type PendingConflictSummary,
  type PendingConflictDetail,
  type ConflictRecord,
  type ResolveDecision,
} from '@/lib/conflictApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';

const T = {
  bg: 'var(--po-canvas)',
  panel: 'var(--po-panel)',
  border: 'var(--po-border)',
  borderSubtle: 'var(--po-border-subtle)',
  text: 'var(--po-text)',
  textMuted: 'var(--po-text-muted)',
  textDisabled: 'var(--po-text-disabled)',
  warning: 'var(--po-warning)',
  success: 'var(--po-success)',
  danger: 'var(--po-danger)',
} as const;


export default function ConflictsPage({ params }: Readonly<{ params: Promise<{ projectId: string }> }>) {
  const { projectId } = use(params);

  const {
    data: conflicts,
    isLoading,
    mutate,
  } = useSWR<PendingConflictSummary[]>(
    ['conflicts-pending', projectId],
    () => listPendingConflicts(projectId),
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );

  const [selectedId, setSelectedId] = useState<string>('');

  // Pre-load the selected conflict's detail so per-row expansion is
  // snappy. SWR de-dupes if multiple rows ask for the same id.
  const {
    data: detail,
    isLoading: detailLoading,
  } = useSWR<PendingConflictDetail>(
    selectedId ? ['conflict-detail', projectId, selectedId] : null,
    () => getPendingConflict(projectId, selectedId),
  );

  const handleResolve = useCallback(async (
    pendingConflictId: string,
    decision: ResolveDecision,
    resolutionMessage: string,
  ) => {
    // ``reject`` doesn't need a tree id; ``accept`` would, but we
    // intentionally route "merged tree id" / "merged files" through a
    // proper resolver editor (not yet built — see the inline TODO).
    // For now the page supports rejection-from-the-list plus
    // accept-via-existing-server-tree (the engine accepts an empty
    // body's tree id only if it can re-derive from the proposed
    // tree which carries B's content). The richer accept flow with
    // user-merged content lives in a separate editor surface.
    try {
      await resolveConflict(projectId, pendingConflictId, {
        decision,
        resolution_message: resolutionMessage,
      });
      await mutate();
      if (selectedId === pendingConflictId) setSelectedId('');
    } catch (err) {
      console.error('[Conflicts] resolve failed:', err);
      // Surface the failure inline by re-fetching — the list refresh
      // will re-emit a row with whatever the server reported.
      await mutate();
    }
  }, [projectId, mutate, selectedId]);

  if (isLoading && !conflicts) {
    return <ProjectPageLoadingShell />;
  }

  const rows = conflicts ?? [];

  return (
    <div
      style={{
        background: T.bg,
        minHeight: '100%',
        padding: '32px 24px',
      }}
    >
      <div
        style={{
          maxWidth: PROJECT_CONTENT_RAIL_WIDTH,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: T.text, margin: 0 }}>
            Pending conflicts
          </h1>
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, lineHeight: 1.55 }}>
            Writes that landed in ``manual_review`` policy and are
            waiting on a human decision. Accept to commit a resolution
            tree, or reject to leave the scope head unchanged.
          </p>
        </header>

        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row) => (
              <ConflictRow
                key={row.pending_conflict_id}
                row={row}
                isSelected={row.pending_conflict_id === selectedId}
                onToggle={() => setSelectedId(
                  row.pending_conflict_id === selectedId
                    ? ''
                    : row.pending_conflict_id,
                )}
                detail={row.pending_conflict_id === selectedId ? detail : undefined}
                detailLoading={row.pending_conflict_id === selectedId && detailLoading}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function EmptyState() {
  return (
    <div
      style={{
        padding: '36px 16px',
        textAlign: 'center',
        color: T.textMuted,
        fontSize: 13,
        background: T.panel,
        border: `1px dashed ${T.borderSubtle}`,
        borderRadius: 8,
      }}
    >
      No pending conflicts.
      <div style={{ marginTop: 4, color: T.textDisabled, fontSize: 12 }}>
        New rows appear here when a writer opts into ``manual_review``
        and the engine couldn&apos;t auto-merge.
      </div>
    </div>
  );
}


function ConflictRow({
  row,
  isSelected,
  onToggle,
  detail,
  detailLoading,
  onResolve,
}: Readonly<{
  row: PendingConflictSummary;
  isSelected: boolean;
  onToggle: () => void;
  detail: PendingConflictDetail | undefined;
  detailLoading: boolean;
  onResolve: (id: string, decision: ResolveDecision, message: string) => Promise<void>;
}>) {
  const [rejectReason, setRejectReason] = useState('');
  const [running, setRunning] = useState<ResolveDecision | ''>('');

  const handle = useCallback(async (decision: ResolveDecision) => {
    if (running) return;
    setRunning(decision);
    try {
      const message = decision === 'reject'
        ? (rejectReason || 'rejected by reviewer')
        : 'accepted by reviewer';
      await onResolve(row.pending_conflict_id, decision, message);
    } finally {
      setRunning('');
    }
  }, [running, rejectReason, onResolve, row.pending_conflict_id]);

  const scopeLabel = row.scope_path || '/ (root)';

  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'transparent',
          border: 0,
          padding: '12px 14px',
          textAlign: 'left',
          cursor: 'pointer',
          color: T.text,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: T.warning,
              color: 'var(--po-text-inverse)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {row.status}
          </span>
          <span style={{ fontSize: 13, fontFamily: 'var(--po-font-mono)' }}>
            {row.pending_conflict_id.slice(0, 12)}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: T.textMuted }}>
            scope=<code>{scopeLabel}</code> · policy={row.policy} · paths={row.changed_paths.length}
          </span>
          <span style={{ fontSize: 11, color: T.textDisabled }}>
            {isSelected ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {isSelected && (
        <div
          style={{
            borderTop: `1px solid ${T.borderSubtle}`,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {detailLoading && !detail && (
            <div style={{ fontSize: 12, color: T.textMuted }}>Loading…</div>
          )}
          {detail && (
            <>
              <PathList paths={detail.changed_paths} />
              <ConflictRecordsList records={detail.conflict_records} />
            </>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              borderTop: `1px solid ${T.borderSubtle}`,
              paddingTop: 12,
            }}
          >
            <input
              type="text"
              placeholder="Optional reject reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                padding: '6px 10px',
                fontSize: 12,
                color: T.text,
                background: T.bg,
                border: `1px solid ${T.borderSubtle}`,
                borderRadius: 4,
              }}
            />
            <button
              type="button"
              onClick={() => handle('reject')}
              disabled={!!running}
              style={primaryButtonStyle(T.danger, running === 'reject')}
            >
              {running === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              type="button"
              onClick={() => handle('accept')}
              disabled={!!running}
              style={primaryButtonStyle(T.success, running === 'accept')}
              title="Accept the incoming proposed tree as-is (re-enters publish at current head)"
            >
              {running === 'accept' ? 'Accepting…' : 'Accept (use proposed tree)'}
            </button>
          </div>
          {/* TODO: a richer "accept with merged content" editor that
            * lets the reviewer construct ``resolution_files`` per
            * path. The current accept variant re-submits the
            * originally proposed tree, which is correct when the
            * reviewer just wants to override the auto-merge gate;
            * for actual three-way merging users should use a code
            * editor opened against the conflict's tree id. */}
        </div>
      )}
    </div>
  );
}


function PathList({ paths }: Readonly<{ paths: string[] }>) {
  if (paths.length === 0) {
    return (
      <div style={{ fontSize: 12, color: T.textMuted }}>(no paths recorded)</div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
        CHANGED PATHS
      </div>
      <div style={{
        fontFamily: 'var(--po-font-mono)',
        fontSize: 12,
        background: T.bg,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 4,
        padding: '8px 10px',
        maxHeight: 160,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {paths.slice(0, 50).map((p) => <span key={p}>{p}</span>)}
        {paths.length > 50 && (
          <span style={{ color: T.textDisabled }}>
            …{paths.length - 50} more
          </span>
        )}
      </div>
    </div>
  );
}


function ConflictRecordsList({ records }: Readonly<{ records: ConflictRecord[] }>) {
  if (records.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
        CONFLICT RECORDS ({records.length})
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        maxHeight: 240,
        overflow: 'auto',
      }}>
        {records.slice(0, 20).map((r, i) => (
          <div
            key={`${r.path}-${i}`}
            style={{
              padding: '6px 8px',
              background: T.bg,
              border: `1px solid ${T.borderSubtle}`,
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'var(--po-font-mono)',
            }}
          >
            <div style={{ color: T.text }}>
              <strong style={{ color: T.warning }}>{r.strategy}</strong> ·{' '}
              {r.path}
              {r.kept && <span style={{ color: T.textMuted }}> · kept={r.kept}</span>}
            </div>
            {r.detail && (
              <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>
                {r.detail}
              </div>
            )}
          </div>
        ))}
        {records.length > 20 && (
          <div style={{ color: T.textDisabled, fontSize: 11 }}>
            …{records.length - 20} more records
          </div>
        )}
      </div>
    </div>
  );
}


function primaryButtonStyle(accentColor: string, running: boolean) {
  return {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--po-text-inverse)',
    background: accentColor,
    border: 0,
    borderRadius: 4,
    cursor: running ? 'progress' : 'pointer',
    opacity: running ? 0.7 : 1,
  };
}
