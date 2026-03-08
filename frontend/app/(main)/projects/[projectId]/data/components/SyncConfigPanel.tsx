'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { SyncDetailView } from '@/components/agent/views/SyncDetailView';
import { ChatAgentConfig, type AgentConfigProps } from '@/components/agent/views/configs/ChatAgentConfig';
import { OpenClawAgentConfig } from '@/components/agent/views/configs/OpenClawAgentConfig';
import { SaaSyncConfig, type SaaSConfigField } from '@/components/agent/views/configs/SaaSyncConfig';
import type { AcceptedNodeType } from '@/components/agent/views/configs/SyncPreview';
import { SyncPreview } from '@/components/agent/views/configs/SyncPreview';
import { PanelShell } from './PanelShell';
import type { SaasType } from '@/lib/oauthApi';

/* ================================================================
   Types
   ================================================================ */

type SyncProviderId =
  | 'filesystem' | 'gmail' | 'google_calendar' | 'google_sheets'
  | 'google_docs' | 'github' | 'url'
  | 'google_search_console';

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
    id: 'filesystem', label: 'Desktop Folder', description: 'Folder-to-PuppyOne sync via desktop CLI',
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
    oauthType: 'github', requiresAuth: true, direction: 'inbound', accept: ['json', 'folder'],
    configFields: [
      { key: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo' },
      { key: 'content_type', label: 'Content type', type: 'select', options: [
        { value: 'issues', label: 'Issues' }, { value: 'pulls', label: 'Pull Requests' },
        { value: 'code', label: 'Code' },
      ] },
    ],
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

const AGENT_CONFIG_MAP: Record<AgentTypeId, React.ComponentType<AgentConfigProps>> = {
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
      <SyncDetailView syncId={syncId} projectId={projectId} onClose={onClose} />
    );
  }

  return <CreateView projectId={projectId} onClose={onClose} onSyncCreated={onSyncCreated} />;
}

/* ================================================================
   PanelHeader
   ================================================================ */

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

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    inbound: true,
    bidirectional: false,
    outbound: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

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

      if (providerDef.id === 'filesystem') {
        await deploySyncEndpoint({
          provider: 'filesystem',
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
      <PanelShell title="Chat Agent" onClose={onClose} onBack={handleBack}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>
            <SyncPreview
              provider="agent"
              providerLabel="Chat Agent"
              direction="outbound"
              targetName={draftResources[0]?.nodeName || null}
              targetType={(draftResources[0]?.nodeType as AcceptedNodeType) || 'folder'}
              isActive={draftResources.length > 0}
            />
            <div style={{ marginBottom: 12, marginTop: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 6, display: 'block' }}>Name</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Chat Agent"
                style={{
                  width: '100%', height: 36, padding: '0 12px', fontSize: 13, background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                  outline: 'none', transition: 'border-color 0.2s'
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
              />
            </div>
            <ConfigComponent />
          </div>
          
          <div style={{ 
            padding: '12px', 
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: '#09090b',
            flexShrink: 0
          }}>
            <button
              onClick={handleAgentDeploy}
              disabled={deploying || draftResources.length === 0}
              style={{
                width: '100%', height: 36,
                background: (deploying || draftResources.length === 0) ? '#27272a' : '#3b82f6',
                color: (deploying || draftResources.length === 0) ? '#71717a' : '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {deploying ? 'Creating...' : 'Create agent'}
            </button>
          </div>
        </div>
      </PanelShell>
    );
  }

  // If an endpoint type is selected (MCP / Sandbox), show config
  if (selectedEndpointType) {
    const endpointDef = ENDPOINT_OPTIONS.find(e => e.id === selectedEndpointType)!;
    return (
      <PanelShell title={endpointDef.label} onClose={onClose} onBack={handleBack}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>
            <SyncPreview
              provider={selectedEndpointType === 'mcp' ? 'mcp' : 'sandbox'}
              providerLabel={endpointDef.label}
              direction="bidirectional"
              targetName={draftResources[0]?.nodeName || null}
              targetType={(draftResources[0]?.nodeType as AcceptedNodeType) || 'folder'}
              isActive={draftResources.length > 0}
            />
            <div style={{ marginBottom: 12, marginTop: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 6, display: 'block' }}>Name</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={endpointDef.label}
                style={{
                  width: '100%', height: 36, padding: '0 12px', fontSize: 13, background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#e4e4e7',
                  outline: 'none', transition: 'border-color 0.2s'
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
              />
            </div>
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {endpointDef.icon}
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{endpointDef.label}</span>
              </div>
              <p style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.5, margin: 0 }}>
                {selectedEndpointType === 'mcp'
                  ? 'Creates a Model Context Protocol endpoint. Configure tool bindings and node access from the detail page after creation.'
                  : 'Creates an isolated sandbox environment. Configure mounted nodes and execution permissions from the detail page after creation.'}
              </p>
            </div>
            <ChatAgentConfig />
          </div>
          
          <div style={{ 
            padding: '12px', 
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: '#09090b',
            flexShrink: 0
          }}>
            <button
              onClick={handleEndpointDeploy}
              disabled={deploying || draftResources.length === 0}
              style={{
                width: '100%', height: 36,
                background: (deploying || draftResources.length === 0) ? '#27272a' : '#3b82f6',
                color: (deploying || draftResources.length === 0) ? '#71717a' : '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {deploying ? 'Creating...' : `Create ${endpointDef.label.toLowerCase()}`}
            </button>
          </div>
        </div>
      </PanelShell>
    );
  }

  // If a sync provider is selected, show config
  if (selectedSyncProvider) {
    const providerDef = SYNC_PROVIDERS.find(p => p.id === selectedSyncProvider)!;

    if (providerDef.id === 'filesystem') {
      return (
        <PanelShell title={providerDef.label} onClose={onClose} onBack={handleBack}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>
              <SyncPreview
                provider="filesystem"
                providerLabel="Desktop Folder"
                direction="bidirectional"
                targetName={draftResources[0]?.nodeName || null}
                targetType="folder"
                isActive={draftResources.length > 0}
              />
              <div style={{ marginTop: 12 }}>
                <OpenClawAgentConfig />
              </div>
            </div>
            
            <div style={{ 
              padding: '12px', 
              borderTop: '1px solid rgba(255,255,255,0.06)',
              background: '#09090b',
              flexShrink: 0
            }}>
              <button
                onClick={handleSyncDeploy}
                disabled={deploying || draftResources.length === 0}
                style={{
                  width: '100%', height: 36,
                  background: (deploying || draftResources.length === 0) ? '#27272a' : '#3b82f6',
                  color: (deploying || draftResources.length === 0) ? '#71717a' : '#fff',
                  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {deploying ? 'Creating...' : 'Create connection'}
              </button>
            </div>
          </div>
        </PanelShell>
      );
    }

  return (
    <PanelShell title={providerDef.label} onClose={onClose} onBack={handleBack}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {providerDef.configFields.map(field => (
                <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{field.label}</label>
                  {field.type === 'select' && field.options ? (
                    <div style={{ position: 'relative' }}>
                      <select
                        value={syncConfigValues[field.key] || field.defaultValue || ''}
                        onChange={e => setSyncConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                        style={{
                          width: '100%', height: 36, padding: '0 12px', fontSize: 13,
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 6, color: '#e4e4e7', outline: 'none', appearance: 'none',
                          cursor: 'pointer', transition: 'border-color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      >
                        <option value="">Select...</option>
                        {field.options.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: 12, top: 15, pointerEvents: 'none' }}>
                        <path d="M1 1L5 5L9 1" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <input
                      value={syncConfigValues[field.key] || ''}
                      onChange={e => setSyncConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder || ''}
                      style={{
                        width: '100%', height: 36, padding: '0 12px', fontSize: 13,
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 6, color: '#e4e4e7', outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                      onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div style={{ 
          padding: '12px', 
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#09090b', // Match panel background to prevent transparency issues when scrolling
          flexShrink: 0
        }}>
          <button
            onClick={handleSyncDeploy}
            disabled={deploying || draftResources.length === 0}
            style={{
              width: '100%', height: 36,
              background: (deploying || draftResources.length === 0) ? '#27272a' : '#3b82f6',
              color: (deploying || draftResources.length === 0) ? '#71717a' : '#fff',
              border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
              cursor: (deploying || draftResources.length === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {deploying ? 'Creating...' : 'Create connection'}
          </button>
        </div>
      </div>
    </PanelShell>
    );
  }

  // Categorize sync providers by data flow
  const inboundProviders = SYNC_PROVIDERS.filter(p =>
    ['gmail', 'google_calendar', 'google_sheets', 'google_docs', 'google_search_console', 'url', 'github'].includes(p.id)
  );
  const bidirectionalProviders = SYNC_PROVIDERS.filter(p =>
    ['filesystem'].includes(p.id)
  );

  // Default: show provider picker
  return (
    <PanelShell title="New connection" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Inbound */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <DirectionalSectionLabel 
              type="inbound" 
              title="Import to PuppyOne" 
              isExpanded={expandedSections.inbound}
              onClick={() => toggleSection('inbound')}
            />
            {expandedSections.inbound && (
              <div style={{ 
                display: 'flex', flexDirection: 'column', gap: 2, 
                paddingLeft: 38, 
                paddingBottom: 12,
                paddingTop: 4
              }}>
                {inboundProviders.map(p => (
                  <ProviderRow key={p.id} icon={p.icon} label={p.label} description={p.description}
                    onClick={() => handleSelectSyncProvider(p.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Bidirectional */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <DirectionalSectionLabel 
              type="bidirectional" 
              title="Two-way Workspace Sync" 
              isExpanded={expandedSections.bidirectional}
              onClick={() => toggleSection('bidirectional')}
            />
            {expandedSections.bidirectional && (
              <div style={{ 
                display: 'flex', flexDirection: 'column', gap: 2, 
                paddingLeft: 38, 
                paddingBottom: 12,
                paddingTop: 4
              }}>
                {bidirectionalProviders.map(p => (
                  <ProviderRow key={p.id} icon={p.icon} label={p.label} description={p.description}
                    onClick={() => handleSelectSyncProvider(p.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Outbound / AI Endpoints */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <DirectionalSectionLabel 
              type="outbound" 
              title="AI Data Access" 
              isExpanded={expandedSections.outbound}
              onClick={() => toggleSection('outbound')}
            />
            {expandedSections.outbound && (
              <div style={{ 
                display: 'flex', flexDirection: 'column', gap: 2, 
                paddingLeft: 38, 
                paddingBottom: 12,
                paddingTop: 4
              }}>
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
            )}
          </div>

        </div>
      </div>
    </PanelShell>
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

function DirectionalSectionLabel({ type, title, isExpanded, onClick }: { 
  type: 'inbound' | 'bidirectional' | 'outbound', 
  title: string, 
  isExpanded: boolean,
  onClick: () => void 
}) {
  const [hovered, setHovered] = useState(false);
  let iconContent;

  if (type === 'inbound') {
    iconContent = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;
  } else if (type === 'bidirectional') {
    iconContent = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>;
  } else {
    iconContent = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>;
  }

  // Capitalize title
  const displayTitle = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();

  return (
    <button 
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ 
        display: 'flex', alignItems: 'center', width: '100%', gap: 12,
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none', cursor: 'pointer',
        padding: '8px 8px', textAlign: 'left',
        borderRadius: 6,
        transition: 'background 0.15s ease',
        marginLeft: '-8px' // Offset the padding to keep alignment
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0
      }}>
        <div style={{ 
          color: hovered ? '#a1a1aa' : '#71717a', display: 'flex', 
          transition: 'all 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          opacity: isExpanded ? 0.8 : 0.5 
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div style={{ 
          color: (isExpanded || hovered) ? '#e4e4e7' : '#71717a', 
          display: 'flex', transition: 'all 0.2s' 
        }}>
          {iconContent}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 500, 
          color: (isExpanded || hovered) ? '#e4e4e7' : '#71717a', 
          transition: 'color 0.2s'
        }}>
          {displayTitle}
        </div>
      </div>
      <div style={{ 
        flex: 1, 
        height: '1px', 
        backgroundColor: (isExpanded || hovered) ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        transition: 'background-color 0.2s'
      }} />
    </button>
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
        <div style={{ fontSize: 13, fontWeight: hovered ? 500 : 400, color: hovered ? '#ffffff' : '#e4e4e7', transition: 'all 0.15s', lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {description}
        </div>
      </div>
    </button>
  );
}
