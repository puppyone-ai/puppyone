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
import { ProjectsHeader, type EditorType, type BreadcrumbSegment } from '@/components/ProjectsHeader';
import { ChatSidebar } from '@/components/ChatSidebar';
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
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  type?: 'folder' | 'file';
}) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 120,
        height: 110,
        padding: 12,
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ 
        fontSize: 48, 
        marginBottom: 8,
        // Folder 保持蓝色，File (Table) 使用类似 Excel 的绿色或更亮的白色，这里选 emerald-400 风格的绿
        color: type === 'folder' ? '#3b82f6' : '#34d399',
        opacity: hovered ? 1 : 0.9,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {icon}
      </div>
      <div style={{
        fontSize: 13,
        color: hovered ? '#fff' : '#d4d4d4',
        textAlign: 'center',
        wordBreak: 'break-word',
        lineHeight: 1.4,
        maxHeight: 36,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {label}
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

  // 6. 路径片段 - 用于导航
  const pathSegments = useMemo<BreadcrumbSegment[]>(() => {
    // 1. Home Segment
    const segments: BreadcrumbSegment[] = [
      { 
        label: 'Home', 
        href: '/projects',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 9.5L12 2L21 9.5V21C21 21.5523 20.5523 22 20 22H15V16H9V22H4C3.44772 22 3 21.5523 3 21V9.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      }
    ];

    // 2. Project Segment
    if (activeBaseId) {
      const folderIcon = (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: '#3b82f6' }}>
           <path d="M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z" fill="currentColor"/>
        </svg>
      );

      if (activeBase) {
        segments.push({ 
          label: activeBase.name, 
          href: `/projects/${activeBase.id}`,
          icon: folderIcon
        });
      } else {
         segments.push({ 
           label: 'Project', 
           href: `/projects/${activeBaseId}`,
           icon: folderIcon
         });
      }
    }
    
    // 3. Context Segment
    if (activeTableId) {
       const tableIcon = (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: '#34d399' }}>
           <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
           <path d="M3 9H21" stroke="currentColor" strokeWidth="2"/>
           <path d="M9 21V9" stroke="currentColor" strokeWidth="2"/>
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
  }, [activeBase, activeTable, activeBaseId, activeTableId, isOrphanTable, currentTableData]);

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
      {/* 左侧主要区域 */}
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
            showViewSwitcher={isEditorView}
            isChatOpen={isChatOpen}
            onChatOpenChange={setIsChatOpen}
            // Add custom back handling if needed, but breadcrumbs usually handle it
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
            overflowY: isEditorView ? 'hidden' : 'auto', // Scroll for grid, hidden for editor
            padding: isEditorView ? 0 : 24, // Padding for grid
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
               {(activeBase || isOrphanTable) ? (
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
                      const hasAnyPermission = Object.values(permissions).some(Boolean);
                      setAccessPoints(prev => {
                        const existing = prev.find(ap => ap.path === path);
                        if (existing) {
                          if (!hasAnyPermission) return prev.filter(ap => ap.path !== path);
                          return prev.map(ap => ap.path === path ? { ...ap, permissions } : ap);
                        } else if (hasAnyPermission) {
                          return [...prev, { id: `ap-${Date.now()}`, path, permissions }];
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
                      setAccessPoints(prev => prev.filter(ap => ap.path !== path));
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
              <h2 style={{ color: '#fff', marginBottom: 20, fontSize: 18, fontWeight: 600 }}>
                {activeBase.name}
              </h2>
              {(!activeBase.tables || activeBase.tables.length === 0) ? (
                 <div style={{ color: '#666', fontStyle: 'italic' }}>No contexts in this folder.</div>
              ) : (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                  gap: 16 
                }}>
                  {activeBase.tables.map(table => (
                    <GridItem
                      key={table.id}
                      type="file"
                      icon={
                        // 表格图标 (Table Icon) - 类似 Excel/Database 的隐喻
                        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          {/* 外框 */}
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                          {/* 表头分隔线 */}
                          <path d="M3 9H21" stroke="currentColor" strokeWidth="2"/>
                          {/* 竖向分隔线 */}
                          <path d="M9 21V9" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      }
                      label={table.name}
                      onClick={() => router.push(`/projects/${activeBase.id}/${table.id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* VIEW 3: ROOT FOLDER CONTENTS */}
          {isRootView && (
            <div style={{ width: '100%' }}>
              <h2 style={{ color: '#fff', marginBottom: 20, fontSize: 18, fontWeight: 600 }}>
                Projects
              </h2>
              {projectsLoading ? (
                <div style={{ color: '#666' }}>Loading...</div>
              ) : (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                  gap: 16 
                }}>
                  {projects.map(project => (
                    <GridItem
                      key={project.id}
                      type="folder"
                      icon={
                        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <path d="M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z" fill="currentColor"/>
                        </svg>
                      }
                      label={project.name}
                      onClick={() => router.push(`/projects/${project.id}`)}
                    />
                  ))}
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
    </div>
  );
}
