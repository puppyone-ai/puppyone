'use client';

/**
 * Projects Page - RESTful URL Routing
 * 
 * URL Format:
 *   /projects/{projectId}                          -> Project root view
 *   /projects/{projectId}/{folderId}               -> Folder view
 *   /projects/{projectId}/{folderId1}/{folderId2}  -> Nested folder view
 *   /projects/{projectId}/{nodeId}                 -> Node editor (JSON in root)
 *   /projects/{projectId}/{folderId}/{nodeId}      -> Node editor (JSON in folder)
 * 
 * The [[...slug]] catch-all route handles all paths.
 * Path segments are resolved by querying each node's type from the API.
 */

import { useEffect, useMemo, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import {
  useProjects,
  refreshProjects,
  useTableTools,
  refreshTableTools,
  useTable,
  useProjectTools,
  refreshProjectTools,
} from '@/lib/hooks/useData';
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import { OnboardingView } from '@/components/OnboardingView';
import {
  ProjectsHeader,
  type EditorType,
  type ViewType,
  type BreadcrumbSegment,
} from '@/components/ProjectsHeader';
import { ChatSidebar } from '@/components/ChatSidebar';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';
import { DashboardView } from '@/components/dashboard/DashboardView';

// 面板内容类型
type RightPanelContent = 'NONE' | 'EDITOR';

// 编辑器目标类型
interface EditorTarget {
  path: string;
  value: string;
}

// MCP Tools imports
import {
  createTool,
  deleteTool,
  type McpToolPermissions,
  type McpToolType,
  type Tool,
} from '@/lib/mcpApi';

import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { TableManageDialog } from '@/components/TableManageDialog';
import { FolderManageDialog } from '@/components/FolderManageDialog';
import { listNodes, getNode, type NodeInfo } from '@/lib/contentNodesApi';

// Finder View Components
import { GridView, ListView } from './components/views';
import { CreateMenu, type ContentType } from './components/finder';

export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

import { redirect } from 'next/navigation';

// ...

// 重构版本的页面组件 - 极简布局，用于定位显示问题
export default function ProjectsSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = use(params);
  
  // 如果访问 /projects (无 slug)，重定向到 /home
  if (!slug || slug.length === 0) {
    redirect('/home');
  }

  const router = useRouter();
  const { session } = useAuth();

  // 1. 解析路由参数
  // URL 格式：/projects/{projectId}/{path1}/{path2}/...
  // - /projects/11                    -> 项目根目录
  // - /projects/11/{folderId}         -> 文件夹视图（需要查询确认类型）
  // - /projects/11/{nodeId}           -> 节点视图（需要查询确认类型）
  // - /projects/11/{folderId}/{nodeId} -> 文件夹内的节点
  const [projectId, ...restPath] = slug || [];
  
  // projectId === '-' 表示裸 Table（不属于任何 Project）
  const isOrphanTable = projectId === '-';
  const [activeBaseId, setActiveBaseId] = useState<string>(
    isOrphanTable ? '' : projectId || ''
  );
  
  // 解析路径：最后一个可能是节点 ID，前面的都是文件夹路径
  const [routeFolderId, setRouteFolderId] = useState<string | null>(null);
  const [routeNodeId, setRouteNodeId] = useState<string | null>(null);
  const [activeTableId, setActiveTableId] = useState<string>('');

  // View State
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(
    new Set()
  );

  // 2. 数据获取
  const { projects, isLoading: projectsLoading } = useProjects();
  // 获取当前 table 的 Tools（用于 sidebar 显示）
  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(
    activeTableId
  );
  // 获取当前 project 下的所有 Tools（用于 ChatSidebar 项目级展示）
  const { tools: projectTools } = useProjectTools(
    !isOrphanTable ? activeBaseId || projectId : undefined
  );
  // 获取当前 table 的数据（用于 ChatSidebar）
  const { tableData: currentTableData, refresh: refreshTable } = useTable(
    activeBaseId || projectId,
    activeTableId
  );

  // 3. 状态管理
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null);
  const [editorType, setEditorType] = useState<EditorType>('table');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(340);
  const [rightPanelContent, setRightPanelContent] =
    useState<RightPanelContent>('NONE');
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const lastSyncedTableId = useRef<string | null>(null);

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);

  // Dialog states
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  // Current folder context for nested navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderPath, setCurrentFolderPath] = useState<string>('/');
  // 完整的文件夹路径（包含每个层级的 ID 和名称）
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [contentNodes, setContentNodes] = useState<NodeInfo[]>([]);
  const [contentNodesLoading, setContentNodesLoading] = useState(false);
  // 路径解析加载状态
  const [isResolvingPath, setIsResolvingPath] = useState(false);

  // Create menu state
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Close create menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        createMenuRef.current &&
        !createMenuRef.current.contains(e.target as Node)
      ) {
        setCreateMenuOpen(false);
      }
    };
    if (createMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [createMenuOpen]);

  // 加载内容节点（用于嵌套文件夹导航）
  const loadContentNodes = async (parentId: string | null) => {
    if (!activeBaseId) return; // 需要 projectId
    try {
      setContentNodesLoading(true);
      const result = await listNodes(activeBaseId, parentId);
      setContentNodes(result.nodes);
    } catch (error) {
      console.error('Failed to load content nodes:', error);
      setContentNodes([]);
    } finally {
      setContentNodesLoading(false);
    }
  };

  // 4. 副作用：解析 URL 路径并同步状态
  useEffect(() => {
    // 设置 projectId
    if (projectId !== undefined) {
      setActiveBaseId(projectId === '-' ? '' : projectId);
    } else {
      setActiveBaseId('');
    }

    const currentProject = projects.find(p => p.id === projectId);
    const projectName = currentProject?.name || '';
    
    // 解析 restPath 来确定文件夹和节点
    // URL: /projects/{projectId}/{id1}/{id2}/...
    // 需要查询每个 ID 的类型来确定是文件夹还是节点
    async function resolvePathSegments() {
      setIsResolvingPath(true);
      
      try {
        if (restPath.length === 0) {
          // 项目根目录
          setRouteFolderId(null);
          setRouteNodeId(null);
          setActiveTableId('');
          setCurrentFolderId(null);
          setFolderBreadcrumbs([]);
          setCurrentFolderPath(`/${projectName}`);
          await loadContentNodes(null);
          return;
        }

        // 获取路径中每个节点的信息
        const pathNodes: Array<{ id: string; name: string; type: string }> = [];
        for (const nodeId of restPath) {
          try {
            const node = await getNode(nodeId);
            if (node) {
              pathNodes.push({ id: node.id, name: node.name, type: node.type });
            }
          } catch (err) {
            console.error(`Failed to get node ${nodeId}:`, err);
          }
        }

        // 分析路径：文件夹在前，节点（如果有）在最后
        const folders = pathNodes.filter(n => n.type === 'folder');
        const lastNode = pathNodes[pathNodes.length - 1];
        
        if (lastNode?.type === 'folder') {
          // 最后一个是文件夹 -> 显示文件夹内容
          setRouteFolderId(lastNode.id);
          setRouteNodeId(null);
          setActiveTableId('');
          setCurrentFolderId(lastNode.id);
          setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
          setCurrentFolderPath(`/${projectName}/${folders.map(f => f.name).join('/')}`);
          await loadContentNodes(lastNode.id);
        } else if (lastNode) {
          // 最后一个是节点（json 等）-> 显示节点编辑器
          setRouteNodeId(lastNode.id);
          setActiveTableId(lastNode.id);
          
          // 文件夹是除了最后一个之外的所有 folder 类型节点
          if (folders.length > 0) {
            const lastFolder = folders[folders.length - 1];
            setRouteFolderId(lastFolder.id);
            setCurrentFolderId(lastFolder.id);
            setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
            setCurrentFolderPath(`/${projectName}/${folders.map(f => f.name).join('/')}`);
          } else {
            // 节点在项目根目录
            setRouteFolderId(null);
            setCurrentFolderId(null);
            setFolderBreadcrumbs([]);
            setCurrentFolderPath(`/${projectName}`);
          }
        }
      } finally {
        setIsResolvingPath(false);
      }
    }

    resolvePathSegments();
  }, [projectId, restPath.join('/'), projects]);

  // 同步 Access Points
  useEffect(() => {
    if (!activeTableId || toolsLoading) return;
    if (activeTableId === lastSyncedTableId.current) return;

    // 转换后端 tools 为 accessPoints 格式
    const pathPermissionsMap = new Map<string, McpToolPermissions>();
    tableTools.forEach(tool => {
      const path = tool.json_path || '';
      const existing = pathPermissionsMap.get(path) || {};
      pathPermissionsMap.set(path, { ...existing, [tool.type]: true });
    });

    const initialAccessPoints: AccessPoint[] = [];
    pathPermissionsMap.forEach((permissions, path) => {
      initialAccessPoints.push({
        id: `saved-${path || 'root'}`,
        path,
        permissions,
      });
    });

    setAccessPoints(initialAccessPoints);
    lastSyncedTableId.current = activeTableId;
  }, [activeTableId, toolsLoading, tableTools]);

  const TOOL_TYPES: McpToolType[] = [
    'shell_access',
    'shell_access_readonly',
    'query_data',
    'get_all_data',
    'create',
    'update',
    'delete',
  ];

  function normalizeJsonPath(p: string) {
    if (!p || p === '/') return '';
    return p;
  }

  async function syncToolsForPath(params: {
    tableId: string;
    path: string;
    permissions: McpToolPermissions;
    existingTools: Tool[];
  }) {
    const { tableId, path, permissions, existingTools } = params;
    const jsonPath = normalizeJsonPath(path);

    // group existing tools by type at this scope
    const byType = new Map<string, Tool>();
    for (const t of existingTools) {
      if (t.table_id !== tableId) continue;
      if ((t.json_path || '') !== jsonPath) continue;
      byType.set(t.type, t);
    }

    // Desired: one row per enabled type
    const wantShellReadonly = !!(permissions as any)?.shell_access_readonly;
    const wantShellFull = !!(permissions as any)?.shell_access;
    const effectivePermissions: Record<string, boolean> = {
      ...(permissions as any),
    };
    if (wantShellReadonly) effectivePermissions['shell_access'] = false;
    if (wantShellFull) effectivePermissions['shell_access_readonly'] = false;

    // 先删除不需要的工具（包括互斥的 bash 类型）
    const toDelete: string[] = [];
    const toCreate: McpToolType[] = [];

    for (const type of TOOL_TYPES) {
      const enabled = !!effectivePermissions[type];
      const existing = byType.get(type);

      if (!enabled && existing) {
        toDelete.push(existing.id);
      }
      if (enabled && !existing) {
        toCreate.push(type);
      }
    }

    // 先执行删除
    for (const id of toDelete) {
      await deleteTool(id);
    }

    // 再执行创建
    for (const type of toCreate) {
      await createTool({
        table_id: tableId,
        json_path: jsonPath,
        type,
        name: `${type}_${tableId}_${jsonPath ? jsonPath.replaceAll('/', '_') : 'root'}`,
        description: undefined,
      });
    }
  }

  async function deleteAllToolsForPath(params: {
    tableId: string;
    path: string;
    existingTools: Tool[];
  }) {
    const { tableId, path, existingTools } = params;
    const jsonPath = normalizeJsonPath(path);
    const toDelete = existingTools.filter(
      t => t.table_id === tableId && (t.json_path || '') === jsonPath
    );
    for (const t of toDelete) {
      await deleteTool(t.id);
    }
  }

  // 5. 计算当前上下文
  const activeBase = useMemo(
    () =>
      projects.find(project => String(project.id) === String(activeBaseId)) ??
      null,
    [projects, activeBaseId]
  );

  const activeTable = useMemo(
    () =>
      contentNodes.find(
        node => String(node.id) === String(activeTableId)
      ) ?? null,
    [contentNodes, activeTableId]
  );

  const toggleBaseExpansion = (baseId: string) => {
    const newSet = new Set(expandedBaseIds);
    if (newSet.has(baseId)) {
      newSet.delete(baseId);
    } else {
      newSet.add(baseId);
    }
    setExpandedBaseIds(newSet);
  };

  // 6. 路径片段 - 用于导航
  const pathSegments = useMemo<BreadcrumbSegment[]>(() => {
    const segments: BreadcrumbSegment[] = [];

    // Project 图标 (立方体/盒子，表示一个项目容器)
    const projectIcon = (
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        style={{ color: '#a78bfa' }}
      >
        <path
          d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path d='M3.27 6.96L12 12.01l8.73-5.05' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
        <path d='M12 22.08V12' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      </svg>
    );

    // 文件夹图标 (只用于 Project 内部的子文件夹)
    const folderIcon = (
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        style={{ color: '#3b82f6' }}
      >
        <path
          d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z'
          fill='currentColor'
        />
      </svg>
    );

    // Context/Table 图标
    const tableIcon = (
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        style={{ color: '#34d399' }}
      >
        <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='2' />
        <path d='M3 9H21' stroke='currentColor' strokeWidth='2' />
        <path d='M9 21V9' stroke='currentColor' strokeWidth='2' />
      </svg>
    );

    // 1. Project Segment (首位，带返回功能)
    // 当在文件夹内或 Context 视图时，项目名可点击返回项目根目录
    const hasSubContent = !!(currentFolderId || activeTableId);
    if (activeBaseId) {
      if (activeBase) {
        segments.push({ 
          label: activeBase.name, 
          href: hasSubContent ? `/projects/${activeBase.id}` : undefined,
          icon: projectIcon,
        });
      } else {
        segments.push({ 
          label: 'Project', 
          href: hasSubContent ? `/projects/${activeBaseId}` : undefined,
          icon: projectIcon,
        });
      }
    }

    // 2. Folder Segments (显示完整的文件夹层级，每个都可点击)
    if (folderBreadcrumbs.length > 0) {
      folderBreadcrumbs.forEach((folder, index) => {
        const isLast = index === folderBreadcrumbs.length - 1;
        segments.push({
          label: folder.name,
          // 非最后一个文件夹可以点击返回该层级
          // 最后一个只有在 Context 视图时才有 href
          // 构建到该文件夹的完整路径
          href: !isLast 
            ? `/projects/${activeBaseId}/${folderBreadcrumbs.slice(0, index + 1).map(f => f.id).join('/')}` 
            : (activeTableId ? `/projects/${activeBaseId}/${folderBreadcrumbs.map(f => f.id).join('/')}` : undefined),
          icon: folderIcon,
        });
      });
    }
    
    // 3. Context Segment (当前选中的表/JSON 文件)
    if (activeTableId) {
      if (activeTable) {
        segments.push({ label: activeTable.name, icon: tableIcon });
      } else if (isOrphanTable && currentTableData) {
        segments.push({ label: currentTableData.name, icon: tableIcon });
      } else {
        segments.push({ label: 'Context', icon: tableIcon });
      }
    }

    return segments;
  }, [
    activeBase,
    activeTable,
    activeBaseId,
    activeTableId,
    isOrphanTable,
    currentTableData,
    currentFolderId,
    folderBreadcrumbs,
  ]);

  // 8. 渲染准备
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({
      path: ap.path,
      permissions: ap.permissions,
    }));
  }, [accessPoints]);

  const tableNameById = useMemo(() => {
    const map: Record<string, string> = {};
    // 从 contentNodes 获取名称映射（新架构）
    contentNodes.forEach(node => {
      map[node.id] = node.name;
    });
    // 保留当前加载的 table 数据
    if (currentTableData?.id && currentTableData?.name) {
      map[currentTableData.id] = currentTableData.name;
    }
    return map;
  }, [contentNodes, currentTableData?.id, currentTableData?.name]);
  
  // --- View Selection Logic ---
  
  // View 1: Editor View (Specific Context)
  const isEditorView = !!activeTableId;
  
  // View 2: Project Folder View (Inside a Project)
  const isProjectFolderView = !!activeBaseId && !activeTableId;
  
  // View 3: Root View (All Projects)
  const isRootView = !activeBaseId && !activeTableId;

  // 当进入项目文件夹时，设置初始路径（已在 resolvePathSegments 中处理）

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: '#000',
        overflow: 'hidden',
      }}
    >
      {/* 左侧主要区域 (Header + Content) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          position: 'relative',
        }}
      >
        {/* Header - Finder Style Navigation */}
        {!isRootView && (
          <div style={{ flexShrink: 0 }}>
            <ProjectsHeader
              pathSegments={pathSegments}
              projectId={activeBase?.id ?? null}
              onProjectsRefresh={() => refreshProjects()}
              editorType={editorType}
              onEditorTypeChange={setEditorType}
              accessPointCount={accessPoints.length}
              showEditorSwitcher={isEditorView}
              viewType={viewType}
              onViewTypeChange={setViewType}
              isChatOpen={isChatOpen}
              onChatOpenChange={setIsChatOpen}
            />
          </div>
        )}

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            position: 'relative',
            background: isRootView ? '#050607' : '#050607', // 可以为 Dashboard 设置不同的背景色
            overflowY: isEditorView ? 'hidden' : 'auto', 
            padding: isEditorView || isRootView ? 0 : 24, // Dashboard 自带 padding
          }}
        >
          {/* VIEW 1: EDITOR */}
          {isEditorView && (
             <div
               style={{
                 flex: 1,
                 display: 'flex',
                 flexDirection: 'column',
                 height: '100%',
                 position: 'relative',
                 minWidth: 0,
               }}
             >
              {activeBase || isOrphanTable ? (
                 <ProjectWorkspaceView
                   projectId={activeBase?.id || '-'}
                   project={
                     activeBase || {
                       id: '-',
                       name: currentTableData?.name || 'Context',
                       tables: currentTableData
                         ? [
                             {
                               id: String(currentTableData.id),
                               name: currentTableData.name,
                               rows: currentTableData.rows,
                             },
                           ]
                         : [],
                     }
                   }
                   activeTableId={activeTableId}
                   onActiveTableChange={(id: string) => {
                     setActiveTableId(id);
                     if (isOrphanTable) {
                       router.push(`/projects/-/${id}`);
                     } else {
                       router.push(`/projects/${activeBaseId}/${id}`);
                     }
                   }}
                   onTreePathChange={setCurrentTreePath}
                   editorType={editorType}
                   configuredAccessPoints={configuredAccessPoints}
                   onAccessPointChange={(
                     path: string,
                     permissions: McpToolPermissions
                   ) => {
                      // ... existing access point logic ...
                    const hasAnyPermission =
                      Object.values(permissions).some(Boolean);
                      setAccessPoints(prev => {
                        const existing = prev.find(ap => ap.path === path);
                        if (existing) {
                        if (!hasAnyPermission)
                          return prev.filter(ap => ap.path !== path);
                        return prev.map(ap =>
                          ap.path === path ? { ...ap, permissions } : ap
                        );
                        } else if (hasAnyPermission) {
                        return [
                          ...prev,
                          { id: `ap-${Date.now()}`, path, permissions },
                        ];
                        }
                        return prev;
                      });
                      
                      if (activeTableId) {
                        syncToolsForPath({
                          tableId: activeTableId,
                          path,
                          permissions,
                          existingTools: tableTools as any,
                        }).then(() => {
                           refreshTableTools(activeTableId);
                           refreshProjectTools(activeBaseId || projectId);
                        });
                      }
                   }}
                   onAccessPointRemove={(path: string) => {
                    setAccessPoints(prev =>
                      prev.filter(ap => ap.path !== path)
                    );
                      if (activeTableId) {
                        deleteAllToolsForPath({
                          tableId: activeTableId,
                          path,
                          existingTools: tableTools as any,
                        }).then(() => {
                           refreshTableTools(activeTableId);
                           refreshProjectTools(activeBaseId || projectId);
                        });
                      }
                   }}
                   onOpenDocument={(path: string, value: string) => {
                     setEditorTarget({ path, value });
                     setRightPanelContent('EDITOR');
                   }}
                 />
               ) : (
                 <div style={{ color: '#666', padding: 20 }}>
                   {projectsLoading ? 'Loading Context...' : 'Context Not Found'}
                 </div>
               )}
             </div>
          )}

          {/* VIEW 2: PROJECT FOLDER CONTENTS */}
          {isProjectFolderView && activeBase && (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {/* Loading Overlay */}
              {(isResolvingPath || contentNodesLoading) && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10,
                    gap: 16,
                  }}
                >
                  {/* Spinner */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      border: '3px solid rgba(255, 255, 255, 0.1)',
                      borderTopColor: '#fff',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 14 }}>
                    Loading...
                  </span>
                  <style>{`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              )}
              {(() => {
                // 准备数据：只从 content_nodes 获取（已完成数据迁移）
                const items = contentNodes.map(node => ({
                  id: node.id,
                  name: node.name,
                  type: node.type as ContentType,
                  description: node.type === 'folder' ? 'Folder' : 'JSON',
                  onClick: () => {
                    if (node.type === 'folder') {
                      // 进入子文件夹 - 构建完整路径
                      const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
                      const newPath = currentPath ? `${currentPath}/${node.id}` : node.id;
                      router.push(`/projects/${activeBaseId}/${newPath}`);
                    } else {
                      // 打开 JSON 编辑器 - 包含文件夹路径
                      const currentPath = folderBreadcrumbs.map(f => f.id).join('/');
                      const nodePath = currentPath ? `${currentPath}/${node.id}` : node.id;
                      router.push(`/projects/${activeBase.id}/${nodePath}`);
                    }
                  },
                }));

                const handleCreateClick = (e: React.MouseEvent) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setCreateMenuPosition({ x: rect.left, y: rect.bottom + 4 });
                  setCreateMenuOpen(true);
                };

                return viewType === 'list' ? (
                  <ListView
                    items={items}
                    onCreateClick={handleCreateClick}
                    createLabel='New...'
                  />
                ) : (
                  <GridView
                    items={items}
                    onCreateClick={handleCreateClick}
                    createLabel='New...'
                  />
                );
              })()}
            </div>
          )}
          

          {/* VIEW 3: ROOT FOLDER CONTENTS - DASHBOARD VIEW */}
          {isRootView && (
            <div style={{ width: '100%', height: '100%' }}>
              <DashboardView
                projects={projects}
                loading={projectsLoading}
                onProjectClick={(projectId) => router.push(`/projects/${projectId}`)}
                onCreateClick={() => setCreateProjectOpen(true)}
              />
            </div>
          )}

          {/* Right Panel (Shared) */}
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
                onToggleFullScreen={() =>
                  setIsEditorFullScreen(!isEditorFullScreen)
                }
              />
            )}
          </ResizablePanel>
        </div>
      </div>

      {/* Chat Sidebar (Only visible if editor is open, or maybe always?) */}
      {/* Keeping Chat Sidebar available but it might be context-aware */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
        tableData={currentTableData?.data}
        tableId={activeTableId}
        projectId={!isOrphanTable ? activeBase?.id : undefined}
        onDataUpdate={async () => {
          refreshTable();
        }}
        accessPoints={accessPoints}
        projectTools={!isOrphanTable ? projectTools : tableTools}
        tableNameById={tableNameById}
      />

      {/* Create Menu */}
      {createMenuOpen && createMenuPosition && (
        <div ref={createMenuRef}>
          <CreateMenu
            x={createMenuPosition.x}
            y={createMenuPosition.y}
            onClose={() => setCreateMenuOpen(false)}
            onCreateFolder={() => {
              // 在项目内部使用新的 FolderManageDialog，在根目录使用 ProjectManageDialog
              if (isProjectFolderView) {
                setCreateFolderOpen(true);
              } else {
                setCreateProjectOpen(true);
              }
            }}
            onCreateContext={() => setCreateTableOpen(true)}
          />
        </div>
      )}

      {/* Dialogs */}
      {createProjectOpen && (
        <ProjectManageDialog
          mode='create'
          projectId={null}
          projects={projects}
          onClose={() => setCreateProjectOpen(false)}
        />
      )}

      {createTableOpen && (
        <TableManageDialog
          mode='create'
          projectId={activeBase?.id || null}
          tableId={null}
          parentId={currentFolderId}
          projects={projects}
          onClose={() => setCreateTableOpen(false)}
        />
      )}

      {createFolderOpen && activeBaseId && (
        <FolderManageDialog
          projectId={activeBaseId}
          parentId={currentFolderId}
          parentPath={currentFolderPath || `/${activeBase?.name || ''}`}
          onClose={() => setCreateFolderOpen(false)}
          onSuccess={() => {
            // 刷新内容节点列表
            loadContentNodes(currentFolderId);
          }}
        />
      )}
    </div>
  );
}
