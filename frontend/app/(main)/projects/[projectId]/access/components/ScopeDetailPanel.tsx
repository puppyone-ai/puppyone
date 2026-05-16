'use client';

/**
 * ScopeDetailPanel — right rail of the access page.
 *
 * The user's mental model:
 *
 *   1. The left sidebar lists *mount points* (paths). Pick one.
 *   2. Each mount point has multiple *Access Points* bound to it
 *      (a CLI access point, an Agent access point, an MCP one, …).
 *      Each AP has its own database-stored name, status, and prompt.
 *   3. CLI / Agent / MCP / Sandbox / Third-party are *not* "tabs of a
 *      configuration page" — they're fundamentally distinct entities.
 *      So the switcher renders one card *per access point*, not one
 *      tab per type bucket. Picking a card swaps the detail view to
 *      that AP's name + attributes + prompt + configuration.
 *
 * Layout:
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  📁 Workspace root  /  [r] [w]                  [Edit]    │  ← compact scope strip
 *   │                                                            │
 *   │  ACCESS POINTS                                             │
 *   │  ┌───────────┐ ┌───────────┐                              │
 *   │  │ [icon]    │ │ [icon]    │                              │
 *   │  │ CLI    ●  │ │ AGENT  ●  │                              │
 *   │  │ Puppyone… │ │ Hello AI  │                              │
 *   │  └───────────┘ └───────────┘                              │
 *   │   ↑ selected     unselected                                │
 *   │                                                            │
 *   │  Puppyone CLI                       [Pause] [⋮]           │  ← AP NAME (page header)
 *   │  CLI agent · Two-way · ● Active · Never                   │
 *   │  ─────────────────────────────────────                    │
 *   │  PROMPT FOR AI AGENT                                       │
 *   │  [prompt block with centered Copy CTA]                    │
 *   │  CONFIGURATION                                             │
 *   │  [config table]                                            │
 *   │  RECENT ACTIVITY                                           │
 *   │  [activity placeholder]                                    │
 *   └───────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { DialogBody, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { getProjectAuditLogs, type AuditLogItem } from '@/lib/contentTreeApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { T } from '../lib/tokens';
import {
  PROVIDER_LABELS,
  STATUS_COLORS,
  STATUS_LABEL,
} from '../lib/constants';
import { getTypeLine, timeAgo } from '../lib/format';
import { PauseIcon, PlayIcon, ProviderIcon, RetryIcon } from './icons';
import { GhostButton, SectionLabel } from './ui-blocks';
import { ConnectorDetailBody } from './ConnectorCard';
import { ConnectorAccessPanel } from './quick-connect';
// We deliberately reuse the existing ScopeSettingsBlock from /data —
// it already implements every editable scope field (mode, exclude,
// access-key rotate/copy, name, identity, danger zone) plus the
// dirty-aware Save/Discard footer. Building a parallel widget here
// would duplicate ~600 lines and inevitably drift visually.
import { ScopeSettingsBlock } from '../../data/components/access-points/ScopeSettingsBlock';
import type { ConnectorEditPatch } from '../hooks/useAccessData';

const SHOW_ACCESS_ACTIVITY = false;

// ─── Detail pane root ────────────────────────────────────────────────

export function ScopeDetailPanel({
  scope,
  connectors,
  projectId,
  onPauseResume,
  onUpdate,
  onDelete,
  pendingConnectorIds,
  onScopeMutated,
  onScopeDeleted,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly projectId: string;
  readonly onPauseResume: (id: string) => void;
  readonly onUpdate: (id: string, patch: ConnectorEditPatch) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly pendingConnectorIds: ReadonlySet<string>;
  /** Refresh both `repo-scopes` and `repo-connectors` SWR caches after
   *  a save / rotate / delete inside the inline settings block. */
  readonly onScopeMutated: () => Promise<unknown>;
  /** Notify the parent that the active scope was deleted, so it can
   *  clear its `selectedScopeId` and let the auto-select-first effect
   *  pick up an adjacent scope on the next render. */
  readonly onScopeDeleted: () => void;
}) {
  // Track the currently-expanded connector row. Defaults to collapsed
  // so first-time users see the compact connector list before drilling
  // into setup/configuration details.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);

  // Inline scope-settings toggle. The `Edit` button on the strip flips
  // this; we mount `ScopeSettingsBlock` right under the strip so the
  // user never leaves the access page. Auto-collapses when the user
  // navigates to a different scope so dirty edits don't ride along.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
    setSelectedConnectorId(null);
  }, [scope?.id]);

  const handleSelectConnector = useCallback((connectorId: string) => {
    setSelectedConnectorId((current) => {
      if (current === connectorId) {
        return null;
      }
      return connectorId;
    });
  }, []);

  const handleToggleSettings = useCallback(() => {
    if (settingsOpen && settingsDirty) {
      const ok = globalThis.confirm(
        'Discard unsaved scope edits?',
      );
      if (!ok) return;
      setSettingsDirty(false);
    }
    setSettingsOpen((v) => !v);
  }, [settingsOpen, settingsDirty]);

  const handleScopeDeleted = useCallback(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
    onScopeDeleted();
  }, [onScopeDeleted]);

  useEffect(() => {
    if (connectors.length === 0) {
      setSelectedConnectorId(null);
      return;
    }
    if (selectedConnectorId == null) return;
    const stillExists = connectors.some((c) => c.id === selectedConnectorId);
    if (!stillExists) setSelectedConnectorId(null);
  }, [connectors, selectedConnectorId]);

  const selectedConnector = useMemo(
    () =>
      connectors.find((c) => c.id === selectedConnectorId) ?? null,
    [connectors, selectedConnectorId],
  );
  const {
    data: auditData,
    error: auditError,
  } = useSWR(
    SHOW_ACCESS_ACTIVITY && projectId ? ['access-project-audit-logs', projectId] : null,
    () => getProjectAuditLogs(projectId, 150),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 15000 },
  );
  const accessActivity = useMemo(
    () => filterAccessActivityLogs(auditData?.logs ?? [], scope).slice(0, 7),
    [auditData?.logs, scope],
  );
  const activityLoading = !auditError && auditData === undefined;

  return (
    <div
      key={scope?.id ?? 'no-scope'}
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'auto',
        background: T.bg,
        animation: `puppyone-access-fade-in 200ms ${T.ease}`,
      }}
    >
      <div
        style={{
          maxWidth: PROJECT_CONTENT_RAIL_WIDTH,
          margin: '0 auto',
          padding: '20px 24px 40px',
        }}
      >
        {/* PAGE HEADER — `scope.name` at h1 scale, an aggregate
            status line beneath, and a bulk Pause-/Resume-all action
            on the right. Mirrors the per-connector card header so
            the user sees the same control pattern at the scope and
            connector levels. The strip below answers "where" and
            "what permissions"; this header answers "what is this
            page" and "how is it doing". */}
        <ScopePageHeader
          scope={scope}
          connectors={connectors}
          onPauseResume={onPauseResume}
          pendingConnectorIds={pendingConnectorIds}
          settingsOpen={settingsOpen}
          settingsDirty={settingsDirty}
          onToggleSettings={handleToggleSettings}
        />

        {/* SETTINGS — opened from the header gear. The collapsed
            placeholder row is intentionally gone so the boundary row
            can stay visually adjacent to the title. */}
        {scope ? (
          <SettingsSection open={settingsOpen}>
            <ScopeSettingsBlock
              scope={scope}
              projectId={projectId}
              onMutated={onScopeMutated}
              onScopeDeleted={handleScopeDeleted}
              onDirtyChange={setSettingsDirty}
            />
          </SettingsSection>
        ) : null}

        {/* CONNECTORS — the page used to call this section "Access
            points" but the underlying entity in the data model (and in
            every API path / SQL table) is `connector`. Naming the UI
            section the same name eliminates the translation step. */}
        {connectors.length > 0 ? (
          <>
            <SectionLabel
              right={
                <span
                  style={{
                    fontSize: 11,
                    color: T.text4,
                    fontFamily: T.fontSans,
                    fontWeight: 500,
                  }}
                >
                  {connectors.length === 1 ? '1 way in' : `${connectors.length} ways in`}
                </span>
              }
            >
              Connectors
            </SectionLabel>
            <ConnectorList
              scope={scope}
              connectors={connectors}
              selectedId={selectedConnector?.id ?? null}
              onSelect={handleSelectConnector}
              onPauseResume={onPauseResume}
              onUpdate={onUpdate}
              pendingConnectorIds={pendingConnectorIds}
            />
            {SHOW_ACCESS_ACTIVITY ? (
              <AccessActivitySection
                rows={accessActivity}
                loading={activityLoading}
                errored={!!auditError}
              />
            ) : null}
          </>
        ) : (
          <div
            style={{
              marginTop: 18,
              padding: '14px 16px',
              borderRadius: 8,
              border: `1px dashed ${T.cardBorder}`,
              background: T.cardBg,
              fontSize: 12,
              color: T.text3,
              fontFamily: T.fontSans,
              fontStyle: 'italic',
            }}
          >
            No connectors bound to this scope yet.
          </div>
        )}
      </div>

      <style>{`
        @keyframes puppyone-access-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes puppyone-access-settings-slide {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Access activity ─────────────────────────────────────────────────

type ActivityProvider = 'cli' | 'filesystem' | 'agent' | 'generic';
type ActivityTone = 'success' | 'pending' | 'error' | 'neutral';

interface AccessActivityRow {
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

function AccessActivitySection({
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
            <span style={{ fontSize: 11, color: T.text4, fontFamily: T.fontSans, fontWeight: 500 }}>
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
    fontSize: 10.5,
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
          fontSize: 11.5,
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
                fontSize: 10.5,
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
              fontSize: 10.5,
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
          fontSize: 11.5,
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

function ActivityEmptyRow({ children }: { readonly children: React.ReactNode }) {
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
  readonly children: React.ReactNode;
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
        fontSize: 11.5,
        lineHeight: '16px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
        }}
      />
      {children}
    </span>
  );
}

function filterAccessActivityLogs(
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
    return 'filesystem';
  }
  if (log.operator_type === 'agent' || log.operator_id?.startsWith('agent:')) {
    return 'agent';
  }
  if (source === 'mut' || isProtocolAuditAction(action) || log.operator_id?.startsWith('scope:')) {
    return 'cli';
  }
  if (log.operator_type === 'sync') {
    return 'generic';
  }
  return 'generic';
}

function formatAuditSource(log: AuditLogItem, provider: ActivityProvider): string {
  if (provider === 'filesystem') return 'Git Remote';
  if (provider === 'cli') return 'Puppyone CLI';
  if (provider === 'agent') return 'AI Agent';
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
    : provider === 'filesystem' ? 'Git protocol'
    : provider === 'cli' ? 'CLI protocol'
    : '';
  const actor = formatAuditActor(log);
  return [entryLabel, actor].filter(Boolean).join(' · ');
}

function formatAuditAction(action: string): string {
  const known: Record<string, string> = {
    clone: 'Clone',
    pull: 'Pull',
    pull_commit: 'Read commit',
    push: 'Push',
    mut_push: 'CLI push',
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
    permanent_delete: 'Delete',
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

// ─── ScopePageHeader ─────────────────────────────────────────────────
//
// h1 of the right pane. Displays the scope's *name* (first-class
// editable field independent of the filesystem path), a tiny meta
// line summarizing aggregate health across the scope's connectors,
// and a bulk-action button mirroring the per-connector Pause/Resume
// pattern but applied to the whole scope at once.
//
// The visual pattern mirrors `ConnectorCard`'s own header so the user
// can instantly tell that a scope is conceptually "the same kind of
// surface" as a connector — just one level up. Path information
// (where this scope lives on disk + its read/write mode + perm
// badges) lives in the compact strip below; we deliberately keep the
// title lean.
//
// Aggregate status:
//   - any errored             → 'Error'   (red dot)
//   - any syncing             → 'Syncing' (blue dot)
//   - all active              → 'Active'  (green dot)
//   - all paused              → 'Paused'  (amber dot)
//   - mixed (some on/off)     → 'Mixed'   (amber dot)
//   - empty                   → no meta line
//
// Bulk action picks the most natural intent given the current state:
//   - any active connectors   → "Pause all"  (pauses every active one)
//   - else any paused/pending → "Resume all" (resumes them)
//   - else                    → button hidden
// Errored connectors are intentionally not auto-retried by bulk —
// retry is a per-connector decision and lives on the connector card.

interface ScopeAggregateStatus {
  readonly key: 'empty' | 'active' | 'syncing' | 'paused' | 'mixed' | 'error';
  readonly label: string;
  readonly color: string;
}

function computeAggregate(connectors: readonly Connector[]): ScopeAggregateStatus {
  if (connectors.length === 0) {
    return { key: 'empty', label: 'No connectors', color: T.text4 };
  }
  if (connectors.some((c) => c.status === 'error')) {
    return { key: 'error', label: STATUS_LABEL.error, color: STATUS_COLORS.error };
  }
  if (connectors.some((c) => c.status === 'syncing')) {
    return { key: 'syncing', label: STATUS_LABEL.syncing, color: STATUS_COLORS.syncing };
  }
  if (connectors.every((c) => c.status === 'active')) {
    return { key: 'active', label: STATUS_LABEL.active, color: STATUS_COLORS.active };
  }
  if (connectors.every((c) => c.status === 'paused')) {
    return { key: 'paused', label: STATUS_LABEL.paused, color: STATUS_COLORS.paused };
  }
  return { key: 'mixed', label: 'Mixed', color: STATUS_COLORS.paused };
}

interface BulkAction {
  readonly action: 'pause-all' | 'resume-all';
  readonly label: string;
  readonly icon: 'pause' | 'play';
  readonly targets: readonly Connector[];
}

function getBulkAction(connectors: readonly Connector[]): BulkAction | null {
  const active = connectors.filter((c) => c.status === 'active' || c.status === 'syncing');
  if (active.length > 0) {
    return { action: 'pause-all', label: 'Pause all', icon: 'pause', targets: active };
  }
  const paused = connectors.filter((c) => c.status === 'paused');
  if (paused.length > 0) {
    return { action: 'resume-all', label: 'Resume all', icon: 'play', targets: paused };
  }
  return null;
}

function ScopePageHeader({
  scope,
  connectors,
  onPauseResume,
  pendingConnectorIds,
  settingsOpen,
  settingsDirty,
  onToggleSettings,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly onPauseResume: (connectorId: string) => Promise<void> | void;
  readonly pendingConnectorIds: ReadonlySet<string>;
  readonly settingsOpen: boolean;
  readonly settingsDirty: boolean;
  readonly onToggleSettings: () => void;
}) {
  const titleText = scope?.name?.trim() || 'Untitled scope';
  const aggregate = computeAggregate(connectors);
  const bulkAction = getBulkAction(connectors);
  const anyPending = connectors.some((c) => pendingConnectorIds.has(c.id));
  const isWorkspaceWide = scope?.is_root || scope?.path === '' || scope?.path == null;
  const pathLabel = isWorkspaceWide ? '/' : `/${scope?.path ?? ''}`;
  const modeLabel = scope?.mode === 'rw' ? 'Read & write' : 'Read only';

  const handleBulk = useCallback(() => {
    if (!bulkAction) return;
    bulkAction.targets.forEach((t) => {
      void onPauseResume(t.id);
    });
  }, [bulkAction, onPauseResume]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 28,
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            lineHeight: 1.25,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: T.text1,
            fontFamily: T.fontSans,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleText}
        >
          {titleText}
        </h1>
        {connectors.length > 0 && aggregate.key !== 'empty' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: T.text3,
              fontFamily: T.fontSans,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: aggregate.color,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: aggregate.color,
                  boxShadow: `0 0 6px color-mix(in srgb, ${aggregate.color} 55%, transparent)`,
                }}
              />
              {aggregate.label}
            </span>
            <span style={{ color: T.text4, flexShrink: 0 }}>·</span>
            <span style={{ color: T.text3, flexShrink: 0 }}>
              {connectors.length === 1 ? '1 connector' : `${connectors.length} connectors`}
            </span>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            fontFamily: T.fontSans,
            fontSize: 12,
            lineHeight: '16px',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              color: T.text3,
              fontWeight: 500,
            }}
          >
            Scope
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: T.text2,
              fontFamily: T.fontMono,
            }}
            title={pathLabel}
          >
            {pathLabel}
          </span>
          <span aria-hidden style={{ color: T.text4, flexShrink: 0 }}>·</span>
          <span style={{ color: T.text3, flexShrink: 0 }}>
            {modeLabel}
          </span>
        </div>
      </div>
      <div style={{ flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
        <SettingsHeaderButton
          active={settingsOpen}
          dirty={settingsDirty}
          onClick={onToggleSettings}
        />
        {bulkAction ? (
          <GhostButton
            onClick={handleBulk}
            disabled={anyPending}
            icon={bulkAction.icon === 'pause' ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
          >
            {bulkAction.label}
          </GhostButton>
        ) : null}
      </div>
    </div>
  );
}

function SettingsHeaderButton({
  active,
  dirty,
  onClick,
}: {
  readonly active: boolean;
  readonly dirty: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type='button'
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-pressed={active}
      aria-label={active ? 'Close scope settings' : 'Open scope settings'}
      title={active ? 'Close settings' : 'Open settings'}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        border: `1px solid ${active ? 'var(--po-border-strong)' : T.border}`,
        background: active ? 'var(--po-hover)' : hovered ? 'var(--po-hover)' : 'transparent',
        color: active || hovered ? T.text1 : T.text2,
        cursor: 'pointer',
        transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
      }}
    >
      <GearIcon size={13} />
      {dirty ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--po-warning)',
          }}
        />
      ) : null}
    </button>
  );
}

function SettingsSection({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel>Settings</SectionLabel>
      <div
        id='puppyone-access-scope-settings-body'
        style={{
          padding: '14px 14px 12px',
          borderRadius: 10,
          background: 'var(--po-control)',
          border: `1px solid ${T.cardBorder}`,
          animation: `puppyone-access-settings-slide 180ms ${T.ease}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const GearIcon = ({ size = 13 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <circle cx='12' cy='12' r='3' />
    <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.3.22.63.22 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' />
  </svg>
);

// ─── ConnectorList ──────────────────────────────────────────────────
//
// Compact table-style list inspired by the newer Access direction:
// every connector is a row with identity, state, recency, and an
// immediate on/off control. The selected row expands in-place for the
// heavier setup/configuration material, so the page stays scannable
// until the user asks for detail.

function ConnectorList({
  scope,
  connectors,
  selectedId,
  onSelect,
  onPauseResume,
  onUpdate,
  pendingConnectorIds,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onPauseResume: (id: string) => Promise<void> | void;
  readonly onUpdate: (id: string, patch: ConnectorEditPatch) => Promise<void>;
  readonly pendingConnectorIds: ReadonlySet<string>;
}) {
  const [connectDialogConnector, setConnectDialogConnector] = useState<Connector | null>(null);

  return (
    <>
      <div
        style={{
          borderRadius: 8,
          border: `1px solid ${T.cardBorder}`,
          background: 'color-mix(in srgb, var(--po-control) 58%, var(--po-panel) 42%)',
          overflowX: 'hidden',
          overflowY: 'hidden',
          marginBottom: 20,
          minWidth: 0,
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {connectors.map((connector, index) => {
            const selected = connector.id === selectedId;
            const pending = pendingConnectorIds.has(connector.id);
            return (
              <div
                key={connector.id}
                style={{ background: selected ? 'var(--po-control)' : 'transparent' }}
              >
                <ConnectorListRow
                  connector={connector}
                  selected={selected}
                  isFirst={index === 0}
                  onSelect={() => onSelect(connector.id)}
                  onConnect={() => setConnectDialogConnector(connector)}
                  onPauseResume={() => onPauseResume(connector.id)}
                  pending={pending}
                />
                {selected ? (
                  <ConnectorExpandedDetail
                    connector={connector}
                    scope={scope}
                    pending={pending}
                    onPauseResume={() => onPauseResume(connector.id)}
                    onUpdate={(patch) => onUpdate(connector.id, patch)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {connectDialogConnector ? (
        <ConnectorConnectDialog
          connector={connectDialogConnector}
          scope={scope}
          onClose={() => setConnectDialogConnector(null)}
        />
      ) : null}
    </>
  );
}

const CONNECTOR_GRID = 'minmax(170px, 1.4fr) minmax(76px, 0.55fr) minmax(64px, max-content) minmax(82px, max-content) 14px';

function ConnectorListRow({
  connector,
  selected,
  isFirst,
  onSelect,
  onConnect,
  onPauseResume,
  pending,
}: {
  readonly connector: Connector;
  readonly selected: boolean;
  readonly isFirst: boolean;
  readonly onSelect: () => void;
  readonly onConnect: () => void;
  readonly onPauseResume: () => Promise<void> | void;
  readonly pending: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getConnectorDisplayName(connector);
  const dimmed = connector.status === 'paused';
  const tile = getProviderTileStyle(connector.provider, selected);
  const tileSize = getProviderTileSize(connector.provider);
  const iconSize = getProviderIconSize(connector.provider);

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role='button'
      tabIndex={0}
      aria-pressed={selected}
      style={{
        minHeight: 62,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: CONNECTOR_GRID,
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        boxSizing: 'border-box',
        cursor: 'pointer',
        borderTop: isFirst ? 'none' : `1px solid ${T.cardBorder}`,
        background: selected
          ? 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)'
          : hovered
            ? 'color-mix(in srgb, var(--po-control) 74%, var(--po-panel) 26%)'
            : 'transparent',
        opacity: dimmed ? 0.76 : 1,
        transition: `background 0.15s ${T.ease}, opacity 0.15s ${T.ease}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div
          style={{
            height: tileSize,
            width: tileSize,
            borderRadius: connector.provider === 'filesystem' ? 7 : 6,
            background: tile.background,
            border: `1px solid ${tile.border}`,
            color: tile.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: tile.shadow,
            overflow: connector.provider === 'filesystem' ? 'hidden' : undefined,
          }}
        >
          <ProviderIcon provider={connector.provider} size={iconSize} />
        </div>
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 13,
              fontWeight: selected ? 600 : 500,
              color: selected ? T.text1 : T.text2,
              fontFamily: T.fontSans,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={name}
          >
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {name}
            </span>
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: T.text3,
              fontFamily: T.fontSans,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={getTypeLine(connector)}
          >
            {getTypeLine(connector)}
          </span>
        </div>
      </div>
      <RowMetaCell
        label='Last used'
        value={timeAgo(connector.last_run_at)}
      />
      <ConnectorAccessControl
        status={connector.status}
        pending={pending}
        onPauseResume={onPauseResume}
      />
      <RowActionButton
        label='Setup guide'
        tone='success'
        disabled={false}
        onClick={onConnect}
      />
      <span
        aria-hidden
        style={{
          justifySelf: 'end',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: selected ? T.text2 : T.text4,
          transform: selected ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: `transform 0.15s ${T.ease}, color 0.15s ${T.ease}`,
        }}
      >
        <ChevronDownGlyph size={12} />
      </span>
    </div>
  );
}

function getConnectorDisplayName(connector: Connector): string {
  if (connector.provider === 'cli') return 'Puppyone CLI';
  if (connector.provider === 'filesystem') return 'Git Remote';
  return connector.name || PROVIDER_LABELS[connector.provider] || connector.provider;
}

function getProviderTileStyle(provider: string, selected: boolean) {
  if (provider === 'cli') {
    return {
      background: 'var(--po-accent)',
      border: 'var(--po-accent)',
      color: 'var(--po-text-inverse)',
      shadow: '0 1px 2px var(--po-shadow)',
    };
  }
  if (provider === 'filesystem') {
    return {
      background: 'var(--po-text-inverse)',
      border: selected ? 'var(--po-border-strong)' : T.border,
      color: T.text2,
      shadow: selected ? '0 1px 2px var(--po-shadow)' : 'none',
    };
  }
  return {
    background: selected ? 'var(--po-panel)' : 'var(--po-hover)',
    border: selected ? 'var(--po-border-strong)' : T.border,
    color: T.text2,
    shadow: selected ? '0 1px 2px var(--po-shadow)' : 'none',
  };
}

function getProviderTileSize(provider: string): number {
  return provider === 'filesystem' ? 34 : 30;
}

function getProviderIconSize(provider: string): number {
  if (provider === 'filesystem') return 34;
  if (provider === 'cli') return 17;
  return 15;
}

function RowMetaCell({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        fontFamily: T.fontSans,
      }}
    >
      <span style={{ fontSize: 10.5, lineHeight: '14px', color: T.text4 }}>{label}</span>
      <span
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
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function ConnectorAccessControl({
  status,
  pending,
  onPauseResume,
}: {
  readonly status: string;
  readonly pending: boolean;
  readonly onPauseResume: () => Promise<void> | void;
}) {
  if (status === 'error') {
    return (
      <RowActionButton
        label='Retry'
        icon={<RetryIcon size={10} />}
        disabled={pending}
        onClick={onPauseResume}
      />
    );
  }

  const isOn = status === 'active' || status === 'syncing';
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 11.5,
          color: isOn ? T.text2 : T.text3,
          fontFamily: T.fontSans,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {isOn ? 'On' : 'Paused'}
      </span>
      <ConnectorToggle
        status={status}
        on={isOn}
        pending={pending}
        onToggle={onPauseResume}
      />
    </div>
  );
}

function RowActionButton({
  icon,
  label,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly tone?: 'neutral' | 'success';
  readonly disabled: boolean;
  readonly onClick: () => Promise<void> | void;
}) {
  const [hovered, setHovered] = useState(false);
  const successTone = tone === 'success';
  const border = successTone
    ? 'color-mix(in srgb, var(--po-success) 38%, transparent)'
    : hovered
      ? 'var(--po-border-strong)'
      : T.border;
  const background = successTone
    ? hovered
      ? 'color-mix(in srgb, var(--po-success) 20%, var(--po-panel) 80%)'
      : 'color-mix(in srgb, var(--po-success) 14%, var(--po-panel) 86%)'
    : hovered
      ? 'var(--po-hover)'
      : 'transparent';
  const color = successTone ? 'var(--po-success)' : T.text2;

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        justifySelf: 'end',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: successTone ? 30 : 28,
        padding: successTone ? '0 12px' : '0 10px',
        borderRadius: 6,
        border: `1px solid ${border}`,
        background,
        color,
        fontSize: 11.5,
        fontWeight: successTone ? 600 : 500,
        fontFamily: T.fontSans,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
    >
      {icon ?? null}
      {label}
    </button>
  );
}

function ConnectorConnectDialog({
  connector,
  scope,
  onClose,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly onClose: () => void;
}) {
  const name = getConnectorDisplayName(connector);
  const tile = getProviderTileStyle(connector.provider, false);
  const tileSize = getProviderTileSize(connector.provider);
  const iconSize = getProviderIconSize(connector.provider);

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface width={680} maxHeight='min(760px, calc(100vh - 32px))'>
        <DialogHeader
          title={`Connect ${name}`}
          onClose={onClose}
          style={{ padding: '14px 20px 4px' }}
          leading={
            <div
              style={{
                width: tileSize,
                height: tileSize,
                borderRadius: connector.provider === 'filesystem' ? 7 : 6,
                background: tile.background,
                border: `1px solid ${tile.border}`,
                color: tile.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: connector.provider === 'filesystem' ? 'hidden' : undefined,
              }}
            >
              <ProviderIcon provider={connector.provider} size={iconSize} />
            </div>
          }
        />
        <DialogBody style={{ padding: '4px 20px 20px' }}>
          <ConnectorAccessPanel
            connector={connector}
            scope={scope}
          />
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}

function ConnectorExpandedDetail({
  connector,
  scope,
  pending,
  onPauseResume,
  onUpdate,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly pending: boolean;
  readonly onPauseResume: () => Promise<void> | void;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${T.cardBorder}`,
        background: 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)',
      }}
    >
      <ConnectorDetailBody
        connector={connector}
        scope={scope}
        onPauseResume={onPauseResume}
        onUpdate={onUpdate}
        pending={pending}
        variant='inline'
      />
    </div>
  );
}

const ChevronDownGlyph = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <polyline points='6 9 12 15 18 9' />
  </svg>
);

// ─── ConnectorToggle ─────────────────────────────────────────────────
//
// Tiny iOS-style switch driving connector pause/resume directly from
// the list row. Click the toggle → flip pause/resume (event stops
// there so the parent row doesn't also try to select itself).
function ConnectorToggle({
  status,
  on,
  pending,
  onToggle,
}: {
  readonly status: string;
  readonly on: boolean;
  readonly pending: boolean;
  readonly onToggle: () => Promise<void> | void;
}) {
  const ariaLabel = `${STATUS_LABEL[status] ?? status} — click to ${on ? 'pause' : 'resume'}`;

  return (
    <ToggleSwitch
      checked={on}
      pending={pending}
      ariaLabel={ariaLabel}
      title={ariaLabel}
      size='xs'
      stopPropagation
      onCheckedChange={() => {
        void onToggle();
      }}
    />
  );
}
