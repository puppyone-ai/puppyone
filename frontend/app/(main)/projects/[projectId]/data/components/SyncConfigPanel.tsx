'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { SyncDetailView } from '@/components/agent/views/SyncDetailView';
import { ChatAgentConfig } from '@/components/agent/views/configs/ChatAgentConfig';
import { OpenClawAgentConfig } from '@/components/agent/views/configs/OpenClawAgentConfig';
import { SaaSyncConfig, type SaaSConfigField } from '@/components/agent/views/configs/SaaSyncConfig';
import type { AcceptedNodeType } from '@/components/agent/views/configs/SyncPreview';
import type { SaasType } from '@/lib/oauthApi';

/* ================================================================
   Types
   ================================================================ */

type SyncProviderId =
  | 'openclaw' | 'gmail' | 'google_calendar' | 'google_sheets'
  | 'google_docs' | 'github' | 'notion' | 'linear' | 'url'
  | 'hackernews' | 'posthog' | 'google_search_console' | 'script';

type AgentTypeId = 'chat';

interface SyncProviderDef {
  id: SyncProviderId;
  label: string;
  description: string;
  icon: React.ReactNode;
  oauthType: SaasType;
  requiresAuth?: boolean;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  accept: AcceptedNodeType[];
  configFields: SaaSConfigField[];
}

type EndpointTypeId = 'mcp' | 'sandbox';

interface AgentOptionDef {
  id: AgentTypeId;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface EndpointOptionDef {
  id: EndpointTypeId;
  label: string;
  description: string;
  icon: React.ReactNode;
}

/* ================================================================
   Provider & Agent Definitions
   ================================================================ */

const AGENT_OPTIONS: AgentOptionDef[] = [
  { id: 'chat', label: 'Chat Agent', description: 'Interactive AI assistant with data access', icon: <span style={{ fontSize: 14 }}>💬</span> },
];

const ENDPOINT_OPTIONS: EndpointOptionDef[] = [
  { id: 'mcp', label: 'MCP Server', description: 'Model Context Protocol endpoint', icon: <McpMini /> },
  { id: 'sandbox', label: 'Sandbox', description: 'Isolated script execution environment', icon: <SandboxMini /> },
];

const SYNC_PROVIDERS: SyncProviderDef[] = [
  {
    id: 'openclaw', label: 'Desktop Folder', description: 'Folder-to-PuppyOne sync via desktop CLI',
    icon: <span style={{ fontSize: 14 }}>🦞</span>,
    oauthType: 'notion' as SaasType, direction: 'bidirectional', accept: ['folder'],
    configFields: [],
  },
  {
    id: 'gmail', label: 'Gmail', description: 'Sync emails to JSON',
    icon: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png" />,
    oauthType: 'gmail', requiresAuth: true, direction: 'inbound', accept: ['json'],
    configFields: [
      { key: 'label_filter', label: 'Label filter', type: 'text', placeholder: 'INBOX' },
      { key: 'max_results', label: 'Max results', type: 'text', placeholder: '50' },
    ],
  },
  {
    id: 'google_calendar', label: 'Google Calendar', description: 'Sync calendar events',
    icon: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png" />,
    oauthType: 'google_calendar', requiresAuth: true, direction: 'inbound', accept: ['json'],
    configFields: [],
  },
  {
    id: 'google_sheets', label: 'Google Sheets', description: 'Sync spreadsheet data',
    icon: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" />,
    oauthType: 'google_sheets', requiresAuth: true, direction: 'inbound', accept: ['json'],
    configFields: [
      { key: 'spreadsheet_id', label: 'Spreadsheet ID', type: 'text', placeholder: 'From the sheet URL' },
    ],
  },
  {
    id: 'google_docs', label: 'Google Docs', description: 'Sync documents',
    icon: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png" />,
    oauthType: 'google_docs', requiresAuth: true, direction: 'inbound', accept: ['markdown'],
    configFields: [],
  },
  {
    id: 'github', label: 'GitHub', description: 'Sync repos, issues, or PRs',
    icon: <GitHubMini />,
    oauthType: 'github', requiresAuth: true, direction: 'bidirectional', accept: ['json', 'folder'],
    configFields: [
      { key: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo' },
      { key: 'content_type', label: 'Content type', type: 'select', options: [
        { value: 'issues', label: 'Issues' }, { value: 'pulls', label: 'Pull Requests' },
        { value: 'code', label: 'Code' },
      ] },
    ],
  },
  {
    id: 'notion', label: 'Notion', description: 'Sync Notion pages and databases',
    icon: <ProviderImg src="https://www.notion.so/images/favicon.ico" />,
    oauthType: 'notion', requiresAuth: true, direction: 'bidirectional', accept: ['json', 'markdown'],
    configFields: [],
  },
  {
    id: 'linear', label: 'Linear', description: 'Sync Linear issues',
    icon: <LinearMini />,
    oauthType: 'linear', requiresAuth: true, direction: 'inbound', accept: ['json'],
    configFields: [],
  },
  {
    id: 'url', label: 'Web Page', description: 'Import content from a URL',
    icon: <span style={{ fontSize: 14 }}>🌐</span>,
    oauthType: 'notion' as SaasType, direction: 'inbound', accept: ['markdown'],
    configFields: [
      { key: 'source_url', label: 'URL', type: 'text', placeholder: 'https://example.com/page' },
    ],
  },
  {
    id: 'hackernews', label: 'Hacker News', description: 'Pull top/new/best stories from HN',
    icon: <span style={{ fontSize: 14 }}>🟠</span>,
    oauthType: 'notion' as SaasType, direction: 'inbound', accept: ['json'],
    configFields: [
      { key: 'feed_type', label: 'Feed type', type: 'select', options: [
        { value: 'topstories', label: 'Top Stories' }, { value: 'newstories', label: 'New Stories' },
        { value: 'beststories', label: 'Best Stories' }, { value: 'askstories', label: 'Ask HN' },
        { value: 'showstories', label: 'Show HN' },
      ], defaultValue: 'topstories' },
      { key: 'limit', label: 'Max stories', type: 'text', placeholder: '30' },
    ],
  },
  {
    id: 'posthog', label: 'PostHog', description: 'Sync events, persons, or insights',
    icon: <span style={{ fontSize: 14 }}>🦔</span>,
    oauthType: 'notion' as SaasType, direction: 'inbound', accept: ['json'],
    configFields: [
      { key: 'api_key', label: 'Personal API Key', type: 'text', placeholder: 'phx_...' },
      { key: 'project_id', label: 'PostHog Project ID', type: 'text', placeholder: '12345' },
      { key: 'host', label: 'PostHog Host', type: 'text', placeholder: 'https://app.posthog.com' },
      { key: 'mode', label: 'Data to sync', type: 'select', options: [
        { value: 'events', label: 'Recent Events' }, { value: 'persons', label: 'Persons' },
        { value: 'insights', label: 'Saved Insights' },
      ], defaultValue: 'events' },
      { key: 'limit', label: 'Max records', type: 'text', placeholder: '100' },
    ],
  },
  {
    id: 'google_search_console', label: 'Google Search Console', description: 'Sync search performance data',
    icon: <span style={{ fontSize: 14 }}>📊</span>,
    oauthType: 'google_docs' as SaasType, requiresAuth: true, direction: 'inbound', accept: ['json'],
    configFields: [
      { key: 'site_url', label: 'Site URL', type: 'text', placeholder: 'https://example.com' },
      { key: 'date_range', label: 'Date range', type: 'select', options: [
        { value: '7d', label: 'Last 7 days' }, { value: '28d', label: 'Last 28 days' },
        { value: '90d', label: 'Last 3 months' },
      ], defaultValue: '7d' },
      { key: 'dimensions', label: 'Dimensions', type: 'select', options: [
        { value: 'query', label: 'Queries' }, { value: 'page', label: 'Pages' },
        { value: 'query,page', label: 'Queries + Pages' }, { value: 'country', label: 'Countries' },
      ], defaultValue: 'query' },
      { key: 'row_limit', label: 'Max rows', type: 'text', placeholder: '500' },
    ],
  },
  {
    id: 'script', label: 'Custom Script', description: 'Run your own script in a sandbox',
    icon: <span style={{ fontSize: 14 }}>📜</span>,
    oauthType: 'notion' as SaasType, direction: 'inbound', accept: ['json', 'markdown'],
    configFields: [
      { key: 'runtime', label: 'Runtime', type: 'select', options: [
        { value: 'python', label: 'Python 3' }, { value: 'node', label: 'Node.js' },
        { value: 'shell', label: 'Shell (bash)' },
      ], defaultValue: 'python' },
      { key: 'script_content', label: 'Script', type: 'text', placeholder: 'Paste script or use CLI: puppyone connect script --file ./my-script.py' },
      { key: 'timeout', label: 'Timeout (seconds)', type: 'text', placeholder: '60' },
    ],
  },
];

/* ================================================================
   Mini Icon Components
   ================================================================ */

function ProviderImg({ src }: { src: string }) {
  return <img src={src} alt="" width={16} height={16} style={{ display: 'block', borderRadius: 2 }} />;
}

function GitHubMini() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="#fff">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function LinearMini() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <path d="M3.75 12.5l7.75 7.75c-4.28-.33-7.7-3.75-8.03-8.03l.28.28z" fill="#5E6AD2" />
      <path d="M5.37 18.63l-.53-.53c-1.09-1.09-1.88-2.43-2.3-3.9l6.73 6.73c-1.47-.42-2.81-1.21-3.9-2.3z" fill="#5E6AD2" />
      <path d="M8.4 21.2l-1.03-1.03 13.56-13.56c.22.66.37 1.35.44 2.06L8.4 21.2z" fill="#5E6AD2" />
      <path d="M20.97 11.5l-9.47 9.47c-.7-.07-1.4-.22-2.06-.44L21.37 8.6c.3.92.49 1.88.56 2.87l-.96.03z" fill="#5E6AD2" />
    </svg>
  );
}

function McpMini() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SandboxMini() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/* ================================================================
   Config map for agent types
   ================================================================ */

const AGENT_CONFIG_MAP: Record<AgentTypeId, React.ComponentType<{ projectTools?: unknown[] }>> = {
  chat: ChatAgentConfig,
};

/* ================================================================
   SyncConfigPanel
   ================================================================ */

interface SyncConfigPanelProps {
  mode: 'create' | 'detail';
  syncId: string | null;
  projectId: string;
  onClose: () => void;
  onSyncCreated?: (nodeId: string) => void;
}

export function SyncConfigPanel({ mode, syncId, projectId, onClose, onSyncCreated }: SyncConfigPanelProps) {
  if (mode === 'detail' && syncId) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title="Connection details" onClose={onClose} />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SyncDetailView syncId={syncId} projectId={projectId} />
        </div>
      </div>
    );
  }

  return <CreateView projectId={projectId} onClose={onClose} onSyncCreated={onSyncCreated} />;
}

/* ================================================================
   PanelHeader
   ================================================================ */

function PanelHeader({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div style={{
      height: 40, minHeight: 40, display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer',
          padding: '2px 4px', fontSize: 13, display: 'flex', alignItems: 'center',
        }}>
          ←
        </button>
      )}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{title}</span>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
        padding: '2px 6px', fontSize: 16, lineHeight: 1,
      }}>
        ×
      </button>
    </div>
  );
}

/* ================================================================
   CreateView — unified creation panel for agents & syncs
   ================================================================ */

function CreateView({ projectId, onClose, onSyncCreated }: {
  projectId: string;
  onClose: () => void;
  onSyncCreated?: (nodeId: string) => void;
}) {
  const {
    deployAgent, deploySyncEndpoint, setDraftType, draftResources,
    pendingSyncProvider, setDraftResources,
    draftSyncMode, setDraftSyncMode,
  } = useAgent();

  const [selectedAgentType, setSelectedAgentType] = useState<AgentTypeId | null>(null);
  const [selectedEndpointType, setSelectedEndpointType] = useState<EndpointTypeId | null>(null);
  const [selectedSyncProvider, setSelectedSyncProvider] = useState<SyncProviderId | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [syncConfigValues, setSyncConfigValues] = useState<Record<string, string>>({});

  // Auto-select if pendingSyncProvider is set
  useEffect(() => {
    if (pendingSyncProvider) {
      const found = SYNC_PROVIDERS.find(p => p.id === pendingSyncProvider);
      if (found) {
        setSelectedSyncProvider(found.id);
        setSelectedAgentType(null);
      }
    }
  }, [pendingSyncProvider]);

  const handleSelectAgentType = (type: AgentTypeId) => {
    setSelectedAgentType(type);
    setSelectedEndpointType(null);
    setSelectedSyncProvider(null);
    setDraftType('chat');
    setDraftResources([]);
    setDisplayName('');
  };

  const handleSelectEndpointType = (type: EndpointTypeId) => {
    setSelectedEndpointType(type);
    setSelectedAgentType(null);
    setSelectedSyncProvider(null);
    setDraftResources([]);
    setDisplayName('');
  };

  const handleSelectSyncProvider = (id: SyncProviderId) => {
    setSelectedSyncProvider(id);
    setSelectedAgentType(null);
    setSelectedEndpointType(null);
    setDraftResources([]);
    setSyncConfigValues({});
    setDisplayName('');
  };

  const handleBack = () => {
    setSelectedAgentType(null);
    setSelectedEndpointType(null);
    setSelectedSyncProvider(null);
    setDraftResources([]);
    setSyncConfigValues({});
    setDisplayName('');
  };

  // Deploy agent
  const handleAgentDeploy = useCallback(async () => {
    if (!selectedAgentType || deploying) return;
    setDeploying(true);
    try {
      const name = displayName.trim() || 'Chat Agent';
      deployAgent(name, '💬');
      onClose();
    } finally {
      setDeploying(false);
    }
  }, [selectedAgentType, displayName, deploying, deployAgent, onClose]);

  // Deploy endpoint (MCP / Sandbox)
  const handleEndpointDeploy = useCallback(async () => {
    if (!selectedEndpointType || deploying) return;
    setDeploying(true);
    try {
      const name = displayName.trim() || (selectedEndpointType === 'mcp' ? 'MCP Server' : 'Sandbox');
      await deploySyncEndpoint({
        provider: selectedEndpointType,
        direction: 'bidirectional',
        config: { name },
        uiMode: 'inline',
      });
      onClose();
    } catch (err) {
      console.error('Failed to create endpoint:', err);
    } finally {
      setDeploying(false);
    }
  }, [selectedEndpointType, displayName, deploying, deploySyncEndpoint, onClose]);

  // Deploy sync
  const handleSyncDeploy = useCallback(async () => {
    if (!selectedSyncProvider || deploying) return;
    const providerDef = SYNC_PROVIDERS.find(p => p.id === selectedSyncProvider);
    if (!providerDef) return;

    setDeploying(true);
    try {
      const target = draftResources[0];
      if (!target && providerDef.id !== 'url') return;

      const config: Record<string, unknown> = { ...syncConfigValues };

      if (providerDef.id === 'openclaw') {
        await deploySyncEndpoint({
          provider: 'openclaw',
          direction: 'bidirectional',
          config,
          uiMode: 'inline',
        });
      } else if (providerDef.id === 'url') {
        await deploySyncEndpoint({
          provider: 'url',
          direction: 'inbound',
          config,
          syncMode: draftSyncMode as 'import_once' | 'manual' | 'scheduled',
          uiMode: 'inline',
        });
      } else {
        await deploySyncEndpoint({
          provider: providerDef.id,
          direction: providerDef.direction,
          config,
          syncMode: draftSyncMode as 'import_once' | 'manual' | 'scheduled',
          uiMode: 'inline',
        });
      }

      if (target && onSyncCreated) {
        onSyncCreated(target.nodeId);
      }
      onClose();
    } catch (err) {
      console.error('Failed to create sync:', err);
    } finally {
      setDeploying(false);
    }
  }, [selectedSyncProvider, deploying, draftResources, syncConfigValues, draftSyncMode, deploySyncEndpoint, onSyncCreated, onClose]);

  // If an agent type is selected, show config
  if (selectedAgentType) {
    const ConfigComponent = AGENT_CONFIG_MAP[selectedAgentType];
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title="Chat Agent" onClose={onClose} onBack={handleBack} />
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 40px' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 4, display: 'block' }}>Name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Chat Agent"
              style={{
                width: '100%', padding: '6px 10px', fontSize: 13, background: '#1a1a1c',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                outline: 'none',
              }}
            />
          </div>
          <ConfigComponent />
          <div style={{ marginTop: 16 }}>
            <button
              onClick={handleAgentDeploy}
              disabled={deploying}
              style={{
                width: '100%', height: 32, background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                cursor: deploying ? 'not-allowed' : 'pointer',
                opacity: deploying ? 0.6 : 1,
              }}
            >
              {deploying ? 'Creating...' : 'Create agent'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If an endpoint type is selected (MCP / Sandbox), show config
  if (selectedEndpointType) {
    const endpointDef = ENDPOINT_OPTIONS.find(e => e.id === selectedEndpointType)!;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title={endpointDef.label} onClose={onClose} onBack={handleBack} />
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 40px' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 4, display: 'block' }}>Name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={endpointDef.label}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 13, background: '#1a1a1c',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ padding: '12px', background: '#141414', border: '1px solid #252525', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {endpointDef.icon}
              <span style={{ fontSize: 12, fontWeight: 500, color: '#a1a1aa' }}>{endpointDef.label}</span>
            </div>
            <p style={{ fontSize: 12, color: '#525252', lineHeight: 1.5, margin: 0 }}>
              {selectedEndpointType === 'mcp'
                ? 'Creates a Model Context Protocol endpoint. Configure tool bindings and node access from the detail page after creation.'
                : 'Creates an isolated sandbox environment. Configure mounted nodes and execution permissions from the detail page after creation.'}
            </p>
          </div>
          <ChatAgentConfig />
          <div style={{ marginTop: 16 }}>
            <button
              onClick={handleEndpointDeploy}
              disabled={deploying || draftResources.length === 0}
              style={{
                width: '100%', height: 32, background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (deploying || draftResources.length === 0) ? 0.6 : 1,
              }}
            >
              {deploying ? 'Creating...' : `Create ${endpointDef.label.toLowerCase()}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If a sync provider is selected, show config
  if (selectedSyncProvider) {
    const providerDef = SYNC_PROVIDERS.find(p => p.id === selectedSyncProvider)!;

    if (providerDef.id === 'openclaw') {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <PanelHeader title={providerDef.label} onClose={onClose} onBack={handleBack} />
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 40px' }}>
            <OpenClawAgentConfig />
            <div style={{ marginTop: 16 }}>
              <button
                onClick={handleSyncDeploy}
                disabled={deploying || draftResources.length === 0}
                style={{
                  width: '100%', height: 32, background: '#3b82f6', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (deploying || draftResources.length === 0) ? 0.6 : 1,
                }}
              >
                {deploying ? 'Creating...' : 'Create connection'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PanelHeader title={providerDef.label} onClose={onClose} onBack={handleBack} />
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 40px' }}>
          <SaaSyncConfig
            provider={providerDef.id}
            providerLabel={providerDef.label}
            oauthType={providerDef.oauthType}
            requiresAuth={providerDef.requiresAuth ?? false}
            icon={providerDef.icon}
            description={providerDef.description}
            configFields={providerDef.configFields}
            accept={providerDef.accept}
            direction={providerDef.direction}
          />
          {providerDef.configFields.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {providerDef.configFields.map(field => (
                <div key={field.key}>
                  <label style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 4, display: 'block' }}>{field.label}</label>
                  {field.type === 'select' && field.options ? (
                    <select
                      value={syncConfigValues[field.key] || field.defaultValue || ''}
                      onChange={e => setSyncConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: 13, background: '#1a1a1c',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                      }}
                    >
                      <option value="">Select...</option>
                      {field.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={syncConfigValues[field.key] || ''}
                      onChange={e => setSyncConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder || ''}
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: 13, background: '#1a1a1c',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                        outline: 'none',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button
              onClick={handleSyncDeploy}
              disabled={deploying}
              style={{
                width: '100%', height: 32, background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                cursor: deploying ? 'not-allowed' : 'pointer',
                opacity: deploying ? 0.6 : 1,
              }}
            >
              {deploying ? 'Creating...' : 'Create connection'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Categorize sync providers
  const googleProviders = SYNC_PROVIDERS.filter(p =>
    ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_search_console'].includes(p.id)
  );
  const devProviders = SYNC_PROVIDERS.filter(p =>
    ['github', 'notion', 'linear'].includes(p.id)
  );
  const dataProviders = SYNC_PROVIDERS.filter(p =>
    ['openclaw', 'url', 'hackernews', 'posthog', 'script'].includes(p.id)
  );

  // Default: show provider picker
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader title="New connection" onClose={onClose} />
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 40px' }}>
        {/* Agents & Endpoints */}
        <SectionLabel>Agent & Endpoints</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
          {AGENT_OPTIONS.map(opt => (
            <ProviderRow
              key={opt.id}
              icon={opt.icon}
              label={opt.label}
              description={opt.description}
              onClick={() => handleSelectAgentType(opt.id)}
            />
          ))}
          {ENDPOINT_OPTIONS.map(opt => (
            <ProviderRow
              key={opt.id}
              icon={opt.icon}
              label={opt.label}
              description={opt.description}
              onClick={() => handleSelectEndpointType(opt.id)}
            />
          ))}
        </div>

        {/* Google */}
        <SectionLabel>Google</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
          {googleProviders.map(p => (
            <ProviderRow key={p.id} icon={p.icon} label={p.label} description={p.description}
              onClick={() => handleSelectSyncProvider(p.id)} />
          ))}
        </div>

        {/* Dev & Productivity */}
        <SectionLabel>Productivity</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
          {devProviders.map(p => (
            <ProviderRow key={p.id} icon={p.icon} label={p.label} description={p.description}
              onClick={() => handleSelectSyncProvider(p.id)} />
          ))}
        </div>

        {/* Data Sources */}
        <SectionLabel>Data Sources</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {dataProviders.map(p => (
            <ProviderRow key={p.id} icon={p.icon} label={p.label} description={p.description}
              onClick={() => handleSelectSyncProvider(p.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Shared UI Atoms
   ================================================================ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase',
      letterSpacing: '0.04em', marginBottom: 6, padding: '0 4px',
    }}>
      {children}
    </div>
  );
}

function ProviderRow({ icon, label, description, onClick }: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: 'none', borderRadius: 6, cursor: 'pointer', width: '100%',
        textAlign: 'left', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.04)', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {description}
        </div>
      </div>
    </button>
  );
}
