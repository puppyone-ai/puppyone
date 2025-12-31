'use client'

import { useEffect, useMemo, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../supabase/SupabaseAuthProvider'
import { type ProjectInfo } from '../../../lib/projectsApi'
import { useProjects, refreshProjects, useTableTools, refreshTableTools } from '../../../lib/hooks/useData'
import { ProjectWorkspaceView } from '../../../components/ProjectWorkspaceView'
import { ProjectsSidebar } from '../../../components/ProjectsSidebar'
import { ProjectsHeader, type EditorType } from '../../../components/ProjectsHeader'
import { ToolsManager } from '../../tools/components/ToolsManager'
import { ConnectContentView } from '../../../components/ConnectContentView'
import { ChatSidebar } from '../../../components/ChatSidebar'
import { OnboardingView } from '../../../components/OnboardingView'
import { 
  type McpToolPermissions, 
  type McpToolType,
  type McpToolDefinition,
  type Tool,
  createTool,
  permissionsToRegisterTools,
  TOOL_INFO,
} from '../../../lib/mcpApi'
import { 
  RightAuxiliaryPanel, 
  type RightPanelContent, 
  type EditorTarget,
  type AccessPoint,
  type SaveToolsResult,
} from '../../../components/RightAuxiliaryPanel'
import { EditorSkeleton } from '../../../components/Skeleton'

type ActiveView = 'projects' | 'tools' | 'mcp' | 'connect' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'test', label: 'Test', path: 'test', isAvailable: false },
  { id: 'logs', label: 'Logs', path: 'logs', isAvailable: false },
  { id: 'settings', label: 'Settings', path: 'settings', isAvailable: false },
]

export default function ProjectsSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  // Unwrap params Promise with React.use()
  const { slug } = use(params)
  
  const router = useRouter()
  const { session } = useAuth()
  
  // 使用 SWR 获取项目列表（自动缓存、去重）
  const { projects, isLoading: loading } = useProjects()
  
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(new Set())
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('projects')
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual')
  
  // Global State (App Shell Level)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isNavCollapsed, setIsNavCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
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

  // Extract projectId and tableId from slug (must be before any conditional returns)
  const [projectId, tableId] = slug || []
  const [activeBaseId, setActiveBaseId] = useState<string>(projectId || '')
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '')
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false)
  
  // 获取当前 table 的 Tools（用于 sidebar 显示）
  const { tools: tableTools, allTools, isLoading: toolsLoading, refresh: refreshTools } = useTableTools(activeTableId || tableId)
  
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
      setExpandedBaseIds(prev => new Set([...prev, projectId]))
    }
    if (tableId) {
      setActiveTableId(tableId)
    }
  }, [projectId, tableId])

  // 如果访问 /projects（slug 为空），重定向到第一个项目
  useEffect(() => {
    // Debug Mode: 在开发 Onboarding 期间，暂时禁用这个自动跳转
    // 这样我们才能在根路径 /projects 看到 Onboarding 页面
    /*
    if (!slug || slug.length === 0) {
      if (projects.length > 0 && !loading) {
        router.replace(`/projects/${projects[0].id}`)
      }
    }
    */
  }, [slug, projects, loading, router])

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

  // Listen for navigate to connect event (from ImportModal auth button)
  useEffect(() => {
    const handleNavigateToConnect = () => {
      setActiveView('connect')
    }
    window.addEventListener('navigateToConnect', handleNavigateToConnect)
    return () => {
      window.removeEventListener('navigateToConnect', handleNavigateToConnect)
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
  // accessPoints 已经从后端 tools 初始化，不需要再合并
  const configuredAccessPoints = useMemo(() => {
    return accessPoints.map(ap => ({ path: ap.path, permissions: ap.permissions }))
  }, [accessPoints])

  useEffect(() => {
    if (activeBase?.tables?.length && !activeTableId) {
      setActiveTableId(activeBase.tables[0].id)
    }
    if (activeBaseId) {
      setExpandedBaseIds(prev => new Set([...prev, activeBaseId]))
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

  // 不再显示全屏 loading，让页面框架先渲染，各区域显示各自的骨架屏

  // 判断是否需要显示空状态（没有 slug 且没有 projects）
  // Debug Mode: 暂时强制显示 Onboarding 以便测试动画效果
  // 只要没有 slug (在 /projects 根路径)，就显示 Onboarding，忽略是否已有 projects
  const showOnboarding = (!slug || slug.length === 0) // && projects.length === 0 && !loading

  // 恢复 showEmptyState 定义，防止后面引用报错
  // 虽然在这个测试模式下可能用不到，但为了编译通过必须保留
  const showEmptyState = (!slug || slug.length === 0) && projects.length === 0

  const handleStartOnboarding = async () => {
    setIsOnboardingLoading(true)
    
    // 短暂延迟，让用户感觉到系统在工作
    await new Promise(resolve => setTimeout(resolve, 500))

    // 跳转到目标页面
    // 注意：不要在这里 setIsOnboardingLoading(false)
    // 让 loading 状态持续到组件卸载（新页面出现时自然消失）
    
    if (projects.length > 0) {
      // 如果已有项目，直接跳过去
      const firstProject = projects[0]
      const tableId = firstProject.tables?.[0]?.id
      if (tableId) {
         router.push(`/projects/${firstProject.id}/${tableId}`)
      } else {
         router.push(`/projects/${firstProject.id}`)
      }
    } else {
      // 如果没有任何项目，跳到 Connect 页面
      router.push('/connect')
    }
    // 不要 setIsOnboardingLoading(false)，让 loading 一直显示到新页面出现
  }

  const userInitial =
    (session?.user?.email?.[0] || session?.user?.user_metadata?.name?.[0] || 'U').toUpperCase()
  const userMetadata = session?.user?.user_metadata as Record<string, any> | undefined
  const userAvatarUrl =
    userMetadata?.avatar_url ||
    userMetadata?.picture ||
    userMetadata?.avatarUrl ||
    null

  if (showOnboarding) {
    return (
      <OnboardingView 
        userName={session?.user?.user_metadata?.name || session?.user?.email?.split('@')[0] || userInitial} 
        onStart={handleStartOnboarding} 
        isLoading={isOnboardingLoading} 
      />
    )
  }

  // 点击 Project 只展开/收起，不跳转 URL
  const handleProjectSelect = (newProjectId: string) => {
    setExpandedBaseIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(newProjectId)) {
        newSet.delete(newProjectId)
      } else {
        newSet.add(newProjectId)
      }
      return newSet
    })
  }

  const handleTableSelect = (newProjectId: string, newTableId: string) => {
    setActiveBaseId(newProjectId)
    setActiveTableId(newTableId)
    const project = projects.find(p => p.id === newProjectId)
    const table = project?.tables.find(t => t.id === newTableId)
    if (project && table) {
      const url = `/projects/${encodeURIComponent(newProjectId)}/${encodeURIComponent(newTableId)}`
      window.history.pushState({}, '', url)
    }
  }

  const handleUtilityNavClick = (viewId: string) => {
    if (viewId === 'tools') {
      setActiveView('tools')
      window.history.pushState({}, '', '/tools')
    } else if (viewId === 'mcp') {
      setActiveView('mcp')
      window.history.pushState({}, '', '/mcp')
    } else if (viewId === 'connect') {
      setActiveView('connect')
      window.history.pushState({}, '', '/connect')
    }
  }

  const handleBackToProjects = () => {
    setActiveView('projects')
    if (activeBaseId && activeTableId) {
      window.history.pushState({}, '', `/projects/${encodeURIComponent(activeBaseId)}/${encodeURIComponent(activeTableId)}`)
    } else if (activeBaseId) {
      window.history.pushState({}, '', `/projects/${encodeURIComponent(activeBaseId)}`)
    } else {
      window.history.pushState({}, '', '/projects')
    }
  }

  // 保存 Tools（不创建 MCP Server）
  const handleSaveTools = async (customDefinitions: Record<string, McpToolDefinition>) => {
    if (!activeBase || !activeTable || !session?.user?.id) return
    if (accessPoints.length === 0) return

    setIsSaving(true)
    setSaveError(null)
    setSavedResult(null)

    try {
      // 收集所有需要创建的 Tool
      const toolsToCreate: Array<{
        path: string
        type: McpToolType
        customDef?: McpToolDefinition
      }> = []

      // 遍历所有 accessPoints，为每个路径的每个权限创建一个 Tool
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

      // 批量创建 Tool
      const createdTools: Tool[] = await Promise.all(
        toolsToCreate.map(({ path, type, customDef }) => {
          // 生成工具名称：tableName_path_type
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
      
      // 刷新 tools 列表
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

  // 注意：认证检查已移到 middleware.ts，这里无需 AuthGuard
  return (
    <>
    <style>{`
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
    <main
      style={{
        height: '100vh',
        maxHeight: '100vh',
        display: 'flex',
        overflow: 'hidden',
        backgroundColor: '#040404',
        color: '#EDEDED',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <ProjectsSidebar
        projects={projects}
        activeBaseId={activeBaseId}
        expandedBaseIds={expandedBaseIds}
        activeTableId={activeTableId}
        activeView={activeView}
        onBaseClick={(id) => {
          handleProjectSelect(id)
          setActiveView('projects')
        }}
        onTableClick={(pId, tId) => {
          handleTableSelect(pId, tId)
          setActiveView('projects')
        }}
        utilityNav={utilityNav}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl ?? undefined}
        loading={loading}
        isCollapsed={isNavCollapsed}
        onCollapsedChange={setIsNavCollapsed}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        toolsCount={allTools.length}
      />

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#040404' }}>
        {activeView === 'projects' ? (
          <>
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
                onViewAllMcp={() => handleUtilityNavClick('mcp')}
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
          </>
        ) : activeView === 'tools' ? (
          <ToolsManager 
            onBack={handleBackToProjects} 
            onNavigateToTable={(tableId: number) => {
              // 查找 table 所属的 project
              const project = projects.find(p => p.tables.some(t => t.id === String(tableId)))
              if (project) {
                setActiveBaseId(project.id)
                setActiveTableId(String(tableId))
                setActiveView('projects')
                window.history.pushState({}, '', `/projects/${project.id}/${tableId}`)
              }
            }}
          />
        ) : activeView === 'connect' ? (
          <ConnectContentView onBack={handleBackToProjects} />
        ) : null}
      </section>

      {/* Chat Sidebar (App Shell Level - same level as ProjectsSidebar) */}
      <ChatSidebar
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
      />
    </main>
    </>
  )
}

