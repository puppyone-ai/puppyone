'use client';

import { useEffect, useState } from 'react';
import { accessPointProfileSlug, buildTerminalCliPrompt } from '@/lib/accessPointCliPrompt';
import { PanelShell } from '../PanelShell';
import { AccessPointProviderIcon, StatusDot } from './AccessPointProviderIcon';
import type { SyncEndpointInfo } from '../explorer';
import type { EndpointEntry, ProviderIconLookup } from './types';
import { ensureExpandedBatch } from '../explorer/explorerState';

function formatStatus(status: string) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDirection(direction: string) {
  if (direction === 'bidirectional') return 'Two-way sync';
  if (direction === 'inbound') return 'Syncs into workspace';
  if (direction === 'outbound') return 'Syncs from workspace';
  return direction || 'Access';
}

function getApiBase() {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_URL || '';
  return process.env.NEXT_PUBLIC_API_URL || window.location.origin;
}

function getSetupSnippets(ep: SyncEndpointInfo, displayName: string, scopeName: string) {
  const apiBase = getApiBase();
  const accessKey = ep.accessKey || '';

  if (ep.provider === 'filesystem' && accessKey) {
    const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;
    const profileName = accessPointProfileSlug(scopeName);
    const { prompt } = buildTerminalCliPrompt({
      apiBase,
      accessKey,
      profileName,
      scopeName,
      accessPointName: displayName,
    });
    return {
      primary: {
        title: 'PuppyOne CLI',
        description: 'Directly read and write this cloud folder. No local clone.',
        body: prompt,
        copyText: prompt,
      },
      secondary: {
        title: 'MUT Sync',
        description: 'Use when you want a local folder copy and ongoing two-way sync.',
        body: [
          `Sync this PuppyOne Access Point with a local folder using the MUT CLI.`,
          ``,
          `Access Point: ${displayName}`,
          `Scope: ${scopeName}`,
          ``,
          `From the local folder that should sync with PuppyOne, run:`,
          `mut connect ${cloneUrl} --credential ${accessKey}`,
          ``,
          `Endpoint URL: ${cloneUrl}`,
          `Credential: ${accessKey}`,
          ``,
          `After connecting, use MUT for ongoing syncs. Do not create a new access point unless I ask for one.`,
        ].join('\n'),
      },
    } as const;
  }

  if (ep.provider === 'mcp' && accessKey) {
    const serverUrl = `${apiBase}/api/v1/mcp/proxy/${accessKey}`;
    const serverName = displayName.toLowerCase().replace(/\s+/g, '-') || 'puppyone-mcp';
    const config = `{\n  "mcpServers": {\n    "${serverName}": {\n      "url": "${serverUrl}",\n      "headers": { "X-API-KEY": "${accessKey}" }\n    }\n  }\n}`;
    const prompt = [
      `Configure this MCP Access Point for my coding agent.`,
      ``,
      `Access Point: ${displayName}`,
      `Scope: ${scopeName}`,
      `Server URL: ${serverUrl}`,
      `API Key: ${accessKey}`,
      ``,
      `Use this MCP config:`,
      config,
      ``,
      `After configuring it, use the MCP tools against the scoped PuppyOne workspace data.`,
    ].join('\n');
    return {
      primary: {
        title: 'MCP',
        description: 'Configure this access point for an MCP-compatible client.',
        body: prompt,
        copyText: prompt,
      },
    };
  }

  if (ep.provider === 'sandbox' && accessKey) {
    const execUrl = `${apiBase}/api/v1/sandbox-endpoints/${ep.syncId}/exec`;
    const command = `curl -X POST ${execUrl} \\\n  -H "X-Access-Key: ${accessKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"command": "ls /workspace"}'`;
    const prompt = [
      `Use this PuppyOne Sandbox Access Point to run commands in an isolated workspace environment.`,
      ``,
      `Access Point: ${displayName}`,
      `Scope: ${scopeName}`,
      `Exec URL: ${execUrl}`,
      `Access Key: ${accessKey}`,
      ``,
      `Example request:`,
      command,
      ``,
      `Use this sandbox endpoint for command execution related to the scoped workspace.`,
    ].join('\n');
    return {
      primary: {
        title: 'Sandbox',
        description: 'Run commands against this sandbox access point.',
        body: prompt,
        copyText: prompt,
      },
    };
  }

  if (ep.provider.startsWith('agent:')) {
    const prompt = [
      `Use this PuppyOne agent Access Point from the scoped workspace.`,
      ``,
      `Access Point: ${displayName}`,
      `Scope: ${scopeName}`,
      `Agent ID: ${ep.syncId}`,
      ``,
      `Open the agent detail panel and use its available workspace resources for the task.`,
    ].join('\n');
    return {
      primary: {
        title: 'Agent',
        description: 'Use this agent access point from the scoped workspace.',
        body: prompt,
        copyText: prompt,
      },
    };
  }

  const prompt = [
    `Use this PuppyOne Access Point.`,
    ``,
    `Access Point: ${displayName}`,
    `Scope: ${scopeName}`,
    `Endpoint ID: ${ep.syncId}`,
    accessKey ? `Access Key: ${accessKey}` : null,
    ``,
    `Use the detail view if you need provider-specific setup.`,
  ].filter(Boolean).join('\n');

  return {
    primary: {
      title: 'Access Point',
      description: 'Use this access point with provider-specific setup.',
      body: prompt,
      copyText: prompt,
    },
  };
}

function maskSecret(value: string) {
  if (!value) return 'Not issued';
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getAncestorPaths(nodeId: string): string[] {
  const parts = nodeId.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        padding: '3px 7px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <span style={{ color: '#71717a', fontSize: 11, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#d4d4d8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  );
}

function CopyPromptButton({
  title,
  description,
  prompt,
  tone = 'neutral',
}: {
  title: string;
  description: string;
  prompt: string;
  tone?: 'green' | 'blue' | 'neutral';
}) {
  const [copied, setCopied] = useState(false);
  const color = tone === 'green' ? '#34d399' : tone === 'blue' ? '#93c5fd' : '#a3a3a3';
  const border = tone === 'green'
    ? 'rgba(52,211,153,0.18)'
    : tone === 'blue'
      ? 'rgba(147,197,253,0.16)'
      : 'rgba(255,255,255,0.08)';
  const background = tone === 'green'
    ? 'rgba(52,211,153,0.045)'
    : tone === 'blue'
      ? 'rgba(96,165,250,0.035)'
      : 'rgba(255,255,255,0.03)';
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 8,
        border: `1px solid ${copied ? 'rgba(52,211,153,0.35)' : border}`,
        background: copied ? 'rgba(52,211,153,0.08)' : background,
        padding: '10px 12px',
        transition: 'border-color 0.2s',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color, fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
          <div style={{ color: '#8b8b8b', fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{description}</div>
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

export function AccessPointsListPanel({
  entries,
  providerIcons,
  expandedEndpointId,
  onClose,
  onEndpointClick,
  onEndpointHover,
}: {
  entries: EndpointEntry[];
  providerIcons: ProviderIconLookup;
  expandedEndpointId?: string | null;
  onClose: () => void;
  onEndpointClick: (ep: SyncEndpointInfo, nodeId: string) => void;
  onEndpointHover?: (nodeId: string | null) => void;
}) {
  const [hoveredEndpoint, setHoveredEndpoint] = useState<string | null>(null);
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(expandedEndpointId ?? null);

  useEffect(() => {
    if (expandedEndpointId) setExpandedEndpoint(expandedEndpointId);
  }, [expandedEndpointId]);

  return (
    <PanelShell
      title="Access Points"
      onClose={onClose}
      headerRight={
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 6px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            color: '#a1a1aa',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {entries.length}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {entries.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#71717a', fontSize: 13, lineHeight: 1.6 }}>
              Access points created from folder link buttons will appear here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entries.map(({ ep, nodeId, name, nodeName }) => {
                const hovered = hoveredEndpoint === ep.syncId;
                const expanded = expandedEndpoint === ep.syncId;
                const scopeName = nodeName || (nodeId ? nodeId : 'Root');
                const setup = getSetupSnippets(ep, name, scopeName);
                return (
                  <div
                    key={`access-panel-${ep.syncId}`}
                    onMouseEnter={() => {
                      setHoveredEndpoint(ep.syncId);
                      ensureExpandedBatch(getAncestorPaths(nodeId));
                      onEndpointHover?.(nodeId);
                    }}
                    onMouseLeave={() => {
                      setHoveredEndpoint(null);
                      onEndpointHover?.(null);
                    }}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid',
                      borderColor: expanded || hovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                      background: expanded ? 'rgba(255,255,255,0.04)' : hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedEndpoint(expanded ? null : ep.syncId)}
                      style={{
                      display: 'flex',
                      alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '8px 10px',
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        overflow: 'hidden',
                      }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        background: 'transparent',
                        flexShrink: 0,
                      }}>
                        <AccessPointProviderIcon ep={ep} providerIcons={providerIcons} />
                        <StatusDot status={ep.status} />
                      </div>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{
                          fontSize: 13,
                          fontWeight: 500,
                          lineHeight: 1.3,
                          color: hovered || expanded ? '#ffffff' : '#e4e4e7',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          transition: 'color 0.15s',
                        }}>
                          {name}
                        </span>
                        <span style={{
                          marginTop: 1,
                          fontSize: 12,
                          lineHeight: 1.3,
                          color: hovered ? '#34d399' : '#71717a',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          Scope: {scopeName}
                        </span>
                      </span>
                      <div style={{ color: hovered || expanded ? '#71717a' : '#3f3f46', transition: 'color 0.15s, transform 0.15s', flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </button>

                    {expanded && (
                      <div style={{ padding: '0 10px 10px 52px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
                          <InfoPill label="Status" value={formatStatus(ep.status)} />
                          <InfoPill label="Scope" value={scopeName} />
                          <InfoPill label="Mode" value={formatDirection(ep.direction)} />
                          <InfoPill label="Key" value={maskSecret(ep.accessKey || ep.syncId)} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ color: '#71717a', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Copy Prompt
                          </div>
                          <CopyPromptButton
                            title={setup.primary.title}
                            description={setup.primary.description}
                            prompt={setup.primary.body}
                            tone={ep.provider === 'filesystem' ? 'green' : 'neutral'}
                          />
                          {setup.secondary && (
                            <CopyPromptButton
                              title={setup.secondary.title}
                              description={setup.secondary.description}
                              prompt={setup.secondary.body}
                              tone="blue"
                            />
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => onEndpointClick(ep, nodeId)}
                            style={{
                              height: 26,
                              padding: '0 10px',
                              borderRadius: 6,
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: '#242424',
                              color: '#e4e4e7',
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            View details
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
