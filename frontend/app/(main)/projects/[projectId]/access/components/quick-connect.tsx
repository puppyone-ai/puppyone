'use client';

/**
 * Quick-Connect — per-provider "how do I use this access point?" body.
 *
 * Different connector kinds expose fundamentally different surfaces.
 * The data view's `ConnectMethods` already encoded this for us; we
 * mirror its split here:
 *
 *   • CLI / filesystem  → copy-prompt block (terminal-CLI or local-sync
 *     prompt for an external AI agent), plus a Show-install disclosure.
 *   • agent             → ActivationCard (Activate / Open chat) — agents
 *     are Puppyone's in-app chat, never an externally-pasted prompt.
 *   • mcp / sandbox / 3p → just the connect URL / endpoint with copy
 *     buttons. No fake "prompt for an AI agent" — those connectors are
 *     configured elsewhere, not driven by prompt-pasting.
 *
 * All 5 Body components live in this single file because they're a
 * family of mutually-exclusive branches behind `ConnectorAccessPanel`,
 * the one router that picks the right one. Reading them side-by-side
 * makes it trivial to spot drift between providers (every Body should
 * share the same NoAccessKeyNotice + SubSectionLabel + KvBlock idiom).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildTerminalCliPrompt } from '@/lib/accessPointCliPrompt';
import { activateAgentConnector, type Connector, type RepoScope } from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS } from '../lib/constants';
import {
  getApiBase,
  profileSlug,
  scopePathToDataUrl,
} from '../lib/format';
import {
  CommandStepsDisclosure,
  KvBlock,
  NoAccessKeyNotice,
  PromptBlock,
  SubSectionLabel,
} from './ui-blocks';

// ─── Per-provider access panel ───────────────────────────────────────

export function ConnectorAccessPanel({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
}) {
  const apiBase = useMemo(() => getApiBase(), []);
  if (!scope) return null;

  if (connector.provider === 'cli') {
    return <TerminalCliBody scope={scope} apiBase={apiBase} />;
  }
  if (connector.provider === 'filesystem') {
    return <LocalSyncBody scope={scope} apiBase={apiBase} />;
  }
  if (connector.provider === 'agent') {
    // Agent surface is gated on the AI_AGENT_ENABLED flag (see
    // `frontend/lib/featureFlags.ts`). When hidden, fall through to
    // an empty render — callers should be filtering agent connectors
    // out at the list level so this branch shouldn't even be hit,
    // but we treat it as a defensive null-render in case stale state
    // or a deep link still navigates here.
    if (!AI_AGENT_ENABLED) return null;
    return <AgentBody connector={connector} scope={scope} />;
  }
  if (connector.provider === 'mcp') {
    return <McpBody connector={connector} scope={scope} />;
  }
  if (connector.provider === 'sandbox') {
    return <SandboxBody scope={scope} />;
  }
  return <ThirdPartyBody connector={connector} scope={scope} />;
}

// ─── Body: Terminal CLI ──────────────────────────────────────────────

function TerminalCliBody({
  scope,
  apiBase,
}: {
  readonly scope: RepoScope;
  readonly apiBase: string;
}) {
  const accessKey = scope.access_key || '';
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);
  const profileName = profileSlug(scope.name || scope.path || 'root');

  const { installLine, loginLine, exploreLines, fileLines, prompt } = buildTerminalCliPrompt({
    apiBase,
    accessKey,
    profileName,
    scopeName,
  });

  return (
    <>
      {!accessKey && <NoAccessKeyNotice />}
      <SubSectionLabel>Prompt for AI agent</SubSectionLabel>
      <PromptBlock prompt={prompt} />
      <CommandStepsDisclosure
        steps={[
          { title: 'Install once', lines: [installLine] },
          { title: 'Sign in to this scope', lines: [loginLine] },
          { title: 'Explore safely', lines: exploreLines },
          { title: 'Read & write files', lines: fileLines },
        ]}
      />
    </>
  );
}

// ─── Body: Local Sync (mut) ──────────────────────────────────────────

function LocalSyncBody({
  scope,
  apiBase,
}: {
  readonly scope: RepoScope;
  readonly apiBase: string;
}) {
  const accessKey = scope.access_key || '';
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);
  // V1 (post-MUT removal): the access key now authorises a stock Git
  // smart-HTTP remote at /git/ap/<key>.git. The legacy MUT wire URL
  // (/api/v1/mut/ap/<key>) was deleted with the protocol.
  const cloneUrl = `${apiBase}/git/ap/${accessKey}.git`;

  const host = (() => {
    try { return new URL(cloneUrl).host; }
    catch { return 'qubits-api.puppyone.ai'; }
  })();

  const authLines = [
    'git config --global credential.helper store',
    String.raw`printf "https://x-access-token:%s@%s\n" "` + (accessKey || '<access-key>') + `" "${host}" >> ~/.git-credentials`,
  ];
  const cloneLine = `git clone ${cloneUrl}`;
  const connectLines = [
    'cd /path/to/your/folder',
    'git init -b main',
    `git remote add origin ${cloneUrl}`,
    'git pull --rebase origin main',
    'git push -u origin main',
  ];
  const workflowLines = [
    'git pull --ff-only               # get latest from cloud',
    '# ... edit files ...',
    'git add -A && git commit -m "describe changes"',
    'git push origin main             # send to cloud',
  ];

  const prompt = [
    `Sync my local folder with PuppyOne cloud using stock \`git\`.`,
    ``,
    `## Authenticate (one-time)`,
    `\`\`\`bash`,
    ...authLines,
    `\`\`\``,
    ``,
    `## Setup — choose one path`,
    ``,
    `**A. Clone to a new folder** (no local files yet):`,
    `\`\`\`bash`,
    cloneLine,
    `cd ${scopeName}`,
    `\`\`\``,
    ``,
    `**B. Connect an existing folder** (already have files locally):`,
    `\`\`\`bash`,
    ...connectLines,
    `\`\`\``,
    ``,
    `## Sync workflow`,
    `\`\`\`bash`,
    ...workflowLines,
    `\`\`\``,
    ``,
    `If a push is rejected with \`puppyone-pending: review required\`,`,
    `open the PuppyOne UI; the conflict is queued for manual review.`,
  ].join('\n');

  return (
    <>
      {!accessKey && <NoAccessKeyNotice />}
      <SubSectionLabel>Prompt for AI agent</SubSectionLabel>
      <PromptBlock prompt={prompt} />
      <CommandStepsDisclosure
        steps={[
          { title: 'Authenticate once', lines: authLines },
          { title: 'Clone or connect', lines: [cloneLine, ...connectLines] },
          { title: 'Day-to-day workflow', lines: workflowLines },
        ]}
      />
    </>
  );
}

// ─── Body: AI Agent ──────────────────────────────────────────────────

function AgentBody({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
}) {
  const router = useRouter();
  // `activateAgentConnector` writes scope + name into config; an
  // unactivated agent has `config.scope` empty. Reading it directly
  // matches `ConnectMethods`.
  const [activated, setActivated] = useState<boolean>(Boolean(connector.config?.scope));
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when connector changes underneath us (e.g. SWR refetch).
  useEffect(() => {
    setActivated(Boolean(connector.config?.scope));
  }, [connector.config?.scope]);

  const goToChat = useCallback(() => {
    // The actual chat runtime lives behind the data view's right panel.
    // Drop the user there — the page-level wiring opens the agent_chat
    // panel for this connector. Using `?ap=...` is enough; the data
    // page reads it on mount.
    router.push(scopePathToDataUrl(connector.project_id, scope.path) + `?ap=${connector.id}`);
  }, [router, connector, scope.path]);

  const handleActivate = useCallback(async () => {
    if (activating) return;
    setActivating(true);
    setError(null);
    try {
      const updated = await activateAgentConnector(connector.project_id, connector.id);
      setActivated(Boolean(updated.config?.scope));
      // Then immediately route to chat — same flow as ConnectMethods.
      router.push(scopePathToDataUrl(connector.project_id, scope.path) + `?ap=${connector.id}`);
    } catch (err) {
      setError((err as Error).message || 'Failed to activate AI Agent');
    } finally {
      setActivating(false);
    }
  }, [activating, connector, scope.path, router]);

  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);

  if (!activated) {
    return (
      <ActivationCard
        title="Activate the AI Agent for this scope"
        body={`Creates an in-app chat agent bound to ${scopeName}. Permissions come from the scope's read/write mode — no separate folder picker.`}
        actionLabel={activating ? 'Activating…' : 'Activate'}
        disabled={activating}
        error={error}
        onAction={handleActivate}
      />
    );
  }

  return (
    <ActivationCard
      title="AI Agent is ready"
      body={`Open an in-app chat with read & write access to ${scopeName}. The chat runtime uses this scope directly; MCP setup belongs in the MCP method.`}
      actionLabel="Open chat"
      onAction={goToChat}
    />
  );
}

// ─── Body: MCP server ────────────────────────────────────────────────

function McpBody({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
}) {
  const apiBase = useMemo(() => getApiBase(), []);
  // MCP endpoint URL — the actual binding lives in the connector's
  // config; we surface the basics so the user can paste them into a
  // Claude Desktop / Cursor MCP config.
  const endpoint = `${apiBase}/mcp/${connector.id}`;
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);

  return (
    <>
      <SubSectionLabel>MCP endpoint</SubSectionLabel>
      <KvBlock
        rows={[
          { label: 'URL', value: endpoint, mono: true, copyable: true },
          { label: 'Scope', value: scopeName },
          { label: 'Mode', value: scope.mode === 'rw' ? 'Read & write' : 'Read-only' },
        ]}
      />
    </>
  );
}

// ─── Body: Sandbox ───────────────────────────────────────────────────

function SandboxBody({ scope }: { readonly scope: RepoScope }) {
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path);
  return (
    <>
      <SubSectionLabel>Sandbox mount</SubSectionLabel>
      <KvBlock
        rows={[
          { label: 'Scope', value: scopeName },
          { label: 'Mount target', value: '/workspace inside the container', mono: true },
          { label: 'Image', value: 'puppyone-sandbox:python3.11', mono: true, copyable: true },
        ]}
      />
    </>
  );
}

// ─── Body: third-party ───────────────────────────────────────────────

function ThirdPartyBody({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
}) {
  const router = useRouter();
  const providerLabel = PROVIDER_LABELS[connector.provider] ?? connector.provider;

  const handleConfigure = useCallback(() => {
    router.push(scopePathToDataUrl(connector.project_id, scope.path) + `?ap=${connector.id}`);
  }, [router, connector, scope.path]);

  return (
    <ActivationCard
      title={`Configure ${providerLabel}`}
      body={`OAuth, sync triggers, and field mapping for ${providerLabel} live in the data view's connector panel. Open it to authorize, set schedules, and edit mappings.`}
      actionLabel="Open in data view"
      onAction={handleConfigure}
    />
  );
}

// ─── ActivationCard ──────────────────────────────────────────────────
// Used by AgentBody and ThirdPartyBody — same shape, different copy.

function ActivationCard({
  title,
  body,
  actionLabel,
  disabled = false,
  error,
  onAction,
}: {
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly disabled?: boolean;
  readonly error?: string | null;
  readonly onAction: () => void;
}) {
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px dashed ${T.cardBorder}`,
        background: T.cardBg,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginBottom: 14,
        fontFamily: T.fontSans,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text1, fontFamily: T.fontSans }}>{title}</div>
      <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.6, fontFamily: T.fontSans }}>{body}</div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 30,
          padding: '0 14px',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: T.fontSans,
          color: disabled ? T.text3 : 'var(--po-text-inverse)',
          background: disabled ? 'var(--po-border-subtle)' : 'var(--po-text)',
          border: 'none',
          borderRadius: 999,
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: disabled
            ? 'none'
            : '0 1px 2px var(--po-shadow), 0 0 0 1px var(--po-border-subtle)',
          transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        {actionLabel}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--po-danger)', lineHeight: 1.5, fontFamily: T.fontSans }}>{error}</div>
      )}
    </div>
  );
}
