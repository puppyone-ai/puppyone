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
import { getMcpEndpoint, type McpEndpoint } from '@/lib/mcpEndpointsApi';
import { getSandboxEndpoint, type SandboxEndpoint } from '@/lib/sandboxEndpointsApi';
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

import { refreshProjects } from '@/lib/hooks/useData';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import {
  GridView,
  type AgentResource,
  type ContentType,
} from '../components/views';
import {
  ExplorerSidebar,
  EndpointIconRenderer,
  setPendingActiveId,
  usePendingActiveId,
  type MillerColumnItem,
  type SyncEndpointInfo,
} from '../components/explorer';

import { useAgent } from '@/contexts/AgentContext';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { TaskStatusWidget } from '@/components/TaskStatusWidget';

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
import { PanelShell } from '../components/PanelShell';
import { EmptyWorkspaceState } from '../../../components/EmptyWorkspaceState';

// Panel components — loaded on demand when user opens the panel (saves ~1.5MB on initial load)
import dynamic from 'next/dynamic';
const _PanelLoading = () => (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>
    Loading...
  </div>
);
const VersionHistoryPanel = dynamic(
  () => import('@/components/editors/VersionHistoryPanel').then(m => ({ default: m.VersionHistoryPanel })),
  { ssr: false, loading: _PanelLoading }
);
const SyncConfigPanel = dynamic(
  () => import('../components/SyncConfigPanel').then(m => ({ default: m.SyncConfigPanel })),
  { ssr: false, loading: _PanelLoading }
);
const McpConfigPanel = dynamic(
  () => import('../components/McpConfigPanel').then(m => ({ default: m.McpConfigPanel })),
  { ssr: false, loading: _PanelLoading }
);
const SandboxConfigPanel = dynamic(
  () => import('../components/SandboxConfigPanel').then(m => ({ default: m.SandboxConfigPanel })),
  { ssr: false, loading: _PanelLoading }
);
const ChatRuntimeView = dynamic(
  () => import('@/components/agent/views/ChatRuntimeView').then(m => ({ default: m.ChatRuntimeView })),
  { ssr: false, loading: _PanelLoading }
);
import { usePanelStore, type PanelState } from '../usePanelStore';
import type { AccessOption } from '@/components/chat/ChatInputArea';
import { useDataCreateFlow } from '../hooks/useDataCreateFlow';

interface EditorTarget {
  path: string;
  value: string;
}

interface DataPageProps {
  params: Promise<{ projectId: string; path?: string[] }>;
}

function endpointToPanelState(ep: SyncEndpointInfo, nodeId: string): PanelState {
  if (ep.provider.startsWith('agent:')) return { type: 'agent_chat', nodeId, agentId: ep.syncId };
  if (ep.provider === 'mcp') return { type: 'mcp_config', nodeId, mcpEndpointId: ep.syncId };
  if (ep.provider === 'sandbox') return { type: 'sandbox_config', nodeId, sandboxEndpointId: ep.syncId };
  return { type: 'sync_config', nodeId };
}

interface EndpointEntry {
  ep: SyncEndpointInfo;
  nodeId: string;
  name: string;
  nodeName?: string;
}

type EndpointCategory = 'agents' | 'sync' | 'infra';

const CATEGORY_CONFIG: Record<EndpointCategory, { label: string; color: string }> = {
  agents: { label: 'Agents', color: '#a78bfa' },
  sync: { label: 'Data Sync', color: '#34d399' },
  infra: { label: 'Infrastructure', color: '#60a5fa' },
};

function categorizeEndpoint(provider: string): EndpointCategory {
  if (provider.startsWith('agent:')) return 'agents';
  if (provider === 'mcp' || provider === 'sandbox') return 'infra';
  return 'sync';
}

function GlobalEndpointsAvatarGroup({ 
  nodeEndpointMap, 
  onEndpointClick,
  onEndpointHover,
  nameMap,
}: { 
  nodeEndpointMap: Map<string, SyncEndpointInfo[]>,
  onEndpointClick: (ep: SyncEndpointInfo, nodeId: string) => void,
  onEndpointHover?: (nodeId: string | null) => void,
  nameMap: { agents: Record<string, string>; nodes: Record<string, string>; syncs: Record<string, string> },
}) {
  const [hoveredEndpoint, setHoveredEndpoint] = useState<string | null>(null);
  const [showAllEndpoints, setShowAllEndpoints] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const uniqueEndpoints = useMemo(() => {
    const map = new Map<string, EndpointEntry>();
    for (const [nodeId, eps] of nodeEndpointMap.entries()) {
      for (const ep of eps) {
        if (!map.has(ep.syncId)) {
          const isAgent = ep.provider.startsWith('agent:');
          const name = isAgent
            ? (nameMap.agents[ep.syncId] || 'Agent')
            : (nameMap.syncs[ep.syncId] || ep.provider);
          const nodeName = nameMap.nodes[nodeId];
          map.set(ep.syncId, { ep, nodeId, name, nodeName });
        }
      }
    }
    return Array.from(map.values());
  }, [nodeEndpointMap, nameMap]);

  const grouped = useMemo(() => {
    const groups: Record<EndpointCategory, EndpointEntry[]> = { agents: [], sync: [], infra: [] };
    for (const entry of uniqueEndpoints) {
      groups[categorizeEndpoint(entry.ep.provider)].push(entry);
    }
    return groups;
  }, [uniqueEndpoints]);

  if (uniqueEndpoints.length === 0) return null;

  const maxVisible = 5;
  const visibleEndpoints = uniqueEndpoints.slice(0, maxVisible);
  const hiddenCount = uniqueEndpoints.length - maxVisible;

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowAllEndpoints(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShowAllEndpoints(false);
      setHoveredEndpoint(null);
      onEndpointHover?.(null);
    }, 150);
  };

  const categoryOrder: EndpointCategory[] = ['agents', 'sync', 'infra'];

  return (
    <div 
      style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {visibleEndpoints.map(({ ep, nodeId, name }, index) => {
        const isHovered = hoveredEndpoint === ep.syncId;
        return (
          <div
            key={ep.syncId}
            title={`${name} (Click to configure)`}
            onClick={() => onEndpointClick(ep, nodeId)}
            onMouseEnter={() => {
              setHoveredEndpoint(ep.syncId);
              onEndpointHover?.(nodeId);
            }}
            onMouseLeave={() => {
              setHoveredEndpoint(null);
              onEndpointHover?.(null);
            }}
            style={{
              width: 24, height: 24, borderRadius: 6,
              background: isHovered ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              opacity: isHovered ? 1 : 0.85,
              transition: 'background 0.1s, opacity 0.1s',
              position: 'relative',
            }}
          >
            {/* For the top header avatars, we only show the icon to save space, no dot */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, color: '#a1a1aa' }}>
              {ep.provider.startsWith('agent:') ? (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ) : ep.provider === 'mcp' ? (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                </svg>
              ) : ep.provider === 'sandbox' ? (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-5" />
                  <path d="M9 8V2" />
                  <path d="M15 8V2" />
                  <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
                </svg>
              )}
            </div>
            <div style={{
              position: 'absolute', bottom: 2, right: 2,
              width: 6, height: 6, borderRadius: '50%',
              background: ep.status === 'error' ? '#ef4444' : ep.status === 'stopped' ? '#71717a' : '#10b981',
              boxShadow: '0 0 0 2px #0e0e0e',
            }} />
          </div>
        );
      })}
      
      {hiddenCount > 0 && (
        <div style={{
          padding: '0 6px', height: 24, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#a1a1aa', fontSize: 12, fontWeight: 500,
          cursor: 'default',
        }}>
          +{hiddenCount}
        </div>
      )}

      {showAllEndpoints && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8,
            background: '#0e0e0e',
            border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            padding: '6px 0', width: 240, maxHeight: 400, overflowY: 'auto',
            zIndex: 1000,
          }}
        >
          {categoryOrder.map((cat, catIdx) => {
            const entries = grouped[cat];
            if (entries.length === 0) return null;
            return (
              <div key={cat}>
                {catIdx > 0 && grouped[categoryOrder[catIdx - 1]].length > 0 && (
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 8px' }} />
                )}
                {entries.map(({ ep, nodeId, name, nodeName }) => (
                  <div
                    key={`dropdown-${ep.syncId}`}
                    onClick={() => { setShowAllEndpoints(false); onEndpointClick(ep, nodeId); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '0 8px', margin: '1px 6px', borderRadius: 6, height: 30,
                      cursor: 'pointer', color: hoveredEndpoint === ep.syncId ? '#d4d4d4' : '#a1a1aa', fontSize: 13,
                      transition: 'background 0.1s, color 0.1s',
                      background: hoveredEndpoint === ep.syncId ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={() => {
                      setHoveredEndpoint(ep.syncId);
                      onEndpointHover?.(nodeId);
                    }}
                    onMouseLeave={() => {
                      setHoveredEndpoint(null);
                      onEndpointHover?.(null);
                    }}
                  >
                    <EndpointIconRenderer ep={ep} size={14} />
                    <span style={{ 
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontWeight: 500, flex: 1, minWidth: 0,
                    }}>
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

  // Project-level data from layout (sync status, tools, endpoints)
  const { syncStatusData, mutateSyncStatus, projectTools, syncEndpoints, nodeEndpointMap } = useDataLayout();

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

  const fileImport = useFileImport(projectId, currentFolderId, session?.access_token);

  const nodeActions = useNodeActions(projectId, currentFolderId);

  // Derive active node info (single source of truth for editor context)
  // pendingActiveId fills the gap before usePathResolver finishes resolving
  const pendingActiveId = usePendingActiveId();
  const effectiveNodeId = pendingActiveId || activeNodeId;

  // ───── Panel State (Zustand store, fully decoupled from URL) ─────
  const { panel: panelState, openPanel, closePanel, togglePanel } = usePanelStore();

  const activeSyncNodeId = panelState.type === 'sync_config' ? panelState.nodeId ?? null : null;
  const activeSyncId = activeSyncNodeId ? (syncEndpoints.get(activeSyncNodeId)?.syncId ?? null) : null;

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

  // ───── Navigation (path only, panel state is independent) ─────

  const navigateTo = useCallback((nextPath: string[], typeHint?: string) => {
    const encoded = nextPath.map(s => encodeURIComponent(s)).join('/');
    const basePath = `/projects/${projectId}/data${encoded ? `/${encoded}` : ''}`;
    const url = typeHint ? `${basePath}?type=${encodeURIComponent(typeHint)}` : basePath;
    router.push(url);
  }, [projectId, router]);

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

  // Same as openSyncCreatePanel, but with the target resource
  // pre-filled to the user's current navigation context.  This is
  // what the Sidebar's "+ New connection" button calls — the user's
  // mental model is "I'm looking at folder X, I want to add an
  // access point to it", and the panel landing with that folder
  // already in the target list collapses a 4-step flow (jump to
  // /access → click Create → drag the folder from sidebar → click
  // Create) into a single click.
  //
  // currentFolderId is the path string of the user's current
  // navigation focus (or `null` for the project root).  We
  // normalise null → '' (root scope) and try to derive a
  // human-readable name from the trailing path segment so the
  // pre-filled chip in the panel reads as something other than
  // an opaque blob.
  const openSyncCreatePanelForCurrentFolder = useCallback(() => {
    const targetPath = currentFolderId ?? '';
    const segments = targetPath.split('/').filter(Boolean);
    const nodeName = segments.length > 0 ? segments[segments.length - 1] : 'Root';
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
  }, [currentFolderId, openPanel, setDraftResources]);

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
    createMenuPosition,
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

  const endpointNameMap = useMemo(() => {
    const agents: Record<string, string> = {};
    for (const a of savedAgents) { agents[a.id] = a.name; }
    const nodes: Record<string, string> = { ...tableNameById };
    if (syncStatusData?.syncs) {
      for (const s of syncStatusData.syncs) {
        if (s.path && !nodes[s.path] && s.name) nodes[s.path] = s.name;
      }
    }
    const syncs: Record<string, string> = {};
    if (syncStatusData?.syncs) {
      for (const s of syncStatusData.syncs) {
        const PROVIDER_LABELS: Record<string, string> = {
          filesystem: 'Local Sync', gmail: 'Gmail',
          google_calendar: 'Calendar', google_sheets: 'Sheets', google_drive: 'Drive',
          google_docs: 'Docs', github: 'GitHub', notion: 'Notion', linear: 'Linear',
          airtable: 'Airtable', mcp: 'MCP Server', sandbox: 'Sandbox',
        };
        syncs[s.id] = s.name || PROVIDER_LABELS[s.provider] || s.provider;
      }
    }
    return { agents, nodes, syncs };
  }, [savedAgents, tableNameById, syncStatusData]);

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
        // folder.id is the full path up to this folder segment
        const folderUrlPath = folder.id.split('/').filter(Boolean).map(s => encodeURIComponent(s)).join('/');
        segments.push({
          label: folder.name,
          href: !isLast || activeNodeId ? `/projects/${projectId}/data/${folderUrlPath}` : undefined,
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
      />

      <DataPageOverlays
        toast={nodeActions.toast}
        createMenuOpen={createMenuOpen}
        createMenuPosition={createMenuPosition}
        createMenuRef={createMenuRef}
        createMenuActions={createMenuActions}
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
            onCreateSync={openSyncCreatePanelForCurrentFolder}
            onRename={nodeActions.handleRename}
            onDelete={nodeActions.handleDelete}
            onMoveNode={nodeActions.handleMoveNode}
            activeSyncNodeId={
              panelState.type === 'sync_config' || panelState.type === 'agent_chat' || panelState.type === 'mcp_config' || panelState.type === 'sandbox_config'
                ? (panelState.nodeId ?? null)
                : null
            }
            highlightNodeId={hoverHighlightNodeId || highlightNodeId}
            createMenuOpenForId={createMenuOpenForId}
            style={{ width: 250, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'transparent', flexShrink: 0 }}
          />

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
              gap: 8,
            }}>
              <GlobalEndpointsAvatarGroup 
                nodeEndpointMap={nodeEndpointMap} 
                onEndpointClick={(ep, nodeId) => {
                  const ps = endpointToPanelState(ep, nodeId);
                  togglePanel(ps);
                }}
                onEndpointHover={setHoverHighlightNodeId}
                nameMap={endpointNameMap}
              />
              {nodeEndpointMap.size > 0 && (
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
              )}
              <button
                onClick={openSyncCreatePanel}
                title="New access"
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
                <span style={{ paddingLeft: 6 }}>
                  Access
                </span>
              </button>
            </div>
          </div>

          {/* Wrapper for Content Column and Right Panel */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            
            {/* Content Column */}
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
            isVersionHistoryOpen={panelState.type === 'version_history'}
            onOpenVersionHistory={openVersionHistoryPanel}
          />
        </div>

        {/* Right Panel */}
        <ResizablePanel isVisible={!!editorTarget || panelState.type !== 'none'}>
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
          {!editorTarget && panelState.type === 'version_history' && panelState.nodeId && (
            <VersionHistoryPanel
              nodeId={panelState.nodeId}
              projectId={projectId}
              onClose={closeRightPanel}
              onRollbackComplete={() => { refreshTable(); refreshCurrentNodes(); }}
            />
          )}
          {!editorTarget && panelState.type === 'sync_config' && activeSyncId && (
            <SyncConfigPanel
              mode="detail"
              syncId={activeSyncId}
              projectId={projectId}
              onClose={closeRightPanel}
            />
          )}
          {!editorTarget && panelState.type === 'sync_config' && !activeSyncId && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
              {!syncStatusData ? (
                <span style={{ color: '#71717a', fontSize: 13 }}>Loading...</span>
              ) : (
                <>
                  <span style={{ color: '#525252', fontSize: 13 }}>No access configured</span>
                  <button
                    onClick={() => {
                      const nodeId = panelState.nodeId;
                      if (nodeId) {
                        openSyncSetting('_generic', { path: nodeId, nodeName: '', nodeType: 'folder', readonly: true });
                      }
                      openPanel({ type: 'sync_create' });
                    }}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 500,
                      background: '#242424', border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 6, color: '#e4e4e7', cursor: 'pointer',
                    }}
                  >
                    + New Access
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
              onClose={closeRightPanel}
              onSyncCreated={handleSyncCreated}
            />
          )}
          {!editorTarget && panelState.type === 'mcp_config' && panelState.mcpEndpointId && (
            <McpConfigPanel endpoint={mcpEndpointDetail} onClose={closeRightPanel} />
          )}
          {!editorTarget && panelState.type === 'sandbox_config' && panelState.sandboxEndpointId && (
            <SandboxConfigPanel endpoint={sandboxEndpointDetail} onClose={closeRightPanel} />
          )}
          {panelState.type === 'agent_chat' && (() => {
            const agentId = panelState.agentId;
            const chatAgent = agentId ? savedAgents.find(a => a.id === agentId) : null;
            if (!chatAgent) {
              return !editorTarget ? (
                <PanelShell title="Chat Agent" onClose={closeRightPanel}>
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
                  onDataUpdate={async () => { await refreshTable(); }}
                  projectTools={projectTools}
                  onClose={closeRightPanel}
                />
              </div>
            );
          })()}
        </ResizablePanel>
          </div>
        </div>
      </div>
    </>
  );
}
