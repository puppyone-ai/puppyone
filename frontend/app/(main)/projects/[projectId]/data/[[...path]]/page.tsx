'use client';

/**
 * Data Page - File/Folder Browser & Node Editor
 * 
 * URL Format:
 *   /projects/{projectId}/data                    -> Project root (folder view)
 *   /projects/{projectId}/data/{folderId}         -> Folder view
 *   /projects/{projectId}/data/{folderId}/{nodeId} -> Node editor
 */

import { useEffect, useMemo, useState, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  useProjects,
  useTableTools,
  refreshTableTools,
  refreshProjectTools,
  useTable,
  useProjectTools,
} from '@/lib/hooks/useData';
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import {
  ProjectsHeader,
  type EditorType,
  type ViewType,
  type BreadcrumbSegment,
} from '@/components/ProjectsHeader';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// MCP Tools imports
import {
  createTool,
  deleteTool,
  type McpToolPermissions,
  type McpToolType,
  type Tool,
  type AccessPoint,
} from '@/lib/mcpApi';

import { TableManageDialog } from '@/components/TableManageDialog';
import { FolderManageDialog } from '@/components/FolderManageDialog';
import { listNodes, getNode, createFolder, createMarkdownNode, getDownloadUrl, updateNode, deleteNode, type NodeInfo } from '@/lib/contentNodesApi';
import { createTable } from '@/lib/projectsApi';
import { refreshProjects } from '@/lib/hooks/useData';

// Markdown Editor
import { MarkdownEditor } from '@/components/editors/markdown';

// GitHub Repo View
import { GithubRepoView } from '@/components/views/GithubRepoView';

// Node Type Config
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';

// Finder View Components
import { GridView, ListView, ExplorerSidebar, type MillerColumnItem, type AgentResource, type ContentType } from '../components/views';
import { CreateMenu } from '../../../[[...slug]]/components/finder';

// Agent Context
import { useAgent } from '@/contexts/AgentContext';

// Tool Creation
import { NodeAccessPanel } from '@/components/NodeAccessPanel';

// Task Status
import { TaskStatusWidget } from '@/components/TaskStatusWidget';

// Onboarding Components
import { OnboardingGuide } from '@/components/onboarding/OnboardingGuide';

// Rename Dialog
import { NodeRenameDialog } from '@/components/NodeRenameDialog';

// Panel content types
type RightPanelContent = 'NONE' | 'EDITOR';

interface EditorTarget {
  path: string;
  value: string;
}

interface DataPageProps {
  params: Promise<{ projectId: string; path?: string[] }>;
}

// === File Preview Component (for pure S3 files without preview content) ===
function FilePreview({ nodeName }: { nodeName: string }) {
  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      gap: 16,
      color: '#71717a',
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <div style={{ fontSize: 16, fontWeight: 500 }}>{nodeName}</div>
      <div style={{ fontSize: 13 }}>Raw file stored in S3</div>
    </div>
  );
}

export default function DataPage({ params }: DataPageProps) {
  const { projectId, path = [] } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  
  // Onboarding state
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);
  
  // Workspace context - for sharing state with AgentViewport in layout
  const { 
    setTableData, 
    setTableId, 
    setProjectId, 
    setTableNameById, 
    setAccessPoints: setAccessPointsToContext, 
    setOnDataUpdate 
  } = useWorkspace();

  // Data fetching
  const { projects, isLoading: projectsLoading } = useProjects();
  const { tools: projectTools } = useProjectTools(projectId);

  // State - viewType persisted in localStorage
  // 使用默认值初始化，避免 hydration mismatch
  const [viewType, setViewTypeState] = useState<ViewType>('grid');
  
  // editorType persisted in localStorage
  const [editorType, setEditorTypeState] = useState<EditorType>('table');
  
  // 客户端 mount 后从 localStorage 读取
  useEffect(() => {
    const savedViewType = localStorage.getItem('puppyone-view-type');
    if (savedViewType === 'grid' || savedViewType === 'list' || savedViewType === 'explorer') {
      setViewTypeState(savedViewType as ViewType);
    }
    
    const savedEditorType = localStorage.getItem('puppyone-editor-type');
    if (savedEditorType === 'table' || savedEditorType === 'treeline-virtual' || savedEditorType === 'monaco') {
      setEditorTypeState(savedEditorType);
    }
  }, []);
  
  // Check for welcome parameter (new user onboarding)
  useEffect(() => {
    const isWelcome = searchParams.get('welcome') === 'true';
    if (isWelcome) {
      // Force refresh projects list to ensure the new demo project is visible
      // This fixes the race condition where the redirect happens before SWR cache updates
      refreshProjects().then(() => {
        setShowOnboardingGuide(true);
        // Clean up URL (remove ?welcome=true)
        router.replace(`/projects/${projectId}/data`);
      });
    }
  }, [searchParams, projectId, router]);
  
  const handleOnboardingComplete = () => {
    // Mark onboarding as seen in sessionStorage
    sessionStorage.setItem(`onboarding-completed-${projectId}`, 'true');
  };
  
  // Cleanup markdown save timeouts on unmount
  useEffect(() => {
    return () => {
      if (markdownSaveTimeoutRef.current) {
        clearTimeout(markdownSaveTimeoutRef.current);
      }
      if (markdownSaveStatusTimeoutRef.current) {
        clearTimeout(markdownSaveStatusTimeoutRef.current);
      }
    };
  }, []);

  // Markdown save handler with debounce
  const handleMarkdownChange = (newContent: string) => {
    setMarkdownContent(newContent);

    // Clear previous save timeout
    if (markdownSaveTimeoutRef.current) {
      clearTimeout(markdownSaveTimeoutRef.current);
    }

    // Clear previous status timeout
    if (markdownSaveStatusTimeoutRef.current) {
      clearTimeout(markdownSaveStatusTimeoutRef.current);
    }

    // 1.5s debounce save
    markdownSaveTimeoutRef.current = setTimeout(async () => {
      if (!activeNodeId) return;

      setIsSavingMarkdown(true);
      setMarkdownSaveStatus('saving');

      try {
        await updateNode(activeNodeId, projectId, { preview_json: newContent });
        console.log('[Markdown AutoSave] Saved successfully');
        setMarkdownSaveStatus('saved');
        
        // Clear "Saved" status after 2 seconds
        markdownSaveStatusTimeoutRef.current = setTimeout(() => {
          setMarkdownSaveStatus('idle');
        }, 2000);
      } catch (err) {
        console.error('[Markdown AutoSave] Failed:', err);
        setMarkdownSaveStatus('error');
        
        // Clear error status after 3 seconds
        markdownSaveStatusTimeoutRef.current = setTimeout(() => {
          setMarkdownSaveStatus('idle');
        }, 3000);
      } finally {
        setIsSavingMarkdown(false);
      }
    }, 1500);
  };
  
  // Wrapper to persist viewType changes
  const setViewType = (newViewType: ViewType) => {
    setViewTypeState(newViewType);
    localStorage.setItem('puppyone-view-type', newViewType);
  };
  
  const setEditorType = (newEditorType: EditorType) => {
    setEditorTypeState(newEditorType);
    localStorage.setItem('puppyone-editor-type', newEditorType);
  };
  // Right panel state
  const [rightPanelContent, setRightPanelContent] = useState<RightPanelContent>('NONE');
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [contentNodes, setContentNodes] = useState<NodeInfo[]>([]);
  const [contentNodesLoading, setContentNodesLoading] = useState(false);
  const [isResolvingPath, setIsResolvingPath] = useState(false);

  // Active node (for editor)
  const [activeNodeId, setActiveNodeId] = useState<string>('');
  const [activeNodeType, setActiveNodeType] = useState<string>('');
  const [activePreviewType, setActivePreviewType] = useState<string | null>(null);
  
  // Markdown content state
  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);
  const [isSavingMarkdown, setIsSavingMarkdown] = useState(false);
  const [markdownSaveStatus, setMarkdownSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const markdownSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const markdownSaveStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  // Tools for current node
  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(activeNodeId);
  const { tableData: currentTableData, refresh: refreshTable } = useTable(projectId, activeNodeId);

  // Access points state
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const lastSyncedTableId = useRef<string | null>(null);

  // Dialog states
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [defaultStartOption, setDefaultStartOption] = useState<'empty' | 'documents' | 'url' | 'connect'>('empty');
  const [defaultSelectedSaas, setDefaultSelectedSaas] = useState<'notion' | 'github' | 'airtable' | 'linear' | 'google_sheets' | 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets' | undefined>(undefined);

  // Create menu state
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [createInFolderId, setCreateInFolderId] = useState<string | null | undefined>(undefined); // undefined = use currentFolderId
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Tool creation panel state
  const [toolPanelTarget, setToolPanelTarget] = useState<{ id: string; name: string; type: string; jsonPath?: string } | null>(null);

  // Agent Context - get draft resources for highlighting
  const { draftResources, sidebarMode, currentAgentId, savedAgents, hoveredAgentId } = useAgent();
  
  // Convert resources to AgentResource format for views
  // Priority: 1) Hovered Agent (Preview), 2) Setting Mode (Draft), 3) Deployed Mode (Active Agent)
  const agentResources: AgentResource[] = useMemo(() => {
    // Helper to convert resource to AgentResource format
    // Support both new format (readonly) and legacy format (terminal/terminalReadonly)
    const toAgentResource = (r: { nodeId: string; readonly?: boolean; terminal?: boolean; terminalReadonly?: boolean }) => ({
      nodeId: r.nodeId,
      // New format uses 'readonly', legacy uses 'terminalReadonly'
      terminalReadonly: r.readonly ?? r.terminalReadonly ?? true,
    });

    // 1. Hover Preview - highest priority
    if (hoveredAgentId) {
      const agent = savedAgents.find(a => a.id === hoveredAgentId);
      if (agent?.resources && agent.resources.length > 0) {
        return agent.resources.map(toAgentResource);
      }
    }

    // 2. Setting Mode - show draft resources
    if (sidebarMode === 'setting') {
      return draftResources.map(toAgentResource);
    }
    
    // 3. Deployed Mode - show current agent's resources
    if (sidebarMode === 'deployed' && currentAgentId) {
      const agent = savedAgents.find(a => a.id === currentAgentId);
      if (agent?.resources && agent.resources.length > 0) {
        return agent.resources.map(toAgentResource);
      }
    }
    
    return [];
  }, [draftResources, sidebarMode, currentAgentId, savedAgents, hoveredAgentId]);

  // Current project
  const activeProject = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId]
  );
  

  // Load content nodes
  const loadContentNodes = async (parentId: string | null) => {
    try {
      setContentNodesLoading(true);
      const result = await listNodes(projectId, parentId);
      setContentNodes(result.nodes);
    } catch (error) {
      console.error('Failed to load content nodes:', error);
      setContentNodes([]);
    } finally {
      setContentNodesLoading(false);
    }
  };

  // Listen for SaaS task completion events to refresh the view
  useEffect(() => {
    const handleSaasTaskComplete = () => {
      loadContentNodes(currentFolderId);
      refreshProjects();
    };
    
    window.addEventListener('saas-task-completed', handleSaasTaskComplete);
    window.addEventListener('etl-task-completed', handleSaasTaskComplete);
    
    return () => {
      window.removeEventListener('saas-task-completed', handleSaasTaskComplete);
      window.removeEventListener('etl-task-completed', handleSaasTaskComplete);
    };
  }, [currentFolderId]);

  // Resolve path segments
  useEffect(() => {
    async function resolvePathSegments() {
      setIsResolvingPath(true);

      try {
        if (path.length === 0) {
          // Project root
          setCurrentFolderId(null);
          setFolderBreadcrumbs([]);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
          await loadContentNodes(null);
          return;
        }

        // Get info for each node in path
        const pathNodes: Array<{ id: string; name: string; type: string; preview_type?: string | null }> = [];
        for (const nodeId of path) {
          try {
            const node = await getNode(nodeId, projectId);
            if (node) {
              pathNodes.push({ id: node.id, name: node.name, type: node.type, preview_type: node.preview_type });
            }
          } catch (err) {
            console.error(`Failed to get node ${nodeId}:`, err);
          }
        }

        const folders = pathNodes.filter(n => n.type === 'folder');
        const lastNode = pathNodes[pathNodes.length - 1];

        if (lastNode?.type === 'folder') {
          // Last is folder -> show folder contents
          setCurrentFolderId(lastNode.id);
          setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
          await loadContentNodes(lastNode.id);
        } else if (lastNode) {
          // Last is node -> show editor
          setActiveNodeId(lastNode.id);
          setActiveNodeType(lastNode.type);
          setActivePreviewType(lastNode.preview_type ?? null);
          
          // Check if this node type should render as markdown
          // Uses preview_type to decide: file+preview_md → render as markdown
          const nodeConfig = getNodeTypeConfig(lastNode.type, lastNode.preview_type);
          const shouldLoadAsMarkdown = nodeConfig.renderAs === 'markdown';
          
          if (shouldLoadAsMarkdown) {
            setIsLoadingMarkdown(true);
            try {
              // Get full node detail to check content field
              const fullNode = await getNode(lastNode.id, projectId);
              
              // First check if content is stored in the preview_md field
              if (fullNode.preview_md && typeof fullNode.preview_md === 'string') {
                setMarkdownContent(fullNode.preview_md);
              } else if (fullNode.s3_key) {
                // Content is in S3, download it
                const { download_url } = await getDownloadUrl(lastNode.id, projectId);
                const response = await fetch(download_url);
                const content = await response.text();
                setMarkdownContent(content);
              } else {
                // No content available
                setMarkdownContent('');
              }
            } catch (err) {
              console.error('Failed to load markdown content:', err);
              setMarkdownContent('');
            } finally {
              setIsLoadingMarkdown(false);
            }
          } else {
            setMarkdownContent('');
          }
          
          if (folders.length > 0) {
            const lastFolder = folders[folders.length - 1];
            setCurrentFolderId(lastFolder.id);
            setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
          } else {
            setCurrentFolderId(null);
            setFolderBreadcrumbs([]);
          }
        }
      } finally {
        setIsResolvingPath(false);
      }
    }

    resolvePathSegments();
  }, [projectId, path.join('/')]);

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
      initialAccessPoints.push({
        id: `saved-${toolPath || 'root'}`,
        path: toolPath,
        permissions,
      });
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

  // Icons
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
      <path
        d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='currentColor'
        fillOpacity='0.08'
      />
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

  // Breadcrumbs - show loading placeholder when resolving
  const pathSegments = useMemo<BreadcrumbSegment[]>(() => {
    const segments: BreadcrumbSegment[] = [];

    // Project segment - always show
    const projectName = activeProject?.name || projectId;
    const hasSubContent = path.length > 0 || currentFolderId || activeNodeId;
    segments.push({
      label: projectName,
      href: hasSubContent ? `/projects/${projectId}/data` : undefined,
      icon: projectIcon,
    });

    // When resolving path, show placeholder segments
    if (isResolvingPath && path.length > 0 && folderBreadcrumbs.length === 0) {
      // Show loading placeholders based on URL path count
      path.forEach((_, index) => {
        const isLast = index === path.length - 1;
        segments.push({
          label: isLast ? '...' : '...',
          icon: isLast ? loadingIcon : folderIcon,
        });
      });
    } else {
      // Normal: show resolved folder breadcrumbs
      folderBreadcrumbs.forEach((folder, index) => {
        const isLast = index === folderBreadcrumbs.length - 1;
        const folderPath = folderBreadcrumbs.slice(0, index + 1).map(f => f.id).join('/');
        segments.push({
          label: folder.name,
          href: !isLast || activeNodeId ? `/projects/${projectId}/data/${folderPath}` : undefined,
          icon: folderIcon,
        });
      });

      // Node segment
      if (activeNodeId && currentTableData) {
        const renderAs = getNodeTypeConfig(activeNodeType, activePreviewType).renderAs;
        // markdown -> markdown icon, file/image -> file icon, others -> table icon
        const nodeIcon = renderAs === 'markdown' ? markdownIcon 
          : ['file', 'image'].includes(renderAs) ? fileIcon 
          : tableIcon;
        segments.push({ label: currentTableData.name, icon: nodeIcon });
      } else if (activeNodeId) {
        segments.push({ label: '...', icon: loadingIcon });
      }
    }

    return segments;
  }, [activeProject, projectId, folderBreadcrumbs, currentFolderId, activeNodeId, activeNodeType, currentTableData, isResolvingPath, path]);

  // Configured access points for editor
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({ path: ap.path, permissions: ap.permissions }));
  }, [accessPoints]);

  // Table name mapping
  const tableNameById = useMemo(() => {
    const map: Record<string, string> = {};
    contentNodes.forEach(node => {
      map[node.id] = node.name;
    });
    if (currentTableData?.id && currentTableData?.name) {
      map[currentTableData.id] = currentTableData.name;
    }
    return map;
  }, [contentNodes, currentTableData?.id, currentTableData?.name]);

  // View logic
  const isEditorView = !!activeNodeId;
  const isFolderView = !activeNodeId;
  const isLoading = isResolvingPath || contentNodesLoading;

  // Sync state to WorkspaceContext (for AgentViewport in layout)
  useEffect(() => {
    setProjectId(projectId);
  }, [projectId, setProjectId]);

  useEffect(() => {
    setTableId(activeNodeId);
  }, [activeNodeId, setTableId]);

  useEffect(() => {
    setTableData(currentTableData?.data);
  }, [currentTableData?.data, setTableData]);

  useEffect(() => {
    setTableNameById(tableNameById);
  }, [tableNameById, setTableNameById]);

  useEffect(() => {
    setAccessPointsToContext(accessPoints);
  }, [accessPoints, setAccessPointsToContext]);

  useEffect(() => {
    setOnDataUpdate(async () => { await refreshTable(); });
    return () => setOnDataUpdate(null);
  }, [refreshTable, setOnDataUpdate]);

  // Tool sync helpers
  // NOTE: shell_access is NOT a Tool - it's managed via agent_bash table per Agent
  const TOOL_TYPES: McpToolType[] = ['search', 'query_data', 'get_all_data', 'create', 'update', 'delete'];

  function normalizeJsonPath(p: string) {
    if (!p || p === '/') return '';
    return p;
  }

  async function syncToolsForPath(params: { nodeId: string; path: string; permissions: McpToolPermissions; existingTools: Tool[] }) {
    const { nodeId, path: toolPath, permissions, existingTools } = params;
    const jsonPath = normalizeJsonPath(toolPath);

    const byType = new Map<string, Tool>();
    for (const t of existingTools) {
      if (t.node_id !== nodeId) continue;
      if ((t.json_path || '') !== jsonPath) continue;
      // Skip legacy shell_access entries (cast to string for comparison with legacy types)
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
        node_id: nodeId,
        json_path: jsonPath,
        type,
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

  // === View Helpers (Hoisted) ===
  
  // Helper: Map node type to SaasId for placeholder nodes
  const getPlaceholderSaasId = (nodeType: string): string | null => {
    const mapping: Record<string, string> = {
      'gmail_inbox': 'gmail',
      'google_sheets_sync': 'sheets',
      'google_calendar_sync': 'calendar',
      'google_docs_sync': 'docs',
      'notion_database': 'notion',
      'github_repo': 'github',
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
                 node.type === 'sync' ? `Sync (${node.source})` : 'Unknown',
    is_synced: node.is_synced,
    sync_source: node.sync_source,
    source: node.source,  // 新增：传递 source 字段用于显示 Logo
    sync_url: node.sync_url,
    sync_status: node.sync_status,
    last_synced_at: node.last_synced_at,
    onClick: () => {
      // Handle placeholder nodes: open configuration dialog instead of navigating
      if (node.sync_status === 'not_connected') {
        const saasId = getPlaceholderSaasId(node.type);
        if (saasId) {
          // Open TableManageDialog with the corresponding SaaS pre-selected
          setDefaultStartOption('connect');
          setDefaultSelectedSaas(saasId as any);
          setCreateTableOpen(true);
        }
        return;
      }
      
      // Normal navigation for connected nodes
      const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
      const newPath = currentPath ? `${currentPath}/${node.id}` : node.id;
      router.push(`/projects/${projectId}/data/${newPath}`);
    },
  }));

  const handleCreateClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenuPosition({ x: rect.left, y: rect.bottom + 4 });
    setCreateInFolderId(undefined); 
    setCreateMenuOpen(true);
  };

  const handleMillerCreateClick = (e: React.MouseEvent, parentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCreateMenuPosition({ x: rect.left, y: rect.bottom + 4 });
    setCreateInFolderId(parentId); 
    setCreateMenuOpen(true);
  };

  const loadChildren = async (folderId: string | null): Promise<MillerColumnItem[]> => {
    try {
      const response = await listNodes(projectId, folderId ?? undefined);
      return response.nodes.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type as ContentType,
        is_synced: node.is_synced,
        sync_source: node.sync_source,
        last_synced_at: node.last_synced_at,
      }));
    } catch (err) {
      console.error('Failed to load folder children:', err);
      return [];
    }
  };

  const handleMillerNavigate = (item: MillerColumnItem, pathToItem: string[]) => {
    const newPath = pathToItem.join('/');
    router.push(`/projects/${projectId}/data/${newPath}`);
  };

  const handleRename = (id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName });
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameTarget) return;
      try {
      await updateNode(renameTarget.id, projectId, { name: newName });
        loadContentNodes(currentFolderId);
      } catch (err) {
        console.error('Failed to rename:', err);
        alert('Failed to rename item');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${name}"?`);
    if (confirmed) {
      try {
        await deleteNode(id, projectId);
        loadContentNodes(currentFolderId);
      } catch (err) {
        console.error('Failed to delete:', err);
        alert('Failed to delete item');
      }
    }
  };

  const handleRefresh = async (id: string) => {
    const node = contentNodes.find(n => n.id === id);
    if (!node?.sync_url) {
      alert('No sync URL available for this item');
      return;
    }
    alert(`Refreshing from: ${node.sync_url}\n\n(Not yet implemented)`);
  };

  // Handle creating tools from the context menu
  const handleCreateTool = (id: string, name: string, type: string, jsonPath?: string) => {
    setToolPanelTarget({ id, name, type, jsonPath });
  };

  return (
    <>
      {/* Onboarding Guide for new users */}
      <OnboardingGuide
        isOpen={showOnboardingGuide}
        onClose={() => setShowOnboardingGuide(false)}
        onComplete={handleOnboardingComplete}
        userName={session?.user?.email?.split('@')[0]}
      />

      {/* Rename Dialog */}
      <NodeRenameDialog
        isOpen={renameDialogOpen}
        currentName={renameTarget?.name ?? ''}
        onClose={() => {
          setRenameDialogOpen(false);
          setRenameTarget(null);
        }}
        onConfirm={handleRenameConfirm}
      />
      
      {/* Header (Full Width) */}
      <div style={{ flexShrink: 0, zIndex: 60 }}>
        <ProjectsHeader
          pathSegments={pathSegments}
          projectId={activeProject?.id ?? null}
          onProjectsRefresh={() => {}}
          accessPointCount={accessPoints.length}
        />
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          {viewType === 'explorer' && (
            <ExplorerSidebar
              currentPath={folderBreadcrumbs.map(f => ({ id: f.id, name: f.name }))}
              onLoadChildren={loadChildren}
              onNavigate={handleMillerNavigate}
              agentResources={agentResources}
              style={{
                width: 250,
                borderRight: '1px solid rgba(255,255,255,0.08)',
                background: '#141414',
                flexShrink: 0
              }}
            />
          )}
          {/* Editor View */}
          {isEditorView && activeProject && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
              {/* Markdown Editor (only for types with preview_md content) */}
              {getNodeTypeConfig(activeNodeType, activePreviewType).renderAs === 'markdown' ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {isLoadingMarkdown ? (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                      flex: 1,
                    color: '#666',
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 8px', animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                      <div>Loading markdown...</div>
                    </div>
                  </div>
                ) : (
                    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                      {/* Save Status Indicator */}
                      {markdownSaveStatus !== 'idle' && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            zIndex: 30,
                            background: markdownSaveStatus === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(0, 0, 0, 0.7)',
                            color: '#fff',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          {markdownSaveStatus === 'saving' && (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              Saving...
                            </>
                          )}
                          {markdownSaveStatus === 'saved' && (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Saved
                            </>
                          )}
                          {markdownSaveStatus === 'error' && (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                              </svg>
                              Save failed
                            </>
                          )}
                        </div>
                      )}
                  <MarkdownEditor
                    content={markdownContent}
                        onChange={handleMarkdownChange}
                  />
                    </div>
                  )}
                </div>
              ) : activeNodeType === 'github_repo' ? (
                /* GitHub Repository View */
                <GithubRepoView
                  nodeId={activeNodeId}
                  nodeName={currentTableData?.name || ''}
                  content={currentTableData?.content}
                  syncUrl={currentTableData?.sync_url ?? undefined}
                />
              ) : ['file', 'image'].includes(getNodeTypeConfig(activeNodeType, activePreviewType).renderAs) && !currentTableData?.data && !markdownContent ? (
                /* File Preview - ONLY when node truly has no preview content (no preview_json, no preview_md) */
                <FilePreview nodeName={currentTableData?.name || ''} />
              ) : (
                /* JSON Editor (default: handles json types, sync types with preview_json, etc.) */
                <ProjectWorkspaceView
                  projectId={activeProject.id}
                  project={activeProject}
                  activeTableId={activeNodeId}
                  onActiveTableChange={(id: string) => {
                    const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
                    const nodePath = currentPath ? `${currentPath}/${id}` : id;
                    router.push(`/projects/${projectId}/data/${nodePath}`);
                  }}
                  onTreePathChange={() => {}}
                  editorType={editorType}
                  configuredAccessPoints={configuredAccessPoints}
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
                    setRightPanelContent('EDITOR');
                  }}
                  onCreateTool={(path: string, value: any) => {
                    if (!activeNodeId) return;
                    handleCreateTool(activeNodeId, `${currentTableData?.name || 'File'}`, 'json', path);
                  }}
                />
              )}
            </div>
          )}

          {/* Folder View */}
          {isFolderView && viewType !== 'explorer' && (
            <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: 24 }}>
              {/* Generic Loading State */}
              {isLoading ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: 200,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: '#525252',
                    fontSize: 14,
                  }}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      style={{ animation: 'spin 1s linear infinite' }}
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="28"
                        strokeDashoffset="8"
                      />
                    </svg>
                    Loading...
                  </div>
                  <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
              ) : (
                viewType === 'list' ? (
                  <ListView
                    items={items}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onRefresh={handleRefresh}
                    onCreateTool={handleCreateTool}
                    agentResources={agentResources}
                  />
                ) : (
                  <GridView
                    items={items}
                    onCreateClick={handleCreateClick}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onRefresh={handleRefresh}
                    onCreateTool={handleCreateTool}
                    agentResources={agentResources}
                  />
                )
              )}
            </div>
          )}

          {/* Explorer View - Empty State (when no file selected) */}
          {viewType === 'explorer' && isFolderView && (
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 12,
              color: '#525252',
              background: '#0a0a0a'
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5">
                <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" />
                <path d="M14 2V8H20" />
                <path d="M12 18V12" />
                <path d="M9 15L12 12L15 15" />
              </svg>
              <div style={{ fontSize: 14 }}>Select a file to preview</div>
            </div>
          )}

          {/* Task Status Widget - positioned above view toggle */}
          <TaskStatusWidget inline />

          {/* Unified View Toggle - Bottom Left (moved from right to avoid conflict with TaskStatusWidget) */}
          {/* Hide for markdown editor (including notion_page, github_file, etc.) */}
          {getNodeTypeConfig(activeNodeType, activePreviewType).renderAs !== 'markdown' && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              display: 'flex',
              background: '#1a1a1a',
              borderRadius: 6,
              padding: 2,
              gap: 1,
              border: '1px solid #2a2a2a',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
              zIndex: 20,
            }}
          >
            {isEditorView ? (
              <>
                <button
                  onClick={() => setEditorType('table')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: editorType === 'table' ? '#2a2a2a' : 'transparent',
                    color: editorType === 'table' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Table view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                  </svg>
                </button>
                <button
                  onClick={() => setEditorType('treeline-virtual')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: editorType === 'treeline-virtual' ? '#2a2a2a' : 'transparent',
                    color: editorType === 'treeline-virtual' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Tree view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22 11V3h-7v3H9V3H2v8h7v-3h2v10h4v3h7v-8h-7v3h-2V8h2v3z" />
                  </svg>
                </button>
                <button
                  onClick={() => setEditorType('monaco')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: editorType === 'monaco' ? '#2a2a2a' : 'transparent',
                    color: editorType === 'monaco' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                  title="Raw JSON"
                >
                  { }
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setViewType('grid')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: viewType === 'grid' ? '#2a2a2a' : 'transparent',
                    color: viewType === 'grid' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Grid view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewType('list')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: viewType === 'list' ? '#2a2a2a' : 'transparent',
                    color: viewType === 'list' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="List view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewType('explorer')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: viewType === 'explorer' ? '#2a2a2a' : 'transparent',
                    color: viewType === 'explorer' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Explorer view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </button>
              </>
            )}
          </div>
          )}

          {/* Right Panel */}
          <ResizablePanel isVisible={rightPanelContent !== 'NONE'}>
            {rightPanelContent === 'EDITOR' && editorTarget && (
              <DocumentEditor
                path={editorTarget.path}
                value={editorTarget.value}
                onSave={newValue => {
                  console.log('Save document:', editorTarget.path, newValue);
                  setEditorTarget(null);
                  setRightPanelContent('NONE');
                  setIsEditorFullScreen(false);
                }}
                onClose={() => {
                  setRightPanelContent('NONE');
                  setIsEditorFullScreen(false);
                }}
                isFullScreen={isEditorFullScreen}
                onToggleFullScreen={() => setIsEditorFullScreen(!isEditorFullScreen)}
              />
            )}
          </ResizablePanel>
        </div>

      {/* Create Menu */}
      {createMenuOpen && createMenuPosition && (
        <div ref={createMenuRef}>
          <CreateMenu
            x={createMenuPosition.x}
            y={createMenuPosition.y}
              onClose={() => setCreateMenuOpen(false)}
              onCreateFolder={async () => {
                const targetFolderId = createInFolderId === undefined ? currentFolderId : createInFolderId;
                try {
                  await createFolder('New Folder', projectId, targetFolderId);
                  await refreshProjects();
                  await loadContentNodes(currentFolderId); // Refresh current view
                } catch (err) {
                  console.error('Failed to create folder:', err);
                }
              }}
              onCreateBlankJson={async () => {
                const targetFolderId = createInFolderId === undefined ? currentFolderId : createInFolderId;
                try {
                  await createTable(projectId, 'Untitled', {}, targetFolderId);
                  await refreshProjects();
                  await loadContentNodes(currentFolderId);
                } catch (err) {
                  console.error('Failed to create JSON:', err);
                }
              }}
              onCreateBlankMarkdown={async () => {
                const targetFolderId = createInFolderId === undefined ? currentFolderId : createInFolderId;
                try {
                  await createMarkdownNode('Untitled Note', projectId, '', targetFolderId);
                  await refreshProjects();
                  await loadContentNodes(currentFolderId);
                } catch (err) {
                  console.error('Failed to create markdown:', err);
                }
              }}
              onImportFromFiles={() => {
                setDefaultStartOption('documents');
                setCreateTableOpen(true);
              }}
              onImportFromUrl={() => {
                setDefaultStartOption('url');
                setCreateTableOpen(true);
              }}
              onImportFromSaas={() => {
                setDefaultStartOption('connect');
                setDefaultSelectedSaas(undefined);
                setCreateTableOpen(true);
              }}
              onImportNotion={() => {
                setDefaultSelectedSaas('notion');
                setCreateTableOpen(true);
              }}
              onImportGitHub={() => {
                setDefaultSelectedSaas('github');
                setCreateTableOpen(true);
              }}
              onImportGmail={() => {
                setDefaultSelectedSaas('gmail');
                setCreateTableOpen(true);
              }}
              onImportDocs={() => {
                setDefaultSelectedSaas('docs');
                setCreateTableOpen(true);
              }}
              onImportCalendar={() => {
                setDefaultSelectedSaas('calendar');
                setCreateTableOpen(true);
              }}
              onImportSheets={() => {
                setDefaultSelectedSaas('sheets');
                setCreateTableOpen(true);
              }}
          />
        </div>
      )}

      {/* Dialogs */}
      {createTableOpen && (
        <TableManageDialog
          mode='create'
          projectId={projectId}
          tableId={null}
          parentId={currentFolderId}
          projects={projects}
          onClose={() => {
            setCreateTableOpen(false);
            setDefaultStartOption('empty');
            setDefaultSelectedSaas(undefined);
          }}
          defaultStartOption={defaultStartOption}
          defaultSelectedSaas={defaultSelectedSaas}
        />
      )}

      {createFolderOpen && (
        <FolderManageDialog
          projectId={projectId}
          parentId={currentFolderId}
          parentPath={activeProject?.name || ''}
          onClose={() => setCreateFolderOpen(false)}
          onSuccess={() => loadContentNodes(currentFolderId)}
        />
      )}

      {/* Tool Creation Panel */}
      {toolPanelTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setToolPanelTarget(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <NodeAccessPanel
              nodeId={toolPanelTarget.id}
              nodeType={toolPanelTarget.type as 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image'}
              nodeName={toolPanelTarget.name}
              jsonPath={toolPanelTarget.jsonPath} // 新增
              existingTools={projectTools}
              onToolsChange={() => {
                // Refresh both node-level and project-level tools list
                refreshTableTools(toolPanelTarget.id);
                refreshProjectTools(projectId);
              }}
              onClose={() => setToolPanelTarget(null)}
            />
          </div>
        </div>
      )}

    </>
  );
}

