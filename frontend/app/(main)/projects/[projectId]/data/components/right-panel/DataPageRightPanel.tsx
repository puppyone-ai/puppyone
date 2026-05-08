'use client';

import { useEffect, useRef } from 'react';
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
  CreateAccessPointPanel,
  ScopedConnectorsListPanel,
  type EndpointEntry,
  type ProviderIconLookup,
} from '../access-points';
import { matchScopeForPath, type Connector, type RepoIdentity, type RepoScope } from '@/lib/repoApi';
import type { SyncStatusSync } from '../../DataLayoutContext';
import type { PanelState } from '../../usePanelStore';
import { PageLoading, InlineLoading } from '@/components/loading';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';

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
  readonly scopes: RepoScope[];
  /** Redesign 2026-05-02: connectors indexed by scope_id. */
  readonly connectorsByScope: Map<string, Connector[]>;
  /** Redesign 2026-05-02: current canonical URL path (empty string for root). */
  readonly currentScopePath: string;
  /** Redesign 2026-05-02: project identity payload (URL + prompt_template + scope keys). */
  readonly repoIdentity: RepoIdentity | undefined;
  readonly onClose: () => void;
  onEditorClose: () => void;
  onEditorSave: (newValue: string) => void;
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
  onOpenSyncSetting: (
    syncId: string,
    resource: { path: string; nodeName: string; nodeType: 'folder'; readonly: boolean },
  ) => void;
  onDataUpdate: () => Promise<void>;
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
  connectorsByScope,
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
  onOpenSyncSetting,
  onDataUpdate,
}: DataPageRightPanelProps) {
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
  // The Access surface is a 3-page hierarchy (per 2026-05-08 UX spec):
  //
  //   Pp.1 Overview      — list of all scopes, project-wide.
  //   Pp.2a Scope Detail — per-scope settings + connect methods.
  //   Pp.2b Create New   — dedicated form to promote a folder.
  //
  // Three signals drive which page renders:
  //
  //   1. `panelState.view`            — explicit user choice from a
  //                                     trigger (header → overview,
  //                                     row → detail, sidebar chain
  //                                     on non-scope → create, etc.).
  //   2. `panelState.selectedScopeId` — drill-down target id.
  //   3. `currentScopePath`           — file tree's current folder.
  //
  // Resolution precedence:
  //   - view === 'create'               → Create page (Pp.2b).
  //   - view === 'overview'             → Overview (Pp.1), hard.
  //   - selectedScopeId is set          → Detail of that scope.
  //   - currentScopePath matches scope  → Detail of that scope (auto).
  //   - otherwise                       → Overview (Pp.1).
  //
  // The user always has a way OUT of any Pp.2 sub-page: PanelShell's
  // back chevron resolves to view='overview' for both Detail and
  // Create — a single, predictable affordance back to the management
  // surface.
  //
  // No parent-child inheritance per the redesign Q1 decision
  // (2026-05-03) — exact match only.
  const drilledScope =
    panelState.type === 'access_list' && panelState.selectedScopeId
      ? scopes.find((s) => s.id === panelState.selectedScopeId) ?? null
      : null;
  const folderScope = matchScopeForPath(panelScopePath, scopes);

  const accessListView: 'overview' | 'detail' | 'create' =
    panelState.type === 'access_list' && panelState.view === 'create'
      ? 'create'
      : panelState.type === 'access_list' && panelState.view === 'overview'
        ? 'overview'
        : drilledScope || folderScope
          ? 'detail'
          : 'overview';

  const currentScope =
    accessListView === 'detail' ? drilledScope ?? folderScope : null;
  const currentScopeConnectors = currentScope
    ? connectorsByScope.get(currentScope.id) || []
    : [];

  // For Pp.2b Create, the prefill comes from `panelState.nodeId` (set
  // by whichever trigger opened the form), not from `currentScopePath`
  // — the file tree's cursor is independent of which folder the user
  // clicked the chain icon on.  Falls back to the file tree path when
  // the trigger didn't set one (e.g. Overview's "+ Create new" CTA
  // when the user is at the workspace root).
  const createPrefillPath =
    panelState.type === 'access_list' && panelState.view === 'create'
      ? panelState.nodeId ?? currentScopePath
      : currentScopePath;

  // File-tree navigation resets the panel's drill-down so the panel
  // resumes auto-following the explorer's cursor — but ONLY for
  // detail-mode drill-downs.  Pp.1 Overview and Pp.2b Create are
  // explicit user destinations: yanking them out from under the user
  // because they happened to click a folder in the file tree would be
  // a surprise. They stay sticky until the user explicitly navigates
  // away (back button / close).
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
        panelState.view !== 'create' &&
        (panelState.view !== undefined ||
          panelState.selectedScopeId !== undefined)
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
  const isTopAlignedSheet = !editorTarget && panelState.type !== 'none';

  return (
    <ResizablePanel
      isVisible={!!editorTarget || panelState.type !== 'none'}
      topOffset={isTopAlignedSheet ? 46 : 0}
      zIndex={isTopAlignedSheet ? 80 : 20}
      borderLeftColor={isTopAlignedSheet ? 'rgba(255,255,255,0.08)' : '#2a2a2a'}
      background={isTopAlignedSheet ? '#0e0e0e' : '#111111'}
    >
      {editorTarget && (
        <DocumentEditor
          path={editorTarget.path}
          value={editorTarget.value}
          onSave={onEditorSave}
          onClose={onEditorClose}
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
            <InlineLoading />
          ) : (
            <>
              <span style={{ color: '#525252', fontSize: 13 }}>No access configured</span>
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
                  onOpenPanel({ type: 'sync_create', nodeId });
                }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 500,
                  background: '#242424', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6, color: '#e4e4e7', cursor: 'pointer',
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

      {!editorTarget && panelState.type === 'access_list' && accessListView === 'create' && (
        <CreateAccessPointPanel
          prefillPath={createPrefillPath}
          scopes={scopes}
          projectId={projectId}
          onClose={onClose}
          // Pp.2b Create → Pp.1 Overview. Both Cancel button and the
          // PanelShell back chevron route through here so the user
          // always lands on the management surface, not back into
          // whatever previous panel state preceded the create flow.
          onBack={() => onOpenPanel({ type: 'access_list', view: 'overview' })}
          // On successful create, immediately drill into Pp.2a Detail
          // of the newly-created scope so the user sees the result of
          // their action without having to scan the Overview list for
          // the new row.
          onCreated={(scope) =>
            onOpenPanel({ type: 'access_list', view: 'detail', selectedScopeId: scope.id })
          }
          onMutated={onScopeMutated}
        />
      )}

      {!editorTarget && panelState.type === 'access_list' && accessListView !== 'create' && (
        <ScopedConnectorsListPanel
          scope={currentScope}
          scopes={scopes}
          currentScopePath={panelScopePath}
          projectId={projectId}
          connectors={currentScopeConnectors}
          connectorsByScope={connectorsByScope}
          providerIcons={providerIcons}
          onScopeHover={onAccessPointHover}
          onScopeMutated={onScopeMutated}
          onOpenAgentChat={(agentId, scopePath) => onOpenPanel({ type: 'agent_chat', nodeId: scopePath, agentId })}
          // Overview → Detail drill-down. Routed through panel state
          // alone; the file tree is intentionally untouched so the
          // user keeps their current document open while inspecting
          // a sibling scope's configuration.
          onSelectScope={(scopeId) =>
            onOpenPanel({ type: 'access_list', view: 'detail', selectedScopeId: scopeId })
          }
          // Overview's "+ Create new access point" CTA → Pp.2b Create.
          // Pre-fills the form with the current file-tree folder so
          // the typical "I'm here, give me access to here" flow is one
          // click. The user can still edit the path on the create
          // page if they meant somewhere else.
          onCreateRequested={() =>
            onOpenPanel({ type: 'access_list', view: 'create', nodeId: panelScopePath })
          }
          // Detail → Overview pop. Always present in Detail mode,
          // regardless of how the user landed there (drill-down OR
          // auto-followed from a scope folder). This gives the user a
          // single, predictable affordance to reach the management
          // surface from anywhere in the access_list flow.
          onBack={
            accessListView === 'detail'
              ? () => onOpenPanel({ type: 'access_list', view: 'overview' })
              : undefined
          }
          onClose={onClose}
          onAddRequested={() => {
            // "+ Add integration" opens the create panel pre-filled with
            // the current scope path. Will route through the new
            // connectors endpoint once the create flow is migrated.
            onOpenPanel({ type: 'sync_create', nodeId: panelScopePath });
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
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>Agent not found</div>
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
