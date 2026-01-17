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
import { ProjectsHeader, type EditorType } from '@/components/ProjectsHeader';
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

// AccessPoint was imported from ToolsPanel, need to define or import it correctly if it's not in mcpApi.
// Checking previous file content, it seems AccessPoint interface was exported from ToolsPanel.
// I should define it here or import if it exists in mcpApi.
// Let's define it here to be safe and remove dependency on ToolsPanel.
export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
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
    !isOrphanTable ? (activeBaseId || projectId) : undefined
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
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false);
  const lastSyncedTableId = useRef<string | null>(null);

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);

  // 4. 副作用：同步路由参数到状态
  useEffect(() => {
    if (projectId && projectId !== '-') setActiveBaseId(projectId);
    if (tableId) setActiveTableId(tableId);
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
    tableId: number;
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
    // Note: bash mutual-exclusion is handled in UI, but we keep it safe here too.
    const wantShellReadonly = !!(permissions as any)?.shell_access_readonly;
    const wantShellFull = !!(permissions as any)?.shell_access;
    const effectivePermissions: Record<string, boolean> = { ...(permissions as any) };
    if (wantShellReadonly) effectivePermissions['shell_access'] = false;
    if (wantShellFull) effectivePermissions['shell_access_readonly'] = false;

    // 先删除不需要的工具（包括互斥的 bash 类型）
    const toDelete: number[] = [];
    const toCreate: string[] = [];

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

    // 先执行删除（确保互斥的 bash 类型被先删除）
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
    tableId: number;
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

  // 6. 路径片段
  const pathSegments = useMemo(() => {
    const segments = ['Contexts'];
    if (isOrphanTable) {
      // 裸 Table 只显示 table name
      if (currentTableData) segments.push(currentTableData.name);
    } else {
      if (activeBase) segments.push(activeBase.name);
      if (activeTable) segments.push(activeTable.name);
    }
    return segments;
  }, [activeBase, activeTable, isOrphanTable, currentTableData]);

  // 7. 处理 Onboarding - 移除自动跳转逻辑
  // 我们不再通过前端粗暴地判断是否跳转 Onboarding，避免与后端预置数据逻辑冲突
  // 如果是空项目状态，应该由 UI (ProjectWorkspaceView) 展示 Empty State 引导用户

  // 8. 渲染
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
    // orphan table
    if (currentTableData?.id && currentTableData?.name) {
      const idNum = Number(currentTableData.id);
      if (Number.isFinite(idNum)) map[idNum] = currentTableData.name;
    }
    return map;
  }, [activeBase?.tables, currentTableData?.id, currentTableData?.name]);

  // 8. 渲染
  // 使用显式的背景色块布局，确保容器撑开
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row', // 改为 row，让 ChatSidebar 在右侧挤压
        background: '#000', // 底色纯黑
        overflow: 'hidden',
      }}
    >
      {/* 左侧主要区域 (Header + Main Content) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0, // 防止 flex item 溢出
          height: '100%',
          position: 'relative',
        }}
      >
        {/* 顶部 Header - 固定高度 */}
        <div style={{ flexShrink: 0 }}>
          <ProjectsHeader
            pathSegments={pathSegments}
            projectId={activeBase?.id ?? null}
            onProjectsRefresh={() => refreshProjects()}
            editorType={editorType}
            onEditorTypeChange={setEditorType}
            accessPointCount={accessPoints.length}
            isChatOpen={isChatOpen}
            onChatOpenChange={setIsChatOpen}
          />
        </div>

        {/* 中间主要区域 - 占据剩余空间 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            position: 'relative',
            background: '#050607', // 编辑器背景色
          }}
        >
          {/* 左侧编辑器容器 */}
          {!(isEditorFullScreen && rightPanelContent === 'EDITOR') && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                minWidth: 0,
                // borderRight 已移除 - 浮动卡片样式的 sidebar 不需要分隔线
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
                    const hasAnyPermission =
                      Object.values(permissions).some(Boolean);

                    // 如果该 path 已存在，更新权限；否则添加新的
                    setAccessPoints(prev => {
                      const existing = prev.find(ap => ap.path === path);

                      if (existing) {
                        // 如果没有任何权限了，则移除
                        if (!hasAnyPermission) {
                          return prev.filter(ap => ap.path !== path);
                        }
                        return prev.map(ap =>
                          ap.path === path ? { ...ap, permissions } : ap
                        );
                      } else if (hasAnyPermission) {
                        return [
                          ...prev,
                          {
                            id: `ap-${Date.now()}`,
                            path,
                            permissions,
                          },
                        ];
                      }
                      return prev;
                    });

                    // Persist to backend (best-effort, async)
                    const currentTableId = Number(activeTableId || tableId);
                    if (Number.isFinite(currentTableId)) {
                      syncToolsForPath({
                        tableId: currentTableId,
                        path,
                        permissions,
                        existingTools: tableTools as any,
                      })
                        .then(() => {
                          refreshTableTools(String(currentTableId));
                          // 同步刷新 project tools，保证 ChatSidebar 菜单立刻看到最新配置
                          refreshProjectTools(activeBaseId || projectId);
                        })
                        .catch(err => console.error('Failed to persist tools:', err));
                    }
                  }}
                  onAccessPointRemove={(path: string) => {
                    setAccessPoints(prev =>
                      prev.filter(ap => ap.path !== path)
                    );

                    const currentTableId = Number(activeTableId || tableId);
                    if (Number.isFinite(currentTableId)) {
                      deleteAllToolsForPath({
                        tableId: currentTableId,
                        path,
                        existingTools: tableTools as any,
                      })
                        .then(() => {
                          refreshTableTools(String(currentTableId));
                          refreshProjectTools(activeBaseId || projectId);
                        })
                        .catch(err =>
                          console.error('Failed to remove tools for path:', err)
                        );
                    }
                  }}
                  onOpenDocument={(path: string, value: string) => {
                    setEditorTarget({ path, value });
                    setRightPanelContent('EDITOR');
                  }}
                />
              ) : (
                <div style={{ color: '#666', padding: 20 }}>
                  {projectsLoading
                    ? 'Loading Projects...'
                    : 'Project Not Found'}
                </div>
              )}
            </div>
          )}

          {/* 右侧面板区域 (Document Editor) */}
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

      {/* Chat Sidebar (全局层级，挤压左侧所有内容) */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
        tableData={currentTableData?.data}
        tableId={activeTableId || tableId}
        projectId={!isOrphanTable ? activeBase?.id ?? null : null}
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
