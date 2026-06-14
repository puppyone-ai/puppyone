'use client';

import type { ReactNode } from 'react';
import type { RepoScope } from '@/lib/repoApi';
import type { AuditLogItem } from '@/lib/contentTreeApi';
import { StatusDot } from '@/components/ui/StatusDot';
import { T } from '../lib/tokens';
import { timeAgo } from '../lib/format';
import { ProviderIcon } from './icons';
import { SectionLabel } from './ui-blocks';

// ─── Access activity ─────────────────────────────────────────────────

type ActivityProvider = 'cli' | 'git_remote' | 'agent' | 'generic';
type ActivityTone = 'success' | 'pending' | 'error' | 'neutral';

const ACTIVITY_PROVIDER_LABELS: Partial<Record<ActivityProvider, string>> = {
  git_remote: 'Git Remote',
  cli: 'FS CLI',
  agent: 'AI Agent',
};

const ACTIVITY_PROTOCOL_LABELS: Partial<Record<ActivityProvider, string>> = {
  git_remote: 'Git protocol',
  cli: 'CLI protocol',
};

export interface AccessActivityRow {
  readonly id: number;
  readonly provider: ActivityProvider;
  readonly methodLabel: string;
  readonly sourceDetail: string;
  readonly actionLabel: string;
  readonly actionDetail: string;
  readonly detail: string;
  readonly statusLabel: string;
  readonly statusTone: ActivityTone;
  readonly timeLabel: string;
  readonly timeTitle: string;
}

export function AccessActivitySection({
  rows,
  loading,
  errored,
}: {
  readonly rows: readonly AccessActivityRow[];
  readonly loading: boolean;
  readonly errored: boolean;
}) {
  return (
    <div style={{ marginTop: 2 }}>
      <SectionLabel
        right={
          rows.length > 0 ? (
            <span style={{ fontSize: 12, color: T.text4, fontFamily: T.fontSans, fontWeight: 500 }}>
              {rows.length === 1 ? '1 event' : `${rows.length} events`}
            </span>
          ) : null
        }
      >
        Recent access activity
      </SectionLabel>
      <div
        style={{
          borderRadius: 8,
          border: `1px solid ${T.cardBorder}`,
          background: 'color-mix(in srgb, var(--po-control) 42%, var(--po-panel) 58%)',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <ActivityHeaderRow />
        {loading ? (
          <ActivityEmptyRow>Loading activity...</ActivityEmptyRow>
        ) : errored ? (
          <ActivityEmptyRow>Could not load audit logs.</ActivityEmptyRow>
        ) : rows.length === 0 ? (
          <ActivityEmptyRow>No access activity for this scope yet.</ActivityEmptyRow>
        ) : (
          rows.map((row, index) => (
            <ActivityRow key={row.id} row={row} isFirst={index === 0} />
          ))
        )}
      </div>
    </div>
  );
}

const ACTIVITY_GRID = '64px minmax(118px, 0.85fr) minmax(92px, 0.7fr) minmax(140px, 1.35fr) 70px';

function ActivityHeaderRow() {
  const cellStyle = {
    fontSize: 12,
    lineHeight: '14px',
    color: T.text4,
    fontFamily: T.fontSans,
    fontWeight: 500,
  } as const;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: ACTIVITY_GRID,
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
        padding: '8px 12px',
        borderBottom: `1px solid ${T.cardBorder}`,
      }}
    >
      <span style={cellStyle}>Time</span>
      <span style={cellStyle}>Source</span>
      <span style={cellStyle}>Action</span>
      <span style={cellStyle}>Details</span>
      <span style={{ ...cellStyle, textAlign: 'right' }}>Result</span>
    </div>
  );
}

function ActivityRow({
  row,
  isFirst,
}: {
  readonly row: AccessActivityRow;
  readonly isFirst: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: ACTIVITY_GRID,
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
        padding: '8px 12px',
        borderTop: isFirst ? 'none' : `1px solid ${T.cardBorder}`,
        fontFamily: T.fontSans,
      }}
    >
      <span
        title={row.timeTitle}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          lineHeight: '16px',
          color: T.text3,
        }}
      >
        {row.timeLabel}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: `1px solid ${T.cardBorder}`,
            background: 'color-mix(in srgb, var(--po-control) 58%, transparent)',
            color: T.text2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ProviderIcon provider={row.provider} variant='mono' size={14} />
        </span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span
            title={row.methodLabel}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              lineHeight: '16px',
              color: T.text2,
              fontWeight: 500,
            }}
          >
            {row.methodLabel}
          </span>
          {row.sourceDetail ? (
            <span
              title={row.sourceDetail}
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                lineHeight: '14px',
                color: T.text4,
              }}
            >
              {row.sourceDetail}
            </span>
          ) : null}
        </div>
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          title={row.actionLabel}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
            lineHeight: '16px',
            color: T.text2,
            fontWeight: 500,
          }}
        >
          {row.actionLabel}
        </span>
        {row.actionDetail ? (
          <span
            title={row.actionDetail}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              lineHeight: '14px',
              color: T.text4,
              fontFamily: T.fontMono,
            }}
          >
            {row.actionDetail}
          </span>
        ) : null}
      </div>
      <span
        title={row.detail}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          lineHeight: '16px',
          color: T.text3,
          fontFamily: T.fontMono,
        }}
      >
        {row.detail}
      </span>
      <StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill>
    </div>
  );
}

function ActivityEmptyRow({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        padding: '12px',
        color: T.text3,
        fontFamily: T.fontSans,
        fontSize: 12,
        lineHeight: '18px',
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  readonly tone: ActivityTone;
  readonly children: ReactNode;
}) {
  const color =
    tone === 'success' ? 'var(--po-success)'
    : tone === 'error' ? 'var(--po-danger)'
    : tone === 'pending' ? 'var(--po-warning)'
    : T.text4;
  return (
    <span
      style={{
        justifySelf: 'end',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        color: tone === 'neutral' ? T.text3 : color,
        fontFamily: T.fontSans,
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <StatusDot style={{ background: color }} />
      {children}
    </span>
  );
}

export function filterAccessActivityLogs(
  logs: readonly AuditLogItem[],
  scope: RepoScope | undefined,
): AccessActivityRow[] {
  if (!scope) return [];
  return logs
    .filter((log) => isAuditLogForScope(log, scope))
    .map((log) => toAccessActivityRow(log));
}

function isAuditLogForScope(log: AuditLogItem, scope: RepoScope): boolean {
  const metadata = log.metadata ?? {};
  const scopePath = normalizeScopePath(scope.path ?? '');
  const metadataScope = normalizeScopePath(readString(metadata.scope) ?? readString(metadata.scope_path) ?? '');
  const actorIsScopeKey =
    log.operator_id === `scope:${scope.id}` ||
    log.operator_id === scope.id ||
    readString(metadata.scope_id) === scope.id;
  const scopedByMetadata = metadataScope === scopePath;
  const scopedByPath = auditPathMatchesScope(log, scopePath);
  return actorIsScopeKey || scopedByMetadata || scopedByPath;
}

function toAccessActivityRow(log: AuditLogItem): AccessActivityRow {
  const action = normalizeAuditAction(log.action);
  const provider = getAuditProvider(action, log);
  const createdAt = log.created_at;
  const status = formatAuditStatus(log);
  return {
    id: log.id,
    provider,
    methodLabel: formatAuditSource(log, provider),
    sourceDetail: formatAuditSourceDetail(log, provider),
    actionLabel: formatAuditAction(action),
    actionDetail: log.action,
    detail: formatAuditDetail(log),
    statusLabel: status.label,
    statusTone: status.tone,
    timeLabel: timeAgo(createdAt),
    timeTitle: createdAt ? new Date(createdAt).toLocaleString() : 'No timestamp',
  };
}

function normalizeAuditAction(action: string): string {
  return action.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeScopePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/^\/+|\/+$/g, '');
}

function isProtocolAuditAction(action: string): boolean {
  return (
    action.includes('clone') ||
    action.includes('pull') ||
    action.includes('push') ||
    action.includes('rollback') ||
    action.includes('receive_pack') ||
    action.includes('upload_pack')
  );
}

function auditPathMatchesScope(log: AuditLogItem, scopePath: string): boolean {
  const candidates = [
    log.path,
    readString(log.metadata?.path),
    readString(log.metadata?.old_path),
    readString(log.metadata?.new_path),
  ].filter((value): value is string => !!value);
  const paths = readStringArray(log.metadata?.paths);
  candidates.push(...paths);
  if (candidates.length === 0) return scopePath === '';
  return candidates.some((path) => {
    const normalized = normalizeScopePath(path);
    return !scopePath || normalized === scopePath || normalized.startsWith(`${scopePath}/`);
  });
}

function getAuditProvider(action: string, log: AuditLogItem): ActivityProvider {
  const metadata = log.metadata ?? {};
  const source = readString(metadata.source_channel);
  if (source === 'git' || action.startsWith('git_') || action.includes('receive_pack') || action.includes('upload_pack')) {
    return 'git_remote';
  }
  if (log.operator_type === 'agent' || log.operator_id?.startsWith('agent:')) {
    return 'agent';
  }
  if (isProtocolAuditAction(action) || log.operator_id?.startsWith('scope:')) {
    return 'cli';
  }
  if (log.operator_type === 'sync') {
    return 'generic';
  }
  return 'generic';
}

function formatAuditSource(log: AuditLogItem, provider: ActivityProvider): string {
  const providerLabel = ACTIVITY_PROVIDER_LABELS[provider];
  if (providerLabel) return providerLabel;
  if (log.operator_type === 'user') return 'Puppyone';
  if (log.operator_type === 'sync') return 'Sync';
  if (log.operator_type === 'system') return 'System';
  return 'Audit';
}

function formatAuditSourceDetail(log: AuditLogItem, provider: ActivityProvider): string {
  const metadata = log.metadata ?? {};
  const explicitRemote =
    readString(metadata.remote_name) ||
    readString(metadata.remote) ||
    readString(metadata.repository) ||
    readString(metadata.repo);
  if (explicitRemote) return explicitRemote;

  const entryPoint = readString(metadata.entry_point) || readString(metadata.remote_kind);
  const entryLabel =
    entryPoint === 'access_key_git_remote' ? 'access key remote'
    : entryPoint === 'project_git_remote' ? 'project Git remote'
    : entryPoint === 'access_key_cli' ? 'access key CLI'
    : entryPoint === 'project_cli' ? 'project CLI'
    : entryPoint === 'web_app' ? 'web app'
    : entryPoint === 'agent_runtime' ? 'agent runtime'
    : ACTIVITY_PROTOCOL_LABELS[provider] ?? '';
  const actor = formatAuditActor(log);
  return [entryLabel, actor].filter(Boolean).join(' · ');
}

function formatAuditAction(action: string): string {
  const known: Record<string, string> = {
    clone: 'Clone',
    pull: 'Pull',
    pull_commit: 'Read commit',
    push: 'Push',
    agent_push: 'CLI push',
    git_push: 'Git push',
    rollback: 'Rollback',
    git_rollback: 'Git rollback',
    write_file: 'Write file',
    bulk_write: 'Bulk write',
    mkdir: 'Create folder',
    touch: 'Create file',
    move: 'Move',
    copy: 'Copy',
    delete: 'Delete',
  };
  if (known[action]) return known[action];
  return action
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAuditDetail(log: AuditLogItem): string {
  const metadata = log.metadata ?? {};
  const paths = readStringArray(metadata.paths);
  const path =
    readString(metadata.path) ||
    readString(metadata.new_path) ||
    readString(metadata.old_path) ||
    paths[0] ||
    log.path ||
    '';
  const bits: string[] = [];
  if (path) {
    bits.push(paths.length > 1 ? `${path} +${paths.length - 1}` : path);
  }
  const changes = readNumber(metadata.changes);
  if (changes != null) bits.push(`${changes} ${changes === 1 ? 'change' : 'changes'}`);
  const files = readNumber(metadata.files);
  if (files != null && changes == null) bits.push(`${files} ${files === 1 ? 'file' : 'files'}`);
  const commit =
    readString(metadata.commit_id) ||
    readString(metadata.new_commit_id) ||
    readString(metadata.target_commit_id);
  if (commit) bits.push(commit.slice(0, 8));
  return bits.length > 0 ? bits.slice(0, 3).join(' · ') : 'scope activity';
}

function formatAuditActor(log: AuditLogItem): string {
  const actor = log.operator_id?.trim();
  if (!actor) return '';
  if (actor.startsWith('scope:')) return 'scope key';
  if (actor.startsWith('user:')) return 'user';
  if (actor.startsWith('agent:')) return 'agent';
  if (actor.startsWith('sync:')) return 'sync';
  return log.operator_type || actor.slice(0, 10);
}

function formatAuditStatus(log: AuditLogItem): { label: string; tone: ActivityTone } {
  const action = normalizeAuditAction(log.action);
  const raw =
    log.status ||
    readString(log.metadata?.status) ||
    (action.includes('pending') ? 'pending' : action.includes('error') || action.includes('rejected') ? 'error' : '');
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes('error') || normalized.includes('reject') || normalized.includes('fail')) {
    return { label: 'Error', tone: 'error' };
  }
  if (normalized.includes('pending')) {
    return { label: 'Pending', tone: 'pending' };
  }
  if (normalized && normalized !== 'ok' && normalized !== 'success') {
    return { label: formatAuditAction(normalized), tone: 'neutral' };
  }
  return { label: 'Success', tone: 'success' };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
