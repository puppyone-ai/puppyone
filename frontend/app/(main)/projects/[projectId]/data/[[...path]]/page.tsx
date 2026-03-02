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
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useOrganization } from '@/contexts/OrganizationContext';
import { get } from '@/lib/apiClient';
import {
  useProjects,
  useTableTools,
  refreshTableTools,
  refreshProjectTools,
  useTable,
  useProjectTools,
  useContentNodes,
  refreshAllContentNodes,
} from '@/lib/hooks/useData';
import {
  ProjectsHeader,
  type EditorType,
  type ViewType,
  type BreadcrumbSegment,
} from '@/components/ProjectsHeader';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import {
  createTool,
  deleteTool,
  type McpToolPermissions,
  type McpToolType,
  type Tool,
  type AccessPoint,
} from '@/lib/mcpApi';

import { createFolder, createJsonNode, createMarkdownNode } from '@/lib/contentNodesApi';
import { refreshProjects } from '@/lib/hooks/useData';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import {
  GridView,
  ExplorerSidebar,
  ensureExpanded,
  setPendingActiveId,
  usePendingActiveId,
  type MillerColumnItem,
  type AgentResource,
  type ContentType,
  type SyncEndpointInfo,
} from '../components/views';

import { useAgent } from '@/contexts/AgentContext';
import { VersionHistoryPanel } from '@/components/editors/VersionHistoryPanel';
import { TaskStatusWidget } from '@/components/TaskStatusWidget';

// Extracted hooks
import { usePathResolver } from '../hooks/usePathResolver';
import { useMarkdownAutoSave } from '../hooks/useMarkdownAutoSave';
import { useFileImport } from '../hooks/useFileImport';
import { useNodeActions } from '../hooks/useNodeActions';

// Extracted components
import { EditorArea } from '../components/EditorArea';
import { BottomBar } from '../components/BottomBar';
import { DataPageDialogs, type CreateMenuActions } from '../components/DataPageDialogs';
import { SyncConfigPanel } from '../components/SyncConfigPanel';

type UrlPanelType = 'none' | 'version_history' | 'sync_config' | 'sync_create';

interface UrlPanelState {
  type: UrlPanelType;
  nodeId?: string;
}

interface EditorTarget {
  path: string;
  value: string;
}

interface DataPageProps {
  params: Promise<{ projectId: string; path?: string[] }>;
}

export default function DataPage({ params }: DataPageProps) {
  const { projectId, path = [] } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { currentOrg } = useOrganization();

  // Onboarding state
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);

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
  const { tools: projectTools } = useProjectTools(projectId);

  // Sync endpoints for file tree badges
  const { data: syncStatusData, mutate: mutateSyncStatus } = useSWR<{ syncs: { id: string; node_id: string; provider: string; direction: string; status: string }[] }>(
    projectId ? ['sync-status', projectId] : null,
    () => get(`/api/v1/connections/status?project_id=${projectId}`),
    { revalidateOnFocus: false },
  );
  const syncEndpoints = useMemo(() => {
    const map = new Map<string, SyncEndpointInfo>();
    if (syncStatusData?.syncs) {
      for (const s of syncStatusData.syncs) {
        if (s.node_id) map.set(s.node_id, { syncId: s.id, provider: s.provider, direction: s.direction, status: s.status });
      }
    }
    return map;
  }, [syncStatusData]);

  // View & editor type — persisted in localStorage
  const [viewType, setViewTypeState] = useState<ViewType>(() => {
    if (typeof window === 'undefined') return 'grid';
    const saved = localStorage.getItem('puppyone-view-type');
    if (saved === 'grid' || saved === 'explorer') return saved;
    return 'grid';
  });

  const [editorType, setEditorTypeState] = useState<EditorType>(() => {
    if (typeof window === 'undefined') return 'table';
    const saved = localStorage.getItem('puppyone-editor-type');
    if (saved === 'table' || saved === 'monaco') return saved;
    return 'table';
  });

  const setViewType = (v: ViewType) => { setViewTypeState(v); localStorage.setItem('puppyone-view-type', v); };
  const setEditorType = (e: EditorType) => { setEditorTypeState(e); localStorage.setItem('puppyone-editor-type', e); };

  // Welcome check (new user onboarding)
  useEffect(() => {
    const isWelcome = searchParams.get('welcome') === 'true';
    if (isWelcome) {
      refreshProjects(currentOrg?.id).then(() => {
        setShowOnboardingGuide(true);
        router.replace(`/projects/${projectId}/data`);
      });
    }
  }, [searchParams, projectId, router]);

  const handleOnboardingComplete = () => {
    sessionStorage.setItem(`onboarding-completed-${projectId}`, 'true');
  };

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);

  // ───── Custom Hooks ─────

  const {
    currentFolderId, folderBreadcrumbs, isResolvingPath,
    activeNodeId, activeNodeType, activePreviewType,
    markdownContent, setMarkdownContent, isLoadingMarkdown,
    markdownViewMode, setMarkdownViewMode,
  } = usePathResolver(projectId, path);

  const { nodes: contentNodes, isLoading: contentNodesLoading, refresh: refreshCurrentNodes } = useContentNodes(projectId, currentFolderId);

  const { handleMarkdownChange, markdownSaveStatus } = useMarkdownAutoSave(activeNodeId, projectId, setMarkdownContent);

  const fileImport = useFileImport(projectId, currentFolderId, session?.access_token);

  const nodeActions = useNodeActions(projectId, currentFolderId);

  // Derive active node info (single source of truth for editor context)
  // pendingActiveId fills the gap before usePathResolver finishes resolving
  const pendingActiveId = usePendingActiveId();
  const effectiveNodeId = pendingActiveId || activeNodeId;

  const urlPanelState = useMemo<UrlPanelState>(() => {
    const panel = searchParams.get('panel');
    const queryNodeId = searchParams.get('panelNodeId') || undefined;

    if (panel === 'history') {
      const nodeId = queryNodeId || effectiveNodeId || undefined;
      return nodeId ? { type: 'version_history', nodeId } : { type: 'none' };
    }
    if (panel === 'sync') {
      const nodeId = queryNodeId || effectiveNodeId || undefined;
      return nodeId ? { type: 'sync_config', nodeId } : { type: 'none' };
    }
    if (panel === 'sync-create') {
      return { type: 'sync_create' };
    }
    return { type: 'none' };
  }, [searchParams, effectiveNodeId]);

  const activeSyncNodeId = urlPanelState.type === 'sync_config' ? urlPanelState.nodeId ?? null : null;
  const activeSyncId = activeSyncNodeId ? (syncEndpoints.get(activeSyncNodeId)?.syncId ?? null) : null;

  const navigateWithPanelState = useCallback((
    nextPath: string[],
    nextPanel: UrlPanelState,
    navigation: 'push' | 'replace' = 'replace',
  ) => {
    const params = new URLSearchParams(searchParams.toString());

    if (nextPanel.type === 'none') {
      params.delete('panel');
      params.delete('panelNodeId');
    } else if (nextPanel.type === 'version_history') {
      params.set('panel', 'history');
      if (nextPanel.nodeId) params.set('panelNodeId', nextPanel.nodeId);
      else params.delete('panelNodeId');
    } else if (nextPanel.type === 'sync_config') {
      params.set('panel', 'sync');
      if (nextPanel.nodeId) params.set('panelNodeId', nextPanel.nodeId);
      else params.delete('panelNodeId');
    } else if (nextPanel.type === 'sync_create') {
      params.set('panel', 'sync-create');
      params.delete('panelNodeId');
    }

    const basePath = `/projects/${projectId}/data${nextPath.length > 0 ? `/${nextPath.join('/')}` : ''}`;
    const query = params.toString();
    const url = query ? `${basePath}?${query}` : basePath;
    if (navigation === 'push') {
      router.push(url);
      return;
    }
    router.replace(url);
  }, [projectId, router, searchParams]);

  const closeRightPanel = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    navigateWithPanelState(path, { type: 'none' }, 'replace');
  }, [navigateWithPanelState, path]);

  const openVersionHistoryPanel = useCallback(() => {
    if (!effectiveNodeId) return;
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    navigateWithPanelState(path, { type: 'version_history', nodeId: effectiveNodeId }, 'replace');
  }, [effectiveNodeId, navigateWithPanelState, path]);

  const openSyncCreatePanel = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    navigateWithPanelState(path, { type: 'sync_create' }, 'replace');
  }, [navigateWithPanelState, path]);

  const handleSyncCreated = useCallback(async (nodeId: string) => {
    await mutateSyncStatus();
    navigateWithPanelState(path, { type: 'sync_config', nodeId }, 'replace');
  }, [mutateSyncStatus, navigateWithPanelState, path]);

  // ───── Table & Tools ─────

  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(activeNodeId);
  const { tableData: currentTableData, refresh: refreshTable } = useTable(projectId, activeNodeId);

  // Access points state
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const lastSyncedTableId = useRef<string | null>(null);

  // Dialog states
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [defaultStartOption, setDefaultStartOption] = useState<'documents' | 'url'>('documents');

  // Supabase connector
  const [supabaseConnectOpen, setSupabaseConnectOpen] = useState(false);
  const [supabaseSQLEditorOpen, setSupabaseSQLEditorOpen] = useState(false);
  const [supabaseConnectionId, setSupabaseConnectionId] = useState<string | null>(null);

  // Create menu
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<{ x: number; y: number; anchorLeft: number } | null>(null);
  const [createInFolderId, setCreateInFolderId] = useState<string | null | undefined>(undefined);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Highlight newly created node
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const highlightCreatedNode = useCallback((nodeId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightNodeId(nodeId);
    highlightTimerRef.current = setTimeout(() => setHighlightNodeId(null), 2500);
  }, []);

  // ───── Agent Context ─────

  const { draftResources, sidebarMode, currentAgentId, savedAgents, hoveredAgentId, openSyncSetting, selectedSyncId, selectedSyncNodeId, hoveredSyncNodeId } = useAgent();

  const PROVIDER_NODE_TYPE: Record<string, 'json' | 'markdown' | 'folder'> = {
    gmail: 'json', calendar: 'json', sheets: 'json', linear: 'json', supabase: 'json',
    docs: 'markdown', github: 'folder', notion: 'folder',
  };
  const PROVIDER_DEFAULT_NAMES: Record<string, string> = {
    gmail: 'Gmail Inbox', calendar: 'Calendar Events', sheets: 'Sheet Data',
    linear: 'Linear Issues', docs: 'Document', github: 'GitHub Repo', notion: 'Notion Pages',
    supabase: 'Supabase Data',
  };
  const handleCreateAndSync = useCallback(async (saasProvider: string) => {
    const nodeType = PROVIDER_NODE_TYPE[saasProvider];
    if (!nodeType) { openSyncSetting(saasProvider); openSyncCreatePanel(); return; }
    const name = PROVIDER_DEFAULT_NAMES[saasProvider] || 'Untitled';
    const parentId = currentFolderId ?? undefined;
    try {
      let node: { id: string; name: string; type?: string };
      if (nodeType === 'json') {
        node = await createJsonNode(name, projectId, null, parentId);
      } else if (nodeType === 'markdown') {
        node = await createMarkdownNode(name, projectId, '', parentId);
      } else {
        node = await createFolder(name, projectId, parentId);
      }
      await refreshAllContentNodes(projectId);
      openSyncSetting(saasProvider, {
        nodeId: node.id, nodeName: node.name, nodeType: nodeType,
        readonly: true, jsonPath: '',
      } as any);
      openSyncCreatePanel();
    } catch {
      openSyncSetting(saasProvider);
      openSyncCreatePanel();
    }
  }, [projectId, currentFolderId, openSyncSetting, openSyncCreatePanel]);

  const agentResources: AgentResource[] = useMemo(() => {
    const toAgentResource = (r: { nodeId: string; readonly?: boolean; terminal?: boolean; terminalReadonly?: boolean }) => ({
      nodeId: r.nodeId,
      terminalReadonly: r.readonly ?? r.terminalReadonly ?? true,
    });

    if (hoveredSyncNodeId) return [{ nodeId: hoveredSyncNodeId, terminalReadonly: true }];
    if (hoveredAgentId) {
      const agent = savedAgents.find(a => a.id === hoveredAgentId);
      if (agent?.resources && agent.resources.length > 0) return agent.resources.map(toAgentResource);
    }
    if (urlPanelState.type === 'sync_create' || sidebarMode === 'editing') return draftResources.map(toAgentResource);
    if (sidebarMode === 'deployed' && currentAgentId) {
      const agent = savedAgents.find(a => a.id === currentAgentId);
      if (agent?.resources && agent.resources.length > 0) return agent.resources.map(toAgentResource);
    }
    if (sidebarMode === 'deployed' && selectedSyncId && selectedSyncNodeId) {
      return [{ nodeId: selectedSyncNodeId, terminalReadonly: true }];
    }
    return [];
  }, [draftResources, sidebarMode, currentAgentId, savedAgents, hoveredAgentId, selectedSyncId, selectedSyncNodeId, hoveredSyncNodeId, urlPanelState.type]);

  const activeProject = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // ───── Effects ─────

  // (Legacy effect removed — 'setting' mode no longer opens the sidebar.
  //  Sync/agent creation now happens inline via SyncConfigPanel.)

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

  // Close create menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    if (createMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [createMenuOpen]);

  // Sync state to WorkspaceContext
  useEffect(() => { setProjectId(projectId); }, [projectId, setProjectId]);
  useEffect(() => { setTableId(activeNodeId); }, [activeNodeId, setTableId]);
  useEffect(() => { setTableData(currentTableData?.data); }, [currentTableData?.data, setTableData]);

  const tableNameByIdRef = useRef<string>('');
  const tableNameById = useMemo(() => {
    const map: Record<string, string> = {};
    contentNodes.forEach(node => { map[node.id] = node.name; });
    if (currentTableData?.id && currentTableData?.name) map[currentTableData.id] = currentTableData.name;
    return map;
  }, [contentNodes, currentTableData?.id, currentTableData?.name]);

  useEffect(() => {
    const key = JSON.stringify(tableNameById);
    if (key !== tableNameByIdRef.current) { tableNameByIdRef.current = key; setTableNameById(tableNameById); }
  }, [tableNameById, setTableNameById]);

  useEffect(() => { setAccessPointsToContext(accessPoints); }, [accessPoints, setAccessPointsToContext]);
  useEffect(() => {
    setOnDataUpdate(async () => { await refreshTable(); });
    return () => setOnDataUpdate(null);
  }, [refreshTable, setOnDataUpdate]);

  // ───── Tool Sync Helpers ─────

  const TOOL_TYPES: McpToolType[] = ['search', 'query_data', 'get_all_data', 'create', 'update', 'delete'];

  function normalizeJsonPath(p: string) { if (!p || p === '/') return ''; return p; }

  async function syncToolsForPath(params: { nodeId: string; path: string; permissions: McpToolPermissions; existingTools: Tool[] }) {
    const { nodeId, path: toolPath, permissions, existingTools } = params;
    const jsonPath = normalizeJsonPath(toolPath);
    const byType = new Map<string, Tool>();
    for (const t of existingTools) {
      if (t.node_id !== nodeId) continue;
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
        node_id: nodeId, json_path: jsonPath, type,
        name: `${type}_${nodeId}_${jsonPath ? jsonPath.replaceAll('/', '_') : 'root'}`,
        description: undefined,
      });
    }
  }

  async function deleteAllToolsForPath(params: { nodeId: string; path: string; existingTools: Tool[] }) {
    const { nodeId, path: toolPath, existingTools } = params;
    const jsonPath = normalizeJsonPath(toolPath);
    const toDelete = existingTools.filter(t => t.node_id === nodeId && (t.json_path || '') === jsonPath);
    for (const t of toDelete) await deleteTool(t.id);
  }

  // ───── View Helpers ─────

  const getPlaceholderSaasId = (nodeType: string): string | null => {
    const mapping: Record<string, string> = {
      'gmail': 'gmail', 'google_sheets': 'sheets', 'google_calendar': 'calendar',
      'google_drive': 'drive', 'notion': 'notion', 'github': 'github',
      'airtable': 'airtable', 'linear': 'linear',
      'gmail_inbox': 'gmail', 'google_sheets_sync': 'sheets', 'google_calendar_sync': 'calendar',
      'google_docs_sync': 'docs', 'notion_database': 'notion', 'github_repo': 'github',
    };
    return mapping[nodeType] || null;
  };

  const items = contentNodes.map(node => ({
    id: node.id,
    name: node.name,
    type: node.type as ContentType,
    description: node.type === 'folder' ? 'Folder' :
                 node.type === 'json' ? 'JSON' :
                 node.type === 'markdown' ? 'Markdown' :
                 node.type === 'file' ? 'File' :
                 node.is_synced ? `Sync (${node.sync_source})` : 'Unknown',
    is_synced: node.is_synced,
    sync_source: node.sync_source,
    sync_url: node.sync_url,
    sync_status: node.sync_status,
    last_synced_at: node.last_synced_at,
    preview_snippet: node.preview_snippet,
    children_count: node.children_count,
    onClick: () => {
      if (node.sync_status === 'not_connected') {
        const saasId = getPlaceholderSaasId(node.type);
        if (saasId) {
          openSyncSetting(saasId, {
            nodeId: node.id, nodeName: node.name, nodeType: node.type as any,
            readonly: true, jsonPath: '',
          } as any);
          openSyncCreatePanel();
        }
        return;
      }
      if (node.type !== 'folder') setPendingActiveId(node.id);
      const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
      const newPath = currentPath ? `${currentPath}/${node.id}` : node.id;
      navigateWithPanelState(newPath.split('/').filter(Boolean), urlPanelState, 'push');
    },
  }));

  const handleCreateClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenuPosition({ x: rect.right + 4, y: rect.top, anchorLeft: rect.left });
    setCreateInFolderId(undefined);
    setCreateMenuOpen(true);
  };

  const handleMillerCreateClick = (e: React.MouseEvent, parentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenuPosition({ x: rect.right + 4, y: rect.top, anchorLeft: rect.left });
    setCreateInFolderId(parentId);
    setCreateMenuOpen(true);
  };

  const handleMillerNavigate = (item: MillerColumnItem, pathToItem: string[]) => {
    setPendingActiveId(item.id);
    navigateWithPanelState(pathToItem, urlPanelState, 'push');
  };

  const handleRefresh = async (id: string) => {
    const node = contentNodes.find(n => n.id === id);
    if (!node?.sync_url) { alert('No sync URL available for this item'); return; }
    alert(`Refreshing from: ${node.sync_url}\n\n(Not yet implemented)`);
  };

  // ───── Icons & Breadcrumbs ─────

  const projectIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#a78bfa' }}>
      <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M3.27 6.96L12 12.01l8.73-5.05' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M12 22.08V12' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
  const folderIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#3b82f6' }}>
      <path d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z' fill='currentColor' />
    </svg>
  );
  const tableIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#34d399' }}>
      <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='2' />
      <path d='M3 9H21' stroke='currentColor' strokeWidth='2' />
      <path d='M9 21V9' stroke='currentColor' strokeWidth='2' />
    </svg>
  );
  const markdownIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#60a5fa' }}>
      <path d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z' stroke='currentColor' strokeWidth='1.5' fill='currentColor' fillOpacity='0.08' />
      <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
      <path d='M8 13H16' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      <path d='M8 17H12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  );
  const fileIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#71717a' }}>
      <path d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z' stroke='currentColor' strokeWidth='1.5' />
      <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
  const loadingIcon = (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' style={{ color: '#525252' }}>
      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' opacity='0.3' />
      <path d='M12 2a10 10 0 0 1 10 10' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
        <animateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='0.8s' repeatCount='indefinite' />
      </path>
    </svg>
  );

  const pathSegments = useMemo<BreadcrumbSegment[]>(() => {
    const segments: BreadcrumbSegment[] = [];
    const projectName = activeProject?.name || projectId;
    const hasSubContent = path.length > 0 || currentFolderId || activeNodeId;
    segments.push({ label: projectName, href: hasSubContent ? `/projects/${projectId}/data` : undefined, icon: projectIcon });

    if (isResolvingPath && path.length > 0 && folderBreadcrumbs.length === 0) {
      path.forEach((_, index) => {
        const isLast = index === path.length - 1;
        segments.push({ label: '...', icon: isLast ? loadingIcon : folderIcon });
      });
    } else {
      folderBreadcrumbs.forEach((folder, index) => {
        const isLast = index === folderBreadcrumbs.length - 1;
        const folderPath = folderBreadcrumbs.slice(0, index + 1).map(f => f.id).join('/');
        segments.push({
          label: folder.name,
          href: !isLast || activeNodeId ? `/projects/${projectId}/data/${folderPath}` : undefined,
          icon: folderIcon,
        });
      });
      if (activeNodeId && currentTableData) {
        const renderAs = getNodeTypeConfig(activeNodeType).renderAs;
        const nodeIcon = renderAs === 'markdown' ? markdownIcon : ['file', 'image'].includes(renderAs) ? fileIcon : tableIcon;
        segments.push({ label: currentTableData.name, icon: nodeIcon });
      } else if (activeNodeId) {
        segments.push({ label: '...', icon: loadingIcon });
      }
    }
    return segments;
  }, [activeProject, projectId, folderBreadcrumbs, currentFolderId, activeNodeId, activeNodeType, currentTableData, isResolvingPath, path]);

  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({ path: ap.path, permissions: ap.permissions }));
  }, [accessPoints]);

  // View logic flags
  const isEditorView = !!activeNodeId;
  const isFolderView = !activeNodeId;
  const isLoading = isResolvingPath || contentNodesLoading;

  // ───── CreateMenu Actions ─────

  const createMenuActions = useMemo<CreateMenuActions>(() => {
    const targetFolderIdFn = () => createInFolderId === undefined ? currentFolderId : createInFolderId;

    return {
      onClose: () => setCreateMenuOpen(false),
      onCreateFolder: async () => {
        const targetFolderId = targetFolderIdFn();
        try {
          const result = await createFolder('New Folder', projectId, targetFolderId);
          if (targetFolderId) ensureExpanded(targetFolderId);
          await refreshAllContentNodes(projectId);
          if (result?.id) { ensureExpanded(result.id); highlightCreatedNode(result.id); }
        } catch (err) { console.error('Failed to create folder:', err); }
      },
      onCreateBlankJson: async () => {
        const targetFolderId = targetFolderIdFn();
        try {
          const result = await createJsonNode('Untitled', projectId, {}, targetFolderId);
          if (targetFolderId) ensureExpanded(targetFolderId);
          await refreshAllContentNodes(projectId);
          if (result?.id) {
            highlightCreatedNode(result.id);
            const navPath = result.id_path?.replace(/^\//, '') || result.id;
            navigateWithPanelState(navPath.split('/').filter(Boolean), urlPanelState, 'push');
          }
        } catch (err) { console.error('Failed to create JSON:', err); }
      },
      onCreateBlankMarkdown: async () => {
        const targetFolderId = targetFolderIdFn();
        try {
          const result = await createMarkdownNode('Untitled Note', projectId, '', targetFolderId);
          if (targetFolderId) ensureExpanded(targetFolderId);
          await refreshAllContentNodes(projectId);
          if (result?.id) {
            highlightCreatedNode(result.id);
            const navPath = result.id_path?.replace(/^\//, '') || result.id;
            navigateWithPanelState(navPath.split('/').filter(Boolean), urlPanelState, 'push');
          }
        } catch (err) { console.error('Failed to create markdown:', err); }
      },
      onImportFromFiles: () => { setDefaultStartOption('documents'); setCreateTableOpen(true); },
      onImportFromUrl: () => { setDefaultStartOption('url'); setCreateTableOpen(true); },
      onImportFromSaas: () => { openSyncSetting('_generic'); openSyncCreatePanel(); },
      onImportNotion: () => { handleCreateAndSync('notion'); },
      onImportGitHub: () => { handleCreateAndSync('github'); },
      onImportGmail: () => { handleCreateAndSync('gmail'); },
      onImportDocs: () => { handleCreateAndSync('docs'); },
      onImportCalendar: () => { handleCreateAndSync('calendar'); },
      onImportSheets: () => { handleCreateAndSync('sheets'); },
      onConnectSupabase: () => { handleCreateAndSync('supabase'); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentFolderId, createInFolderId, highlightCreatedNode, openSyncSetting, openSyncCreatePanel, handleCreateAndSync, navigateWithPanelState, urlPanelState]);

  // ───── Render ─────

  return (
    <>
      <DataPageDialogs
        projectId={projectId}
        currentFolderId={currentFolderId}
        projects={projects}
        activeProject={activeProject}
        activeNodeId={activeNodeId}
        showOnboardingGuide={showOnboardingGuide}
        onCloseOnboarding={() => setShowOnboardingGuide(false)}
        onOnboardingComplete={handleOnboardingComplete}
        userName={session?.user?.email?.split('@')[0]}
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
        toast={nodeActions.toast}
        createMenuOpen={createMenuOpen}
        createMenuPosition={createMenuPosition}
        createMenuRef={createMenuRef}
        createMenuActions={createMenuActions}
        createTableOpen={createTableOpen}
        onCloseCreateTable={() => { setCreateTableOpen(false); setDefaultStartOption('documents'); }}
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
        toolPanelTarget={nodeActions.toolPanelTarget}
        onCloseToolPanel={() => nodeActions.setToolPanelTarget(null)}
        projectTools={projectTools}
        onToolsChange={() => {
          if (nodeActions.toolPanelTarget) {
            refreshTableTools(nodeActions.toolPanelTarget.id);
            refreshProjectTools(projectId);
          }
        }}
      />

      {/* Main Content */}
      <div
        onDragEnter={fileImport.handleGlobalDragEnter}
        onDragLeave={fileImport.handleGlobalDragLeave}
        onDragOver={fileImport.handleGlobalDragOver}
        onDrop={fileImport.handleGlobalDrop}
        style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' } as React.CSSProperties}
      >
        {/* File drop overlay */}
        {fileImport.isDraggingFiles && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(59, 130, 246, 0.08)', border: '2px dashed #3b82f6', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
            pointerEvents: 'none',
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.8">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#3b82f6' }}>Drop files to import</div>
          </div>
        )}

        {/* Explorer Sidebar */}
        {viewType === 'explorer' && (
          <ExplorerSidebar
            projectId={projectId}
            currentPath={folderBreadcrumbs.map(f => ({ id: f.id, name: f.name }))}
            activeNodeId={activeNodeId || undefined}
            onNavigate={handleMillerNavigate}
            onCreate={handleMillerCreateClick}
            onRename={nodeActions.handleRename}
            onDelete={nodeActions.handleDelete}
            onMoveNode={nodeActions.handleMoveNode}
            onSyncClick={(item, pathToItem) => {
              const isAlreadyOpen = urlPanelState.type === 'sync_config' && urlPanelState.nodeId === item.id;
              setPendingActiveId(item.id);
              setEditorTarget(null);
              setIsEditorFullScreen(false);
              navigateWithPanelState(
                pathToItem,
                isAlreadyOpen ? { type: 'none' } : { type: 'sync_config', nodeId: item.id },
                'push',
              );
            }}
            activeSyncNodeId={urlPanelState.type === 'sync_config' ? (urlPanelState.nodeId ?? null) : null}
            agentResources={agentResources}
            syncEndpoints={syncEndpoints}
            highlightNodeId={highlightNodeId}
            style={{ width: 250, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'transparent', flexShrink: 0 }}
          />
        )}

        {/* Content column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header (Breadcrumbs + Connect) */}
          <div style={{ flexShrink: 0, zIndex: 60, display: 'flex', alignItems: 'stretch', height: 40 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ProjectsHeader
                pathSegments={pathSegments}
                projectId={activeProject?.id ?? null}
                onProjectsRefresh={() => {}}
                accessPointCount={accessPoints.length}
              />
            </div>
            {/* New Sync button in header */}
            <div style={{
              display: 'flex', alignItems: 'center', paddingRight: 8,
              borderBottom: '1px solid rgba(255,255,255,0.1)', background: '#0e0e0e',
              height: '100%',
            }}>
              <button
                onClick={openSyncCreatePanel}
                title="New connection"
                style={{
                  display: 'flex', alignItems: 'center',
                  height: 28, paddingRight: 10, borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: '#242424', 
                  color: '#ededed',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  transition: 'all 0.15s ease', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#2a2a2a';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#242424';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                }}
                onMouseDown={e => {
                  e.currentTarget.style.background = '#1f1f1f';
                }}
                onMouseUp={e => {
                  e.currentTarget.style.background = '#2a2a2a';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: '100%' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </div>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
                <span style={{ 
                  display: 'flex', alignItems: 'center', gap: 4, 
                  paddingLeft: 8
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
                    <path d="M12 22v-5" />
                    <path d="M9 8V2" />
                    <path d="M15 8V2" />
                    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
                  </svg>
                  Connect
                </span>
              </button>
            </div>
          </div>

          {/* Wrapper for Content Column and Right Panel */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            
            {/* Content Column */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Explorer loading state */}
            {viewType === 'explorer' && isResolvingPath && !isEditorView && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', background: '#0a0a0a' }}>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
                </svg>
              </div>
            )}

            {/* Editor View */}
            {isEditorView && activeProject && (
              <EditorArea
                activeNodeId={activeNodeId}
                activeNodeType={activeNodeType}
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
                onActiveTableChange={(id: string) => {
                  const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
                  const nodePath = currentPath ? `${currentPath}/${id}` : id;
                  navigateWithPanelState(nodePath.split('/').filter(Boolean), urlPanelState, 'push');
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
                    syncToolsForPath({ nodeId: activeNodeId, path: apPath, permissions, existingTools: tableTools as any }).then(() => {
                      refreshTableTools(activeNodeId);
                      refreshProjectTools(projectId);
                    });
                  }
                }}
                onAccessPointRemove={(apPath: string) => {
                  setAccessPoints(prev => prev.filter(ap => ap.path !== apPath));
                  if (activeNodeId) {
                    deleteAllToolsForPath({ nodeId: activeNodeId, path: apPath, existingTools: tableTools as any }).then(() => {
                      refreshTableTools(activeNodeId);
                      refreshProjectTools(projectId);
                    });
                  }
                }}
                onOpenDocument={(docPath: string, value: string) => {
                  setEditorTarget({ path: docPath, value });
                  setIsEditorFullScreen(false);
                  navigateWithPanelState(path, { type: 'none' }, 'replace');
                }}
                onCreateTool={(path: string) => {
                  if (!activeNodeId) return;
                  nodeActions.handleCreateTool(activeNodeId, `${currentTableData?.name || 'File'}`, 'json', path);
                }}
              />
            )}

            {/* Folder View (Grid mode) */}
            {isFolderView && viewType !== 'explorer' && (
              <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
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
                    highlightNodeId={highlightNodeId}
                  />
                )}
              </div>
            )}

            {/* Explorer View - Empty State */}
            {viewType === 'explorer' && isFolderView && !isResolvingPath && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#525252', background: '#0a0a0a' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5">
                  <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" />
                  <path d="M14 2V8H20" /><path d="M12 18V12" /><path d="M9 15L12 12L15 15" />
                </svg>
                <div style={{ fontSize: 14 }}>Select a file to preview</div>
              </div>
            )}

            <TaskStatusWidget inline />
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
            isVersionHistoryOpen={urlPanelState.type === 'version_history'}
            onOpenVersionHistory={openVersionHistoryPanel}
          />
            </div>

            {/* Right Panel */}
            <ResizablePanel isVisible={!!editorTarget || urlPanelState.type !== 'none'}>
          {editorTarget && (
            <DocumentEditor
              path={editorTarget.path}
              value={editorTarget.value}
              onSave={newValue => {
                console.log('Save document:', editorTarget.path, newValue);
                setEditorTarget(null);
                setIsEditorFullScreen(false);
              }}
              onClose={() => { setEditorTarget(null); setIsEditorFullScreen(false); }}
              isFullScreen={isEditorFullScreen}
              onToggleFullScreen={() => setIsEditorFullScreen(!isEditorFullScreen)}
            />
          )}
          {!editorTarget && urlPanelState.type === 'version_history' && urlPanelState.nodeId && (
            <VersionHistoryPanel
              nodeId={urlPanelState.nodeId}
              projectId={projectId}
              onClose={closeRightPanel}
              onRollbackComplete={() => { refreshTable(); refreshCurrentNodes(); }}
            />
          )}
          {!editorTarget && urlPanelState.type === 'sync_config' && activeSyncId && (
            <SyncConfigPanel
              mode="detail"
              syncId={activeSyncId}
              projectId={projectId}
              onClose={closeRightPanel}
            />
          )}
          {!editorTarget && urlPanelState.type === 'sync_config' && !activeSyncId && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#71717a', fontSize: 13 }}>
              Loading sync details...
            </div>
          )}
          {!editorTarget && urlPanelState.type === 'sync_create' && (
            <SyncConfigPanel
              mode="create"
              syncId={null}
              projectId={projectId}
              onClose={closeRightPanel}
              onSyncCreated={handleSyncCreated}
            />
          )}
        </ResizablePanel>
          </div>
        </div>
      </div>
    </>
  );
}
