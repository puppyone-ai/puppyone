'use client';

import { use, useState, useMemo } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  getProjectHistory,
  type MutCommitInfo,
  type MutCommitChange,
} from '@/lib/contentNodesApi';

interface HistoryPageProps {
  params: Promise<{ projectId: string }>;
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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
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
      {summary.added > 0 && (
        <span style={{ color: OP_COLORS.added }}>+{summary.added}</span>
      )}
      {summary.modified > 0 && (
        <span style={{ color: OP_COLORS.modified }}>~{summary.modified}</span>
      )}
      {summary.deleted > 0 && (
        <span style={{ color: OP_COLORS.deleted }}>-{summary.deleted}</span>
      )}
    </div>
  );
}

function CommitRow({ commit, isLatest }: { commit: MutCommitInfo; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ position: 'relative', paddingLeft: 32 }}>
      {/* Timeline dot */}
      <div style={{
        position: 'absolute', left: 11, top: 18,
        width: 10, height: 10, borderRadius: '50%',
        background: isLatest ? '#22c55e' : '#27272a',
        border: `2px solid ${isLatest ? '#22c55e' : '#3f3f46'}`,
        zIndex: 1,
      }} />

      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.06)',
          background: expanded ? '#111113' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
          marginBottom: 2,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#0d0d0f'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, fontWeight: 600,
              color: isLatest ? '#22c55e' : '#e4e4e7',
              flexShrink: 0,
            }}>
              v{commit.version}
            </span>
            {isLatest && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 500,
              }}>
                HEAD
              </span>
            )}
            <span style={{
              fontSize: 13, color: '#d4d4d8',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {commit.message || '(no message)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <ChangeSummary changes={commit.changes} />
            <span style={{ fontSize: 11, color: '#52525b', whiteSpace: 'nowrap' }} title={formatFullTime(commit.created_at)}>
              {formatTime(commit.created_at)}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OperatorBadge who={commit.who} />
          {commit.scope_path && (
            <span style={{
              fontSize: 11, color: '#52525b',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              scope: {commit.scope_path}
            </span>
          )}
          {commit.conflicts.length > 0 && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 3,
              background: 'rgba(234,179,8,0.15)', color: '#eab308', fontWeight: 500,
            }}>
              {commit.conflicts.length} conflict{commit.conflicts.length > 1 ? 's' : ''}
            </span>
          )}
          {commit.root_hash && (
            <span style={{
              fontSize: 10, color: '#3f3f46', marginLeft: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {commit.root_hash.slice(0, 10)}
            </span>
          )}
        </div>

        {/* Expanded: changed files */}
        {expanded && commit.changes.length > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>
              {commit.changes.length} file{commit.changes.length !== 1 ? 's' : ''} changed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {commit.changes.map((change, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 8px', borderRadius: 4,
                  fontSize: 12,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2,
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
                    fontSize: 10, color: OP_COLORS[change.op] || '#71717a',
                    marginLeft: 'auto', flexShrink: 0,
                  }}>
                    {change.op}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expanded: conflicts */}
        {expanded && commit.conflicts.length > 0 && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: 'rgba(234,179,8,0.05)',
            border: '1px solid rgba(234,179,8,0.15)',
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 11, color: '#eab308', fontWeight: 500, marginBottom: 6 }}>
              Merge Conflicts
            </div>
            {commit.conflicts.map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 2 }}>
                <span style={{ fontFamily: 'monospace' }}>{c.path}</span>
                <span style={{ color: '#52525b' }}> — {c.strategy}</span>
                {c.kept && <span style={{ color: '#52525b' }}> (kept: {c.kept})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage({ params }: HistoryPageProps) {
  const { projectId } = use(params);
  const { session } = useAuth();

  const { data: history, error, isLoading } = useSWR(
    session ? ['project-history', projectId] : null,
    () => getProjectHistory(projectId, 100),
    { revalidateOnFocus: false },
  );

  const commits = history?.commits ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7' }}>
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
            fontSize: 11, color: '#3f3f46',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            root: {history.root_hash.slice(0, 12)}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#52525b', fontSize: 13 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite', marginRight: 8 }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
            </svg>
            Loading commit history...
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#ef4444', fontSize: 13 }}>
            Failed to load commit history
          </div>
        )}

        {!isLoading && !error && commits.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 300, gap: 12, color: '#3f3f46',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ fontSize: 14 }}>No commits yet</span>
            <span style={{ fontSize: 12, color: '#27272a' }}>Changes to your context will appear here</span>
          </div>
        )}

        {commits.length > 0 && (
          <div style={{ position: 'relative', maxWidth: 800 }}>
            {/* Timeline line */}
            <div style={{
              position: 'absolute', left: 15, top: 24, bottom: 24,
              width: 2, background: '#1f1f23',
            }} />

            {commits.map((commit, i) => (
              <CommitRow
                key={commit.version}
                commit={commit}
                isLatest={i === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
