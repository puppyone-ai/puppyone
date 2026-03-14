'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useConnectorSpecs } from '@/lib/hooks/useData';
import { createSyncConnection } from '@/lib/syncApi';

/* ================================================================
   Types
   ================================================================ */

type AgentTypeId = 'chat';

interface SyncProviderDef {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  oauthType?: SaasType;
  requiresAuth: boolean;
  creationMode: 'direct' | 'bootstrap';
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

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  filesystem: <span style={{ fontSize: 14 }}>🦞</span>,
  gmail: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png" />,
  google_calendar: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png" />,
  google_sheets: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" />,
  google_docs: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png" />,
  google_drive: <ProviderImg src="https://www.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" />,
  github: <GitHubMini />,
};

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
    draftSyncMode, setDraftSyncMode, draftTriggerConfig,
  } = useAgent();

  const { specs: connectorSpecs } = useConnectorSpecs();

  const syncProviders = useMemo<SyncProviderDef[]>(() => connectorSpecs.map(spec => ({
    id: spec.provider,
    label: spec.display_name,
    description: spec.description || '',
    icon: PROVIDER_ICONS[spec.provider] || <span style={{ fontSize: 14 }}>{spec.icon || '📄'}</span>,
    oauthType: spec.oauth_ui_type ? spec.oauth_ui_type as SaasType : undefined,
    requiresAuth: spec.auth !== 'none',
    creationMode: spec.creation_mode,
    direction: (spec.supported_directions[0] || 'inbound') as 'inbound' | 'outbound' | 'bidirectional',
    accept: spec.accept_types as AcceptedNodeType[],
    configFields: spec.config_fields.map(f => ({
      key: f.key,
      label: f.label,
      type: (f.type === 'url' ? 'text' : f.type) as 'select' | 'text' | 'number',
      placeholder: f.placeholder || undefined,
      options: f.options || undefined,
      defaultValue: f.default != null ? String(f.default) : undefined,
      required: f.required || undefined,
      hint: f.hint || undefined,
    })),
  })), [connectorSpecs]);

  const [selectedAgentType, setSelectedAgentType] = useState<AgentTypeId | null>(null);
  const [selectedEndpointType, setSelectedEndpointType] = useState<EndpointTypeId | null>(null);
  const [selectedSyncProvider, setSelectedSyncProvider] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
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

  useEffect(() => {
    if (pendingSyncProvider && syncProviders.length > 0) {
      const found = syncProviders.find(p => p.id === pendingSyncProvider);
      if (found) {
        setSelectedSyncProvider(found.id);
        setSelectedAgentType(null);
        const defaults: Record<string, string> = {};
        for (const f of found.configFields) {
          if (f.defaultValue) defaults[f.key] = f.defaultValue;
        }
        setSyncConfigValues(defaults);
      }
    }
  }, [pendingSyncProvider, syncProviders]);

  const handleSelectAgentType = (type: AgentTypeId) => {
    setSelectedAgentType(type);
    setSelectedEndpointType(null);
    setSelectedSyncProvider(null);
    setDraftType('chat');
    setDraftResources([]);
    setDisplayName('');
    setDeployError(null);
  };

  const handleSelectEndpointType = (type: EndpointTypeId) => {
    setSelectedEndpointType(type);
    setSelectedAgentType(null);
    setSelectedSyncProvider(null);
    setDraftResources([]);
    setDisplayName('');
    setDeployError(null);
  };

  const handleSelectSyncProvider = (id: string) => {
    setSelectedSyncProvider(id);
    setSelectedAgentType(null);
    setSelectedEndpointType(null);
    setDraftResources([]);
    setDisplayName('');
    setDeployError(null);
    const provider = syncProviders.find(p => p.id === id);
    const defaults: Record<string, string> = {};
    if (provider) {
      for (const f of provider.configFields) {
        if (f.defaultValue) defaults[f.key] = f.defaultValue;
      }
    }
    setSyncConfigValues(defaults);
  };

  const handleBack = () => {
    setSelectedAgentType(null);
    setSelectedEndpointType(null);
    setSelectedSyncProvider(null);
    setDraftResources([]);
    setSyncConfigValues({});
    setDisplayName('');
    setDeployError(null);
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

  const syncRequiredFieldsMissing = selectedSyncProvider
    ? syncProviders.find(p => p.id === selectedSyncProvider)?.configFields
        .filter(f => f.required)
        .some(f => !syncConfigValues[f.key]?.trim()) ?? false
    : false;

  // Deploy sync
  const handleSyncDeploy = useCallback(async () => {
    if (!selectedSyncProvider || deploying) return;
    const providerDef = syncProviders.find(p => p.id === selectedSyncProvider);
    if (!providerDef) return;

    const missingRequired = providerDef.configFields
      .filter(f => f.required && !syncConfigValues[f.key]?.trim());
    if (missingRequired.length > 0) return;

    setDeploying(true);
    setDeployError(null);
    try {
      const target = draftResources[0];
      if (!target) return;

      const config: Record<string, unknown> = { ...syncConfigValues };
      let createdNodeId: string | null = null;

      if (providerDef.creationMode === 'bootstrap') {
        await deploySyncEndpoint({
          provider: providerDef.id,
          direction: providerDef.direction,
          config,
          uiMode: 'inline',
        });
        createdNodeId = target.nodeId;
      } else {
        const result = await createSyncConnection({
          project_id: projectId,
          provider: providerDef.id,
          config,
          target_folder_node_id: target.nodeId,
          direction: providerDef.direction,
          sync_mode: draftSyncMode as 'import_once' | 'manual' | 'scheduled',
          trigger: draftSyncMode === 'scheduled'
            ? {
                type: 'scheduled',
                schedule: draftTriggerConfig?.schedule,
                timezone: draftTriggerConfig?.timezone,
              }
            : draftSyncMode === 'manual'
              ? { type: 'manual' }
              : { type: 'import_once' },
        });
        createdNodeId = result.sync.node_id;
        if (!createdNodeId) {
          throw new Error('Connection was created without a destination node.');
        }
        if (result.sync.status === 'error' && result.sync.error_message) {
          throw new Error(result.sync.error_message);
        }
      }

      if (createdNodeId && onSyncCreated) {
        await onSyncCreated(createdNodeId);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Failed to create sync:', err);
      setDeployError(err instanceof Error ? err.message : 'Failed to create connection.');
    } finally {
      setDeploying(false);
    }
  }, [selectedSyncProvider, deploying, draftResources, syncConfigValues, draftSyncMode, draftTriggerConfig, deploySyncEndpoint, onSyncCreated, onClose, projectId, syncProviders]);

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
            <ChatAgentConfig
              targetLabel={selectedEndpointType === 'mcp' ? 'Data Access Target' : 'Workspace Mount'}
              targetDescription={selectedEndpointType === 'mcp'
                ? 'Drag and drop a folder or file to expose as MCP tools.'
                : 'Drag and drop a folder to mount into the sandbox environment.'}
            />
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
    const providerDef = syncProviders.find(p => p.id === selectedSyncProvider)!;

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
            configValues={syncConfigValues}
            onConfigChange={(key, value) => setSyncConfigValues(prev => ({ ...prev, [key]: value }))}
          />
        </div>
        
        <div style={{ 
          padding: '12px', 
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#09090b', // Match panel background to prevent transparency issues when scrolling
          flexShrink: 0
        }}>
          {deployError && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>
              {deployError}
            </div>
          )}
          <button
            onClick={handleSyncDeploy}
            disabled={deploying || draftResources.length === 0 || syncRequiredFieldsMissing}
            style={{
              width: '100%', height: 36,
              background: (deploying || draftResources.length === 0 || syncRequiredFieldsMissing) ? '#27272a' : '#3b82f6',
              color: (deploying || draftResources.length === 0 || syncRequiredFieldsMissing) ? '#71717a' : '#fff',
              border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500,
              cursor: (deploying || draftResources.length === 0 || syncRequiredFieldsMissing) ? 'not-allowed' : 'pointer',
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

  const inboundProviders = syncProviders.filter(p => p.direction === 'inbound');
  const bidirectionalProviders = syncProviders.filter(p => p.direction === 'bidirectional');

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
