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
import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';

import { useAgent } from '@/contexts/AgentContext';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { matchScopeForPath } from '@/lib/repoApi';

// Extracted hooks
import { usePathResolver } from '../hooks/usePathResolver';
import { useMarkdownSave } from '../hooks/useMarkdownSave';
import { useFileImport } from '../hooks/useFileImport';
import { useNodeActions } from '../hooks/useNodeActions';
import { useGridSelection } from '../hooks/useGridSelection';
import { useExternalFileDropCatcher } from '@/lib/hooks/useExternalFileDropCatcher';

// Extracted components
import { EditorArea } from '../components/EditorArea';
import { BottomBar } from '../components/BottomBar';
import { DataPageDialogs } from '../components/DataPageDialogs';
import { DataPageOverlays } from '../components/DataPageOverlays';
import { EmptyWorkspaceState } from '../../../components/EmptyWorkspaceState';
import { AccessPointsHeaderButton } from '../components/access-points';
import { SelectionActionBar } from '../components/SelectionActionBar';
import { BulkDeleteDialog } from '../components/BulkDeleteDialog';
import { DataPageRightPanel, type EditorTarget } from '../components/right-panel';
import { usePanelStore } from '../usePanelStore';
import { useDataCreateFlow } from '../hooks/useDataCreateFlow';
import { useAccessPointEntries } from '../hooks/useAccessPointEntries';
import { PageLoading } from '@/components/loading';

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
  const { draftResources, setDraftResources, currentAgentId, savedAgents, hoveredAgentId, openSyncSetting, editingAgentId, selectedSyncId, selectedSyncNodeId, hoveredSyncNodeId, selectAgent, refreshAgents } = useAgent();

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
    // `textContent` here is the **server-side** value (any text-like
    // file: markdown, code, yaml, csv, plaintext). Fed into
    // `useMarkdownSave` as the dirty-check baseline. The page-level
    // editor draft (used by EditorArea) comes from the save hook
    // below — it may differ from the server value when the user has
    // unsaved markdown edits. Non-markdown text formats are
    // read-only, so for those the draft equals the server value.
    textContent: serverTextContent,
    isLoadingText,
    markdownViewMode, setMarkdownViewMode,
  } = usePathResolver(projectId, path);

  const { nodes: contentNodes, isLoading: contentNodesLoading, refresh: refreshCurrentNodes } = useContentNodes(projectId, currentFolderId);

  // Manual-save hook: editor edits stay local until the user hits
  // Cmd+S / clicks Save. Replaces the older 1.5s-debounced
  // auto-save which generated 100+ commits per editing session.
  // CLI / MUT / external writes still go through their own code
  // paths and are unaffected.
  const {
    markdownContent: editorTextDraft,
    handleMarkdownChange: onEditorTextChange,
    markdownSaveStatus: editorSaveStatus,
    save: saveEditor,
    dirty: editorDirty,
  } = useMarkdownSave({
    projectId,
    activeNodePath: activeNodeId,
    serverContent: serverTextContent,
  });

  // ── Cmd+S / Ctrl+S → save the active markdown editor ──────────
  //
  // The shortcut is global on the data page — listening on
  // `document` so it works regardless of which child element has
  // focus (sidebar, right panel, breadcrumb, etc.). We pre-empt
  // the browser's default "Save Page As…" dialog *only* when an
  // editor is actually mounted and has unsaved work; otherwise
  // we leave the default behaviour alone so the shortcut still
  // does something familiar in non-editor contexts (e.g. when
  // the user is on the access management page).
  //
  // We bind once and read the latest values via the dependency
  // array — the listener captures `saveEditor` etc. by closure
  // and React re-binds it on each render where the deps changed.
  // The cost of re-binding (one removeEventListener +
  // addEventListener) is negligible.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== 's' && event.key !== 'S') return;
      // Only intercept if there's actually something to save.
      // Without this guard we'd swallow Cmd+S on every page in the
      // app, which is hostile when the user is just trying to save
      // the browser tab (e.g. a long form they typed into).
      if (!editorDirty) return;
      event.preventDefault();
      void saveEditor();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [saveEditor, editorDirty]);

  // ── beforeunload guard for unsaved markdown edits ─────────────
  //
  // Browsers no longer let us customise the prompt copy (it always
  // shows their generic "Leave site?" dialog), but setting
  // `returnValue` to a non-empty string is still the documented way
  // to *trigger* it. We only attach the listener while there's
  // actually something dirty — otherwise every navigation in the
  // app would needlessly check this listener.
  useEffect(() => {
    if (!editorDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required for Chrome — the value itself is ignored by all
      // modern browsers, but a non-empty assignment is what
      // actually surfaces the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editorDirty]);

  const fileImport = useFileImport(projectId, session?.access_token);

  const nodeActions = useNodeActions(projectId, currentFolderId);

  // Page-wide safety net for external file drops. Without this, a
  // file dropped on the content area / right-panel / gap between
  // zones triggers the browser-default "open file in this tab"
  // behaviour — the user's session vanishes and the file appears
  // not to upload at all.
  //
  // The catcher runs silently (no full-page overlay): the explorer
  // sidebar already has its own per-row drop highlighting, and
  // overlaying a banner across the whole page on top of that read
  // as duplicated/confusing UI. So:
  //   - inside sidebar  → sidebar's own per-folder UI takes over
  //                       (its handlers stopPropagation/preventDefault
  //                       before this fallback ever runs)
  //   - outside sidebar → no visual cue, but on drop we still route
  //                       to the current folder so the file isn't
  //                       silently lost to a browser-default tab nav
  const externalDropTarget = useMemo(
    () => (currentFolderId
      ? { path: currentFolderId, name: folderBreadcrumbs.at(-1)?.name ?? 'Folder' }
      : { path: null, name: 'Root' }),
    [currentFolderId, folderBreadcrumbs],
  );
  useExternalFileDropCatcher({
    onDrop: (files) => {
      fileImport.openFileImportForTarget(files, externalDropTarget);
    },
  });

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

  const refreshRepoAndAgents = useCallback(async () => {
    await mutateRepo();
    await refreshAgents();
  }, [mutateRepo, refreshAgents]);

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

  const openSyncCreatePanel = useCallback((targetScopePath?: string | null) => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    openPanel({
      type: 'sync_create',
      nodeId: targetScopePath ?? currentFolderId ?? undefined,
    });
  }, [currentFolderId, openPanel]);

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
      openPanel({ type: 'sync_create', nodeId: targetPath });
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

  // ───── Multi-select ─────
  // Selection lives at this level so SelectionActionBar / BulkDeleteDialog
  // / the Esc / Delete hotkey handlers can all observe the same state.
  // GridView only renders the highlights; it doesn't own the truth.
  const orderedItemIds = useMemo(() => items.map((i) => i.id), [items]);
  const gridSelection = useGridSelection({ orderedIds: orderedItemIds });

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Snapshot the paths at "open dialog" time so refreshes between
  // opening and confirming don't shrink the set under the user's feet.
  const [bulkDeletePaths, setBulkDeletePaths] = useState<string[]>([]);
  const [bulkDeleteSubmitting, setBulkDeleteSubmitting] = useState(false);

  const openBulkDeleteDialog = useCallback(() => {
    if (gridSelection.selectedCount === 0) return;
    setBulkDeletePaths(gridSelection.selectedInOrder);
    setBulkDeleteOpen(true);
  }, [gridSelection.selectedCount, gridSelection.selectedInOrder]);

  const handleBulkDeleteConfirm = useCallback(
    async (permanent: boolean) => {
      if (!bulkDeletePaths.length) return;
      setBulkDeleteSubmitting(true);
      try {
        if (permanent) {
          // For permanent delete we need a different API call
          // (bulkRemoveFiles with permanent=true). Reach into the
          // raw API client because nodeActions.handleBulkDelete
          // only does soft delete.
          const { bulkRemoveFiles } = await import('@/lib/contentTreeApi');
          const { refreshFolderNodes } = await import('@/lib/hooks/useData');
          await bulkRemoveFiles(projectId, bulkDeletePaths, true);
          const parents = Array.from(
            new Set(
              bulkDeletePaths.map((p) =>
                p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '',
              ),
            ),
          );
          await refreshFolderNodes(projectId, ...parents);
          nodeActions.showToast(
            `Deleted ${bulkDeletePaths.length} item(s) permanently`,
          );
        } else {
          await nodeActions.handleBulkDelete(bulkDeletePaths);
        }
        gridSelection.clear();
      } finally {
        setBulkDeleteSubmitting(false);
      }
    },
    [bulkDeletePaths, nodeActions, gridSelection, projectId],
  );

  // Folder navigation invalidates any prior selection — selecting in
  // /docs and then navigating to /assets shouldn't leave a phantom
  // count on screen for items the user is no longer looking at.
  useEffect(() => {
    gridSelection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  // OS-aware shortcut hint (only used by SelectionActionBar's Delete
  // button tooltip, not the actual key binding).
  const platformDeleteHint = useMemo(() => {
    if (typeof navigator === 'undefined') return 'Delete';
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      ? '⌫'
      : 'Del';
  }, []);

  // Selection hotkeys: Delete / Backspace opens the dialog, Esc clears.
  // Guarded so they don't fire while the user is typing in an input
  // (rename dialog, search, etc.).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (gridSelection.selectedCount === 0) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        gridSelection.clear();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !bulkDeleteOpen) {
        e.preventDefault();
        openBulkDeleteDialog();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [gridSelection, bulkDeleteOpen, openBulkDeleteDialog]);

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

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        paths={bulkDeletePaths}
        onClose={() => {
          if (!bulkDeleteSubmitting) setBulkDeleteOpen(false);
        }}
        onConfirm={handleBulkDeleteConfirm}
      />

      <SelectionActionBar
        count={gridSelection.selectedCount}
        onClear={gridSelection.clear}
        onDelete={openBulkDeleteDialog}
        busy={bulkDeleteSubmitting}
        shortcutHint={platformDeleteHint}
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
          {/* Right slot of the header — Access entry. The vertical
              hairline on the left anchors the button into a "section"
              instead of letting it float as a standalone chip. Same
              ``rgba(255,255,255,0.08)`` alpha as every other divider
              in the chrome (sidebar / header bottom / footer top), so
              all four lines visually belong to the same grid. */}
          <div style={{
            display: 'flex', alignItems: 'center',
            paddingLeft: 12, paddingRight: 12,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            background: '#0e0e0e',
            height: '100%',
          }}>
            <AccessPointsHeaderButton
              // Project-level scope count, not per-folder integration
              // count. The button is a global entry to Pp.1 Overview;
              // its number should reflect the project's total access
              // surface ("you have 5 access points") rather than
              // whatever scope the file-tree cursor happens to match
              // (per 2026-05-08 UX spec).
              scopeCount={scopes.length}
              isOpen={panelState.type === 'access_list'}
              // Header chip is the canonical entry to Pp.1 Overview:
              // clicking "Access" always lands on the management home
              // page, never auto-resolves into Detail. Toggle is
              // type-only for access_list (see usePanelStore): the
              // panel auto-syncs to the current folder, so reopening
              // with a different nodeId would otherwise re-open
              // instead of closing.
              onClick={() => togglePanel({ type: 'access_list', view: 'overview' })}
            />
          </div>
        </div>

        {/* Body row: Explorer sidebar + content column + right panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            position: 'relative',
            // The right sheet lives inside this body row and is pulled
            // upward by 46px so its header replaces the page header's
            // right slot. The page header itself has zIndex 60; without
            // lifting the body row above it, the sheet is still painted
            // underneath the header and the old Access chip remains
            // visible (the exact bug seen in the screenshot).
            zIndex: 70,
          }}
        >

          {/* Explorer Sidebar — no internal header, starts directly
              with the file tree so it sits flush under the unified
              ProjectsHeader above.
              Wrapped in `ResizableSidebarColumn` so the user can drag
              the right edge to widen the file tree (long sync/AP
              names + deep paths quickly outgrow a fixed 250px). The
              storageKey persists per-page so the data view's preferred
              width doesn't bleed into history / access. */}
          <ResizableSidebarColumn
            storageKey='explorer-sidebar:data'
            defaultWidth={250}
            minWidth={220}
            maxWidth={480}
            style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
          >
            <ExplorerSidebar
              projectId={projectId}
              currentPath={folderBreadcrumbs.map(f => ({ id: f.id, name: f.name }))}
              activeNodeId={
                (panelState.type !== 'none' && panelState.nodeId !== undefined)
                  ? panelState.nodeId
                  : (activeNodeId || undefined)
              }
              onNavigate={handleMillerNavigate}
              onCreate={handleMillerCreateClick}
              // Per-folder access link button — Pp.2 trigger in the
              // 3-page Access hierarchy (2026-05-08 UX spec):
              //
              //   - Folder IS a scope    → Pp.2a Detail of that scope
              //                            (selectedScopeId pinned).
              //   - Folder is NOT a scope → Pp.2b Create, pre-filled
              //                            with the row's nodeId.
              //
              // Critical: we explicitly set `view='create'` for the
              // non-scope branch so the right panel opens DIRECTLY on
              // the create form pre-filled with the clicked folder.
              // Previously this routed to Overview which read
              // `currentScopePath` (= file-tree cursor), so clicking
              // /iiinote's chain icon while cursor was at Root made
              // Root the activated context — the user had to manually
              // navigate the file tree to /iiinote first. Now the
              // sidebar trigger fully owns the context, no manual
              // file-tree dance required.
              //
              // The chain icon and the row's "+" share this handler
              // so both surfaces produce identical navigation; the
              // event arg distinguishes them upstream if/when needed.
              onCreateSync={(_event, nodeId) => {
                setHoverHighlightNodeId(null);
                const matched = matchScopeForPath(nodeId, scopes);
                if (matched) {
                  openPanel({ type: 'access_list', view: 'detail', selectedScopeId: matched.id });
                } else {
                  openPanel({ type: 'access_list', view: 'create', nodeId });
                }
              }}
              onOpenAccess={(_endpoints, nodeId) => {
                setHoverHighlightNodeId(null);
                const matched = matchScopeForPath(nodeId, scopes);
                if (matched) {
                  openPanel({ type: 'access_list', view: 'detail', selectedScopeId: matched.id });
                } else {
                  openPanel({ type: 'access_list', view: 'create', nodeId });
                }
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
              style={{ flex: 1, width: '100%', background: 'transparent', minHeight: 0 }}
            />
          </ResizableSidebarColumn>

          {/* Content column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Loading state */}
            {isResolvingPath && (
              <div style={{ flex: 1, background: '#0e0e0e' }}>
                <PageLoading variant="fill" />
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
                  textContent={editorTextDraft}
                  isLoadingText={isLoadingText}
                  saveStatus={editorSaveStatus}
                  markdownViewMode={markdownViewMode}
                  onTextChange={onEditorTextChange}
                  onSave={saveEditor}
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
                  <div style={{ height: '100%', minHeight: 200 }}>
                    <PageLoading variant="fill" />
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
                    selectedIds={gridSelection.selectedIds}
                    onToggleSelected={gridSelection.toggle}
                    onRangeSelectTo={gridSelection.selectRangeTo}
                    onSelectOnly={gridSelection.selectOnly}
                    onClearSelection={gridSelection.clear}
                  />
                )}
              </div>
            )}
          </div>

          <BottomBar
            editorType={editorType}
            setEditorType={setEditorType}
            isEditorView={isEditorView}
            activeNodeId={activeNodeId}
            activeMimeType={activeMimeType}
            activeProject={activeProject}
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
          onScopeMutated={refreshRepoAndAgents}
          onOpenPanel={openPanel}
          onOpenSyncSetting={openSyncSetting}
          onDataUpdate={async () => { await refreshTable(); }}
        />
        </div>
      </div>
    </>
  );
}
