'use client'

import { useEffect, useMemo, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/supabase/SupabaseAuthProvider'
import { useProjects, refreshProjects, useTableTools, refreshTableTools } from '@/lib/hooks/useData'
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView'
import { ProjectsHeader, type EditorType } from '@/components/ProjectsHeader'
import { SettingsManager } from '@/app/settings/components/SettingsManager'
import { ChatSidebar } from '@/components/ChatSidebar'
import { OnboardingView } from '@/components/OnboardingView'
import { 
  type McpToolPermissions, 
  type McpToolType,
  type McpToolDefinition,
  type Tool,
  createTool,
  permissionsToRegisterTools,
  TOOL_INFO,
} from '@/lib/mcpApi'
import { 
  RightAuxiliaryPanel, 
  type RightPanelContent, 
  type EditorTarget,
  type AccessPoint,
  type SaveToolsResult,
} from '@/components/RightAuxiliaryPanel'
import { EditorSkeleton } from '@/components/Skeleton'

type ActiveView = 'projects' | 'tools' | 'mcp' | 'connect' | 'test' | 'logs' | 'settings'

export default function ProjectsSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params)
  
  const router = useRouter()
  const { session } = useAuth()
  
  const { projects, isLoading: loading } = useProjects()
  
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual')
  
  // Global State (App Shell Level)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatWidth, setChatWidth] = useState(340)
  
  // 右侧辅助面板状态（互斥复用）
  const [rightPanelContent, setRightPanelContent] = useState<RightPanelContent>('NONE')
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null)
  const [isEditorFullScreen, setIsEditorFullScreen] = useState(false)
  
  // 兼容：isAgentPanelOpen 现在等价于 rightPanelContent === 'TOOLS'
  const isAgentPanelOpen = rightPanelContent === 'TOOLS'
  const setIsAgentPanelOpen = (open: boolean) => setRightPanelContent(open ? 'TOOLS' : 'NONE')
  
  // Access Points 状态 - 用于存储已配置的 MCP 工具权限
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([])
  
  // Tools 保存状态
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedResult, setSavedResult] = useState<SaveToolsResult | null>(null)

  // Extract projectId and tableId from slug
  const [projectId, tableId] = slug || []
  const [activeBaseId, setActiveBaseId] = useState<string>(projectId || '')
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '')
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false)
  
  // 获取当前 table 的 Tools（用于 sidebar 显示）
  const { tools: tableTools, isLoading: toolsLoading } = useTableTools(activeTableId || tableId)
  
  // 跟踪上次同步的 tableId，避免重复同步
  const lastSyncedTableId = useRef<string | null>(null)
  
  // 当 tableId 变化且 tools 加载完成时，用后端 tools 初始化 accessPoints
  useEffect(() => {
    const currentTableId = activeTableId || tableId
    if (!currentTableId || toolsLoading) return
    if (currentTableId === lastSyncedTableId.current) return
    
    // 转换后端 tools 为 accessPoints 格式
    const pathPermissionsMap = new Map<string, McpToolPermissions>()
    tableTools.forEach(tool => {
      const path = tool.json_path || ''
      const existing = pathPermissionsMap.get(path) || {}
      pathPermissionsMap.set(path, { ...existing, [tool.type]: true })
    })
    
    const initialAccessPoints: AccessPoint[] = []
    pathPermissionsMap.forEach((permissions, path) => {
      initialAccessPoints.push({ id: `saved-${path || 'root'}`, path, permissions })
    })
    
    setAccessPoints(initialAccessPoints)
    lastSyncedTableId.current = currentTableId
  }, [activeTableId, tableId, toolsLoading, tableTools])

  // Update state when slug changes
  useEffect(() => {
    if (projectId) {
      setActiveBaseId(projectId)
    }
    if (tableId) {
      setActiveTableId(tableId)
    }
  }, [projectId, tableId])

  // Listen for projects refresh event
  useEffect(() => {
    const handleProjectsRefresh = () => {
      refreshProjects() // 使用 SWR 的 mutate 刷新
    }
    window.addEventListener('projects-refresh', handleProjectsRefresh)
    return () => {
      window.removeEventListener('projects-refresh', handleProjectsRefresh)
    }
  }, [])

  const activeBase = useMemo(
    () => projects.find((project) => project.id === activeBaseId) ?? null,
    [projects, activeBaseId],
  )

  const activeTable = useMemo(
    () => activeBase?.tables.find((table) => table.id === activeTableId) ?? null,
    [activeBase, activeTableId],
  )

  // 将 accessPoints 转换为 configuredAccessPoints 格式（用于 JSON editor）
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({ path: ap.path, permissions: ap.permissions }))
  }, [accessPoints])

  useEffect(() => {
    if (activeBase?.tables?.length && !activeTableId) {
      setActiveTableId(activeBase.tables[0].id)
    }
    setCurrentTreePath(null)
  }, [activeBaseId, activeBase?.tables])

  useEffect(() => {
    setCurrentTreePath(null)
  }, [activeTableId])

  const pathSegments = useMemo(() => {
    const segments = ['Projects']
    if (activeBase) segments.push(activeBase.name)
    if (activeTable) segments.push(activeTable.name)
    return segments
  }, [activeBase, activeTable])

  const showOnboarding = (!slug || slug.length === 0)
  const showEmptyState = (!slug || slug.length === 0) && projects.length === 0

  const handleStartOnboarding = async () => {
    setIsOnboardingLoading(true)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    if (projects.length > 0) {
      const firstProject = projects[0]
      const tableId = firstProject.tables?.[0]?.id
      if (tableId) {
         router.push(`/projects/${firstProject.id}/${tableId}`)
      } else {
         router.push(`/projects/${firstProject.id}`)
      }
    } else {
      router.push('/settings/connect')
    }
  }

  const userInitial =
    (session?.user?.email?.[0] || session?.user?.user_metadata?.name?.[0] || 'U').toUpperCase()

  if (showOnboarding) {
    return (
      <OnboardingView 
        userName={session?.user?.user_metadata?.name || session?.user?.email?.split('@')[0] || userInitial} 
        onStart={handleStartOnboarding} 
        isLoading={isOnboardingLoading} 
      />
    )
  }

  // 保存 Tools（不创建 MCP Server）
  const handleSaveTools = async (customDefinitions: Record<string, McpToolDefinition>) => {
    if (!activeBase || !activeTable || !session?.user?.id) return
    if (accessPoints.length === 0) return

    setIsSaving(true)
    setSaveError(null)
    setSavedResult(null)

    try {
      const toolsToCreate: Array<{
        path: string
        type: McpToolType
        customDef?: McpToolDefinition
      }> = []

      accessPoints.forEach(ap => {
        const toolTypes = permissionsToRegisterTools(ap.permissions)
        toolTypes.forEach(type => {
          toolsToCreate.push({
            path: ap.path,
            type,
            customDef: customDefinitions[type],
          })
        })
      })

      if (toolsToCreate.length === 0) {
        throw new Error('No tools to create')
      }

      const createdTools: Tool[] = await Promise.all(
        toolsToCreate.map(({ path, type, customDef }) => {
          const pathSuffix = path ? path.replace(/\//g, '_').replace(/^_/, '') : 'root'
          const defaultName = `${activeTable.name}_${pathSuffix}_${type}`
          
          return createTool({
            table_id: parseInt(activeTable.id),
            json_path: path,
            type: type,
            name: customDef?.name || defaultName,
            description: customDef?.description || TOOL_INFO[type].description,
          })
        })
      )

      setSavedResult({
        tools: createdTools,
        count: createdTools.length,
      })
      
      if (activeTableId) {
        refreshTableTools(activeTableId)
      }
    } catch (error) {
      console.error('Failed to save tools:', error)
      setSaveError(error instanceof Error ? error.message : 'Failed to save tools')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
    <style>{`
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <ProjectsHeader
            pathSegments={pathSegments}
            projectId={activeBase?.id ?? null}
            onProjectsRefresh={() => refreshProjects()}
            editorType={editorType}
            onEditorTypeChange={setEditorType}
            isAgentPanelOpen={isAgentPanelOpen}
            onAgentPanelOpenChange={setIsAgentPanelOpen}
            accessPointCount={accessPoints.length}
            isChatOpen={isChatOpen}
            onChatOpenChange={setIsChatOpen}
        />
        <div style={{ flex: 1, display: 'flex', minHeight: 0, background: '#050607' }}>
            {/* Main Editor Area - 全屏编辑时隐藏 */}
            {!(isEditorFullScreen && rightPanelContent === 'EDITOR') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeBase ? (
                <ProjectWorkspaceView
                key={activeBase.id}
                projectId={activeBase.id}
                project={activeBase}
                isProjectsLoading={loading}
                activeTableId={activeTableId}
                onActiveTableChange={setActiveTableId}
                onTreePathChange={setCurrentTreePath}
                showHeaderBar={false}
                showBackButton={false}
                editorType={editorType}
                // 已配置的 Access Points - 合并本地配置 + 后端 tools
                configuredAccessPoints={configuredAccessPoints}
                // 统一交互模型：右侧 Gutter 配置
                onAccessPointChange={(path, permissions) => {
                    const hasAnyPermission = Object.values(permissions).some(Boolean)
                    
                    // 🎯 只要 Sidebar 是收起的，配置新工具时就展开
                    if (hasAnyPermission && !isAgentPanelOpen) {
                    setIsAgentPanelOpen(true)
                    }
                    
                    // 如果该 path 已存在，更新权限；否则添加新的
                    setAccessPoints(prev => {
                    const existing = prev.find(ap => ap.path === path)
                    
                    if (existing) {
                        // 如果没有任何权限了，则移除
                        if (!hasAnyPermission) {
                        return prev.filter(ap => ap.path !== path)
                        }
                        return prev.map(ap => 
                        ap.path === path 
                            ? { ...ap, permissions }
                            : ap
                        )
                    } else if (hasAnyPermission) {
                        return [...prev, {
                        id: `ap-${Date.now()}`,
                        path,
                        permissions,
                        }]
                    }
                    return prev
                    })
                }}
                onAccessPointRemove={(path) => {
                    setAccessPoints(prev => prev.filter(ap => ap.path !== path))
                }}
                // 打开长文本文档编辑器
                onOpenDocument={(path, value) => {
                    setEditorTarget({ path, value })
                    setRightPanelContent('EDITOR')
                }}
                />
            ) : loading ? (
                /* Projects 正在加载 -> 显示骨架屏 */
                <EditorSkeleton />
            ) : (
                <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6F7580',
                    fontSize: 13,
                    letterSpacing: 0.4,
                    gap: 16,
                }}
                >
                {showEmptyState ? (
                    <>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 15, color: '#9ca3af', marginBottom: 8 }}>No context yet</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                        Click <strong style={{ color: '#9ca3af' }}>+ Add context...</strong> in the left sidebar to create your first context
                        </div>
                    </div>
                    </>
                ) : (
                    <div>Select a context to inspect its tables.</div>
                )}
                </div>
            )}
            </div>
            )}

            {/* Right Auxiliary Panel - Tools / Document Editor */}
            <RightAuxiliaryPanel
            content={rightPanelContent}
            onClose={() => {
                setRightPanelContent('NONE')
                setIsEditorFullScreen(false)
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
                console.log('Save document:', path, newValue)
                setEditorTarget(null)
                setRightPanelContent('NONE')
                setIsEditorFullScreen(false)
            }}
            isEditorFullScreen={isEditorFullScreen}
            onToggleEditorFullScreen={() => setIsEditorFullScreen(!isEditorFullScreen)}
            />
        </div>

      {/* Chat Sidebar */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
      />
    </div>
    </>
  )
}
