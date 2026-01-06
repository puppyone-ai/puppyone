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
} from '@/lib/hooks/useData';
import { updateTableData } from '@/lib/projectsApi';
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import { OnboardingView } from '@/components/OnboardingView';
import { ProjectsHeader, type EditorType } from '@/components/ProjectsHeader';
import { ChatSidebar } from '@/components/ChatSidebar';
import {
  RightAuxiliaryPanel,
  type RightPanelContent,
  type EditorTarget,
  type AccessPoint,
  type SaveToolsResult,
} from '@/components/RightAuxiliaryPanel';

// MCP Tools imports
import {
  type McpToolPermissions,
  type McpToolType,
  type McpToolDefinition,
  type Tool,
  createTool,
  permissionsToRegisterTools,
  TOOL_INFO,
} from '@/lib/mcpApi';

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
  const [activeBaseId, setActiveBaseId] = useState<string>(projectId || '');
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '');

  // 2. 数据获取
  const { projects, isLoading: projectsLoading } = useProjects();
  // 获取当前 table 的 Tools（用于 sidebar 显示）
  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(
    activeTableId || tableId
  );
  // 获取当前 table 的数据（用于 ChatSidebar）
  const { tableData: currentTableData, refresh: refreshTable } = useTable(
    activeBaseId || projectId,
    activeTableId || tableId
  );

  // 3. 状态管理
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null);
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(340);
  const [rightPanelContent, setRightPanelContent] =
    useState<RightPanelContent>('NONE');
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<SaveToolsResult | null>(null);
  const lastSyncedTableId = useRef<string | null>(null);

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false);

  // 兼容：isAgentPanelOpen 现在等价于 rightPanelContent === 'TOOLS'
  const isAgentPanelOpen = rightPanelContent === 'TOOLS';
  const setIsAgentPanelOpen = (open: boolean) =>
    setRightPanelContent(open ? 'TOOLS' : 'NONE');

  // 4. 副作用：同步路由参数到状态
  useEffect(() => {
    if (projectId) setActiveBaseId(projectId);
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
    const segments = ['Projects'];
    if (activeBase) segments.push(activeBase.name);
    if (activeTable) segments.push(activeTable.name);
    return segments;
  }, [activeBase, activeTable]);

  // 7. 处理 Onboarding
  const showOnboarding = !slug || slug.length === 0;

  // 保存 Tools
  const handleSaveTools = async (
    customDefinitions: Record<string, McpToolDefinition>
  ) => {
    if (!activeBase || !activeTable || !session?.user?.id) return;
    if (accessPoints.length === 0) return;

    setIsSaving(true);
    setSaveError(null);
    setSavedResult(null);

    try {
      const toolsToCreate: Array<{
        path: string;
        type: McpToolType;
        customDef?: McpToolDefinition;
      }> = [];

      accessPoints.forEach(ap => {
        const toolTypes = permissionsToRegisterTools(ap.permissions);
        toolTypes.forEach(type => {
          toolsToCreate.push({
            path: ap.path,
            type,
            customDef: customDefinitions[type],
          });
        });
      });

      if (toolsToCreate.length === 0) {
        throw new Error('No tools to create');
      }

      const createdTools: Tool[] = await Promise.all(
        toolsToCreate.map(({ path, type, customDef }) => {
          const pathSuffix = path
            ? path.replace(/\//g, '_').replace(/^_/, '')
            : 'root';
          const defaultName = `${activeTable.name}_${pathSuffix}_${type}`;

          return createTool({
            table_id: parseInt(activeTable.id),
            json_path: path,
            type: type,
            name: customDef?.name || defaultName,
            description: customDef?.description || TOOL_INFO[type].description,
          });
        })
      );

      setSavedResult({
        tools: createdTools,
        count: createdTools.length,
      });

      if (activeTableId) {
        refreshTableTools(activeTableId);
      }
    } catch (error) {
      console.error('Failed to save tools:', error);
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save tools'
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (showOnboarding) {
    return (
      <OnboardingView
        userName={session?.user?.email?.split('@')[0] || 'User'}
        onStart={async () => {
          setIsOnboardingLoading(true);
          await new Promise(r => setTimeout(r, 500));
          if (projects.length > 0) {
            const p = projects[0];
            router.push(`/projects/${p.id}/${p.tables?.[0]?.id || ''}`);
          } else {
            router.push('/settings/connect');
          }
        }}
        isLoading={isOnboardingLoading}
      />
    );
  }

  // 将 accessPoints 转换为 configuredAccessPoints 格式
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({
      path: ap.path,
      permissions: ap.permissions,
    }));
  }, [accessPoints]);

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
            isAgentPanelOpen={rightPanelContent === 'TOOLS'}
            onAgentPanelOpenChange={open =>
              setRightPanelContent(open ? 'TOOLS' : 'NONE')
            }
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
              {activeBase ? (
                <ProjectWorkspaceView
                  projectId={activeBase.id}
                  project={activeBase}
                  activeTableId={activeTableId}
                  onActiveTableChange={(id: string) => {
                    setActiveTableId(id);
                    router.push(`/projects/${activeBaseId}/${id}`);
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

                    // 🎯 只要 Sidebar 是收起的，配置新工具时就展开
                    if (hasAnyPermission && !isAgentPanelOpen) {
                      setIsAgentPanelOpen(true);
                    }

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
                  }}
                  onAccessPointRemove={(path: string) => {
                    setAccessPoints(prev =>
                      prev.filter(ap => ap.path !== path)
                    );
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

          {/* 右侧面板区域 (Tools / Document Editor) */}
          <RightAuxiliaryPanel
            content={rightPanelContent}
            onClose={() => {
              setRightPanelContent('NONE');
              setIsEditorFullScreen(false);
            }}
            accessPoints={accessPoints}
            setAccessPoints={setAccessPoints}
            activeBaseName={activeBase?.name}
            activeTableName={activeTable?.name}
            onSaveTools={handleSaveTools}
            isSaving={isSaving}
            saveError={saveError}
            savedResult={savedResult}
            setSavedResult={setSavedResult}
            onViewAllMcp={() => router.push('/tools-and-server/tools-list')}
            editorTarget={editorTarget}
            onEditorSave={(path, newValue) => {
              // TODO: 实现保存逻辑 - 通过 path 找到对应的节点并更新
              console.log('Save document:', path, newValue);
              setEditorTarget(null);
              setRightPanelContent('NONE');
              setIsEditorFullScreen(false);
            }}
            isEditorFullScreen={isEditorFullScreen}
            onToggleEditorFullScreen={() =>
              setIsEditorFullScreen(!isEditorFullScreen)
            }
          />
        </div>
      </div>

      {/* Chat Sidebar (全局层级，挤压左侧所有内容) */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
        tableData={currentTableData?.data}
        onDataUpdate={async (newData) => {
          // 保存到后端
          if (activeBaseId && activeTableId) {
            try {
              const dataToSave = Array.isArray(newData) ? newData : [newData];
              await updateTableData(activeBaseId, activeTableId, dataToSave);
              // 刷新数据
              refreshTable();
            } catch (err) {
              console.error('[ChatSidebar] Failed to save:', err);
            }
          }
        }}
      />
    </div>
  );
}
