'use client';

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
import { ContextSidebar } from '@/components/ContextSidebar';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';

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
import { listNodes, type NodeInfo } from '@/lib/contentNodesApi';

export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

// --- Finder View Components ---

function GridItem({
  icon,
  label,
  onClick,
  type = 'folder',
}: {
  icon: React.ReactNode | ((props: { hovered: boolean }) => React.ReactNode);
  label: string;
  onClick: (e: React.MouseEvent) => void;
  type?: 'folder' | 'file' | 'create';
}) {
  const [hovered, setHovered] = useState(false);
  const isCreate = type === 'create';

  return (
    <div
      onClick={e => onClick(e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 120,
        height: 136,
        padding: '22px 10px 10px 10px', // 改为顶部对齐，通过 padding 固定图标位置，确保新建按钮与普通图标对齐
        gap: 10,
        borderRadius: 8,
        cursor: 'pointer',
        background:
          hovered && !isCreate ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <div
        style={{
          width: isCreate ? 48 : 'auto',
          height: isCreate ? 48 : 48, // 固定高度以对齐
          borderRadius: isCreate ? 12 : 0,
          // Create 按钮：平时全透明无边框，hover 时才显示微弱背景
          background: isCreate
            ? hovered
              ? 'rgba(255,255,255,0.05)'
              : 'transparent'
            : 'transparent',
          // Create 按钮：平时虚线边框，hover 时实线或更亮
          border: isCreate
            ? hovered
              ? '1px dashed rgba(255,255,255,0.3)'
              : '1px dashed rgba(255,255,255,0.15)'
            : 'none',
          fontSize: isCreate ? 20 : 48,
          // Folder 改为中性灰白色，去除"AI蓝"；File (Table) 保持绿色
          color:
            type === 'folder'
              ? hovered
                ? '#e4e4e7'
                : '#a1a1aa'
              : type === 'file'
                ? '#34d399'
                : hovered
                  ? '#fff'
                  : '#444',
          opacity: hovered ? 1 : isCreate ? 1 : 0.9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
          // 移除了 translateY 上浮效果，避免 AR 味太重
          transform: 'none',
          boxShadow:
            isCreate && hovered ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
        }}
      >
        {typeof icon === 'function' ? icon({ hovered }) : icon}
      </div>
      {!isCreate && (
        <div
          style={{
            fontSize: 13,
            color: hovered ? '#fff' : '#a1a1aa', // 更柔和的灰色
            textAlign: 'center',
            wordBreak: 'break-word',
            lineHeight: '1.4em',
            height: '2.8em', // 强制两行高度以保持网格对齐
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            padding: '0 2px',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

// Create Menu Component
function CreateMenu({
  x,
  y,
  onClose,
  onCreateFolder,
  onCreateContext,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateContext: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: '6px 0',
        minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div
        onClick={() => {
          onCreateFolder();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          color: '#e4e4e7',
          fontSize: 14,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
        }
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg
          width='18'
          height='18'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
            fill='#a1a1aa'
            fillOpacity='0.2'
            stroke='#a1a1aa'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        <span>New Folder</span>
      </div>

      <div
        style={{
          height: 1,
          background: 'rgba(255,255,255,0.08)',
          margin: '4px 8px',
        }}
      />

      <div
        onClick={() => {
          onCreateContext();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          color: '#e4e4e7',
          fontSize: 14,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
        }
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg
          width='18'
          height='18'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z'
            stroke='#34d399'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
            fill='#34d399'
            fillOpacity='0.1'
          />
          <path
            d='M3 9H21'
            stroke='#34d399'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M3 15H21'
            stroke='#34d399'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M9 3V21'
            stroke='#34d399'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        <span>New Context</span>
      </div>
    </div>
  );
}

// List View Item Component
function ListItem({
  icon,
  label,
  onClick,
  type = 'folder',
  description,
}: {
  icon: React.ReactNode | ((props: { hovered: boolean }) => React.ReactNode);
  label: string;
  onClick: (e: React.MouseEvent) => void;
  type?: 'folder' | 'file' | 'create';
  description?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const isCreate = type === 'create';

  return (
    <div
      onClick={e => onClick(e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        gap: 12,
        borderRadius: 6,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        transition: 'all 0.1s',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color:
            type === 'folder'
              ? hovered
                ? '#e4e4e7'
                : '#a1a1aa'
              : type === 'file'
                ? '#34d399'
                : '#666',
          fontSize: 20,
        }}
      >
        {typeof icon === 'function' ? icon({ hovered }) : icon}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: 14,
            color: hovered || isCreate ? '#fff' : '#d4d4d8',
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 12, color: '#71717a' }}>{description}</div>
        )}
      </div>

      <div style={{ color: '#52525b', fontSize: 12 }}>
        {type === 'folder' ? 'Folder' : type === 'file' ? 'Context' : 'Action'}
      </div>
    </div>
  );
}

// 重构版本的页面组件 - 极简布局，用于定位显示问题
export default function ProjectsSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const { session } = useAuth();

  // 1. 解析路由参数
  const [projectId, tableId] = slug || [];
  // projectId === '-' 表示裸 Table（不属于任何 Project）
  const isOrphanTable = projectId === '-';
  const [activeBaseId, setActiveBaseId] = useState<string>(
    isOrphanTable ? '' : projectId || ''
  );
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '');

  // View State
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(
    new Set()
  );

  // 2. 数据获取
  const { projects, isLoading: projectsLoading } = useProjects();
  // 获取当前 table 的 Tools（用于 sidebar 显示）
  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(
    activeTableId || tableId
  );
  // 获取当前 project 下的所有 Tools（用于 ChatSidebar 项目级展示）
  const { tools: projectTools } = useProjectTools(
    !isOrphanTable ? activeBaseId || projectId : undefined
  );
  // 获取当前 table 的数据（用于 ChatSidebar）
  const { tableData: currentTableData, refresh: refreshTable } = useTable(
    activeBaseId || projectId,
    activeTableId || tableId
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
  const [contentNodes, setContentNodes] = useState<NodeInfo[]>([]);
  const [contentNodesLoading, setContentNodesLoading] = useState(false);

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
    try {
      setContentNodesLoading(true);
      const result = await listNodes(parentId);
      setContentNodes(result.nodes);
    } catch (error) {
      console.error('Failed to load content nodes:', error);
      setContentNodes([]);
    } finally {
      setContentNodesLoading(false);
    }
  };

  // 4. 副作用：同步路由参数到状态
  useEffect(() => {
    // 只有当 URL 参数存在时才更新状态，避免清除状态
    if (projectId !== undefined) {
      setActiveBaseId(projectId === '-' ? '' : projectId);
    } else {
      setActiveBaseId('');
    }

    if (tableId !== undefined) {
      setActiveTableId(tableId);
    } else {
      setActiveTableId('');
    }
  }, [projectId, tableId]);

  // 同步 Access Points
  useEffect(() => {
    const currentTableId = activeTableId || tableId;
    if (!currentTableId || toolsLoading) return;
    if (currentTableId === lastSyncedTableId.current) return;

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
    lastSyncedTableId.current = currentTableId;
  }, [activeTableId, tableId, toolsLoading, tableTools]);

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
      activeBase?.tables.find(
        table => String(table.id) === String(activeTableId)
      ) ?? null,
    [activeBase, activeTableId]
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
    // 1. Home Segment
    const segments: BreadcrumbSegment[] = [
      {
        label: 'Home',
        href: '/projects',
        icon: (
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M3 9.5L12 2L21 9.5V21C21 21.5523 20.5523 22 20 22H15V16H9V22H4C3.44772 22 3 21.5523 3 21V9.5Z'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        ),
      },
    ];

    // 2. Project Segment
    if (activeBaseId) {
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

      if (activeBase) {
        segments.push({
          label: activeBase.name,
          href: `/projects/${activeBase.id}`,
          icon: folderIcon,
        });
      } else {
        segments.push({
          label: 'Project',
          href: `/projects/${activeBaseId}`,
          icon: folderIcon,
        });
      }
    }

    // 3. Context Segment
    if (activeTableId) {
      const tableIcon = (
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          style={{ color: '#34d399' }}
        >
          <rect
            x='3'
            y='3'
            width='18'
            height='18'
            rx='2'
            stroke='currentColor'
            strokeWidth='2'
          />
          <path d='M3 9H21' stroke='currentColor' strokeWidth='2' />
          <path d='M9 21V9' stroke='currentColor' strokeWidth='2' />
        </svg>
      );

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
  ]);

  // 8. 渲染准备
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({
      path: ap.path,
      permissions: ap.permissions,
    }));
  }, [accessPoints]);

  const tableNameById = useMemo(() => {
    const map: Record<number, string> = {};
    if (activeBase?.tables) {
      activeBase.tables.forEach(t => {
        const idNum = Number(t.id);
        if (Number.isFinite(idNum)) map[idNum] = t.name;
      });
    }
    if (currentTableData?.id && currentTableData?.name) {
      const idNum = Number(currentTableData.id);
      if (Number.isFinite(idNum)) map[idNum] = currentTableData.name;
    }
    return map;
  }, [activeBase?.tables, currentTableData?.id, currentTableData?.name]);

  // --- View Selection Logic ---

  // View 1: Editor View (Specific Context)
  const isEditorView = !!activeTableId;

  // View 2: Project Folder View (Inside a Project)
  const isProjectFolderView = !!activeBaseId && !activeTableId;

  // View 3: Root View (All Projects)
  const isRootView = !activeBaseId && !activeTableId;

  // 当进入项目文件夹时，加载 content_nodes
  useEffect(() => {
    if (isProjectFolderView && activeBase) {
      // 设置当前文件夹路径
      setCurrentFolderPath(`/${activeBase.name}`);
      setCurrentFolderId(null); // 重置为根目录（项目级别）
      // 加载该项目根目录的 content_nodes
      loadContentNodes(null);
    }
  }, [isProjectFolderView, activeBase?.id]);

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
      {/* View 3: Sidebar (Column Mode) */}
      {viewType === 'column' && (
        <ContextSidebar
          project={activeBase}
          allProjects={projects}
          activeTableId={activeTableId}
          onTableSelect={id => router.push(`/projects/${activeBaseId}/${id}`)}
          onBackToProjects={() => router.push('/projects')}
        />
      )}

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

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            position: 'relative',
            background: '#050607',
            overflowY: isEditorView ? 'hidden' : 'auto', // Scroll for grid/list, hidden for editor
            padding: isEditorView ? 0 : 24, // Padding for browser
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

                    const currentTableId = activeTableId || tableId;
                    if (currentTableId) {
                      syncToolsForPath({
                        tableId: currentTableId,
                        path,
                        permissions,
                        existingTools: tableTools as any,
                      }).then(() => {
                        refreshTableTools(String(currentTableId));
                        refreshProjectTools(activeBaseId || projectId);
                      });
                    }
                  }}
                  onAccessPointRemove={(path: string) => {
                    setAccessPoints(prev =>
                      prev.filter(ap => ap.path !== path)
                    );
                    const currentTableId = activeTableId || tableId;
                    if (currentTableId) {
                      deleteAllToolsForPath({
                        tableId: currentTableId,
                        path,
                        existingTools: tableTools as any,
                      }).then(() => {
                        refreshTableTools(String(currentTableId));
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
            <div style={{ width: '100%' }}>
              <div
                style={{
                  display: viewType === 'list' ? 'flex' : 'grid',
                  flexDirection: 'column',
                  gridTemplateColumns:
                    viewType === 'list'
                      ? undefined
                      : 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: viewType === 'list' ? 0 : 16,
                }}
              >
                {/* Content Nodes - Folders (from new content_nodes API) */}
                {contentNodes
                  .filter(node => node.type === 'folder')
                  .map(folder =>
                    viewType === 'list' ? (
                      <ListItem
                        key={folder.id}
                        type='folder'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M2 9C2 7.89543 2.89543 7 4 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V9Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={folder.name}
                        onClick={() => {
                          setCurrentFolderId(folder.id);
                          setCurrentFolderPath(folder.path);
                          loadContentNodes(folder.id);
                        }}
                        description='Folder'
                      />
                    ) : (
                      <GridItem
                        key={folder.id}
                        type='folder'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M2 9C2 7.89543 2.89543 7 4 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V9Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={folder.name}
                        onClick={() => {
                          setCurrentFolderId(folder.id);
                          setCurrentFolderPath(folder.path);
                          loadContentNodes(folder.id);
                        }}
                      />
                    )
                  )}

                {/* Contexts (from old project/table structure) */}
                {activeBase.tables &&
                  activeBase.tables.map(table =>
                    viewType === 'list' ? (
                      <ListItem
                        key={table.id}
                        type='file'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              fill='currentColor'
                              fillOpacity='0.05'
                            />
                            <path
                              d='M3 9H21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M3 15H21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M9 3V21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={table.name}
                        onClick={() =>
                          router.push(`/projects/${activeBase.id}/${table.id}`)
                        }
                        description={`${table.rows?.length || 0} rows`}
                      />
                    ) : (
                      <GridItem
                        key={table.id}
                        type='file'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              fill='currentColor'
                              fillOpacity='0.05'
                            />
                            <path
                              d='M3 9H21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M3 15H21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M9 3V21'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={table.name}
                        onClick={() =>
                          router.push(`/projects/${activeBase.id}/${table.id}`)
                        }
                      />
                    )
                  )}

                {/* Create New Item Card - At the end */}
                {viewType === 'list' ? (
                  <ListItem
                    type='create'
                    icon={
                      <svg
                        width='1em'
                        height='1em'
                        viewBox='0 0 24 24'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          d='M12 6V18'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                        <path
                          d='M6 12H18'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    }
                    label='New...'
                    onClick={(e: React.MouseEvent) => {
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setCreateMenuPosition({
                        x: rect.left,
                        y: rect.bottom + 4,
                      });
                      setCreateMenuOpen(true);
                    }}
                  />
                ) : (
                  <GridItem
                    type='create'
                    icon={
                      <svg
                        width='1em'
                        height='1em'
                        viewBox='0 0 24 24'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          d='M12 6V18'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                        <path
                          d='M6 12H18'
                          stroke='currentColor'
                          strokeWidth='1.5'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    }
                    label='New...'
                    onClick={(e: React.MouseEvent) => {
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setCreateMenuPosition({
                        x: rect.left,
                        y: rect.bottom + 4,
                      });
                      setCreateMenuOpen(true);
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* VIEW 3: ROOT FOLDER CONTENTS */}
          {isRootView && (
            <div style={{ width: '100%' }}>
              {projectsLoading ? (
                <div style={{ color: '#666' }}>Loading...</div>
              ) : (
                <div
                  style={{
                    display: viewType === 'list' ? 'flex' : 'grid',
                    flexDirection: 'column',
                    gridTemplateColumns:
                      viewType === 'list'
                        ? undefined
                        : 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: viewType === 'list' ? 0 : 16,
                  }}
                >
                  {projects.map(project =>
                    viewType === 'list' ? (
                      <ListItem
                        key={project.id}
                        type='folder'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M2 9C2 7.89543 2.89543 7 4 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V9Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={project.name}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        description={`${project.tables?.length || 0} items`}
                      />
                    ) : (
                      <GridItem
                        key={project.id}
                        type='folder'
                        icon={
                          <svg
                            width='1em'
                            height='1em'
                            viewBox='0 0 24 24'
                            fill='none'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                            <path
                              d='M2 9C2 7.89543 2.89543 7 4 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V9Z'
                              fill='currentColor'
                              fillOpacity='0.1'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        }
                        label={project.name}
                        onClick={() => router.push(`/projects/${project.id}`)}
                      />
                    )
                  )}

                  {/* Create New Project Card - At the end */}
                  {viewType === 'list' ? (
                    <ListItem
                      type='create'
                      icon={
                        <svg
                          width='1em'
                          height='1em'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            d='M12 6V18'
                            stroke='currentColor'
                            strokeWidth='1.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                          <path
                            d='M6 12H18'
                            stroke='currentColor'
                            strokeWidth='1.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                        </svg>
                      }
                      label='New Folder'
                      onClick={() => setCreateProjectOpen(true)}
                    />
                  ) : (
                    <GridItem
                      type='create'
                      icon={
                        <svg
                          width='1em'
                          height='1em'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            d='M12 6V18'
                            stroke='currentColor'
                            strokeWidth='1.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                          <path
                            d='M6 12H18'
                            stroke='currentColor'
                            strokeWidth='1.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                        </svg>
                      }
                      label='New Folder'
                      onClick={() => setCreateProjectOpen(true)}
                    />
                  )}
                </div>
              )}
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
        tableId={activeTableId || tableId}
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
          projects={projects}
          onClose={() => setCreateTableOpen(false)}
        />
      )}

      {createFolderOpen && (
        <FolderManageDialog
          parentId={currentFolderId}
          parentPath={currentFolderPath || `/${activeBase?.name || ''}`}
          onClose={() => setCreateFolderOpen(false)}
          onSuccess={() => {
            // 刷新内容节点列表
            if (currentFolderId) {
              loadContentNodes(currentFolderId);
            }
          }}
        />
      )}
    </div>
  );
}
