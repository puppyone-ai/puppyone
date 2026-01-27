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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  useProjects,
  useTableTools,
  refreshTableTools,
  useTable,
  useProjectTools,
  refreshProjectTools,
} from '@/lib/hooks/useData';
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import {
  ProjectsHeader,
  type EditorType,
  type ViewType,
  type BreadcrumbSegment,
} from '@/components/ProjectsHeader';
import { ChatSidebar } from '@/components/ChatSidebar';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';

// MCP Tools imports
import {
  createTool,
  deleteTool,
  type McpToolPermissions,
  type McpToolType,
  type Tool,
} from '@/lib/mcpApi';

import { TableManageDialog } from '@/components/TableManageDialog';
import { FolderManageDialog } from '@/components/FolderManageDialog';
import { listNodes, getNode, createFolder, createMarkdownNode, getDownloadUrl, type NodeInfo } from '@/lib/contentNodesApi';
import { createTable } from '@/lib/projectsApi';
import { refreshProjects } from '@/lib/hooks/useData';

// Markdown Editor
import { MarkdownEditor } from '@/components/editors/markdown';

// Finder View Components
import { GridView, ListView, MillerColumnsView, type MillerColumnItem } from '../../../[[...slug]]/components/views';
import { CreateMenu, type ContentType } from '../../../[[...slug]]/components/finder';

// Node Access Panel (for Folder/File level sandbox configuration)
import { NodeAccessPanel } from '@/components/NodeAccessPanel';

export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

// Panel content types
type RightPanelContent = 'NONE' | 'EDITOR';

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
  const { session } = useAuth();

  // Data fetching
  const { projects, isLoading: projectsLoading } = useProjects();
  const { tools: projectTools } = useProjectTools(projectId);

  // State - viewType persisted in localStorage
  const [viewType, setViewTypeState] = useState<ViewType>(() => {
    // Initialize from localStorage (client-side only)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('puppyone-view-type');
      if (saved === 'grid' || saved === 'list' || saved === 'column') {
        return saved;
      }
    }
    return 'grid';
  });
  
  // Wrapper to persist viewType changes
  const setViewType = (newViewType: ViewType) => {
    setViewTypeState(newViewType);
    if (typeof window !== 'undefined') {
      localStorage.setItem('puppyone-view-type', newViewType);
    }
  };
  
  // editorType persisted in localStorage
  const [editorType, setEditorTypeState] = useState<EditorType>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('puppyone-editor-type');
      if (saved === 'table' || saved === 'treeline-virtual' || saved === 'monaco') {
        return saved;
      }
    }
    return 'table';
  });
  
  const setEditorType = (newEditorType: EditorType) => {
    setEditorTypeState(newEditorType);
    if (typeof window !== 'undefined') {
      localStorage.setItem('puppyone-editor-type', newEditorType);
    }
  };
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(340);
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
  
  // Markdown content state
  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);

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

  // Create menu state
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [createInFolderId, setCreateInFolderId] = useState<string | null | undefined>(undefined); // undefined = use currentFolderId
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Access panel state (小爪子弹出面板)
  const [accessPanelTarget, setAccessPanelTarget] = useState<{
    nodeId: string;
    nodeType: 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image';
    nodeName: string;
    position: { x: number; y: number };
  } | null>(null);

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
          setMarkdownContent('');
          await loadContentNodes(null);
          return;
        }

        // Get info for each node in path
        const pathNodes: Array<{ id: string; name: string; type: string }> = [];
        for (const nodeId of path) {
          try {
            const node = await getNode(nodeId);
            if (node) {
              pathNodes.push({ id: node.id, name: node.name, type: node.type });
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
          setMarkdownContent('');
          await loadContentNodes(lastNode.id);
        } else if (lastNode) {
          // Last is node -> show editor
          setActiveNodeId(lastNode.id);
          setActiveNodeType(lastNode.type);
          
          // If markdown, load content from S3
          if (lastNode.type === 'markdown') {
            setIsLoadingMarkdown(true);
            try {
              const { download_url } = await getDownloadUrl(lastNode.id);
              const response = await fetch(download_url);
              const content = await response.text();
              setMarkdownContent(content);
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
        const nodeIcon = activeNodeType === 'markdown' ? markdownIcon : tableIcon;
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

  // Tool sync helpers
  const TOOL_TYPES: McpToolType[] = ['shell_access', 'shell_access_readonly', 'query_data', 'get_all_data', 'create', 'update', 'delete'];

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
      byType.set(t.type, t);
    }

    const wantShellReadonly = !!(permissions as any)?.shell_access_readonly;
    const wantShellFull = !!(permissions as any)?.shell_access;
    const effectivePermissions: Record<string, boolean> = { ...(permissions as any) };
    if (wantShellReadonly) effectivePermissions['shell_access'] = false;
    if (wantShellFull) effectivePermissions['shell_access_readonly'] = false;

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

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {/* Main Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', position: 'relative' }}>
        {/* Header */}
        <div style={{ flexShrink: 0 }}>
          <ProjectsHeader
            pathSegments={pathSegments}
            projectId={activeProject?.id ?? null}
            onProjectsRefresh={() => {}}
            accessPointCount={accessPoints.length}
            showEditorSwitcher={false}
            isChatOpen={isChatOpen}
            onChatOpenChange={setIsChatOpen}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          {/* Editor View */}
          {isEditorView && activeProject && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
              {/* Markdown Editor */}
              {activeNodeType === 'markdown' ? (
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
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <MarkdownEditor
                        content={markdownContent}
                        onChange={(newContent) => {
                          setMarkdownContent(newContent);
                          // TODO: Save markdown content to S3
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* JSON Editor */
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
                />
              )}
            </div>
          )}

          {/* Folder View */}
          {isFolderView && (
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
                    fontSize: 13,
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
                (() => {
                  const items = contentNodes.map(node => ({
                    id: node.id,
                    name: node.name,
                    type: node.type as ContentType,
                    description: node.type === 'folder' ? 'Folder' : node.type === 'markdown' ? 'Markdown' : 'JSON',
                    onClick: () => {
                      const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
                      const newPath = currentPath ? `${currentPath}/${node.id}` : node.id;
                      router.push(`/projects/${projectId}/data/${newPath}`);
                    },
                  }));

                  const handleCreateClick = (e: React.MouseEvent) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setCreateMenuPosition({ x: rect.left, y: rect.bottom + 4 });
                    setCreateInFolderId(undefined); // Use current folder
                    setCreateMenuOpen(true);
                  };

                  const handleMillerCreateClick = (e: React.MouseEvent, parentId: string | null) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setCreateMenuPosition({ x: rect.left, y: rect.bottom + 4 });
                    setCreateInFolderId(parentId); // Use specific folder from Miller Columns
                    setCreateMenuOpen(true);
                  };

                  // Miller Columns View: load children async (null = root)
                  const loadChildren = async (folderId: string | null): Promise<MillerColumnItem[]> => {
                    try {
                      const response = await listNodes(projectId, folderId ?? undefined);
                      return response.nodes.map(node => ({
                        id: node.id,
                        name: node.name,
                        type: node.type as ContentType,
                      }));
                    } catch (err) {
                      console.error('Failed to load folder children:', err);
                      return [];
                    }
                  };

                  const handleMillerNavigate = (item: MillerColumnItem, pathToItem: string[]) => {
                    // pathToItem contains the full path to reach this item
                    const newPath = pathToItem.join('/');
                    router.push(`/projects/${projectId}/data/${newPath}`);
                  };

                  if (viewType === 'column') {
                    return (
                      <MillerColumnsView
                        currentPath={folderBreadcrumbs.map(f => ({ id: f.id, name: f.name }))}
                        currentItems={items.map(i => ({ id: i.id, name: i.name, type: i.type }))}
                        onLoadChildren={loadChildren}
                        onNavigate={handleMillerNavigate}
                        onCreateClick={handleMillerCreateClick}
                      />
                    );
                  }

                  return viewType === 'list' ? (
                    <ListView
                      items={items}
                      existingTools={projectTools || []}
                      onAccessClick={(item, e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setAccessPanelTarget({
                          nodeId: item.id,
                          nodeType: item.type as any,
                          nodeName: item.name,
                          position: { x: rect.right + 8, y: rect.top },
                        });
                      }}
                    />
                  ) : (
                    <GridView
                      items={items}
                      onCreateClick={handleCreateClick}
                      createLabel='New...'
                      existingTools={projectTools || []}
                      onAccessClick={(item, e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setAccessPanelTarget({
                          nodeId: item.id,
                          nodeType: item.type as any,
                          nodeName: item.name,
                          position: { x: rect.right + 8, y: rect.top },
                        });
                      }}
                    />
                  );
                })()
              )}
            </div>
          )}

          {/* Unified View Toggle - Bottom Right (fixed position in Content area) */}
          {/* Hide for markdown editor */}
          {activeNodeType !== 'markdown' && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
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
                  onClick={() => setViewType('column')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: viewType === 'column' ? '#2a2a2a' : 'transparent',
                    color: viewType === 'column' ? '#fff' : '#737373',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Column view"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="5" height="18" rx="1" />
                    <rect x="10" y="3" width="5" height="18" rx="1" />
                    <rect x="17" y="3" width="5" height="18" rx="1" />
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
      </div>

      {/* Chat Sidebar */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
        tableData={currentTableData?.data}
        tableId={activeNodeId}
        projectId={projectId}
        onDataUpdate={async () => refreshTable()}
        accessPoints={accessPoints}
        projectTools={projectTools}
        tableNameById={tableNameById}
      />

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
            setDefaultStartOption('empty'); // Reset for next time
          }}
          defaultStartOption={defaultStartOption}
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

      {/* Access Panel (小爪子配置面板) */}
      {accessPanelTarget && (
        <div
          style={{
            position: 'fixed',
            top: accessPanelTarget.position.y,
            left: accessPanelTarget.position.x,
            zIndex: 1000,
          }}
        >
          <NodeAccessPanel
            nodeId={accessPanelTarget.nodeId}
            nodeType={accessPanelTarget.nodeType}
            nodeName={accessPanelTarget.nodeName}
            existingTools={projectTools || []}
            onToolsChange={() => refreshProjectTools(projectId)}
            onClose={() => setAccessPanelTarget(null)}
          />
        </div>
      )}

      {/* Click outside to close access panel */}
      {accessPanelTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
          }}
          onClick={() => setAccessPanelTarget(null)}
        />
      )}
    </div>
  );
}

