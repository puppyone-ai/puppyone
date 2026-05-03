'use client';

/**
 * ScopedConnectorsListPanel — per-scope connector list (redesign-2026-05-02).
 *
 * Replaces the project-wide AccessPointsListPanel. Renders the connectors
 * bound to the scope the user has navigated into. cli + agent are the
 * always-present defaults (DB trigger guarantees their existence per scope);
 * third-party providers (notion / gmail / github / url / ...) appear under
 * a separate section. The header carries an "+ Add Import/Export" button
 * that opens the provider picker.
 *
 * No parent-child inheritance: a folder shows ONLY connectors of its
 * exact-match scope (per Q1 decision 2026-05-03). Folders that aren't
 * scopes show an empty state.
 */

import { useMemo, useState } from 'react';
import { PanelShell } from '../PanelShell';
import { AccessPointProviderIcon, StatusDot } from './AccessPointProviderIcon';
import { sortConnectorsBuiltinFirst, type Connector, type RepoScope } from '@/lib/repoApi';
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
  readonly connectors: readonly Connector[];
  readonly providerIcons: ProviderIconLookup;
  readonly onClose: () => void;
  readonly onAddRequested: () => void;
  readonly onConnectorClick: (c: Connector) => void;
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

interface SnippetBlock {
  title: string;
  description: string;
  prompt: string;
  tone?: 'green' | 'blue' | 'neutral';
}

function buildCliSnippets(scope: RepoScope, displayName: string): SnippetBlock[] {
  const apiBase = getApiBase();
  const accessKey = scope.access_key || '';
  if (!accessKey) {
    return [{
      title: 'No access key',
      description: 'This scope has no access_key issued. Regenerate it from scope settings to enable CLI access.',
      prompt: '',
      tone: 'neutral',
    }];
  }
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;
  const profileName = profileSlug(scope.name || scope.path || 'root');
  const scopeLabel = scope.path === '' ? 'root' : scope.path;

  const cliPrompt = [
    `Use this PuppyOne folder Access Point from terminal.`,
    ``,
    `Connector: ${displayName}`,
    `Scope: ${scopeLabel}`,
    ``,
    `Recommended: direct remote filesystem commands (no local clone needed).`,
    `printf '%s' '${accessKey}' | puppyone ap login ${profileName} --api-url ${apiBase} --access-key-stdin`,
    `puppyone fs ls`,
    `puppyone fs cat <file.md>`,
    `echo "hello" | puppyone fs write notes/hello.md --type markdown`,
    ``,
    `Use MUT when you want a local folder backup or ongoing two-way sync.`,
    `mut connect ${cloneUrl} --credential ${accessKey}`,
    ``,
    `Endpoint URL: ${cloneUrl}`,
    `Credential: ${accessKey}`,
    ``,
    `Do not create a new access point unless I ask for one.`,
  ].join('\n');

  const mutPrompt = [
    `Sync this PuppyOne Access Point with a local folder using the MUT CLI.`,
    ``,
    `Connector: ${displayName}`,
    `Scope: ${scopeLabel}`,
    ``,
    `From the local folder that should sync with PuppyOne, run:`,
    `mut connect ${cloneUrl} --credential ${accessKey}`,
    ``,
    `Endpoint URL: ${cloneUrl}`,
    `Credential: ${accessKey}`,
    ``,
    `After connecting, use MUT for ongoing syncs. Do not create a new access point unless I ask for one.`,
  ].join('\n');

  return [
    {
      title: 'PuppyOne CLI',
      description: 'Directly read and write this cloud folder. No local clone.',
      prompt: cliPrompt,
      tone: 'green',
    },
    {
      title: 'MUT Sync',
      description: 'Use when you want a local folder copy and ongoing two-way sync.',
      prompt: mutPrompt,
      tone: 'blue',
    },
  ];
}

function buildAgentSnippets(connector: Connector, scope: RepoScope, displayName: string): SnippetBlock[] {
  const apiBase = getApiBase();
  const mcpKey = (connector.config?.mcp_api_key as string | undefined) || '';
  const scopeLabel = scope.path === '' ? 'root' : scope.path;

  if (!mcpKey) {
    return [{
      title: 'Agent not yet activated',
      description: 'No mcp_api_key on this agent connector. Open the agent in chat once to provision its MCP key.',
      prompt: '',
      tone: 'neutral',
    }];
  }

  const serverName = profileSlug(displayName) || 'puppyone-agent';
  const serverUrl = `${apiBase}/api/v1/mcp/proxy/${mcpKey}`;
  const config = `{\n  "mcpServers": {\n    "${serverName}": {\n      "url": "${serverUrl}",\n      "headers": { "X-API-KEY": "${mcpKey}" }\n    }\n  }\n}`;
  const prompt = [
    `Configure this PuppyOne Chat Agent for an MCP-compatible client.`,
    ``,
    `Connector: ${displayName}`,
    `Scope: ${scopeLabel}`,
    `MCP Server URL: ${serverUrl}`,
    `API Key: ${mcpKey}`,
    ``,
    `Use this MCP config:`,
    config,
    ``,
    `After configuring it, use the MCP tools against the scoped PuppyOne workspace data.`,
  ].join('\n');
  return [{
    title: 'MCP',
    description: 'Configure this agent for an MCP-compatible client (Claude Desktop, Cursor, …).',
    prompt,
    tone: 'blue',
  }];
}

function CopyPromptButton({ block }: { readonly block: SnippetBlock }) {
  const [copied, setCopied] = useState(false);
  const tone = block.tone || 'neutral';
  let color: string;
  if (tone === 'green') color = '#34d399';
  else if (tone === 'blue') color = '#93c5fd';
  else color = '#a3a3a3';

  const handleCopy = async () => {
    if (!block.prompt) return;
    await navigator.clipboard.writeText(block.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!block.prompt}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 8,
        border: `1px solid ${copied ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.08)'}`,
        background: copied ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)',
        padding: '10px 12px',
        cursor: block.prompt ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
        opacity: block.prompt ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color, fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{block.title}</div>
          <div style={{ color: '#8b8b8b', fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>
            {block.description}
          </div>
        </div>
        {block.prompt && (
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
        )}
      </div>
    </button>
  );
}

function BuiltinExpansion({
  connector,
  scope,
  displayName,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
  readonly displayName: string;
}) {
  const blocks = useMemo(() => {
    if (connector.provider === 'cli') return buildCliSnippets(scope, displayName);
    if (connector.provider === 'agent') return buildAgentSnippets(connector, scope, displayName);
    return [];
  }, [connector, scope, displayName]);

  if (blocks.length === 0) return null;
  return (
    <div
      style={{
        borderTop: `1px solid ${COLOR_BORDER}`,
        padding: '10px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {blocks.map((block) => (
        <CopyPromptButton key={block.title} block={block} />
      ))}
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
  onThirdPartyClick,
  builtin,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope;
  readonly providerIcons: ProviderIconLookup;
  readonly onThirdPartyClick: () => void;
  readonly builtin: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iconEp = useMemo(() => connectorAsEndpointShape(connector), [connector]);
  const displayName = connector.name || providerLabel(connector.provider);

  // Builtin (cli/agent): inline-expand to show setup snippets.
  // Third-party: bubble click to parent for detail-panel routing.
  const handleClick = () => {
    if (builtin) setExpanded((v) => !v);
    else onThirdPartyClick();
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
        {builtin && <Chevron expanded={expanded} />}
      </button>
      {builtin && expanded && (
        <BuiltinExpansion connector={connector} scope={scope} displayName={displayName} />
      )}
    </div>
  );
}

function EmptyScopeMessage({ onClose }: { readonly onClose: () => void }) {
  return (
    <div
      style={{
        padding: '32px 16px',
        textAlign: 'center',
        color: COLOR_FG_DIM,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ marginBottom: 8 }}>This folder isn&apos;t a scope.</div>
      <div style={{ fontSize: 12, color: COLOR_FG_DIM }}>
        Imports and exports are configured per scope. Navigate to a scope folder, or close this panel.
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 16,
          padding: '6px 14px',
          fontSize: 12,
          background: '#242424',
          border: `1px solid ${COLOR_BORDER_HOVER}`,
          borderRadius: 6,
          color: COLOR_FG,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  );
}

export function ScopedConnectorsListPanel({
  scope,
  connectors,
  providerIcons,
  onClose,
  onAddRequested,
  onConnectorClick,
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

  const title = scope ? `${scope.name} · Imports & Exports` : 'Imports & Exports';

  return (
    <PanelShell
      title={title}
      onClose={onClose}
      headerRight={
        scope ? (
          <button
            type="button"
            onClick={onAddRequested}
            style={{
              padding: '4px 10px',
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
        ) : null
      }
    >
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
              {/* Scope summary */}
              <div
                style={{
                  fontSize: 11,
                  color: COLOR_FG_DIM,
                  borderBottom: `1px solid ${COLOR_BORDER}`,
                  paddingBottom: 10,
                }}
              >
                <div style={{ color: COLOR_FG_MUTED }}>
                  Path: {scope.path === '' ? '/ (root)' : scope.path}
                </div>
                <div style={{ marginTop: 2 }}>
                  Mode: {scope.mode === 'rw' ? 'Read & Write' : 'Read-only'}
                  {scope.is_root && ' · Root scope'}
                </div>
              </div>

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
                      onThirdPartyClick={() => onConnectorClick(c)}
                      builtin
                    />
                  ))
                )}
              </div>

              {/* Third-party imports & exports */}
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
                  Imports &amp; Exports
                </div>
                {thirdParty.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR_FG_DIM, padding: '8px 4px' }}>
                    No imports or exports yet. Click &quot;+ Add&quot; to connect a source.
                  </div>
                ) : (
                  thirdParty.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      connector={c}
                      scope={scope}
                      providerIcons={providerIcons}
                      onThirdPartyClick={() => onConnectorClick(c)}
                      builtin={false}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <EmptyScopeMessage onClose={onClose} />
          )}
        </div>
      </div>
    </PanelShell>
  );
}
