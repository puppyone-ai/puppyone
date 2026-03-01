'use client';

import React, { useState } from 'react';
import { useAgent, AgentType } from '@/contexts/AgentContext';
import type { Tool as DbTool } from '@/lib/mcpApi';
import type { SaasType } from '@/lib/oauthApi';
import { ChatAgentConfig } from './configs/ChatAgentConfig';
import { ScheduleAgentConfig } from './configs/ScheduleAgentConfig';
import { SaaSyncConfig, type SaaSConfigField } from './configs/SaaSyncConfig';
import { SyncPreview, type AcceptedNodeType } from './configs/SyncPreview';
import { FolderIcon, JsonIcon, CloseIcon, getNodeIcon } from './_icons';
import type { AgentConfigProps } from './configs/ChatAgentConfig';

interface AgentSettingViewProps {
  availableTools?: unknown[];
  projectTools?: DbTool[];
  tableNameById?: Record<string, string>;
  currentTableId?: string;
  projectId?: string;
}

type Category = 'agent' | 'sync';
type SyncProvider = 'openclaw' | 'gmail' | 'google_calendar' | 'google_sheets' | 'google_docs' | 'github' | 'supabase';

interface TypeOption {
  category: Category;
  agentType?: AgentType;
  syncProvider?: SyncProvider;
  label: string;
  icon: React.ReactNode;
  description: string;
}

type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

interface SyncProviderSpec {
  oauthType?: SaasType;
  accept: AcceptedNodeType[];
  configFields: SaaSConfigField[];
  direction: SyncDirection;
}

function Img({ src, alt, size = 16 }: { src: string; alt: string; size?: number }) {
  return <img src={src} alt={alt} width={size} height={size} style={{ display: 'block' }} />;
}

function SupabaseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 109 113" fill="none">
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp0)"/>
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp1)" fillOpacity="0.2"/>
      <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
      <defs>
        <linearGradient id="sp0" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse"><stop stopColor="#249361"/><stop offset="1" stopColor="#3ECF8E"/></linearGradient>
        <linearGradient id="sp1" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse"><stop/><stop offset="1" stopOpacity="0"/></linearGradient>
      </defs>
    </svg>
  );
}

const AGENT_OPTIONS: TypeOption[] = [
  {
    category: 'agent', agentType: 'chat', label: 'Chat Agent', description: 'Interactive AI assistant',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  },
  {
    category: 'agent', agentType: 'schedule', label: 'Schedule', description: 'Cron-based automation',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
];

const SYNC_OPTIONS: TypeOption[] = [
  { category: 'sync', syncProvider: 'openclaw', label: 'OpenClaw', description: 'Bidirectional file sync via CLI', icon: <span style={{ fontSize: 14, lineHeight: 1 }}>🦞</span> },
  { category: 'sync', syncProvider: 'gmail', label: 'Gmail', description: 'Sync emails to JSON', icon: <Img src="/icons/gmail.svg" alt="Gmail" /> },
  { category: 'sync', syncProvider: 'google_calendar', label: 'Google Calendar', description: 'Sync calendar events', icon: <Img src="/icons/google_calendar.svg" alt="Calendar" /> },
  { category: 'sync', syncProvider: 'google_sheets', label: 'Google Sheets', description: 'Sync spreadsheet data', icon: <Img src="/icons/google_sheet.svg" alt="Sheets" /> },
  { category: 'sync', syncProvider: 'google_docs', label: 'Google Docs', description: 'Sync documents', icon: <Img src="/icons/google_doc.svg" alt="Docs" /> },
  { category: 'sync', syncProvider: 'github', label: 'GitHub', description: 'Sync repos & issues', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="#999"><path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> },
  { category: 'sync', syncProvider: 'supabase', label: 'Supabase', description: 'Connect PostgreSQL database', icon: <SupabaseIcon size={16} /> },
];

const SYNC_PROVIDER_SPECS: Record<SyncProvider, SyncProviderSpec> = {
  openclaw: {
    accept: ['folder'], configFields: [], direction: 'bidirectional',
  },
  gmail: {
    oauthType: 'gmail', accept: ['json'], direction: 'inbound',
    configFields: [
      { key: 'label', label: 'Label', type: 'select', defaultValue: 'INBOX', options: [
        { value: 'INBOX', label: 'Inbox' }, { value: 'SENT', label: 'Sent' },
        { value: 'IMPORTANT', label: 'Important' }, { value: 'STARRED', label: 'Starred' }, { value: 'ALL', label: 'All Mail' },
      ]},
      { key: 'timeRange', label: 'Time range', type: 'select', defaultValue: '30d', options: [
        { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
        { value: '90d', label: 'Last 90 days' }, { value: 'all', label: 'All time' },
      ]},
      { key: 'maxEmails', label: 'Max emails', type: 'select', defaultValue: '100', options: [
        { value: '50', label: '50' }, { value: '100', label: '100' }, { value: '500', label: '500' }, { value: '1000', label: '1000' },
      ]},
    ],
  },
  google_calendar: {
    oauthType: 'google_calendar', accept: ['json'], direction: 'inbound',
    configFields: [
      { key: 'calendarId', label: 'Calendar', type: 'select', defaultValue: 'primary', options: [
        { value: 'primary', label: 'Primary Calendar' },
      ]},
      { key: 'timeRange', label: 'Time range', type: 'select', defaultValue: 'future_30d', options: [
        { value: 'future_7d', label: 'Next 7 days' }, { value: 'future_30d', label: 'Next 30 days' },
        { value: 'past_30d', label: 'Past 30 days' }, { value: 'past_90d', label: 'Past 90 days' },
      ]},
    ],
  },
  google_sheets: {
    oauthType: 'google_sheets', accept: ['json'], direction: 'inbound',
    configFields: [
      { key: 'url', label: 'Sheet URL', type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/...' },
    ],
  },
  google_docs: {
    oauthType: 'google_docs', accept: ['markdown'], direction: 'inbound',
    configFields: [
      { key: 'url', label: 'Doc URL', type: 'text', placeholder: 'https://docs.google.com/document/d/...' },
    ],
  },
  github: {
    oauthType: 'github', accept: ['folder'], direction: 'inbound',
    configFields: [
      { key: 'url', label: 'Repo URL', type: 'text', placeholder: 'https://github.com/owner/repo' },
    ],
  },
  supabase: {
    accept: ['json'], direction: 'inbound',
    configFields: [],
  },
};

const AGENT_CONFIG_MAP: Record<AgentType, React.ComponentType<AgentConfigProps>> = {
  chat: ChatAgentConfig,
  schedule: ScheduleAgentConfig,
  devbox: ChatAgentConfig,
  webhook: ChatAgentConfig,
};

const NAME_ADJ = ['Swift', 'Cosmic', 'Silent', 'Crystal', 'Shadow', 'Golden', 'Iron', 'Silver', 'Neon', 'Phantom', 'Mystic', 'Thunder', 'Frost', 'Solar', 'Lunar', 'Spark', 'Pixel', 'Cyber', 'Atomic', 'Quantum'];
const NAME_NOUN = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Tiger', 'Dragon', 'Phoenix', 'Raven', 'Node', 'Core', 'Link', 'Pulse', 'Wave', 'Bolt', 'Spark', 'Agent', 'Bot', 'Edge', 'Flow', 'Nexus'];
const genName = () => `${NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)]} ${NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)]}`;

// ============================================================
// Main — two-step wizard
// ============================================================

// Map SaaS IDs from TableManageDialog to our SyncProvider keys
const SAAS_TO_SYNC: Record<string, SyncProvider> = {
  gmail: 'gmail', calendar: 'google_calendar', sheets: 'google_sheets',
  docs: 'google_docs', github: 'github', supabase: 'supabase',
  google_sheets: 'google_sheets', google_calendar: 'google_calendar',
  google_docs: 'google_docs', openclaw: 'openclaw',
};

export function AgentSettingView({ projectTools, projectId = '' }: AgentSettingViewProps) {
  const { draftType, setDraftType, deployAgent, deploySyncEndpoint, draftResources, cancelSetting, pendingSyncProvider, draftSyncMode, draftTriggerConfig } = useAgent();

  const [step, setStep] = useState<'pick' | 'config'>('pick');
  const [selected, setSelected] = useState<TypeOption | null>(null);
  const [draftName, setDraftName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [autoName] = useState(() => genName());
  const [didAutoSkip, setDidAutoSkip] = useState(false);

  const displayName = draftName.trim() || autoName;

  const handlePick = (opt: TypeOption) => {
    setSelected(opt);
    if (opt.agentType) setDraftType(opt.agentType);
    if (opt.syncProvider === 'openclaw') setDraftType('devbox' as AgentType);
    setStep('config');
  };

  // Auto-skip to step 2 if a sync provider was pre-selected (e.g. from CreateMenu)
  React.useEffect(() => {
    if (pendingSyncProvider && !didAutoSkip) {
      const mapped = SAAS_TO_SYNC[pendingSyncProvider];
      if (mapped) {
        const opt = SYNC_OPTIONS.find(o => o.syncProvider === mapped);
        if (opt) {
          handlePick(opt);
          setDidAutoSkip(true);
        }
      }
    }
  }, [pendingSyncProvider, didAutoSkip]);

  const handleBack = () => {
    setSelected(null);
    setStep('pick');
  };

  // ── Step 1: Pick ──
  if (step === 'pick') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ViewHeader title="New endpoint" onClose={cancelSetting} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section label="Agents">
            {AGENT_OPTIONS.map(o => <OptionRow key={o.label} option={o} onClick={() => handlePick(o)} />)}
          </Section>
          <Section label="Data sync">
            {SYNC_OPTIONS.map(o => <OptionRow key={o.label} option={o} onClick={() => handlePick(o)} />)}
          </Section>
        </div>
      </div>
    );
  }

  // ── Step 2: Config ──
  const opt = selected!;
  const isAgent = opt.category === 'agent';
  const ActiveConfig = opt.agentType ? AGENT_CONFIG_MAP[opt.agentType] : null;
  const spec = opt.syncProvider ? SYNC_PROVIDER_SPECS[opt.syncProvider] : null;
  const canCreate = draftResources.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ViewHeader title={opt.label} icon={opt.icon} onClose={cancelSetting} onBack={handleBack} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Agent config ── */}
        {isAgent && ActiveConfig && (
          <>
            <ActiveConfig projectTools={projectTools} />
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <NameRow
                icon={opt.icon} displayName={displayName} draftName={draftName}
                setDraftName={setDraftName} isEditing={isEditingName} setIsEditing={setIsEditingName} autoName={autoName}
              />
              <ActionButton label="Create agent" disabled={!canCreate} onClick={() => deployAgent(displayName, opt.agentType!)} />
            </div>
          </>
        )}

        {/* ── OpenClaw (no OAuth, folder only) ── */}
        {!isAgent && opt.syncProvider === 'openclaw' && spec && (
          <>
            <SyncPreview
              provider="openclaw"
              providerLabel="OpenClaw"
              direction="bidirectional"
              targetName={draftResources[0]?.nodeName || null}
              targetType="folder"
            />
            <OpenClawDragZone />
            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <ActionButton label="Create sync endpoint" disabled={!canCreate} onClick={() => deploySyncEndpoint({ provider: 'openclaw', direction: 'bidirectional' })} />
            </div>
          </>
        )}

        {/* ── Supabase (API key, no OAuth) ── */}
        {!isAgent && opt.syncProvider === 'supabase' && spec && (
          <>
            <SyncPreview
              provider="supabase" providerLabel="Supabase" direction="inbound"
              targetName={draftResources[0]?.nodeName || null} targetType="json"
              isActive={!!draftResources[0]}
            />
            <OpenClawDragZone accept={['json']} />
            <SupabaseInlineConfig projectId={projectId} />
            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <ActionButton label="Create sync endpoint" disabled={!canCreate} onClick={() => {
                const supaConfig: Record<string, unknown> = {};
                const urlEl = document.getElementById('sync-cfg-supabase-url') as HTMLInputElement | null;
                const keyEl = document.getElementById('sync-cfg-supabase-key') as HTMLInputElement | null;
                if (urlEl) supaConfig.supabase_url = urlEl.value;
                if (keyEl) supaConfig.supabase_key = keyEl.value;
                deploySyncEndpoint({ provider: 'supabase', direction: 'inbound', config: supaConfig });
              }} />
            </div>
          </>
        )}

        {/* ── SaaS sync (OAuth + config fields + target node + preview) ── */}
        {!isAgent && opt.syncProvider && opt.syncProvider !== 'openclaw' && opt.syncProvider !== 'supabase' && spec && (
          <>
            <SaaSyncConfig
              provider={opt.syncProvider}
              providerLabel={opt.label}
              oauthType={spec.oauthType!}
              icon={opt.icon}
              description={opt.description}
              configFields={spec.configFields}
              accept={spec.accept}
              direction={spec.direction}
            />
            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <ActionButton
                label={draftSyncMode === 'import_once' ? 'Import data' : 'Create sync endpoint'}
                disabled={!canCreate}
                onClick={() => {
                  const config: Record<string, unknown> = {};
                  for (const field of spec.configFields) {
                    const el = document.getElementById(`sync-cfg-${opt.syncProvider}-${field.key}`) as HTMLInputElement | HTMLSelectElement | null;
                    if (el) config[field.key] = el.value;
                  }
                  const trigger = draftSyncMode === 'scheduled' && draftTriggerConfig
                    ? { type: 'scheduled', schedule: draftTriggerConfig.schedule, timezone: draftTriggerConfig.timezone }
                    : undefined;
                  deploySyncEndpoint({
                    provider: opt.syncProvider!,
                    direction: spec.direction,
                    config,
                    syncMode: draftSyncMode,
                    trigger,
                  });
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ViewHeader({ title, icon, onClose, onBack }: { title: string; icon?: React.ReactNode; onClose: () => void; onBack?: () => void }) {
  return (
    <div style={{ height: 48, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6, background: '#141414', flexShrink: 0 }}>
      {onBack && (
        <IconBtn onClick={onBack} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </IconBtn>
      )}
      {icon && <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>}
      <span style={{ fontSize: 14, fontWeight: 500, color: '#999', flex: 1 }}>{title}</span>
      <IconBtn onClick={onClose} title="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </IconBtn>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick} title={title}
      style={{ width: 28, height: 28, background: 'transparent', border: 'none', color: '#525252', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.color = '#a3a3a3'; e.currentTarget.style.background = '#1f1f1f'; }}
      onMouseLeave={e => { e.currentTarget.style.color = '#525252'; e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

function OptionRow({ option, onClick }: { option: TypeOption; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'transparent', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.1s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
    >
      <span style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a1a', border: '1px solid #252525', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#999' }}>
        {option.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#a3a3a3', lineHeight: 1.3 }}>{option.label}</div>
        <div style={{ fontSize: 11, color: '#525252', lineHeight: 1.3, marginTop: 1 }}>{option.description}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

function NameRow({ icon, displayName, draftName, setDraftName, isEditing, setIsEditing, autoName }: {
  icon: React.ReactNode; displayName: string; draftName: string; setDraftName: (v: string) => void;
  isEditing: boolean; setIsEditing: (v: boolean) => void; autoName: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a1a', border: '1px solid #252525', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, color: '#999' }}>
        {icon}
      </span>
      {isEditing ? (
        <input
          type="text" value={draftName} onChange={e => setDraftName(e.target.value)}
          onBlur={() => setIsEditing(false)} onKeyDown={e => { if (e.key === 'Enter') setIsEditing(false); }}
          placeholder={autoName} autoFocus
          style={{ flex: 1, height: 28, background: '#161616', border: '1px solid #3a3a3a', borderRadius: 6, padding: '0 8px', color: '#e5e5e5', fontSize: 13, outline: 'none' }}
        />
      ) : (
        <button
          onClick={() => setIsEditing(true)}
          style={{ flex: 1, height: 28, background: 'transparent', border: 'none', borderRadius: 6, padding: '0 4px', color: draftName ? '#e5e5e5' : '#525252', fontSize: 13, cursor: 'text', textAlign: 'left' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {displayName}
        </button>
      )}
    </div>
  );
}

function OpenClawDragZone({ accept = ['folder'] as AcceptedNodeType[] }: { accept?: AcceptedNodeType[] } = {}) {
  const { draftResources, addDraftResource, removeDraftResource } = useAgent();
  const [isDragging, setIsDragging] = useState(false);
  const targetRes = draftResources[0] || null;
  const primaryType = accept[0];

  const handleDragOver = (e: React.DragEvent) => {
    if (targetRes) return;
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault(); e.stopPropagation(); setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => { e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (targetRes) return;
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (!data) return;
    try {
      const node = JSON.parse(data);
      const nodeType: AcceptedNodeType = node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : node.type === 'markdown' ? 'markdown' : 'file';
      if (!accept.includes(nodeType)) return;
      addDraftResource({ nodeId: node.nodeId || node.id, nodeName: node.name, nodeType, readonly: true, jsonPath: '' } as any);
    } catch { /* ignore */ }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>Sync target</label>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
      </div>
      <div
        style={{
          minHeight: 72,
          background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
          border: isDragging ? '1px dashed #525252' : targetRes ? '1px solid #2a2a2a' : '1px dashed #2a2a2a',
          borderRadius: 6, transition: 'all 0.15s',
        }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      >
        {targetRes ? (
          <div style={{ padding: 6 }}>
            {(() => {
              const { icon, color } = getNodeIcon(targetRes.nodeType);
              return (
                <div
                  style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', borderRadius: 4, background: '#1a1a1a', border: '1px solid #252525', transition: 'all 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                    <span style={{ fontSize: 13, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{targetRes.nodeName}</span>
                  </div>
                  <button
                    onClick={() => removeDraftResource(targetRes.nodeId)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, background: 'transparent', border: 'none', color: '#505050', cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{ minHeight: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: isDragging ? '#a1a1aa' : '#525252' }}>
            <div style={{ color: isDragging ? '#d4d4d4' : primaryType === 'json' ? '#34d399' : '#a1a1aa' }}>
              {primaryType === 'json' ? <JsonIcon /> : <FolderIcon />}
            </div>
            <span style={{ fontSize: 12 }}>{isDragging ? 'Drop here' : `Drag a ${primaryType === 'folder' ? 'folder' : primaryType === 'json' ? 'JSON file' : 'file'} into this`}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SupabaseInlineConfig({ projectId }: { projectId: string }) {
  const [projectUrl, setProjectUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyType, setKeyType] = useState<'anon' | 'service_role'>('anon');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConnect = projectUrl.trim().length > 0 && apiKey.trim().length > 0;

  const handleConnect = async () => {
    if (!canConnect) return;
    setIsConnecting(true); setError(null);
    try {
      const { createConnection } = await import('@/lib/dbConnectorApi');
      const urlHost = new URL(projectUrl.trim()).hostname;
      const ref = urlHost.split('.')[0];
      await createConnection(projectId, {
        name: `Supabase (${ref})`,
        provider: 'supabase',
        project_url: projectUrl.trim(),
        api_key: apiKey.trim(),
        key_type: keyType,
      });
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1, height: 28, padding: '0 8px',
    background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
    color: '#e5e5e5', fontSize: 12, outline: 'none',
  };

  if (connected) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 6,
        background: 'transparent', border: '1px solid #2a2a2a',
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style={{ fontSize: 11, color: '#666' }}>Supabase connected</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>Supabase connection</span>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
      </div>

      {/* Key type toggle */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['anon', 'service_role'] as const).map(kt => (
          <button key={kt} onClick={() => setKeyType(kt)} style={{
            flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: 500,
            background: keyType === kt ? 'rgba(62,207,142,0.1)' : 'transparent',
            border: keyType === kt ? '1px solid rgba(62,207,142,0.3)' : '1px solid #2a2a2a',
            color: keyType === kt ? '#3ECF8E' : '#525252', cursor: 'pointer', transition: 'all 0.12s',
          }}>
            {kt === 'anon' ? 'Anon Key' : 'Service Role'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 12, color: '#525252', minWidth: 60, flexShrink: 0 }}>URL</label>
        <input type="text" placeholder="https://xxx.supabase.co" value={projectUrl}
          onChange={e => { setProjectUrl(e.target.value); setError(null); }} style={inputStyle} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 12, color: '#525252', minWidth: 60, flexShrink: 0 }}>API Key</label>
        <input type="password" placeholder="eyJhbGci..." value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && canConnect) handleConnect(); }} style={inputStyle} />
      </div>

      {error && <div style={{ fontSize: 11, color: '#ef4444', padding: '0 2px' }}>{error}</div>}

      <button onClick={handleConnect} disabled={!canConnect || isConnecting} style={{
        height: 28, borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: canConnect && !isConnecting ? 'pointer' : 'not-allowed',
        background: canConnect && !isConnecting ? 'rgba(62,207,142,0.1)' : 'transparent',
        border: canConnect && !isConnecting ? '1px solid rgba(62,207,142,0.3)' : '1px solid rgba(255,255,255,0.06)',
        color: canConnect && !isConnecting ? '#3ECF8E' : '#525252', transition: 'all 0.12s',
      }}>
        {isConnecting ? 'Connecting...' : 'Connect to Supabase'}
      </button>
    </div>
  );
}

function ActionButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        width: '100%', height: 28, borderRadius: 6, fontSize: 12, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? 'transparent' : '#e5e5e5',
        color: disabled ? '#525252' : '#0a0a0a',
        border: disabled ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e5e5',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#fff'; } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = '#e5e5e5'; e.currentTarget.style.borderColor = '#e5e5e5'; } else { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; } }}
    >
      {label}
    </button>
  );
}
