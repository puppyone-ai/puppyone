'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';
import { getMcpEndpoint, type McpEndpoint } from '@/lib/mcpEndpointsApi';
import { getSandboxEndpoint, type SandboxEndpoint } from '@/lib/sandboxEndpointsApi';
import type { AccessOption } from '@/components/chat/ChatInputArea';
import type { SavedAgent } from '@/components/AgentRail';
import type { Tool } from '@/lib/mcpApi';
import type { TableData } from '@/lib/projectsApi';
import { PanelShell } from '../PanelShell';
import {
  ScopedConnectorsListPanel,
  type EndpointEntry,
  type ProviderIconLookup,
} from '../access-points';
import {
  matchRepositoryViewForPath,
  repositoryViewKey,
  type Connector,
  type RepoIdentity,
  type RepositoryView,
} from '@/lib/repoApi';
import type { SyncStatusSync } from '../../DataLayoutContext';
import type { PanelState } from '../../usePanelStore';
import { PageLoading } from '@/components/loading';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import {
  useEditorSaveSession,
  type EditorSaveNodeType,
} from '@/lib/hooks/useEditorSaveSession';
import { useEditorSaveGuards } from '../../hooks/useEditorSaveGuards';

const PanelLoading = () => <PageLoading variant="fill" />;

const VersionHistoryPanel = dynamic(
  () => import('@/components/editors/VersionHistoryPanel').then(m => ({ default: m.VersionHistoryPanel })),
  { ssr: false, loading: PanelLoading },
);
const SyncConfigPanel = dynamic(
  () => import('../SyncConfigPanel').then(m => ({ default: m.SyncConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const McpConfigPanel = dynamic(
  () => import('../McpConfigPanel').then(m => ({ default: m.McpConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const SandboxConfigPanel = dynamic(
  () => import('../SandboxConfigPanel').then(m => ({ default: m.SandboxConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const ChatRuntimeView = dynamic(
  () => import('@/components/agent/views/ChatRuntimeView').then(m => ({ default: m.ChatRuntimeView })),
  { ssr: false, loading: PanelLoading },
);

export interface EditorTarget {
  path: string;
  value: string;
}

export interface AccessPanelNavigationGuard {
  readonly canLeave: () => boolean;
}

interface DataPageRightPanelProps {
  readonly editorTarget: EditorTarget | null;
  readonly isEditorFullScreen: boolean;
  readonly panelState: PanelState;
  readonly projectId: string;
  readonly activeNodeId?: string;
  readonly activeSyncId: string | null;
  readonly currentTableData?: TableData;
  readonly syncStatusData: { syncs: SyncStatusSync[] } | undefined;
  readonly projectTools: Tool[];
  readonly savedAgents: SavedAgent[];
  readonly accessPointEntries: EndpointEntry[];
  readonly providerIcons: ProviderIconLookup;
  /** Redesign 2026-05-02: scope list for matching the current URL path. */
  readonly scopes: RepositoryView[];
  /** Redesign 2026-05-02: connectors indexed by scope_id. */
  readonly connectorsByTarget: Map<string, Connector[]>;
  /** Redesign 2026-05-02: current canonical URL path (empty string for root). */
  readonly currentScopePath: string;
  /** Redesign 2026-05-02: project identity payload (URL + prompt_template + scope keys). */
  readonly repoIdentity: RepoIdentity | undefined;
  readonly onClose: () => void;
  onEditorClose: () => void;
  onEditorSave: (newValue: string) => Promise<void>;
  onToggleEditorFullScreen: () => void;
  onRollbackComplete: () => void;
  onSyncCreated: (nodeId: string) => void | Promise<void>;
  onAccessPointHover: (nodeId: string | null) => void;
  /** Refresh scopes / connectors / repo identity after a scope CRUD
   *  mutation. Wired at page level to useDataLayout().mutateRepo, which
   *  is typed as `Promise<unknown>` because it forwards SWR's mutate()
   *  return value (we don't care about the resolved value, just the
   *  completion). */
  onScopeMutated: () => Promise<unknown>;
  onOpenPanel: (panel: PanelState) => void;
  onCreateAccessPoint: (folderPath: string | null | undefined) => void;
  onCreateIntegration: (scopePath?: string | null) => void;
  onOpenSyncSetting: (
    syncId: string,
    resource: { path: string; nodeName: string; nodeType: 'folder'; readonly: boolean },
  ) => void;
  onDataUpdate: () => Promise<void>;
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  onAccessPanelNavigationGuardChange?: (guard: AccessPanelNavigationGuard | null) => void;
}

export function DataPageRightPanel({
  editorTarget,
  isEditorFullScreen,
  panelState,
  projectId,
  activeNodeId,
  activeSyncId,
  currentTableData,
  syncStatusData,
  projectTools,
  savedAgents,
  accessPointEntries: _accessPointEntries,
  providerIcons,
  scopes,
  connectorsByTarget,
  currentScopePath,
  repoIdentity,
  onClose,
  onEditorClose,
  onEditorSave,
  onToggleEditorFullScreen,
  onRollbackComplete,
  onSyncCreated,
  onAccessPointHover,
  onScopeMutated,
  onOpenPanel,
  onCreateAccessPoint,
  onCreateIntegration,
  onOpenSyncSetting,
  onDataUpdate,
  panelWidth,
  onPanelWidthChange,
  onAccessPanelNavigationGuardChange,
}: DataPageRightPanelProps) {
  const documentFilePath = editorTarget?.path ?? '';
  const documentNodeType = useMemo<EditorSaveNodeType>(() => {
    const lower = documentFilePath.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) return 'markdown';
    if (lower.endsWith('.json') || lower.endsWith('.json5') || lower.endsWith('.jsonc')) return 'json';
    return 'file';
  }, [documentFilePath]);
  const saveDocumentContent = useCallback(
    async (content: string) => {
      await onEditorSave(content);
    },
    [onEditorSave],
  );
  const documentSession = useEditorSaveSession({
    projectId,
    filePath: documentFilePath,
    serverContent: editorTarget?.value ?? '',
    nodeType: documentNodeType,
    saveContent: saveDocumentContent,
    skipDraftRestore: editorTarget === null,
  });
  useEditorSaveGuards({
    dirty: documentSession.dirty,
    save: documentSession.save,
    keyboardEnabled: editorTarget !== null,
  });
  const closeDocumentEditor = useCallback(() => {
    if (
      documentSession.dirty &&
      typeof window !== 'undefined' &&
      !window.confirm('You have unsaved changes. Close this editor and discard the local draft?')
    ) {
      return;
    }
    onEditorClose();
  }, [documentSession.dirty, onEditorClose]);

  // For access_list, the panel always tracks the *current file-tree
  // folder* (one-way: file tree → panel) so the user's reading context
  // stays in sync with whatever scope they're navigating into.
  //
  // For all other panel types, fall back to the previous "snapshot
  // nodeId at open time" behaviour so version history / sync config /
  // agent chat keep their sticky context.
  const panelScopePath =
    panelState.type === 'access_list'
      ? currentScopePath
      : panelState.type !== 'version_history' && panelState.nodeId !== undefined
        ? panelState.nodeId
        : currentScopePath;

  // ── access_list view resolution ────────────────────────────────────
  //
  // The Access surface is a 3-page hierarchy (per 2026-05-08 UX spec),
  // with creation delegated to the shared modal:
  //
  //   Pp.1 Overview      — list of all scopes, project-wide.
  //   Pp.2a Scope Detail — per-scope connect methods + integrations.
  //   Pp.2s Settings     — selected scope's configuration page.
  //
  // Three signals drive which page renders:
  //
  //   1. `panelState.view`            — explicit user choice from a
  //                                     trigger (header → overview,
  //                                     row → detail, etc.).
  //   2. `panelState.selectedTargetKey` — drill-down target id.
  //   3. `currentScopePath`           — file tree's current folder.
  //
  // Resolution precedence:
  //   - view === 'overview'             → Overview (Pp.1), hard.
  //   - view === 'settings' + scope     → Settings page (Pp.2s).
  //   - selectedTargetKey is set          → Detail of that scope.
  //   - currentScopePath matches scope  → Detail of that scope (auto).
  //   - otherwise                       → Overview (Pp.1).
  //
  // Creation starts from this panel, but the actual form, loading,
  // validation, and success/error states live in CreateAccessModal.
  // That keeps the sidebar as management/discovery chrome instead of
  // a second create workflow.
  //
  // No parent-child inheritance per the redesign Q1 decision
  // (2026-05-03) — exact match only.
  const drilledScope =
    panelState.type === 'access_list' && panelState.selectedTargetKey
      ? scopes.find((s) => repositoryViewKey(s) === panelState.selectedTargetKey) ?? null
      : null;
  const folderScope = matchRepositoryViewForPath(panelScopePath, scopes);
  const resolvedScope = drilledScope ?? folderScope;

  const accessListView: 'overview' | 'detail' | 'settings' =
    panelState.type === 'access_list' && panelState.view === 'settings' && resolvedScope
      ? 'settings'
      : panelState.type === 'access_list' && panelState.view === 'overview'
        ? 'overview'
        : resolvedScope
          ? 'detail'
          : 'overview';

  const currentScope =
    accessListView === 'detail' || accessListView === 'settings'
      ? resolvedScope
      : null;
  const currentScopeConnectors = currentScope
    ? connectorsByTarget.get(repositoryViewKey(currentScope)) || []
    : [];

  // File-tree navigation resets the panel's drill-down so the panel
  // resumes auto-following the explorer's cursor — but ONLY for
  // detail-mode drill-downs. Pp.1 Overview is an explicit user
  // destination: yanking it out from under the user
  // because they happened to click a folder in the file tree would be
  // a surprise. It stays sticky until the user explicitly navigates
  // away (back button / close). Create is modal-owned, so file-tree
  // navigation cannot move an in-sidebar form anymore.
  //
  // We only reset when the path actually changes (skip the initial
  // mount via the `prevPathRef` guard) and only when `access_list` is
  // the active panel.
  const prevPathRef = useRef(currentScopePath);
  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev !== currentScopePath) {
      prevPathRef.current = currentScopePath;
      if (
        panelState.type === 'access_list' &&
        panelState.view !== 'overview' &&
        panelState.view !== 'settings' &&
        (panelState.view !== undefined ||
          panelState.selectedTargetKey !== undefined)
      ) {
        onOpenPanel({ type: 'access_list' });
      }
    }
    // panelState intentionally watched fully so we react to in-panel
    // overrides too; onOpenPanel is stable from the page-level store.
  }, [currentScopePath, panelState, onOpenPanel]);
  const syncConfigId =
    panelState.type === 'sync_config'
      ? panelState.accessEndpointId ?? activeSyncId
      : activeSyncId;
  const panelMcpId = panelState.type === 'mcp_config' ? panelState.mcpEndpointId : undefined;
  const { data: mcpEndpointDetail } = useSWR<McpEndpoint>(
    panelMcpId ? ['mcp-endpoint-detail', panelMcpId] : null,
    () => getMcpEndpoint(panelMcpId!),
    { revalidateOnFocus: false },
  );

  const panelSandboxId = panelState.type === 'sandbox_config' ? panelState.sandboxEndpointId : undefined;
  const { data: sandboxEndpointDetail } = useSWR<SandboxEndpoint>(
    panelSandboxId ? ['sandbox-endpoint-detail', panelSandboxId] : null,
    () => getSandboxEndpoint(panelSandboxId!),
    { revalidateOnFocus: false },
  );
  const backToAccessList = () => onOpenPanel({ type: 'access_list', nodeId: panelScopePath });

  // The data-page chrome has a 46px top header. Non-editor right
  // panels should feel like a side sheet sliding in from the page's
  // right edge, with their own header occupying that same 46px band.
  // Pulling the panel up by the header height avoids the previous
  // "button in header, panel hanging underneath" split. DocumentEditor
  // keeps the legacy body-only behaviour because it is an auxiliary
  // editing surface, not page chrome.
  const isAccessPanel = !editorTarget && panelState.type === 'access_list';
  const isPageSheet = !editorTarget && panelState.type !== 'none';
  const isTopAlignedSheet = isPageSheet && !isAccessPanel;

  return (
    <ResizablePanel
      isVisible={!!editorTarget || panelState.type !== 'none'}
      topOffset={isTopAlignedSheet ? 46 : 0}
      zIndex={isTopAlignedSheet ? 80 : 20}
      borderLeftColor="var(--po-divider)"
      background={isPageSheet ? 'var(--po-canvas)' : 'var(--po-panel)'}
      width={panelWidth}
      onWidthChange={onPanelWidthChange}
    >
      {editorTarget && (
        <DocumentEditor
          path={editorTarget.path}
          value={documentSession.content}
          dirty={documentSession.dirty}
          saveStatus={documentSession.status}
          saveError={documentSession.error}
          onChange={documentSession.onChange}
          onSave={documentSession.save}
          onDiscard={documentSession.discard}
          onClose={closeDocumentEditor}
          isFullScreen={isEditorFullScreen}
          onToggleFullScreen={onToggleEditorFullScreen}
        />
      )}

      {!editorTarget && panelState.type === 'version_history' && panelState.nodeId && (
        <VersionHistoryPanel
          nodeId={panelState.nodeId}
          projectId={projectId}
          onClose={onClose}
          onRollbackComplete={onRollbackComplete}
        />
      )}

      {!editorTarget && panelState.type === 'sync_config' && syncConfigId && (
        <SyncConfigPanel
          mode="detail"
          syncId={syncConfigId}
          projectId={projectId}
          onClose={onClose}
          onBack={backToAccessList}
        />
      )}

      {!editorTarget && panelState.type === 'sync_config' && !activeSyncId && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
          {!syncStatusData ? (
            <PageLoading variant="fill" />
          ) : (
            <>
              <span style={{ color: 'var(--po-text-disabled)', fontSize: 13 }}>No access configured</span>
              <button
                onClick={() => {
                  const nodeId = panelState.nodeId ?? panelScopePath;
                  const segs = nodeId.split('/').filter(Boolean);
                  onOpenSyncSetting('_generic', {
                    path: nodeId,
                    nodeName: segs.length > 0 ? segs[segs.length - 1] : 'Root',
                    nodeType: 'folder',
                    readonly: true,
                  });
                  onCreateIntegration(nodeId);
                }}
                style={{
                  height: 30, padding: '0 14px', fontSize: 12, fontWeight: 500,
                  background: 'var(--po-control)', border: '1px solid var(--po-border-strong)',
                  borderRadius: 6, color: 'var(--po-text)', cursor: 'pointer',
                }}
              >
                + New Integration
              </button>
            </>
          )}
        </div>
      )}

      {!editorTarget && panelState.type === 'sync_create' && (
        <SyncConfigPanel
          mode="create"
          syncId={null}
          projectId={projectId}
          onClose={onClose}
          onBack={backToAccessList}
          onSyncCreated={onSyncCreated}
          scopeBoundary={currentScope?.path}
          scopeBoundaryLabel={currentScope?.name}
          presetAgentType={panelState.agentTypePreselect}
        />
      )}

      {!editorTarget && panelState.type === 'access_list' && (
        <ScopedConnectorsListPanel
          scope={currentScope}
          scopes={scopes}
          currentScopePath={panelScopePath}
          projectId={projectId}
          connectors={currentScopeConnectors}
          connectorsByTarget={connectorsByTarget}
          providerIcons={providerIcons}
          onScopeHover={onAccessPointHover}
          onScopeMutated={onScopeMutated}
          onOpenAgentChat={(agentId, scopePath) => onOpenPanel({ type: 'agent_chat', nodeId: scopePath, agentId })}
          // Overview → Detail drill-down. Routed through panel state
          // alone; the file tree is intentionally untouched so the
          // user keeps their current document open while inspecting
          // a sibling scope's configuration.
          onSelectScope={(scopeId) =>
            onOpenPanel({ type: 'access_list', view: 'detail', selectedTargetKey: scopeId })
          }
          // Overview's "+ Create new access point" CTA opens the same
          // CreateAccessModal used by folder row actions. The sidebar
          // remains a discovery/management surface; it does not own a
          // parallel create form or duplicate create state.
          onCreateRequested={() =>
            onCreateAccessPoint(panelScopePath)
          }
          // Detail → Overview pop. Always present in Detail mode,
          // regardless of how the user landed there (drill-down OR
          // auto-followed from a scope folder). This gives the user a
          // single, predictable affordance to reach the management
          // surface from anywhere in the access_list flow.
          onBack={
            accessListView === 'settings' && currentScope
              ? () => onOpenPanel({
                  type: 'access_list',
                  view: 'detail',
                  selectedTargetKey: repositoryViewKey(currentScope),
                })
              : accessListView === 'detail'
              ? () => onOpenPanel({ type: 'access_list', view: 'overview' })
              : undefined
          }
          onClose={onClose}
          hideHeader={isAccessPanel}
          settingsPage={accessListView === 'settings'}
          onOpenSettings={
            currentScope
              ? () => onOpenPanel({
                  type: 'access_list',
                  view: 'settings',
                  selectedTargetKey: repositoryViewKey(currentScope),
                })
              : undefined
          }
          onNavigationGuardChange={onAccessPanelNavigationGuardChange}
          onAddRequested={() => {
            const segs = panelScopePath.split('/').filter(Boolean);
            onOpenSyncSetting('_generic', {
              path: panelScopePath,
              nodeName: segs.length > 0 ? segs[segs.length - 1] : 'Root',
              nodeType: 'folder',
              readonly: false,
            });
            onCreateIntegration(panelScopePath);
          }}
          onConnectorClick={(c) => {
            // After the 2026-05-06 redesign, ConnectMethodsBlock owns
            // the cli + agent built-ins inline — by the time we get
            // here, the connector is always third-party and we just
            // route into the sync_config detail panel.
            onOpenPanel({ type: 'sync_config', nodeId: panelScopePath, accessEndpointId: c.id });
          }}
        />
      )}

      {!editorTarget && panelState.type === 'mcp_config' && panelState.mcpEndpointId && (
        <McpConfigPanel endpoint={mcpEndpointDetail} onClose={onClose} onBack={backToAccessList} />
      )}

      {!editorTarget && panelState.type === 'sandbox_config' && panelState.sandboxEndpointId && (
        <SandboxConfigPanel endpoint={sandboxEndpointDetail} onClose={onClose} onBack={backToAccessList} />
      )}

      {/* agent_chat view — gated on the AI_AGENT_ENABLED feature flag.
          With the flag off, every entry point that opens this view
          (the AI Agent MethodCard's "Open chat" button, the access
          page's AgentBody, etc.) is also hidden, so this branch
          shouldn't be reachable through normal navigation. We still
          gate here defensively in case stale `panelState` from a
          previous session (or a hand-crafted URL) lands us with
          `type: 'agent_chat'` — under the flag we render nothing
          and the panel just collapses to its empty state. */}
      {AI_AGENT_ENABLED && panelState.type === 'agent_chat' && (() => {
        const agentId = panelState.agentId;
        const chatAgent = agentId ? savedAgents.find(agent => agent.id === agentId) : null;
        if (!chatAgent) {
          return !editorTarget ? (
            <PanelShell title="Chat Agent" onClose={onClose} onBack={backToAccessList}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--po-text-disabled)', fontSize: 13 }}>Agent not found</div>
            </PanelShell>
          ) : null;
        }

        const tools: AccessOption[] = [];
        if (chatAgent.resources) {
          for (const res of chatAgent.resources) {
            tools.push({
              id: `bash:${res.path}`,
              label: `${res.nodeName || res.path} · Bash${res.readonly ? ' (Read-only)' : ''}`,
              type: 'bash' as const,
              tableId: res.path,
              tableName: res.nodeName || res.path,
            });
          }
        }

        return (
          <div style={{ display: editorTarget ? 'none' : 'contents' }}>
            <ChatRuntimeView
              availableTools={tools}
              tableData={currentTableData?.data}
              tableId={activeNodeId}
              projectId={projectId}
              onDataUpdate={onDataUpdate}
              projectTools={projectTools}
              onClose={onClose}
              onBack={backToAccessList}
            />
          </div>
        );
      })()}
    </ResizablePanel>
  );
}
