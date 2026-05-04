'use client';

/**
 * ScopedConnectorsListPanel — per-scope connector list (redesign-2026-05-02).
 *
 * Replaces the project-wide AccessPointsListPanel. Renders the connectors
 * bound to the scope the user has navigated into. cli + agent are the
 * always-present defaults (DB trigger guarantees their existence per scope);
 * third-party integrations (notion / gmail / github / url / ...) appear
 * under a separate section. The "+ Add" button sits BELOW the defaults
 * block (above the third-party section) so the call-to-action lives next
 * to the content it adds rather than orphaned in the panel header.
 *
 * No parent-child inheritance: a folder shows ONLY connectors of its
 * exact-match scope (per Q1 decision 2026-05-03). Folders that aren't
 * scopes show an empty state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelShell } from '../PanelShell';
import { AccessPointProviderIcon, StatusDot } from './AccessPointProviderIcon';
import {
  createScope,
  deleteScope,
  sortConnectorsBuiltinFirst,
  updateScope,
  type Connector,
  type RepoScope,
  type ScopeMode,
} from '@/lib/repoApi';
import type { ProviderIconLookup } from './types';
import type { SyncEndpointInfo } from '../explorer';

/**
 * Map redesign provider strings (cli/agent) to the legacy SyncEndpointInfo
 * shape consumed by AccessPointProviderIcon. Keeps icon logic centralised
 * in the existing component without forking it.
 */
function connectorAsEndpointShape(c: Connector): SyncEndpointInfo {
  // 'cli' maps to the legacy filesystem icon (folder); 'agent' to the
  // legacy agent:* icon. Other providers fall through to providerIcons lookup.
  let legacyProvider: string;
  if (c.provider === 'cli') legacyProvider = 'filesystem';
  else if (c.provider === 'agent') legacyProvider = 'agent:chat';
  else legacyProvider = c.provider;
  return {
    syncId: c.id,
    provider: legacyProvider,
    direction: c.direction,
    status: c.status,
    name: c.name,
    accessKey: null,
  };
}

interface Props {
  readonly scope: RepoScope | null;
  /** All scopes in the project — drives the AllScopesList (non-scope state)
   *  and the AllScopesList is the only navigation surface for scope CRUD. */
  readonly scopes: readonly RepoScope[];
  /** Canonical path of the folder the user has navigated into. Used by
   *  MakeScopeCTA to pre-fill `path` when creating a scope, and by the
   *  AllScopesList to disable the "Open" button on the current row. */
  readonly currentScopePath: string;
  /** Project id needed for the create/update/delete scope API calls. */
  readonly projectId: string;
  readonly connectors: readonly Connector[];
  readonly providerIcons: ProviderIconLookup;
  readonly onClose: () => void;
  readonly onAddRequested: () => void;
  readonly onConnectorClick: (c: Connector) => void;
  /**
   * Hover feedback up into the explorer sidebar: while a row is hovered we
   * pass the scope's path so the matching folder gets the access-point
   * highlight; on leave / unmount we send null. Mirrors the legacy
   * AccessPointsListPanel's onEndpointHover wiring (lost in the redesign).
   */
  readonly onScopeHover?: (path: string | null) => void;
  /** Refresh scopes / connectors / repo identity after a CRUD mutation.
   *  Wired to useDataLayout().mutateRepo at page level. Typed as
   *  `Promise<unknown>` to match the SWR mutate() return value. */
  readonly onScopeMutated: () => Promise<unknown>;
  /** Navigate the file explorer (and hence currentScopePath) to the given
   *  scope's path. The panel itself does not push routes — that's owned by
   *  the page-level navigateTo helper. */
  readonly onScopeNavigate: (scopePath: string) => void;
}

const COLOR_FG = '#e4e4e7';
const COLOR_FG_MUTED = '#a1a1aa';
const COLOR_FG_DIM = '#71717a';
const COLOR_BORDER = 'rgba(255,255,255,0.06)';
const COLOR_BORDER_HOVER = 'rgba(255,255,255,0.12)';
const COLOR_BG_CARD = 'rgba(255,255,255,0.02)';
const COLOR_BG_HOVER = 'rgba(255,255,255,0.06)';

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    cli: 'Local CLI',
    agent: 'AI Agent',
    notion: 'Notion',
    gmail: 'Gmail',
    google_docs: 'Google Docs',
    google_sheets: 'Google Sheets',
    google_drive: 'Google Drive',
    google_calendar: 'Google Calendar',
    github: 'GitHub',
    linear: 'Linear',
    airtable: 'Airtable',
    url: 'Web Page',
    rss: 'RSS Feed',
    rest_api: 'REST API',
    supabase: 'Supabase',
    mcp: 'MCP Server',
    sandbox: 'Sandbox',
  };
  return labels[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

function directionLabel(direction: string): string {
  if (direction === 'bidirectional') return 'Two-way';
  if (direction === 'inbound') return 'Import';
  if (direction === 'outbound') return 'Export';
  return direction || '—';
}

function getApiBase(): string {
  if (globalThis.window === undefined) return process.env.NEXT_PUBLIC_API_URL || '';
  return process.env.NEXT_PUBLIC_API_URL || globalThis.location.origin;
}

function profileSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'folder';
}

function CopyButton({
  text,
  size = 'sm',
}: {
  readonly text: string;
  readonly size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text}
      style={{
        flexShrink: 0,
        color: copied ? '#34d399' : '#a3a3a3',
        fontSize: size === 'md' ? 12 : 11,
        fontWeight: 500,
        border: `1px solid ${copied ? 'rgba(52,211,153,0.24)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 999,
        padding: size === 'md' ? '5px 12px' : '4px 8px',
        background: copied ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
        cursor: text ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CommandBlock({
  label,
  description,
  lines,
}: {
  readonly label: string;
  readonly description?: string;
  readonly lines: readonly string[];
}) {
  const text = lines.join('\n');
  return (
    <div
      style={{
        borderRadius: 6,
        border: `1px solid ${COLOR_BORDER}`,
        background: 'rgba(0,0,0,0.25)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          borderBottom: `1px solid ${COLOR_BORDER}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLOR_FG_MUTED, letterSpacing: 0.4 }}>
            {label}
          </div>
          {description && (
            <div style={{ fontSize: 10, color: COLOR_FG_DIM, marginTop: 1 }}>{description}</div>
          )}
        </div>
        <CopyButton text={text} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace",
          fontSize: 11,
          lineHeight: 1.5,
          color: '#d4d4d8',
          overflowX: 'auto',
          whiteSpace: 'pre',
          wordBreak: 'normal',
          maxWidth: '100%',
        }}
      >{text}</pre>
    </div>
  );
}

/**
 * Build the rich, multi-section prompt for an AI coding agent connecting
 * to this scope via the mut CLI. Sourced from the boss's
 * `AgentPromptBlock` in `frontend/components/agent/views/FilesystemDetailView.tsx`
 * — that copy survived the redesign and is the canonical "give your AI
 * agent everything it needs to drive mut" template. We rebuild it here
 * so the scope panel's cli expansion can offer the same prompt directly,
 * rather than falling back to the project-level `prompt_template` (which
 * is intentionally generic and lacks the install / clone-vs-connect /
 * sync-workflow detail).
 */
function buildMutAgentPrompt(args: {
  readonly cloneUrl: string;
  readonly accessKey: string;
  readonly scopeName: string;
}): string {
  const { cloneUrl, accessKey, scopeName } = args;
  return [
    `Sync my local folder with PuppyOne cloud using the \`mut\` CLI.`,
    ``,
    `## Install (one-time)`,
    `\`\`\`bash`,
    `pip install mutai`,
    `\`\`\``,
    ``,
    `## Setup — choose one path`,
    ``,
    `**A. Clone to a new folder** (no local files yet):`,
    `\`\`\`bash`,
    `mut clone ${cloneUrl} --credential ${accessKey}`,
    `cd ${scopeName}`,
    `\`\`\``,
    ``,
    `**B. Connect an existing folder** (already have files locally):`,
    `\`\`\`bash`,
    `cd /path/to/your/existing/folder`,
    `mut connect ${cloneUrl} --credential ${accessKey}`,
    `\`\`\``,
    `Three-way merges with whatever is on disk — no overwrite, no data loss.`,
    ``,
    `## Sync workflow`,
    `\`\`\`bash`,
    `mut pull                          # get latest from cloud`,
    `# ... make your edits ...`,
    `mut commit -m "describe changes"  # snapshot locally`,
    `mut push                          # send to cloud`,
    `\`\`\``,
    ``,
    `Run \`mut status\` to check for uncommitted changes.`,
    `Run \`mut log\` to view commit history.`,
  ].join('\n');
}

function PromptCopyRow({ prompt }: { readonly prompt: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 8,
        border: `1px solid ${copied ? 'rgba(52,211,153,0.35)' : 'rgba(147,197,253,0.18)'}`,
        background: copied ? 'rgba(52,211,153,0.08)' : 'rgba(96,165,250,0.05)',
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>
            Copy Prompt for AI Agent
          </div>
          <div style={{ color: '#8b8b8b', fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>
            Paste into Claude Code, Cursor, Codex… includes install, clone vs connect, and sync workflow.
          </div>
        </div>
        <span style={{
          flexShrink: 0,
          color: copied ? '#34d399' : '#a3a3a3',
          fontSize: 11,
          fontWeight: 500,
          border: `1px solid ${copied ? 'rgba(52,211,153,0.24)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 999,
          padding: '4px 8px',
          background: copied ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
        }}>
          {copied ? 'Copied' : 'Copy Prompt'}
        </span>
      </div>
    </button>
  );
}

function CliExpansion({ scope }: { readonly scope: RepoScope }) {
  const apiBase = getApiBase();
  const accessKey = scope.access_key || '';
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;

  if (!accessKey) {
    return (
      <div
        style={{
          borderTop: `1px solid ${COLOR_BORDER}`,
          padding: '10px 12px',
          fontSize: 12,
          color: COLOR_FG_DIM,
          lineHeight: 1.5,
        }}
      >
        This scope has no access_key issued. Regenerate it from scope settings to enable CLI access.
      </div>
    );
  }

  // The bare command is the one-line copy users want when they already
  // know what they're doing — `mut` parses the access_key out of the URL
  // path component, so no separate `--credential` flag is needed for the
  // happy path. The detailed prompt below still shows `--credential`
  // explicitly because that's the form a coding agent should reproduce.
  const mutLines = [`mut clone ${cloneUrl}`];
  const agentPrompt = buildMutAgentPrompt({
    cloneUrl,
    accessKey,
    scopeName: scope.name || (scope.path === '' ? 'root' : scope.path),
  });

  return (
    <div
      style={{
        borderTop: `1px solid ${COLOR_BORDER}`,
        padding: '10px 10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <CommandBlock
        label="MUT CLI"
        description="One-line clone — paste into your terminal."
        lines={mutLines}
      />
      <PromptCopyRow prompt={agentPrompt} />
    </div>
  );
}

function Chevron({ expanded }: { readonly expanded: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        fontSize: 10,
        color: COLOR_FG_DIM,
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
        display: 'inline-block',
        width: 10,
        textAlign: 'center',
      }}
    >
      ▶
    </span>
  );
}

function ConnectorCard({
  connector,
  scope,
  providerIcons,
  onClick,
  onHoverEnter,
  onHoverLeave,
  builtin,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
  readonly providerIcons: ProviderIconLookup;
  readonly onClick: () => void;
  readonly onHoverEnter?: () => void;
  readonly onHoverLeave?: () => void;
  readonly builtin: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iconEp = useMemo(() => connectorAsEndpointShape(connector), [connector]);
  const displayName = connector.name || providerLabel(connector.provider);

  // cli is the only provider with an inline-expand (mut + puppyone commands
  // + canonical agent prompt). Agent + third-party bubble click to parent
  // for routing (agent → agent_chat panel; third-party → sync detail).
  const inlineExpand = connector.provider === 'cli';

  const handleClick = () => {
    if (inlineExpand) setExpanded((v) => !v);
    else onClick();
  };

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${hovered || expanded ? COLOR_BORDER_HOVER : COLOR_BORDER}`,
        background: hovered || expanded ? COLOR_BG_HOVER : COLOR_BG_CARD,
        overflow: 'hidden',
        transition: 'all 0.15s',
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => { setHovered(true); onHoverEnter?.(); }}
        onMouseLeave={() => { setHovered(false); onHoverLeave?.(); }}
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: 'transparent',
          border: 'none',
          color: COLOR_FG,
          cursor: 'pointer',
        }}
      >
        <AccessPointProviderIcon ep={iconEp} providerIcons={providerIcons} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: COLOR_FG, lineHeight: 1.3 }}>
              {displayName}
            </span>
            {builtin && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: COLOR_FG_MUTED,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                Default
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: COLOR_FG_DIM, lineHeight: 1.4, marginTop: 2 }}>
            {providerLabel(connector.provider)} · {directionLabel(connector.direction)}
          </div>
        </div>
        <StatusDot status={connector.status} />
        {inlineExpand && <Chevron expanded={expanded} />}
      </button>
      {inlineExpand && expanded && <CliExpansion scope={scope} />}
    </div>
  );
}

/**
 * ScopeSettingsBlock — collapsible scope summary + edit form.
 *
 * Default state shows a one-line summary (path / mode / exclude count) with
 * an [Edit] button. Clicking Edit reveals an inline form where the user can:
 *   - rename the scope (root scope name is locked — DB has a CHECK / RLS)
 *   - flip mode between Read-only and Read & Write
 *   - manage exclude paths (1:1 with mut's scope.excludes)
 *   - delete the scope (two-click confirm; root scope is hard-disabled
 *     because the DB enforces "exactly one root per project")
 *
 * Save calls updateScope, then onMutated to refresh page-level SWR caches.
 * Cancel reverts local form state to the prop values; the [Cancel] button
 * exists separately from clicking [Edit] again because users sometimes
 * touch a field, change their mind, and want to bail without saving — and
 * an "X" close affordance in the corner of an inline panel is too easy to
 * miss in a long form.
 */
function ScopeSettingsBlock({
  scope,
  projectId,
  onMutated,
  onClose,
}: {
  readonly scope: RepoScope;
  readonly projectId: string;
  readonly onMutated: () => Promise<unknown>;
  readonly onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scope.name);
  const [mode, setMode] = useState<ScopeMode>(scope.mode);
  const [excludes, setExcludes] = useState<string[]>(scope.exclude || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset local form state when the scope prop changes (different scope
  // selected via navigation or AllScopesList).
  useEffect(() => {
    setName(scope.name);
    setMode(scope.mode);
    setExcludes(scope.exclude || []);
    setEditing(false);
    setError(null);
    setConfirmDelete(false);
  }, [scope.id, scope.name, scope.mode, scope.exclude]);

  const dirty =
    name.trim() !== scope.name ||
    mode !== scope.mode ||
    JSON.stringify(excludes) !== JSON.stringify(scope.exclude || []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await updateScope(projectId, scope.id, {
        // Root scope name is locked; sending the original value is a no-op.
        name: scope.is_root ? scope.name : (name.trim() || scope.name),
        mode,
        exclude: excludes.map((s) => s.trim()).filter((s) => s !== ''),
      });
      await onMutated();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to save scope');
    } finally {
      setSaving(false);
    }
  }, [projectId, scope.id, scope.is_root, scope.name, name, mode, excludes, onMutated]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      // First click: arm the confirm. Auto-disarm after 4s so a stray
      // first click doesn't leave the button in a destructive state.
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteScope(projectId, scope.id);
      await onMutated();
      // The scope is gone — close the panel back to the explorer rather
      // than leaving the user staring at the now-stale form.
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Failed to delete scope');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [confirmDelete, projectId, scope.id, onMutated, onClose]);

  if (!editing) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 11,
          color: COLOR_FG_DIM,
          borderBottom: `1px solid ${COLOR_BORDER}`,
          paddingBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ color: COLOR_FG_MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Path: {scope.path === '' ? '/ (root)' : `/${scope.path}`}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              padding: '3px 9px',
              fontSize: 11,
              fontWeight: 500,
              color: COLOR_FG,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${COLOR_BORDER_HOVER}`,
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Edit
          </button>
        </div>
        <div>
          Mode: {scope.mode === 'rw' ? 'Read & Write' : 'Read-only'}
          {scope.is_root && ' · Root scope'}
          {scope.exclude && scope.exclude.length > 0 &&
            ` · ${scope.exclude.length} exclude path${scope.exclude.length === 1 ? '' : 's'}`}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 12px 14px',
        borderRadius: 8,
        border: `1px solid ${COLOR_BORDER_HOVER}`,
        background: COLOR_BG_CARD,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLOR_FG_MUTED,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        Edit scope · {scope.path === '' ? '/ (root)' : `/${scope.path}`}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: COLOR_FG_DIM }}>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={scope.is_root}
          style={{
            background: 'rgba(0,0,0,0.3)',
            border: `1px solid ${COLOR_BORDER}`,
            borderRadius: 6,
            color: COLOR_FG,
            fontSize: 13,
            padding: '6px 8px',
            outline: 'none',
            opacity: scope.is_root ? 0.6 : 1,
          }}
        />
        {scope.is_root && (
          <span style={{ fontSize: 10, color: COLOR_FG_DIM }}>
            Root scope name is fixed.
          </span>
        )}
      </label>

      <fieldset
        style={{
          border: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <legend style={{ fontSize: 11, color: COLOR_FG_DIM, padding: 0 }}>Mode</legend>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: COLOR_FG }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`mode-${scope.id}`}
              checked={mode === 'r'}
              onChange={() => setMode('r')}
            />
            Read-only
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`mode-${scope.id}`}
              checked={mode === 'rw'}
              onChange={() => setMode('rw')}
            />
            Read &amp; Write
          </label>
        </div>
      </fieldset>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: COLOR_FG_DIM }}>
          Exclude paths{' '}
          <span style={{ fontSize: 10 }}>
            (relative to scope, applied at MUT layer — e.g. <code>secrets/</code> or <code>.env</code>)
          </span>
        </span>
        {excludes.length === 0 && (
          <div style={{ fontSize: 11, color: COLOR_FG_DIM, padding: '4px 0' }}>
            None — all files in scope are included.
          </div>
        )}
        {excludes.map((p, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              value={p}
              placeholder="e.g. secrets/ or .env"
              onChange={(e) => {
                const next = [...excludes];
                next[i] = e.target.value;
                setExcludes(next);
              }}
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: `1px solid ${COLOR_BORDER}`,
                borderRadius: 6,
                color: COLOR_FG,
                fontSize: 12,
                padding: '5px 8px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => setExcludes(excludes.filter((_, idx) => idx !== i))}
              aria-label="Remove exclude path"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                border: `1px solid ${COLOR_BORDER}`,
                background: 'transparent',
                color: COLOR_FG_DIM,
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setExcludes([...excludes, ''])}
          style={{
            alignSelf: 'flex-start',
            padding: '3px 9px',
            fontSize: 11,
            fontWeight: 500,
            color: COLOR_FG_MUTED,
            background: 'transparent',
            border: `1px dashed ${COLOR_BORDER_HOVER}`,
            borderRadius: 6,
            cursor: 'pointer',
            marginTop: 2,
          }}
        >
          + Add path
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 2 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: dirty && !saving ? '#0a0a0a' : COLOR_FG_DIM,
            background: dirty && !saving ? '#34d399' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${dirty && !saving ? 'rgba(52,211,153,0.6)' : COLOR_BORDER}`,
            borderRadius: 6,
            cursor: dirty && !saving ? 'pointer' : 'default',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setName(scope.name);
            setMode(scope.mode);
            setExcludes(scope.exclude || []);
            setEditing(false);
            setError(null);
          }}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            color: COLOR_FG,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${COLOR_BORDER_HOVER}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>

      <div style={{ marginTop: 6, paddingTop: 10, borderTop: `1px solid ${COLOR_BORDER}` }}>
        <button
          type="button"
          onClick={handleDelete}
          disabled={scope.is_root || deleting}
          title={scope.is_root ? 'Root scope cannot be deleted' : undefined}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: scope.is_root
              ? COLOR_FG_DIM
              : confirmDelete
                ? '#fca5a5'
                : '#f87171',
            background: scope.is_root
              ? 'transparent'
              : confirmDelete
                ? 'rgba(248,113,113,0.12)'
                : 'transparent',
            border: `1px solid ${
              scope.is_root
                ? COLOR_BORDER
                : confirmDelete
                  ? '#f87171'
                  : 'rgba(248,113,113,0.3)'
            }`,
            borderRadius: 6,
            cursor: scope.is_root ? 'not-allowed' : 'pointer',
            opacity: scope.is_root ? 0.5 : 1,
          }}
        >
          {deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete' : 'Delete scope'}
        </button>
      </div>
    </div>
  );
}

/**
 * MakeScopeCTA — primary action shown when the user has navigated to a
 * folder that isn't yet a scope. Single-click create with sensible
 * defaults (name = last path segment, mode = rw, exclude = []) — the user
 * can immediately fine-tune via the ScopeSettingsBlock that appears once
 * the scope materialises. Keeps the new-scope flow to one click for the
 * common case.
 */
function MakeScopeCTA({
  currentPath,
  projectId,
  onMutated,
}: {
  readonly currentPath: string;
  readonly projectId: string;
  readonly onMutated: () => Promise<unknown>;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segments = currentPath.split('/').filter(Boolean);
  const defaultName = segments.length > 0 ? segments[segments.length - 1] : 'Root';
  const displayPath = currentPath === '' ? '/ (root)' : `/${currentPath}`;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await createScope(projectId, {
        name: defaultName,
        path: currentPath,
        mode: 'rw',
        exclude: [],
      });
      await onMutated();
    } catch (e) {
      setError((e as Error).message || 'Failed to create scope');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ paddingBottom: 16, borderBottom: `1px solid ${COLOR_BORDER}` }}>
      <div style={{ fontSize: 13, color: COLOR_FG, marginBottom: 4 }}>
        <code style={{ fontSize: 12, color: COLOR_FG_MUTED }}>{displayPath}</code>{' '}
        isn&apos;t a scope yet.
      </div>
      <div style={{ fontSize: 11, color: COLOR_FG_DIM, marginBottom: 12, lineHeight: 1.5 }}>
        Make this folder a scope to enable cli, agent, and third-party
        integrations bound to it.
      </div>
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        style={{
          padding: '7px 14px',
          fontSize: 12,
          fontWeight: 600,
          color: '#0a0a0a',
          background: '#34d399',
          border: '1px solid rgba(52,211,153,0.7)',
          borderRadius: 6,
          cursor: creating ? 'default' : 'pointer',
        }}
      >
        {creating ? 'Creating…' : '+ Make this folder a scope'}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}

/**
 * AllScopesList — project-wide scope index, shown only in the non-scope
 * state. Doubles as both navigation (each row's Open button takes the
 * user to that scope's folder) and an at-a-glance manifest of what
 * exists. We deliberately do NOT show this list when a scope IS selected
 * — the file tree on the left already provides navigation, and stacking
 * a duplicate list under the scope settings would just clutter the panel.
 */
function AllScopesList({
  scopes,
  currentScopePath,
  onScopeNavigate,
}: {
  readonly scopes: readonly RepoScope[];
  readonly currentScopePath: string;
  readonly onScopeNavigate: (path: string) => void;
}) {
  if (scopes.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLOR_FG_MUTED,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          padding: '0 2px',
        }}
      >
        All scopes in this project
      </div>
      {scopes.map((s) => {
        const isCurrent = s.path === currentScopePath;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (!isCurrent) onScopeNavigate(s.path);
            }}
            disabled={isCurrent}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${COLOR_BORDER}`,
              background: COLOR_BG_CARD,
              color: COLOR_FG,
              cursor: isCurrent ? 'default' : 'pointer',
              opacity: isCurrent ? 0.6 : 1,
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: COLOR_FG, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
                {s.is_root && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: COLOR_FG_MUTED,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      flexShrink: 0,
                    }}
                  >
                    Root
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: COLOR_FG_DIM, lineHeight: 1.4, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.path === '' ? '/ (root)' : `/${s.path}`}
                {' · '}
                {s.mode === 'rw' ? 'rw' : 'r'}
                {s.exclude && s.exclude.length > 0 && ` · ${s.exclude.length} excludes`}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                color: isCurrent ? COLOR_FG_DIM : COLOR_FG_MUTED,
                flexShrink: 0,
              }}
            >
              {isCurrent ? 'Current' : 'Open →'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ScopedConnectorsListPanel({
  scope,
  scopes,
  currentScopePath,
  projectId,
  connectors,
  providerIcons,
  onClose,
  onAddRequested,
  onConnectorClick,
  onScopeHover,
  onScopeMutated,
  onScopeNavigate,
}: Props) {
  const sorted = useMemo(() => sortConnectorsBuiltinFirst(connectors), [connectors]);
  const builtin = useMemo(
    () => sorted.filter((c) => c.provider === 'cli' || c.provider === 'agent'),
    [sorted],
  );
  const thirdParty = useMemo(
    () => sorted.filter((c) => c.provider !== 'cli' && c.provider !== 'agent'),
    [sorted],
  );

  // Clear any lingering hover highlight when the panel unmounts or the
  // hovered scope changes (defensive: onMouseLeave handles the common case,
  // but a fast scope-switch can skip leave events).
  useEffect(() => {
    return () => onScopeHover?.(null);
  }, [scope?.id, onScopeHover]);

  const handleHoverEnter = useCallback(() => {
    if (scope) onScopeHover?.(scope.path);
  }, [scope, onScopeHover]);
  const handleHoverLeave = useCallback(() => {
    onScopeHover?.(null);
  }, [onScopeHover]);

  // The panel covers more than just third-party once a scope is selected
  // (settings, defaults, third-party). Use a tighter title that names the
  // scope, and a generic "Scopes" when no scope is matched (the panel is
  // then a CRUD + navigation surface for all scopes).
  const title = scope ? `${scope.name} · Scope` : 'Scopes';

  return (
    <PanelShell title={title} onClose={onClose}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: '#0e0e0e',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {scope ? (
            <>
              <ScopeSettingsBlock
                scope={scope}
                projectId={projectId}
                onMutated={onScopeMutated}
                onClose={onClose}
              />

              {/* Built-ins (cli + agent) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: COLOR_FG_MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    padding: '0 2px',
                  }}
                >
                  Defaults
                </div>
                {builtin.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR_FG_DIM, padding: '8px 4px' }}>
                    No default connectors yet — they should auto-create on scope insert.
                  </div>
                ) : (
                  builtin.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      connector={c}
                      scope={scope}
                      providerIcons={providerIcons}
                      onClick={() => onConnectorClick(c)}
                      onHoverEnter={handleHoverEnter}
                      onHoverLeave={handleHoverLeave}
                      builtin
                    />
                  ))
                )}
              </div>

              {/* Third Party Integrations: section header + Add button live
                  next to the content they manage. The Add button is the
                  primary CTA for this scope, so it sits inline with the
                  section title (right-aligned) instead of in the panel
                  header — keeps the action visually attached to its
                  destination, and makes it discoverable when the
                  third-party list is empty. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '0 2px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: COLOR_FG_MUTED,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                    }}
                  >
                    Third Party Integrations
                  </div>
                  <button
                    type="button"
                    onClick={onAddRequested}
                    style={{
                      padding: '3px 9px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: COLOR_FG,
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${COLOR_BORDER_HOVER}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    + Add
                  </button>
                </div>
                {thirdParty.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR_FG_DIM, padding: '8px 4px' }}>
                    No third party integrations yet. Click &quot;+ Add&quot; to connect a source.
                  </div>
                ) : (
                  thirdParty.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      connector={c}
                      scope={scope}
                      providerIcons={providerIcons}
                      onClick={() => onConnectorClick(c)}
                      onHoverEnter={handleHoverEnter}
                      onHoverLeave={handleHoverLeave}
                      builtin={false}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <MakeScopeCTA
                currentPath={currentScopePath}
                projectId={projectId}
                onMutated={onScopeMutated}
              />
              <AllScopesList
                scopes={scopes}
                currentScopePath={currentScopePath}
                onScopeNavigate={onScopeNavigate}
              />
            </>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
