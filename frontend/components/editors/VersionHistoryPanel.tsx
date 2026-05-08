'use client';

import React, { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  getVersionHistory,
  rollbackToVersion,
  type FileVersionInfo,
  type MutCommitChange,
} from '@/lib/contentTreeApi';
import { InlineLoading } from '@/components/loading';

interface VersionHistoryPanelProps {
  nodeId: string;  // File path (Mut path)
  projectId: string;
  onClose: () => void;
  onRollbackComplete?: () => void;
}

const OP_COLORS: Record<string, string> = {
  added: '#22c55e',
  modified: '#3b82f6',
  deleted: '#ef4444',
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

function parseOperator(who: string): { type: string; id: string } {
  if (who.includes(':')) {
    const [type, ...rest] = who.split(':');
    return { type, id: rest.join(':') };
  }
  return { type: who || 'system', id: '' };
}

function OperatorBadge({ who }: { who: string }) {
  const { type, id } = parseOperator(who);
  const colors: Record<string, { bg: string; text: string }> = {
    user: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
    agent: { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
    sync: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
    system: { bg: 'rgba(161,161,170,0.15)', text: '#a1a1aa' },
  };
  const c = colors[type] || colors.system;
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: c.bg, color: c.text, fontWeight: 500,
    }}>
      {label}
      {id && <span style={{ opacity: 0.7, fontWeight: 400 }}>{id.slice(0, 8)}</span>}
    </span>
  );
}

function ChangeSummary({ changes }: { changes: MutCommitChange[] }) {
  const summary = useMemo(() => {
    const counts = { added: 0, modified: 0, deleted: 0 };
    for (const c of changes) {
      if (c.op in counts) counts[c.op as keyof typeof counts]++;
    }
    return counts;
  }, [changes]);

  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
      {summary.added > 0 && <span style={{ color: OP_COLORS.added }}>+{summary.added}</span>}
      {summary.modified > 0 && <span style={{ color: OP_COLORS.modified }}>~{summary.modified}</span>}
      {summary.deleted > 0 && <span style={{ color: OP_COLORS.deleted }}>-{summary.deleted}</span>}
    </div>
  );
}

function shortCommit(cid: string): string {
  return cid ? cid.slice(0, 8) : '';
}

function CommitRow({
  commit,
  isCurrent,
  onRollback,
}: {
  commit: FileVersionInfo;
  isCurrent: boolean;
  onRollback: (commitId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shortId = shortCommit(commit.commit_id);

  return (
    <div style={{ position: 'relative', paddingLeft: 24 }}>
      <div style={{
        position: 'absolute', left: 7, top: 16,
        width: 8, height: 8, borderRadius: '50%',
        background: isCurrent ? '#22c55e' : '#27272a',
        border: `2px solid ${isCurrent ? '#22c55e' : '#3f3f46'}`,
        zIndex: 1,
      }} />

      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '10px 12px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.06)',
          background: expanded ? '#111113' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
          marginBottom: 2,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#0d0d0f'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              title={commit.commit_id}
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11, fontWeight: 600,
                color: isCurrent ? '#22c55e' : '#e4e4e7',
                flexShrink: 0,
              }}
            >
              {shortId}
            </span>
            {isCurrent && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 500,
              }}>
                HEAD
              </span>
            )}
            <span style={{
              fontSize: 12, color: '#d4d4d8',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {commit.message || '(no message)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ChangeSummary changes={commit.changes} />
            <span style={{ fontSize: 10, color: '#52525b', whiteSpace: 'nowrap' }} title={formatFullTime(commit.created_at)}>
              {formatTime(commit.created_at)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <OperatorBadge who={commit.who} />
          {commit.root_hash && (
            <span style={{
              fontSize: 10, color: '#3f3f46', marginLeft: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {commit.root_hash.slice(0, 10)}
            </span>
          )}
        </div>

        {expanded && commit.changes.length > 0 && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 10, color: '#71717a', marginBottom: 6 }}>
              {commit.changes.length} file{commit.changes.length !== 1 ? 's' : ''} changed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {commit.changes.map((change, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 6px', borderRadius: 4, fontSize: 11,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: 2,
                    background: OP_COLORS[change.op] || '#71717a',
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: '#a1a1aa',
                  }}>
                    {change.path}
                  </span>
                  <span style={{
                    fontSize: 9, color: OP_COLORS[change.op] || '#71717a',
                    marginLeft: 'auto', flexShrink: 0,
                  }}>
                    {change.op}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
              {!isCurrent && (
                <button
                  onClick={() => onRollback(commit.commit_id)}
                  style={{
                    fontSize: 10, padding: '3px 10px', borderRadius: 4,
                    border: '1px solid rgba(234,179,8,0.3)',
                    background: 'rgba(234,179,8,0.1)',
                    color: '#eab308', cursor: 'pointer',
                  }}
                >
                  Rollback to {shortId}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VersionHistoryPanel({
  nodeId,
  projectId,
  onClose,
  onRollbackComplete,
}: VersionHistoryPanelProps) {
  const [rollbackConfirm, setRollbackConfirm] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const { data: history, error: historyError, mutate: refreshHistory } = useSWR(
    nodeId ? ['version-history', nodeId, projectId] : null,
    () => getVersionHistory(nodeId, projectId),
    { revalidateOnFocus: false },
  );

  const handleRollback = useCallback(async (commitId: string) => {
    setIsRollingBack(true);
    try {
      await rollbackToVersion(nodeId, commitId, projectId);
      setRollbackConfirm(null);
      await refreshHistory();
      onRollbackComplete?.();
    } catch (err) {
      console.error('Rollback failed:', err);
    } finally {
      setIsRollingBack(false);
    }
  }, [nodeId, projectId, refreshHistory, onRollbackComplete]);

  const commits = history?.commits ?? [];
  const headCommitId = history?.head_commit_id ?? '';

  const fileName = nodeId.includes('/') ? nodeId.split('/').pop() : nodeId;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0c0c0d',
      color: '#e4e4e7',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #27272a',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </span>
          {history && (
            <span style={{ fontSize: 11, color: '#52525b', flexShrink: 0 }}>
              {history.total} commit{history.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 2, flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        {historyError && (
          <div style={{ padding: 24, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>
            Failed to load version history
          </div>
        )}

        {!history && !historyError && (
          <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
            <InlineLoading />
          </div>
        )}

        {commits.length > 0 && (
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 10, top: 20, bottom: 20,
              width: 2, background: '#1f1f23',
            }} />
            {commits.map((commit) => (
              <CommitRow
                key={commit.commit_id}
                commit={commit}
                isCurrent={Boolean(headCommitId) && commit.commit_id === headCommitId}
                onRollback={(cid) => setRollbackConfirm(cid)}
              />
            ))}
          </div>
        )}

        {commits.length === 0 && history && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 200, gap: 8, color: '#3f3f46',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ fontSize: 13 }}>No commits for this file</span>
          </div>
        )}
      </div>

      {/* Rollback Confirmation */}
      {rollbackConfirm !== null && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: '#18181b', border: '1px solid #27272a',
            borderRadius: 10, padding: 24, maxWidth: 400, width: '90%',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 500, color: '#e4e4e7' }}>
              Confirm Rollback
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>
              This will create a new commit with the content from{' '}
              <strong title={rollbackConfirm}>{shortCommit(rollbackConfirm)}</strong>.
              The current head will be preserved in history.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRollbackConfirm(null)}
                disabled={isRollingBack}
                style={{
                  padding: '6px 16px', borderRadius: 6,
                  border: '1px solid #27272a', background: 'transparent',
                  color: '#a1a1aa', fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRollback(rollbackConfirm)}
                disabled={isRollingBack}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: 'none',
                  background: '#eab308', color: '#000', fontSize: 13,
                  fontWeight: 500, cursor: isRollingBack ? 'not-allowed' : 'pointer',
                  opacity: isRollingBack ? 0.6 : 1,
                }}
              >
                {isRollingBack ? 'Rolling back...' : `Rollback to ${shortCommit(rollbackConfirm)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
