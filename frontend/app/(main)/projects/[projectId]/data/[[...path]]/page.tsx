'use client';

/**
 * Data Page - File/Folder Browser & Node Editor
 *
 * URL Format:
 *   /projects/{projectId}/data                    -> Project root (folder view)
 *   /projects/{projectId}/data/{folderId}         -> Folder view
 *   /projects/{projectId}/data/{folderId}/{nodeId} -> Node editor
 */

import { useEffect, useMemo, useState, useRef, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  useProjects,
  useToolsByPath,
  refreshToolsByPath,
  refreshProjectTools,
  useTable,
  useContentNodes,
  refreshAllContentNodes,
} from '@/lib/hooks/useData';
import { useDataLayout } from '../DataLayoutContext';
import {
  ProjectsHeader,
  type EditorType,
  type ViewType,
  type BreadcrumbSegment,
} from '@/components/ProjectsHeader';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import {
  createTool,
  deleteTool,
  type McpToolPermissions,
  type McpToolType,
  type Tool,
  type AccessPoint,
} from '@/lib/mcpApi';

import { refreshProjects } from '@/lib/hooks/useData';
import type { RepoScope } from '@/lib/repoApi';
import {
  GridView,
  type AgentResource,
  type ContentType,
} from '../components/views';
import {
  ExplorerSidebar,
  setPendingActiveId,
  usePendingActiveId,
  type MillerColumnItem,
} from '../components/explorer';

import { useAgent } from '@/contexts/AgentContext';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

// Extracted hooks
import { usePathResolver } from '../hooks/usePathResolver';
import { useMarkdownAutoSave } from '../hooks/useMarkdownAutoSave';
import { useFileImport } from '../hooks/useFileImport';
import { useNodeActions } from '../hooks/useNodeActions';

// Extracted components
import { EditorArea } from '../components/EditorArea';
import { BottomBar } from '../components/BottomBar';
import { DataPageDialogs } from '../components/DataPageDialogs';
import { DataPageOverlays } from '../components/DataPageOverlays';
import { EmptyWorkspaceState } from '../../../components/EmptyWorkspaceState';
import {
  AccessPointsHeaderButton,
  endpointToPanelState,
} from '../components/access-points';
import { DataPageRightPanel, type EditorTarget } from '../components/right-panel';
import { usePanelStore } from '../usePanelStore';
import { useDataCreateFlow } from '../hooks/useDataCreateFlow';
import { useAccessPointEntries } from '../hooks/useAccessPointEntries';

interface DataPageProps {
  params: Promise<{ projectId: string; path?: string[] }>;
}

function decodePath(segments: string[]): string[] {
  return segments.map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
}

export default function DataPage({ params }: DataPageProps) {
  const { projectId, path: rawPath = [] } = use(params);
  const path = decodePath(rawPath);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { currentOrg } = useOrganization();

  // Workspace context
  const {
    setTableData,
    setTableId,
    setProjectId,
    setTableNameById,
    setAccessPoints: setAccessPointsToContext,
    setOnDataUpdate,
  } = useWorkspace();

  // Data fetching
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id);

  // Project-level data from layout (sync status, tools, endpoints, scopes, connectors)
  const {
    syncStatusData, mutateSyncStatus, projectTools, syncEndpoints, nodeEndpointMap,
    scopes, connectorsByScope, repoIdentity, mutateRepo,
  } = useDataLayout();

  // Agent context (needed early for syncEndpoints merge)
  const { draftResources, setDraftResources, currentAgentId, savedAgents, hoveredAgentId, openSyncSetting, editingAgentId, selectedSyncId, selectedSyncNodeId, hoveredSyncNodeId, selectAgent } = useAgent();

  // Auto-complete onboarding steps
  const { completeStep } = useOnboarding();
  useEffect(() => {
    if (savedAgents.length > 0) completeStep('agent');
  }, [savedAgents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // View & editor type — persisted in localStorage
  const [viewType, setViewTypeState] = useState<ViewType>(() => {
    if (typeof window === 'undefined') return 'explorer';
    const saved = localStorage.getItem('puppyone-view-type');
    if (saved === 'grid' || saved === 'explorer') return saved;
    return 'explorer';
  });

  const [editorType, setEditorTypeState] = useState<EditorType>(() => {
    if (typeof window === 'undefined') return 'table';
    const saved = localStorage.getItem('puppyone-editor-type');
    if (saved === 'table' || saved === 'monaco') return saved;
    return 'table';
  });

  const setViewType = (v: ViewType) => { setViewTypeState(v); localStorage.setItem('puppyone-view-type', v); };
  const setEditorType = (e: EditorType) => { setEditorTypeState(e); localStorage.setItem('puppyone-editor-type', e); };

  // Legacy welcome query param — strip it without triggering old onboarding guide
  const hasWelcomeParam = searchParams.get('welcome') === 'true';
  useEffect(() => {
    if (hasWelcomeParam) {
      router.replace(`/projects/${projectId}/data`);
    }
  }, [hasWelcomeParam, projectId, router]);


  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);
  const [hoverHighlightNodeId, setHoverHighlightNodeId] = useState<string | null>(null);

  // ───── Custom Hooks ─────

  const {
    currentFolderId, folderBreadcrumbs, isResolvingPath,
    activeNodeId, activeNodeType, activePreviewType, activeMimeType,
    markdownContent, setMarkdownContent, isLoadingMarkdown,
    markdownViewMode, setMarkdownViewMode,
  } = usePathResolver(projectId, path);

  const { nodes: contentNodes, isLoading: contentNodesLoading, refresh: refreshCurrentNodes } = useContentNodes(projectId, currentFolderId);

  const { handleMarkdownChange, markdownSaveStatus } = useMarkdownAutoSave(activeNodeId, projectId, setMarkdownContent);

  const fileImport = useFileImport(projectId, session?.access_token);

  const nodeActions = useNodeActions(projectId, currentFolderId);

  // Derive active node info (single source of truth for editor context)
  // pendingActiveId fills the gap before usePathResolver finishes resolving
  const pendingActiveId = usePendingActiveId();
  const effectiveNodeId = pendingActiveId || activeNodeId;

  // ───── Panel State (Zustand store, fully decoupled from URL) ─────
  const { panel: panelState, openPanel, closePanel, togglePanel } = usePanelStore();

  const activeSyncNodeId = panelState.type === 'sync_config' ? panelState.nodeId ?? null : null;
  const activeSyncId = activeSyncNodeId !== null ? (syncEndpoints.get(activeSyncNodeId)?.syncId ?? null) : null;

  // ───── Navigation (path only, panel state is independent) ─────

  const navigateTo = useCallback((nextPath: string[], typeHint?: string) => {
    const encoded = nextPath.map(s => encodeURIComponent(s)).join('/');
    const basePath = `/projects/${projectId}/data${encoded ? `/${encoded}` : ''}`;
    const url = typeHint ? `${basePath}?type=${encodeURIComponent(typeHint)}` : basePath;
    router.push(url);
  }, [projectId, router]);

  // Used by AllScopesList in ScopedConnectorsListPanel: jump the file
  // explorer (and hence currentScopePath / currentScope resolution) to a
  // given scope's canonical path. '' means the project root.
  const handleScopeNavigate = useCallback((scopePath: string) => {
    navigateTo(scopePath.split('/').filter(Boolean));
  }, [navigateTo]);

  // Click handler for the per-scope "AI Agent" default in
  // ScopedConnectorsListPanel. Pre-fills the draft resource with the
  // scope's folder so the chat-agent form's drop zone is already
  // populated, then opens sync_create with `agentTypePreselect: 'chat'`
  // — SyncConfigPanel auto-skips the type picker and lands on the
  // chat-agent form (image 1 in the boss's mock).
  const handleAgentDefaultRequested = useCallback((scope: RepoScope) => {
    setDraftResources([
      {
        path: scope.path,
        nodeName: scope.name,
        nodeType: 'folder',
        readonly: false,
      },
    ]);
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    openPanel({ type: 'sync_create', agentTypePreselect: 'chat' });
  }, [openPanel, setDraftResources]);

  const closeRightPanel = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    closePanel();
  }, [closePanel]);

  const openVersionHistoryPanel = useCallback(() => {
    if (!effectiveNodeId) return;
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    openPanel({ type: 'version_history', nodeId: effectiveNodeId });
  }, [effectiveNodeId, openPanel]);

  const openSyncCreatePanel = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    openPanel({ type: 'sync_create' });
  }, [openPanel]);

  // Same as openSyncCreatePanel, but with a *given* folder path
  // pre-filled as the target resource.  Two callsites:
  //   - sidebar header "Connect" button → passes the user's
  //     current navigation focus
  //   - per-folder row plug button → passes that row's own folder id
  // Either way the panel lands ready-to-create — the user picks a
  // provider type and clicks Create, instead of going through the
  // old "open empty panel → drag folder from sidebar" flow.
  //
  // `folderPath` is normalised in two ways:
  //   - null/undefined → '' (project root, the canonical "root
  //     scope" key used elsewhere in the codebase via
  //     `accessByPath` etc.)
  //   - a non-empty path → trailing segment becomes the chip's
  //     human-readable nodeName so the pre-filled chip reads as
  //     something more useful than an opaque blob
  const openSyncCreatePanelForFolder = useCallback(
    (folderPath: string | null | undefined) => {
      const targetPath = folderPath ?? '';
      const segments = targetPath.split('/').filter(Boolean);
      const nodeName =
        segments.length > 0 ? segments[segments.length - 1] : 'Root';
      setDraftResources([
        {
          path: targetPath,
          nodeName,
          nodeType: 'folder',
          readonly: false,
        },
      ]);
      setEditorTarget(null);
      setIsEditorFullScreen(false);
      openPanel({ type: 'sync_create' });
    },
    [openPanel, setDraftResources],
  );

  const handleSyncCreated = useCallback(async (nodeId: string) => {
    await mutateSyncStatus();
    refreshCurrentNodes();
    openPanel({ type: 'sync_config', nodeId });
  }, [mutateSyncStatus, refreshCurrentNodes, openPanel]);

  // ───── Table & Tools ─────

  const { tools: tableTools, isLoading: toolsLoading } = useToolsByPath(activeNodeId);
  const { tableData: currentTableData, refresh: refreshTable } = useTable(projectId, activeNodeId);

  // Access points state
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const lastSyncedTableId = useRef<string | null>(null);

  // Dialog states
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  // Supabase connector
  const [supabaseConnectOpen, setSupabaseConnectOpen] = useState(false);
  const [supabaseSQLEditorOpen, setSupabaseSQLEditorOpen] = useState(false);
  const [supabaseConnectionId, setSupabaseConnectionId] = useState<string | null>(null);

  const {
    createTableOpen,
    defaultStartOption,
    createMenuOpen,
    createMenuOpenForId,
    createMenuOpenAction,
    createMenuPosition,
    createMenuAccessOnly,
    createMenuRef,
    createMenuActions,
    highlightNodeId,
    handleCreateClick,
    handleMillerCreateClick,
    handleAccessMenuClick,
    closeCreateTable,
  } = useDataCreateFlow({
    projectId,
    currentFolderId,
    navigateTo,
    openSyncCreatePanel,
    openSyncSetting,
  });

  const agentResources: AgentResource[] = useMemo(() => {
    const toAgentResource = (r: { path: string; readonly?: boolean }) => ({
      path: r.path,
      readonly: r.readonly ?? true,
    });

    if (hoveredSyncNodeId) return [{ path: hoveredSyncNodeId, readonly: true }];
    if (hoveredAgentId) {
      const agent = savedAgents.find(a => a.id === hoveredAgentId);
      if (agent?.resources && agent.resources.length > 0) return agent.resources.map(toAgentResource);
    }
    if (panelState.type === 'sync_create' || editingAgentId) return draftResources.map(toAgentResource);
    if (currentAgentId) {
      const agent = savedAgents.find(a => a.id === currentAgentId);
      if (agent?.resources && agent.resources.length > 0) return agent.resources.map(toAgentResource);
    }
    if (selectedSyncId && selectedSyncNodeId) {
      return [{ path: selectedSyncNodeId, readonly: true }];
    }
    return [];
  }, [draftResources, editingAgentId, currentAgentId, savedAgents, hoveredAgentId, selectedSyncId, selectedSyncNodeId, hoveredSyncNodeId, panelState.type]);

  const activeProject = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // ───── Effects ─────

  useEffect(() => {
    if (panelState.type === 'agent_chat' && panelState.agentId) {
      if (currentAgentId !== panelState.agentId) {
        selectAgent(panelState.agentId);
      }
    }
  }, [panelState.type, panelState.agentId, currentAgentId, selectAgent]);

  // Refresh on external events (SaaS sync, ETL, etc.)
  useEffect(() => {
    const handler = () => { refreshAllContentNodes(projectId); refreshProjects(currentOrg?.id); };
    window.addEventListener('saas-task-completed', handler);
    window.addEventListener('etl-task-completed', handler);
    return () => { window.removeEventListener('saas-task-completed', handler); window.removeEventListener('etl-task-completed', handler); };
  }, [projectId]);

  // Sync access points from tools
  useEffect(() => {
    if (!activeNodeId || toolsLoading) return;
    if (activeNodeId === lastSyncedTableId.current) return;

    const pathPermissionsMap = new Map<string, McpToolPermissions>();
    tableTools.forEach(tool => {
      const toolPath = tool.json_path || '';
      const existing = pathPermissionsMap.get(toolPath) || {};
      pathPermissionsMap.set(toolPath, { ...existing, [tool.type]: true });
    });

    const initialAccessPoints: AccessPoint[] = [];
    pathPermissionsMap.forEach((permissions, toolPath) => {
      initialAccessPoints.push({ id: `saved-${toolPath || 'root'}`, path: toolPath, permissions });
    });
    setAccessPoints(initialAccessPoints);
    lastSyncedTableId.current = activeNodeId;
  }, [activeNodeId, toolsLoading, tableTools]);

  // Sync state to WorkspaceContext
  useEffect(() => { setProjectId(projectId); }, [projectId, setProjectId]);
  useEffect(() => { setTableId(activeNodeId); }, [activeNodeId, setTableId]);
  useEffect(() => { setTableData(currentTableData?.data); }, [currentTableData?.data, setTableData]);

  const tableNameByIdRef = useRef<string>('');
  const tableNameById = useMemo(() => {
    const map: Record<string, string> = {};
    contentNodes.forEach(node => { map[node.path || node.id] = node.name; });
    if (currentTableData?.id && currentTableData?.name) map[currentTableData.id] = currentTableData.name;
    return map;
  }, [contentNodes, currentTableData?.id, currentTableData?.name]);

  useEffect(() => {
    const key = JSON.stringify(tableNameById);
    if (key !== tableNameByIdRef.current) { tableNameByIdRef.current = key; setTableNameById(tableNameById); }
  }, [tableNameById, setTableNameById]);

  const { accessPointEntries, providerIcons } = useAccessPointEntries({
    nodeEndpointMap,
    savedAgents,
    tableNameById,
    syncStatusData,
  });

  useEffect(() => { setAccessPointsToContext(accessPoints); }, [accessPoints, setAccessPointsToContext]);
  useEffect(() => {
    setOnDataUpdate(async () => { await refreshTable(); });
    return () => setOnDataUpdate(null);
  }, [refreshTable, setOnDataUpdate]);

  // ───── Tool Sync Helpers ─────

  const TOOL_TYPES: McpToolType[] = ['search', 'query_data', 'get_all_data', 'create', 'update', 'delete'];

  function normalizeJsonPath(p: string) { if (!p || p === '/') return ''; return p; }

  async function syncToolsForPath(params: { mutPath: string; path: string; permissions: McpToolPermissions; existingTools: Tool[] }) {
    const { mutPath, path: toolPath, permissions, existingTools } = params;
    const jsonPath = normalizeJsonPath(toolPath);
    const byType = new Map<string, Tool>();
    for (const t of existingTools) {
      if (t.path !== mutPath) continue;
      if ((t.json_path || '') !== jsonPath) continue;
      const toolType = t.type as string;
      if (toolType === 'shell_access' || toolType === 'shell_access_readonly') continue;
      byType.set(t.type, t);
    }
    const effectivePermissions: Record<string, boolean> = { ...(permissions as any) };
    const toDelete: string[] = [];
    const toCreate: McpToolType[] = [];
    for (const type of TOOL_TYPES) {
      const enabled = !!effectivePermissions[type];
      const existing = byType.get(type);
      if (!enabled && existing) toDelete.push(existing.id);
      if (enabled && !existing) toCreate.push(type);
    }
    for (const id of toDelete) await deleteTool(id);
    for (const type of toCreate) {
      await createTool({
        path: mutPath, json_path: jsonPath, type,
        name: `${type}_${mutPath}_${jsonPath ? jsonPath.replaceAll('/', '_') : 'root'}`,
        description: undefined,
      });
    }
  }

  async function deleteAllToolsForPath(params: { mutPath: string; path: string; existingTools: Tool[] }) {
    const { mutPath, path: toolPath, existingTools } = params;
    const jsonPath = normalizeJsonPath(toolPath);
    const toDelete = existingTools.filter(t => t.path === mutPath && (t.json_path || '') === jsonPath);
    for (const t of toDelete) await deleteTool(t.id);
  }

  // ───── View Helpers ─────

  const items = contentNodes.map(node => ({
    id: node.path,
    name: node.name,
    type: node.type as ContentType,
    mut_path: node.mut_path,
    description: node.type === 'folder' ? 'Folder' :
                 node.type === 'json' ? 'JSON' :
                 node.type === 'markdown' ? 'Markdown' :
                 node.type === 'file' ? 'File' : 'Unknown',
    is_synced: false,
    sync_source: null as string | null,
    sync_url: null as string | null,
    sync_status: 'not_connected' as const,
    last_synced_at: null as string | null,
    preview_snippet: null as string | null,
    children_count: node.children_count,
    onClick: () => {
      if (node.type !== 'folder') setPendingActiveId(node.path);
      navigateTo(node.path.split('/').filter(Boolean), node.type || undefined);
    },
  }));

  const handleMillerNavigate = useCallback((item: MillerColumnItem) => {
    setPendingActiveId(item.id);
    navigateTo(item.id.split('/').filter(Boolean), item.type || undefined);
  }, [navigateTo]);

  const handleRefresh = async (path: string) => {
    alert(`Refresh not yet implemented for path: ${path}`);
  };

  // ───── Breadcrumbs ─────
  // Text-only segments. Per design: the page header is just the
  // address line — no project box, no folder/markdown/file glyphs,
  // no per-segment color tinting. Type-specific iconography stays in
  // the file tree (where it's functional for scanning), the header
  // stays quiet so the user's eye doesn't compete with the workspace
  // chip on the sidebar.

  const pathSegments = useMemo<BreadcrumbSegment[]>(() => {
    const segments: BreadcrumbSegment[] = [];
    const projectName = activeProject?.name || projectId;
    const hasSubContent = path.length > 0 || currentFolderId || activeNodeId;
    segments.push({
      label: projectName,
      href: hasSubContent ? `/projects/${projectId}/data` : undefined,
    });

    if (isResolvingPath && path.length > 0 && folderBreadcrumbs.length === 0) {
      path.forEach(() => {
        segments.push({ label: '…' });
      });
    } else {
      folderBreadcrumbs.forEach((folder, index) => {
        const isLast = index === folderBreadcrumbs.length - 1;
        // folder.id is the full path up to this folder segment
        const folderUrlPath = folder.id.split('/').filter(Boolean).map(s => encodeURIComponent(s)).join('/');
        segments.push({
          label: folder.name,
          href: !isLast || activeNodeId ? `/projects/${projectId}/data/${folderUrlPath}` : undefined,
        });
      });
      if (activeNodeId && currentTableData) {
        segments.push({ label: currentTableData.name });
      } else if (activeNodeId) {
        segments.push({ label: '…' });
      }
    }
    return segments;
  }, [activeProject, projectId, folderBreadcrumbs, currentFolderId, activeNodeId, currentTableData, isResolvingPath, path]);

  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({ path: ap.path, permissions: ap.permissions }));
  }, [accessPoints]);

  // View logic flags
  const isEditorView = !!activeNodeId;
  const isFolderView = !activeNodeId;
  const isLoading = isResolvingPath || contentNodesLoading;

  // ───── Render ─────

  return (
    <>
      <DataPageDialogs
        projectId={projectId}
        currentFolderId={currentFolderId}
        projects={projects}
        activeProject={activeProject}
        renameDialogOpen={nodeActions.renameDialogOpen}
        renameTargetName={nodeActions.renameTarget?.name ?? ''}
        renameError={nodeActions.renameError}
        onCloseRename={nodeActions.closeRenameDialog}
        onRenameConfirm={nodeActions.handleRenameConfirm}
        moveDialogTarget={nodeActions.moveDialogTarget}
        onMoveConfirm={async (nodeId, targetFolderId) => {
          nodeActions.setMoveDialogTarget(null);
          await nodeActions.handleMoveNode(nodeId, targetFolderId);
        }}
        onCloseMove={() => nodeActions.setMoveDialogTarget(null)}
        createTableOpen={createTableOpen}
        onCloseCreateTable={closeCreateTable}
        defaultStartOption={defaultStartOption}
        createFolderOpen={createFolderOpen}
        onCloseFolderDialog={() => setCreateFolderOpen(false)}
        onFolderSuccess={() => refreshAllContentNodes(projectId)}
        supabaseConnectOpen={supabaseConnectOpen}
        onCloseSupabaseConnect={() => setSupabaseConnectOpen(false)}
        onSupabaseConnected={(connectionId) => {
          setSupabaseConnectOpen(false);
          setSupabaseConnectionId(connectionId);
          setSupabaseSQLEditorOpen(true);
        }}
        supabaseSQLEditorOpen={supabaseSQLEditorOpen}
        supabaseConnectionId={supabaseConnectionId}
        onCloseSupabaseSQLEditor={() => { setSupabaseSQLEditorOpen(false); setSupabaseConnectionId(null); }}
        onSupabaseSaved={() => refreshAllContentNodes(projectId)}
        fileImportDialogOpen={fileImport.fileImportDialogOpen}
        onCloseFileImport={fileImport.closeFileImportDialog}
        onFileImportConfirm={fileImport.handleFileImportConfirm}
        droppedFiles={fileImport.droppedFiles}
        fileImportTargetLabel={fileImport.fileImportTarget.name}
      />

      <DataPageOverlays
        toast={nodeActions.toast}
        createMenuOpen={createMenuOpen}
        createMenuPosition={createMenuPosition}
        createMenuAccessOnly={createMenuAccessOnly}
        createMenuRef={createMenuRef}
        createMenuActions={createMenuActions}
      />

      {/* Main Content
       *
       * Layout (matches the marketing showcase):
       *
       *   ┌──────────────────────────────────────────────────┐
       *   │ ProjectsHeader (Workspace / finance)   [Access]  │  <- 40px, full width
       *   ├────────────┬─────────────────────────────────────┤
       *   │            │                                     │
       *   │ Explorer   │ content / editor / grid             │
       *   │ (tree)     │                                     │
       *   │            │                                     │
       *   └────────────┴─────────────────────────────────────┘
       *
       * Header is hoisted OUT of the column row so a single hairline
       * runs unbroken across the explorer column boundary, the way
       * Linear / GitHub / Supabase do it. The previous structure had
       * ExplorerSidebar render its own "Workspace" header, which
       * broke the line into two segments.
       */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', overflow: 'hidden' } as React.CSSProperties}
      >
        {/* Top header bar — spans the full width of <main>, including
            over the ExplorerSidebar column. Renders ONE breadcrumb
            (`Workspace / finance / …`) and the Access points button. */}
        <div style={{ flexShrink: 0, zIndex: 60, display: 'flex', alignItems: 'stretch', height: 46 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProjectsHeader
              pathSegments={pathSegments}
              projectId={activeProject?.id ?? null}
              onProjectsRefresh={() => {}}
              accessPointCount={accessPoints.length}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', paddingRight: 8,
            borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0e0e0e',
            height: '100%',
            gap: 8,
          }}>
            <AccessPointsHeaderButton
              entries={accessPointEntries}
              isOpen={panelState.type === 'access_list'}
              onClick={() => togglePanel({ type: 'access_list' })}
            />
          </div>
        </div>

        {/* Body row: Explorer sidebar + content column + right panel */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>

          {/* Explorer Sidebar — no internal header, starts directly
              with the file tree so it sits flush under the unified
              ProjectsHeader above. */}
          <ExplorerSidebar
            projectId={projectId}
            currentPath={folderBreadcrumbs.map(f => ({ id: f.id, name: f.name }))}
            activeNodeId={
              (panelState.type !== 'none' && panelState.nodeId)
                ? panelState.nodeId
                : (activeNodeId || undefined)
            }
            onNavigate={handleMillerNavigate}
            onCreate={handleMillerCreateClick}
            onCreateSync={handleAccessMenuClick}
            onOpenAccess={(endpoints, nodeId) => {
              setHoverHighlightNodeId(null);
              if (endpoints.length === 1) {
                openPanel({ type: 'access_list', nodeId, accessEndpointId: endpoints[0].syncId });
                return;
              }
              openPanel({ type: 'access_list', nodeId });
            }}
            endpointByNodeId={nodeEndpointMap}
            onRename={nodeActions.handleRename}
            onDelete={nodeActions.handleDelete}
            onDownload={nodeActions.handleDownload}
            onFilesDrop={fileImport.openFileImportForTarget}
            onMoveNode={nodeActions.handleMoveNode}
            activeSyncNodeId={
              panelState.type === 'sync_config' || panelState.type === 'agent_chat' || panelState.type === 'mcp_config' || panelState.type === 'sandbox_config'
                ? (panelState.nodeId ?? null)
                : null
            }
            highlightNodeId={hoverHighlightNodeId || highlightNodeId}
            highlightVariant={hoverHighlightNodeId !== null ? 'access-point' : 'default'}
            createMenuOpenForId={createMenuOpenForId}
            createMenuOpenAction={createMenuOpenAction}
            style={{ width: 250, borderRight: '1px solid rgba(255,255,255,0.08)', background: 'transparent', flexShrink: 0 }}
          />

          {/* Content column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Loading state */}
            {isResolvingPath && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', background: '#0e0e0e' }}>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
                </svg>
              </div>
            )}

            {/* Editor View */}
            {isEditorView && !isResolvingPath && activeProject && (
              <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <EditorArea
                  activeNodeId={activeNodeId}
                  activeNodeType={activeNodeType}
                  activeMimeType={activeMimeType}
                  activeProject={activeProject}
                  currentTableData={currentTableData}
                  markdownContent={markdownContent}
                  isLoadingMarkdown={isLoadingMarkdown}
                  markdownSaveStatus={markdownSaveStatus}
                  markdownViewMode={markdownViewMode}
                  handleMarkdownChange={handleMarkdownChange}
                  setMarkdownViewMode={setMarkdownViewMode}
                  editorType={editorType}
                  configuredAccessPoints={configuredAccessPoints}
                  onActiveTableChange={(nodePath: string) => {
                    navigateTo(nodePath.split('/').filter(Boolean));
                  }}
                  onAccessPointChange={(apPath: string, permissions: McpToolPermissions) => {
                    const hasAnyPermission = Object.values(permissions).some(Boolean);
                    setAccessPoints(prev => {
                      const existing = prev.find(ap => ap.path === apPath);
                      if (existing) {
                        if (!hasAnyPermission) return prev.filter(ap => ap.path !== apPath);
                        return prev.map(ap => ap.path === apPath ? { ...ap, permissions } : ap);
                      } else if (hasAnyPermission) {
                        return [...prev, { id: `ap-${Date.now()}`, path: apPath, permissions }];
                      }
                      return prev;
                    });
                    if (activeNodeId) {
                      syncToolsForPath({ mutPath: activeNodeId, path: apPath, permissions, existingTools: tableTools as any }).then(() => {
                        refreshToolsByPath(activeNodeId);
                        refreshProjectTools(projectId);
                      });
                    }
                  }}
                  onAccessPointRemove={(apPath: string) => {
                    setAccessPoints(prev => prev.filter(ap => ap.path !== apPath));
                    if (activeNodeId) {
                      deleteAllToolsForPath({ mutPath: activeNodeId, path: apPath, existingTools: tableTools as any }).then(() => {
                        refreshToolsByPath(activeNodeId);
                        refreshProjectTools(projectId);
                      });
                    }
                  }}
                  onOpenDocument={(docPath: string, value: string) => {
                    setEditorTarget({ path: docPath, value });
                    setIsEditorFullScreen(false);
                    closePanel();
                  }}
                  onCreateTool={(path: string) => {
                    if (!activeNodeId) return;
                    nodeActions.handleCreateTool(activeNodeId, `${currentTableData?.name || 'File'}`, 'json', path);
                  }}
                />
              </div>
            )}

            {/* Folder View (Grid mode) */}
            {isFolderView && !isResolvingPath && (
              <div style={{ flex: 1, overflow: 'auto', padding: items.length === 0 && !currentFolderId ? 0 : 24, display: 'flex', flexDirection: 'column' }}>
                {isLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#525252', fontSize: 14 }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
                      </svg>
                      Loading...
                    </div>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                  </div>
                ) : items.length === 0 && !currentFolderId ? (
                  <EmptyWorkspaceState
                    project={activeProject}
                    onCreateClick={handleCreateClick}
                  />
                ) : (
                  <GridView
                    items={items}
                    parentFolderId={currentFolderId}
                    onCreateClick={handleCreateClick}
                    onRename={nodeActions.handleRename}
                    onDelete={nodeActions.handleDelete}
                    onRefresh={handleRefresh}
                    onMove={nodeActions.handleMoveRequest}
                    onMoveNode={nodeActions.handleMoveNode}
                    onCreateTool={nodeActions.handleCreateTool}
                    agentResources={agentResources}
                    highlightNodeId={hoverHighlightNodeId || highlightNodeId}
                  />
                )}
              </div>
            )}
          </div>

          <BottomBar
            viewType={viewType}
            setViewType={setViewType}
            editorType={editorType}
            setEditorType={setEditorType}
            markdownViewMode={markdownViewMode}
            setMarkdownViewMode={setMarkdownViewMode}
            isEditorView={isEditorView}
            activeNodeType={activeNodeType}
            activeProject={activeProject}
            currentTableData={currentTableData}
            markdownContent={markdownContent}
            isVersionHistoryOpen={panelState.type === 'version_history'}
            onOpenVersionHistory={openVersionHistoryPanel}
          />
        </div>

        {/* Right Panel */}
        <DataPageRightPanel
          editorTarget={editorTarget}
          isEditorFullScreen={isEditorFullScreen}
          panelState={panelState}
          projectId={projectId}
          activeNodeId={activeNodeId}
          activeSyncId={activeSyncId}
          currentTableData={currentTableData}
          syncStatusData={syncStatusData}
          projectTools={projectTools}
          savedAgents={savedAgents}
          accessPointEntries={accessPointEntries}
          providerIcons={providerIcons}
          scopes={scopes}
          connectorsByScope={connectorsByScope}
          currentScopePath={currentFolderId || ''}
          repoIdentity={repoIdentity}
          onClose={closeRightPanel}
          onEditorClose={() => { setEditorTarget(null); setIsEditorFullScreen(false); }}
          onEditorSave={(newValue) => {
            console.log('Save document:', editorTarget?.path, newValue);
            setEditorTarget(null);
            setIsEditorFullScreen(false);
          }}
          onToggleEditorFullScreen={() => setIsEditorFullScreen(!isEditorFullScreen)}
          onRollbackComplete={() => { refreshTable(); refreshCurrentNodes(); }}
          onSyncCreated={handleSyncCreated}
          onAccessPointHover={setHoverHighlightNodeId}
          onScopeMutated={mutateRepo}
          onScopeNavigate={handleScopeNavigate}
          onAgentDefaultRequested={handleAgentDefaultRequested}
          onOpenPanel={openPanel}
          onOpenSyncSetting={openSyncSetting}
          onDataUpdate={async () => { await refreshTable(); }}
        />
        </div>
      </div>
    </>
  );
}
