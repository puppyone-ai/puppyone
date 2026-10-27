// Real product components and styles; only external services use disposable fixtures.
import '../../../../src/styles/cascade.css';
import '../../../../src/cloud-globals.css';
import '../../../../src/styles.css';
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalizationProvider, useLocalization } from '@puppyone/localization/react';
import english from '../../../../src/localization/catalog-loaders/en';
import { CloudWorkspaceSwitchDialog } from '../../../../src/features/cloud/workbench/CloudWorkspaceSwitchDialog';
import { useCloudWorkspaceSwitch } from '../../../../src/features/cloud/workbench/useCloudWorkspaceSwitch';
import type { NativeCloudDataService } from '../../../../src/features/cloud/files/cloudDataPort';
import { CloudSignedOutRoute } from '../../../../src/features/cloud/auth/CloudSignedOutRoute';
import type { DesktopCloudAuthState } from '../../../../src/lib/cloudSession';
import { DesktopCloudSignInCta } from '../../../../src/features/cloud/auth/DesktopCloudSignInCta';
import { DesktopHelpLauncher } from '../../../../src/features/app-shell/DesktopHelpLauncher';
import { LanguageSettingRow } from '../../../../src/features/settings/LanguageSetting';
import { CloudNewAutomationDialog } from '../../../../src/features/automation/AutomationCreateDialog';
import { CloudAutomationSourceEditor, CloudAutomationDestinationEditor } from '../../../../src/features/automation/AutomationControls';
import { BuiltInAgentCompute } from '../../../../src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute';
import { AgentPanelStatus } from '../../../../src/features/desktop-agent/ui/AgentPanelStatus';
import { AgentSurfaceHeader } from '../../../../src/features/desktop-agent/ui/AgentSurfaceHeader';
import { modelConnectionsApi } from '../../../../src/features/model-connections/modelConnectionsApi';
import { AccountAICredits } from '../../../../src/features/settings/main/AccountAICredits';
import { AccountSettingsView } from '../../../../src/features/settings/main/AccountSettingsView';
import { ExperimentalSettingsView } from '../../../../src/features/settings/main/ExperimentalSettingsView';
import { LocalAgentActivationDialog } from '../../../../src/features/local-agents/activation/LocalAgentActivationDialog';
import { LocalAgentActivationStore } from '../../../../src/features/local-agents/activation/LocalAgentActivationStore';
import { ModelConnectionSetup } from '../../../../src/features/model-connections/ModelConnectionSetup';
import { CloudOrganizationBillingPage } from '../../../../src/features/cloud/organization/CloudOrganizationBillingPage';
import { CloudOrganizationTeamPage } from '../../../../src/features/cloud/organization/CloudOrganizationTeamPage';
import { CloudProjectSettingsSection } from '../../../../src/features/cloud/sections/settings/SettingsSection';
import { AccessPointCatalogPage } from '../../../../src/features/cloud/access-points/components/AccessPointCatalogPage';
import { CloudServiceUnavailable } from '../../../../src/features/cloud/components/CloudServiceUnavailable';
import { CloudWorkspaceRecovery } from '../../../../src/features/cloud/workbench/CloudWorkspaceRecovery';
import { CloudProjectRecoveryState } from '../../../../src/features/cloud/states/CloudProjectRecoveryState';
import { VersionControlSetupState } from '../../../../src/features/source-control/VersionControlSetupState';
import { GitOperationErrorDialog } from '../../../../src/features/source-control/operationDialogs';
import { OnboardingImportDialog } from '../../../../src/components/OnboardingImportDialog';
import { ShareWizardDialog } from '../../../../src/features/cloud/share/ShareWizardDialog';
import { ProjectReachDialog } from '../../../../src/features/cloud/share/project-reach/ProjectReachDialog';
import { buildProjectShares } from '../../../../src/features/cloud/share/useProjectShares';
import { CloudShareStatusCard } from '../../../../src/features/cloud/share/CloudShareStatusCard';
import { CloudShareProvider } from '../../../../src/features/cloud/share/CloudShareContext';
import { CloudServiceSidebar } from '../../../../src/features/cloud/CloudServiceSidebar';
import { FeatureFlagsProvider } from '../../../../src/features/flags';
import { CloudPublishProgressIndicator } from '../../../../src/features/cloud/initialization/CloudPublishProgressIndicator';
import { AppPreviewSetupView } from '../../../../packages/shared-ui/src/editor/viewers/app/AppPreviewSetupView';
import type { DesktopCloudAutomationProviderSpec, DesktopBillingOperation } from '../../../../src/lib/cloudApi';
import type { ModelConnectionSnapshot } from '../../../../shared/model-connections/types';
import type { LocaleState } from '@puppyone/localization/core';
import { session, orgA, catalog, summary, usage } from './billing';

const noop = () => {};
const refresh = async () => {};
let scene = '', variant = '', revision = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
function defer<T>(key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => pending.set(key, { resolve: value => resolve(value as T), reject }));
}
const calls: string[] = [];
const authListeners = new Set<(state: DesktopCloudAuthState) => void>();
const provider: DesktopCloudAutomationProviderSpec = {
  provider: 'google_docs', display_name: 'Google Docs', description: 'Sync documents', auth: 'oauth',
  category: 'datasource', creation_mode: 'direct', icon: null, config_fields: [],
  supported_sync_modes: ['manual', 'scheduled'], default_sync_mode: 'manual',
};
const fieldProvider: DesktopCloudAutomationProviderSpec = { ...provider, provider: 'github', display_name: 'GitHub', auth: 'none', config_fields: [
  { key: 'source_url', label: 'Repository URL', type: 'text', required: true, default: null, options: [], placeholder: null, hint: 'Full URL of the GitHub repository' },
  { key: 'branch', label: 'Branch', type: 'text', required: false, default: null, options: [], placeholder: null, hint: 'Leave empty to use the default branch.' },
] };
const project = { id: 'project-fixture', name: 'Project', org_id: orgA.id, visibility: 'private', capabilities: ['project.settings.manage'] };
const reachEndpoint = { id: 'ep-fixture', project_id: project.id, path: 'docs', name: 'Claude', api_key_hint: 'mcp_…cdef',
  status: 'active', accesses: [{ path: 'docs', json_path: '', readonly: true }], created_at: '2026-10-01T10:00:00Z' };
const oauthStatus = (connected = false) => ({ connected, workspace_name: connected ? 'Fixture account' : null, access_token: null, refresh_token: null });
async function request({ path, method }: { path: string; method: string }): Promise<unknown> {
  calls.push(`${method} ${path}`);
  if (path.endsWith('/status')) {
    if (variant === 'lookup') return defer('lookup');
    if (variant === 'denied') throw new Error('Authorization was denied.');
    return oauthStatus(variant === 'connected');
  }
  if (path.endsWith('/authorize')) return { authorization_url: 'https://fixture.example/authorize' };
  if (path.includes('/resources')) return { resources: [], next_cursor: null };
  if (path === '/organizations/') return [orgA];
  if (path.endsWith('/access')) return { org_id: orgA.id, user_id: session.user_id, role: 'owner', can_manage_billing: true };
  if (path.endsWith('/members')) return [];
  if (path.endsWith('/entitlements')) return { org_id: orgA.id, plan_id: 'plus', status: 'active', source: 'puppypay', seat_quantity: 2, catalog_version: catalog.catalog_version, source_revision: 2, entitlements: {} };
  if (path.endsWith('/seat-usage')) return { billable_seat_quantity: 1 };
  if (path === '/billing/catalog') return catalog;
  if (path.endsWith('/summary')) return summary(orgA.id);
  if (path.endsWith('/usage')) return usage(orgA.id);
  if (path.endsWith('/operations')) return [operation];
  if (path.includes('/tree')) return { path: '', entries: [] };
  if (path.includes('/bindings') && method === 'POST') {
    if (variant === 'create-error') throw new Error('The sync queue is unavailable.');
    return defer('create');
  }
  if (path.startsWith('/projects/') && method === 'PATCH') return project;
  throw new Error(`Unhandled fixture request: ${method} ${path}`);
}
const operation: DesktopBillingOperation = {
  id: 'operation-fixture', org_id: orgA.id, kind: 'member_activation', state: 'requires_action', terminal: false,
  retryable: false, action_required: true, target_plan_id: 'plus', current_seat_quantity: 2, target_seat_quantity: 3,
  quote_id: null, confirmed_revision: null, error_code: null, created_at: null, updated_at: null, completed_at: null,
};
window.puppyoneDesktop = {
  requestCloudSessionApi: request,
  startCloudOAuth: () => defer('auth'),
  onCloudAuthStateChanged: (listener: (state: DesktopCloudAuthState) => void) => { authListeners.add(listener); return () => authListeners.delete(listener); },
  openExternalUrl: async () => { calls.push('open-authorize'); },
  submitFeedback: () => defer('feedback'),
  getDesktopPlatformCapabilities: async () => ({ nativeSurfaceOcclusion: false }),
  // A folder that already has version history, so the project-reach screen has
  // nothing local left to do and the account becomes its current step.
  getGitStatus: async () => ({ isRepo: true, branch: 'main', headCommitId: 'fixture-head', totalCommits: 1, branches: [] }),
  getPublishScope: async () => ({ files: 12, bytes: 2048, truncated: false }),
} as unknown as Window['puppyoneDesktop'];
let snapshot: ModelConnectionSnapshot = { schemaVersion: 1, revision: 1, connections: [], catalogs: [], managed: { available: false, reason: 'loading', signedIn: true } };
modelConnectionsApi.read = async () => snapshot;
modelConnectionsApi.managed = async () => defer<ModelConnectionSnapshot>('managed');
modelConnectionsApi.subscribe = () => noop;
const locale: LocaleState = { preference: 'en', locale: 'en', direction: 'ltr', systemLanguages: ['en-US'] };
let requestedPreference: LocaleState['preference'] = 'en';
const installation = new LocalAgentActivationStore({
  plan: async () => ({ planId: 'fixture', setupId: 'claude', displayName: 'Claude Code', mode: 'automatic', version: 'fixture', publisher: 'Fixture publisher', surface: 'chat' }),
} as unknown as ConstructorParameters<typeof LocalAgentActivationStore>[0]);
const root = createRoot(document.getElementById('root')!);
const cloudService = { dataPort: { listChildren: () => defer('preflight') } } as unknown as NativeCloudDataService;
function AuthenticationSwitch() {
  const [signedIn, setSignedIn] = useState(false);
  const [active, setActive] = useState(false);
  const commit = useCallback(() => setActive(true), []);
  useEffect(() => { const listener = (state: DesktopCloudAuthState) => setSignedIn(state.status === 'authenticated'); authListeners.add(listener); return () => { authListeners.delete(listener); }; }, []);
  const controller = useCloudWorkspaceSwitch({ enabled: true, scope: 'fixture-project', session: signedIn ? session : null,
    service: signedIn ? cloudService : null, providerError: null, initializationPending: false, onCommit: commit });
  return <><button onClick={controller.request}>Open Cloud</button><input aria-label="Local draft" defaultValue="Unsaved fixture draft" />
    <output data-current-provider={active ? 'cloud' : 'local'}>{active ? 'Cloud project' : 'Local project'}</output>
    <CloudWorkspaceSwitchDialog controller={controller} authenticationRequired={!signedIn} gate={<CloudSignedOutRoute compact activeSection="contents"
      authState={{ status: 'signed-out', apiBaseUrl: session.api_base_url }} apiBaseUrl={session.api_base_url} loadingLabel="Restoring…" />} /></>;
}
function Destination() {
  const [path, setPath] = useState('imports/github');
  return <CloudAutomationDestinationEditor projectId={project.id} cloudSession={session} apiBaseUrl={session.api_base_url} targetPath={path} onChange={setPath} onCloudSessionChange={noop} />;
}
function Progress() { const { t } = useLocalization(); return <CloudPublishProgressIndicator stage="uploading" t={t} />; }
/** The paid route's refusals, in the order a first-time account meets them. */
function agentManaged(value: string): ModelConnectionSnapshot['managed'] {
  if (value === 'error') return { signedIn: true, available: false, reason: 'gateway-unavailable' };
  if (value === 'trial') return { signedIn: false, available: false, reason: 'sign-in-required', trialCreditMicroUsd: 1_000_000 };
  if (value === 'insufficient') {
    return { signedIn: true, available: false, reason: 'insufficient-credit', availableMicroUsd: 0, sandbox: true,
      packs: [{ id: 'agent-sandbox-5', name: 'Sandbox AI credit', price_cents: 500, credit_micro_usd: 5_000_000 }] };
  }
  return { signedIn: true, available: false, reason: 'loading' };
}
function walletManaged(): ModelConnectionSnapshot['managed'] {
  return { signedIn: true, available: true, reason: 'ready', sandbox: true, availableMicroUsd: 1_000_000,
    reservedMicroUsd: 0, trialGrantedMicroUsd: 1_000_000,
    packs: [{ id: 'agent-sandbox-5', name: 'Sandbox AI credit', price_cents: 500, credit_micro_usd: 5_000_000 }] };
}
function surface() {
  switch (scene) {
    case 'authentication': return <AuthenticationSwitch />;
    case 'sign-in': return <DesktopCloudSignInCta signingIn={variant === 'pending'} error={variant === 'error' ? 'Sign-in failed. Try again.' : null} onSignIn={noop} />;
    case 'feedback': return <DesktopHelpLauncher />;
    case 'language': return <div className="desktop-settings-view"><LanguageSettingRow /></div>;
    case 'automation': return <CloudNewAutomationDialog projectId={project.id} cloudSession={session} apiBaseUrl={session.api_base_url}
      providers={[variant.startsWith('configure') || variant.startsWith('create') ? fieldProvider : provider]} providersLoading={false} providersError={null}
      template={{ id: 'source', provider: variant.startsWith('configure') || variant.startsWith('create') ? 'github' : 'google_docs', sourceLabel: 'Source', categories: ['popular'], iconUrl: null, presentation: 'generic' }}
      onCloudSessionChange={noop} onRefresh={refresh} onCreated={noop} onClose={noop} />;
    case 'fields': return <><CloudAutomationSourceEditor provider={fieldProvider} cloudSession={session} apiBaseUrl={session.api_base_url} configValues={{}} source={null}
      onConfigValueChange={noop} onSourceChange={noop} onCloudSessionChange={noop} /><Destination /></>;
    case 'agent': return <div className="desktop-agent-boundary"><BuiltInAgentCompute models={[]} payments={variant !== 'unpaid'} selectedModel={null} disabled={false} accessPrompt
      onSelectModel={noop} onCatalogChange={noop} onOpenAccount={noop} onOpenModelConnections={noop} onReadyChange={noop} /></div>;
    case 'wallet': return <div className="desktop-settings-view"><AccountAICredits payments={variant !== 'unpaid'} signedIn onSignIn={noop} /></div>;
    // The money, as a signed-in account sees it: what is held, what it has
    // used, and what another machine would cost — all of it on Account.
    case 'plan': return <AccountSettingsView cloudSession={session} cloudSessionRestoring={false}
      cloudApiBaseUrl={session.api_base_url} onCloudSessionChange={noop} cloudEnabled />;
    case 'experiments': return <ExperimentalSettingsView />;
    case 'diagnostics': return <div className="desktop-agent-boundary"><AgentSurfaceHeader title="Chat" statusCode="ready" statusLabel="Ready" loading={false}
      newSessionDisabled={false} onNewSession={noop} onCloseSession={noop} diagnostic={variant === 'diagnostic' ? 'Fixture transport detail' : null} />
      {variant === 'readiness' && <AgentPanelStatus unavailable failed={false} error={null} runtimeLabel="Agent"
        readiness={{ runtimeId: 'fixture', provider: 'fixture', status: 'error', code: 'RUNTIME_INSPECTION_FAILED', version: null, minimumVersion: null, message: 'Could not inspect this Agent. Retry.', diagnostic: 'Fixture transport detail' }} onRetry={noop} />}</div>;
    case 'installation': return <LocalAgentActivationDialog setupId="claude" displayName="Claude Code" surface="chat" store={installation} onClose={noop} />;
    case 'model': return <ModelConnectionSetup sourceKind="api" busy={false} connection={{ id: 'fixture', sourceKind: 'api', driver: 'openai-compatible', name: 'API', baseUrl: 'https://fixture.example/v1', auth: 'bearer', credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: false, transport: 'remote', executionLocation: 'unknown' }} onSave={async () => true} onCancel={noop} />;
    case 'billing': return <CloudOrganizationBillingPage session={session} apiBaseUrl={session.api_base_url} onSessionChange={noop} />;
    case 'team': return <CloudOrganizationTeamPage session={session} apiBaseUrl={session.api_base_url} onSessionChange={noop} accountEmail={session.user_email} onOpen={noop} />;
    case 'settings': return <CloudProjectSettingsSection project={project} cloudSession={session} apiBaseUrl={session.api_base_url} loading={false} matchesRepositoryRemote removeRemoteAction={{ onRemove: noop }} onRefresh={refresh} onSessionChange={noop} onSelectSection={noop} />;
    case 'connect': return <AccessPointCatalogPage routeKind="all" selectedKind="all" rows={[]} totalRowCount={0} loading={false} selectedRowId={null} query="" statusFilter="all" canManage onKindChange={noop} onQueryChange={noop} onStatusFilterChange={noop} onOpenRow={noop} onCreate={noop} />;
    case 'recovery': return <><CloudWorkspaceRecovery message="Could not open this project." onRetry={noop} showLocalState /><CloudProjectRecoveryState message="Access was denied." remoteLabel="https://fixture.example/git/project" onRetry={noop} onUseAnotherAccount={noop} onOpenGitDetails={noop} /><CloudServiceUnavailable title="Connect" onRetry={noop} /></>;
    case 'git': return variant === 'error' ? <GitOperationErrorDialog error={{ operation: 'push', workspacePath: '/fixture', code: 'push', detail: 'Push rejected', raw: 'fixture: permission denied' }} onClose={noop} /> : <VersionControlSetupState enabling={variant === 'pending'} operationError={null} onEnable={noop} />;
    case 'import': return <OnboardingImportDialog onClose={noop} onImportSource={async () => false} onConnectSource={async () => ({ connectionId: 'fixture' })} onListResources={async () => ({ items: [], nextCursor: null })} onCancelImport={async () => ({ cancelled: true })} onImportProgress={() => noop} />;
    case 'share': return <ShareWizardDialog workspaceName="Project" initialTargetId={null} initialPath="" session={null} apiBaseUrl={session.api_base_url} projectContext={{ status: 'local-only', projectId: null }}
      publish={{ loading: false, progress: null, error: null, start: noop }} shares={{ shares: [], loading: false, loaded: true, error: false, reload: refresh }} listTopLevelFolders={async () => []} onSessionChange={noop} onIssued={noop} onOpenCloud={noop} onClose={noop} />;
    case 'reach': return <ProjectReachDialog workspaceName="Project" workspacePath="/fixture/Project" initialTargetId={null} initialPath="docs"
      session={variant === 'readers' ? session : null} apiBaseUrl={session.api_base_url} projectContext={{ status: 'local-only', projectId: null }}
      publish={{ loading: false, progress: null, error: null, start: noop }}
      shares={{ shares: variant === 'readers' ? buildProjectShares([reachEndpoint], null) : [], loading: false, loaded: true, error: false, reload: refresh }}
      listTopLevelFolders={async () => [{ name: 'docs', path: 'docs' }, { name: 'media', path: 'media' }]}
      onSessionChange={noop} onIssued={noop} onOpenCloud={noop} onClose={noop} />;
    case 'share-status': return <CloudShareStatusCard status={{ kind: 'shared', readers: [], pending: null, message: null }} surface="page" onPrimary={noop} />;
    case 'share-navigation': return <FeatureFlagsProvider value={{ cloudWorkspace: true, cloudBilling: false, assetLibraryHome: false }}>
      <CloudShareProvider value={variant === 'off' ? null : { signedIn: true, pending: null, openShare: noop,
        shares: { shares: [], loading: false, loaded: true, error: false, reload: refresh } }}>
        <CloudServiceSidebar cloudAuthState={{ status: 'signed-in', apiBaseUrl: session.api_base_url, session }}
          activeSection="contents" automationEnabled={false} projectAvailable onSelectSection={noop} />
      </CloudShareProvider>
    </FeatureFlagsProvider>;
    case 'progress': return <Progress />;
    case 'preview': return <AppPreviewSetupView appName="Preview" appPath="preview.puppyoneapp" content="{}" onConfigured={noop} controller={{
      detect: async () => {
        if (variant === 'detecting') return defer('detect');
        if (variant === 'error') throw new Error('Workspace unavailable');
        return { projects: variant === 'project' ? [{ id: 'web', cwd: '.', directoryLabel: '.', script: 'dev', packageManager: 'npm', framework: 'Vite', command: ['npm', 'run', 'dev'], commandLabel: 'npm run dev', score: 100 }] : [], htmlFiles: [] };
      }, configure: async () => { calls.push('configure-preview'); return { content: '{}' }; },
    } as unknown as React.ComponentProps<typeof AppPreviewSetupView>['controller']} />;
    default: throw new Error(`Unknown scene: ${scene}`);
  }
}
function render() {
  root.render(<LocalizationProvider key={`${scene}:${variant}:${revision}`} initialState={locale} initialCatalog={english} fallbackCatalog={english}
    loadCatalog={async () => ({ catalog: english, fallbackCatalog: english })}
    client={{ setLanguagePreference: preference => { requestedPreference = preference; return defer<LocaleState>('language'); }, onLocaleChanged: () => noop }}>
    <main style={{ maxWidth: 960, margin: 'auto', padding: 28 }}>{surface()}</main>
  </LocalizationProvider>);
}
declare global { interface Window { __uiCopy: { show: (next: string, value?: string) => void; finish: (key: string, fail?: boolean) => void; hasPending: (key: string) => boolean; calls: string[] } } }
window.__uiCopy = {
  show(next, value = '') { scene = next; variant = value; revision++;
    if (scene === 'agent') snapshot = { ...snapshot, revision: snapshot.revision + 1, managed: agentManaged(variant) };
    if (scene === 'wallet') snapshot = { ...snapshot, revision: snapshot.revision + 1, managed: walletManaged() };
    document.body.dataset.scene = scene; render(); },
  finish(key, fail = false) {
    const work = pending.get(key); if (!work) throw new Error(`No pending ${key}`);
    pending.delete(key);
    if (fail) work.reject(new Error('Fixture request failed. Retry.'));
    else { if (key === 'auth') for (const listener of authListeners) listener({ status: 'authenticated', session });
      work.resolve(key === 'language' ? { ...locale, preference: requestedPreference, locale: requestedPreference === 'system' ? 'en' : requestedPreference } : key === 'managed' ? snapshot : key === 'lookup' ? oauthStatus(false) : { ok: true }); }
  }, hasPending: key => pending.has(key), calls,
};
window.__uiCopy.show('sign-in');
