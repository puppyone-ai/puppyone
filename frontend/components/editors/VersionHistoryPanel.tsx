'use client';

import React, { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  getVersionHistory,
  getVersionContent,
  diffVersions,
  rollbackToVersion,
  type FileVersionInfo,
  type FileVersionDetail,
  type DiffResponse,
} from '@/lib/contentNodesApi';

interface VersionHistoryPanelProps {
  nodeId: string;
  projectId: string;
  onClose: () => void;
  onRollbackComplete?: () => void;
}

const OP_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  rollback: 'Rollback',
  merge: 'Merged',
};

const OP_COLORS: Record<string, string> = {
  create: '#22c55e',
  update: '#3b82f6',
  delete: '#ef4444',
  rollback: '#eab308',
  merge: '#a855f7',
};

const OPERATOR_LABELS: Record<string, string> = {
  user: 'User',
  agent: 'Agent',
  system: 'System',
  sync: 'Sync',
};

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VersionHistoryPanel({
  nodeId,
  projectId,
  onClose,
  onRollbackComplete,
}: VersionHistoryPanelProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [diffTarget, setDiffTarget] = useState<{ v1: number; v2: number } | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<number | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [view, setView] = useState<'list' | 'detail' | 'diff'>('list');

  const { data: history, error: historyError, mutate: refreshHistory } = useSWR(
    nodeId ? ['version-history', nodeId, projectId] : null,
    () => getVersionHistory(nodeId, projectId),
    { revalidateOnFocus: false },
  );

  const { data: versionDetail } = useSWR(
    selectedVersion !== null ? ['version-detail', nodeId, selectedVersion, projectId] : null,
    () => getVersionContent(nodeId, selectedVersion!, projectId),
    { revalidateOnFocus: false },
  );

  const { data: diffResult } = useSWR(
    diffTarget ? ['version-diff', nodeId, diffTarget.v1, diffTarget.v2, projectId] : null,
    () => diffVersions(nodeId, diffTarget!.v1, diffTarget!.v2, projectId),
    { revalidateOnFocus: false },
  );

  const handleViewDetail = useCallback((version: number) => {
    setSelectedVersion(version);
    setView('detail');
  }, []);

  const handleDiff = useCallback((v1: number, v2: number) => {
    setDiffTarget({ v1, v2 });
    setView('diff');
  }, []);

  const handleRollback = useCallback(async (version: number) => {
    setIsRollingBack(true);
    try {
      await rollbackToVersion(nodeId, version, projectId);
      setRollbackConfirm(null);
      setView('list');
      await refreshHistory();
      onRollbackComplete?.();
    } catch (err) {
      console.error('Rollback failed:', err);
    } finally {
      setIsRollingBack(false);
    }
  }, [nodeId, projectId, refreshHistory, onRollbackComplete]);

  const versions = history?.versions ?? [];
  const currentVersion = history?.current_version ?? 0;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setSelectedVersion(null); setDiffTarget(null); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#71717a',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {view === 'list' && 'Version History'}
            {view === 'detail' && `Version ${selectedVersion}`}
            {view === 'diff' && `Diff v${diffTarget?.v1} vs v${diffTarget?.v2}`}
          </span>
          {history && (
            <span style={{ fontSize: 11, color: '#52525b' }}>
              ({history.total} versions)
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 2 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {historyError && (
          <div style={{ padding: 24, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>
            Failed to load version history
          </div>
        )}

        {!history && !historyError && (
          <div style={{ padding: 24, textAlign: 'center', color: '#52525b', fontSize: 13 }}>
            Loading...
          </div>
        )}

        {/* List View */}
        {view === 'list' && versions.length > 0 && (
          <div>
            {versions.map((v, idx) => (
              <VersionRow
                key={v.id}
                version={v}
                isCurrent={v.version === currentVersion}
                prevVersion={idx < versions.length - 1 ? versions[idx + 1].version : null}
                onViewDetail={handleViewDetail}
                onDiff={handleDiff}
                onRollback={(ver) => setRollbackConfirm(ver)}
              />
            ))}
          </div>
        )}

        {view === 'list' && versions.length === 0 && history && (
          <div style={{ padding: 40, textAlign: 'center', color: '#3f3f46', fontSize: 13 }}>
            No version history available
          </div>
        )}

        {/* Detail View */}
        {view === 'detail' && versionDetail && (
          <VersionDetailView detail={versionDetail} />
        )}

        {/* Diff View */}
        {view === 'diff' && diffResult && (
          <DiffView diff={diffResult} />
        )}
      </div>

      {/* Rollback Confirmation Dialog */}
      {rollbackConfirm !== null && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: '#18181b',
            border: '1px solid #27272a',
            borderRadius: 10,
            padding: 24,
            maxWidth: 400,
            width: '90%',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 500, color: '#e4e4e7' }}>
              Confirm Rollback
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>
              This will create a new version with the content from <strong>v{rollbackConfirm}</strong>.
              The current version will be preserved in history. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRollbackConfirm(null)}
                disabled={isRollingBack}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: '1px solid #27272a',
                  background: 'transparent',
                  color: '#a1a1aa',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRollback(rollbackConfirm)}
                disabled={isRollingBack}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#eab308',
                  color: '#000',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isRollingBack ? 'not-allowed' : 'pointer',
                  opacity: isRollingBack ? 0.6 : 1,
                }}
              >
                {isRollingBack ? 'Rolling back...' : `Rollback to v${rollbackConfirm}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// === Sub-components ===

function VersionRow({
  version,
  isCurrent,
  prevVersion,
  onViewDetail,
  onDiff,
  onRollback,
}: {
  version: FileVersionInfo;
  isCurrent: boolean;
  prevVersion: number | null;
  onViewDetail: (v: number) => void;
  onDiff: (v1: number, v2: number) => void;
  onRollback: (v: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const opColor = OP_COLORS[version.operation] || '#71717a';
  const opLabel = OP_LABELS[version.operation] || version.operation;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid #1a1a1a',
        background: hovered ? '#111113' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onClick={() => onViewDetail(version.version)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'monospace',
            color: isCurrent ? '#22c55e' : '#e4e4e7',
          }}>
            v{version.version}
          </span>
          {isCurrent && (
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgba(34,197,94,0.15)',
              color: '#22c55e',
              fontWeight: 500,
            }}>
              current
            </span>
          )}
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            background: `${opColor}15`,
            color: opColor,
            fontWeight: 500,
          }}>
            {opLabel}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#52525b' }}>
          {formatTime(version.created_at)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: '#71717a' }}>
          {OPERATOR_LABELS[version.operator_type] || version.operator_type}
          {version.operator_id && <span style={{ color: '#52525b' }}> ({version.operator_id})</span>}
          {version.summary && <span style={{ color: '#52525b', marginLeft: 8 }}>{version.summary}</span>}
        </div>

        {hovered && (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            {prevVersion !== null && (
              <button
                onClick={() => onDiff(prevVersion, version.version)}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #27272a',
                  background: '#18181b',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                }}
              >
                Diff
              </button>
            )}
            {!isCurrent && (
              <button
                onClick={() => onRollback(version.version)}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(234,179,8,0.3)',
                  background: 'rgba(234,179,8,0.1)',
                  color: '#eab308',
                  cursor: 'pointer',
                }}
              >
                Rollback
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: '#3f3f46', marginTop: 2 }}>
        {formatBytes(version.size_bytes)}
        {version.merge_strategy && (
          <span style={{ marginLeft: 8 }}>Strategy: {version.merge_strategy}</span>
        )}
      </div>
    </div>
  );
}

function VersionDetailView({ detail }: { detail: FileVersionDetail }) {
  const content = detail.content_json
    ? JSON.stringify(detail.content_json, null, 2)
    : detail.content_text || '(no content)';

  return (
    <div style={{ padding: 16 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 12,
        marginBottom: 16,
      }}>
        <InfoBlock label="Version" value={`v${detail.version}`} />
        <InfoBlock label="Operation" value={OP_LABELS[detail.operation] || detail.operation} />
        <InfoBlock label="Operator" value={`${OPERATOR_LABELS[detail.operator_type] || detail.operator_type}${detail.operator_id ? ` (${detail.operator_id})` : ''}`} />
        <InfoBlock label="Size" value={formatBytes(detail.size_bytes)} />
        <InfoBlock label="Time" value={formatTime(detail.created_at)} />
        <InfoBlock label="Hash" value={detail.content_hash?.substring(0, 12) + '...'} />
      </div>
      {detail.summary && (
        <div style={{ marginBottom: 12, fontSize: 12, color: '#a1a1aa', fontStyle: 'italic' }}>
          {detail.summary}
        </div>
      )}
      <div style={{
        background: '#09090b',
        border: '1px solid #27272a',
        borderRadius: 6,
        padding: 12,
        maxHeight: 400,
        overflow: 'auto',
      }}>
        <pre style={{
          margin: 0,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          color: '#a1a1aa',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {content}
        </pre>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: DiffResponse }) {
  if (diff.changes.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#3f3f46', fontSize: 13 }}>
        No differences found
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: '#71717a', marginBottom: 12 }}>
        {diff.changes.length} change{diff.changes.length !== 1 ? 's' : ''} between v{diff.v1} and v{diff.v2}
      </div>
      {diff.changes.map((change, idx) => {
        const color = change.change_type === 'added' ? '#22c55e'
          : change.change_type === 'removed' ? '#ef4444'
          : '#3b82f6';
        return (
          <div key={idx} style={{
            marginBottom: 8,
            borderRadius: 6,
            border: '1px solid #27272a',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '6px 12px',
              background: '#18181b',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
            }}>
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: `${color}15`,
                color,
                fontWeight: 500,
              }}>
                {change.change_type}
              </span>
              <span style={{ fontFamily: 'monospace', color: '#a1a1aa' }}>{change.path}</span>
            </div>
            <div style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'monospace' }}>
              {change.old_value !== null && change.old_value !== undefined && (
                <div style={{ color: '#ef4444', marginBottom: 4 }}>
                  - {typeof change.old_value === 'string' ? change.old_value : JSON.stringify(change.old_value)}
                </div>
              )}
              {change.new_value !== null && change.new_value !== undefined && (
                <div style={{ color: '#22c55e' }}>
                  + {typeof change.new_value === 'string' ? change.new_value : JSON.stringify(change.new_value)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: '#e4e4e7' }}>{value}</div>
    </div>
  );
}
