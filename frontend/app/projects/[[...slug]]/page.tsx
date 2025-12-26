'use client'

import { useEffect, useMemo, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../supabase/SupabaseAuthProvider'
import { type ProjectInfo } from '../../../lib/projectsApi'
import { useProjects, refreshProjects } from '../../../lib/hooks/useData'
import { ProjectWorkspaceView } from '../../../components/ProjectWorkspaceView'
import { ProjectsSidebar } from '../../../components/ProjectsSidebar'
import { ProjectsHeader, type EditorType } from '../../../components/ProjectsHeader'
import { McpContentView } from '../../../components/McpContentView'
import { ConnectContentView } from '../../../components/ConnectContentView'
import { ChatSidebar } from '../../../components/ChatSidebar'
import { AuthGuard } from '../../../components/AuthGuard'
import { OnboardingView } from '../../../components/OnboardingView'
import { 
  type McpToolPermissions, 
  type McpToolType,
  type McpToolDefinition,
  createMcpInstance,
  permissionsToRegisterTools,
} from '../../../lib/mcpApi'
import { 
  RightAuxiliaryPanel, 
  type RightPanelContent, 
  type EditorTarget 
} from '../../../components/RightAuxiliaryPanel'

type ActiveView = 'projects' | 'mcp' | 'connect' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'test', label: 'Test', path: 'test', isAvailable: false },
  { id: 'logs', label: 'Logs', path: 'logs', isAvailable: false },
  { id: 'settings', label: 'Settings', path: 'settings', isAvailable: false },
]

// Access Point 类型定义
interface AccessPoint {
  id: string
  path: string
  permissions: McpToolPermissions
}

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
  // Tool 定义编辑状态 - 用于发布 MCP 时自定义工具名称
  const [toolsDefinitionEdits, setToolsDefinitionEdits] = useState<Record<string, { name: string; description: string }>>({})
  
  // MCP 发布状态
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishedResult, setPublishedResult] = useState<{ api_key: string; url: string } | null>(null)

  // Extract projectId and tableId from slug (must be before any conditional returns)
  const [projectId, tableId] = slug || []
  const [activeBaseId, setActiveBaseId] = useState<string>(projectId || '')
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '')
  const [isOnboardingLoading, setIsOnboardingLoading] = useState(false)

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

  // 如果正在加载，显示 loading
  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#040404',
        color: '#9ca3af',
        fontSize: 14,
      }}>
        Loading projects...
      </div>
    )
  }

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

  const handleProjectSelect = (newProjectId: string) => {
    setActiveBaseId(newProjectId)
    setExpandedBaseIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(newProjectId)) {
        newSet.delete(newProjectId)
      } else {
        newSet.add(newProjectId)
      }
      return newSet
    })
    const project = projects.find(p => p.id === newProjectId)
    if (project) {
      const url = `/projects/${encodeURIComponent(newProjectId)}`
      window.history.pushState({}, '', url)
    }
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
    if (viewId === 'mcp') {
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

  // 发布 MCP Server
  const handlePublishMcp = async () => {
    if (!activeBase || !activeTable || !session?.user?.id) return
    if (accessPoints.length === 0) return

    setIsPublishing(true)
    setPublishError(null)
    setPublishedResult(null)

    try {
      // 合并所有 path 的权限
      const mergedPermissions: McpToolPermissions = {}
      accessPoints.forEach(ap => {
        Object.entries(ap.permissions).forEach(([key, value]) => {
          if (value) {
            mergedPermissions[key as keyof McpToolPermissions] = true
          }
        })
      })

      // 构建 tools_definition
      const toolsDefinition: Record<string, McpToolDefinition> = {}
      const registerTools = permissionsToRegisterTools(mergedPermissions)
      
      registerTools.forEach(toolType => {
        // 查找用户自定义的名称和描述
        const editKey = Object.keys(toolsDefinitionEdits).find(k => k.endsWith(`::${toolType}`))
        const customDef = editKey ? toolsDefinitionEdits[editKey] : null
        
        toolsDefinition[toolType] = {
          name: customDef?.name || `${toolType}_${activeTable.name}`,
          description: customDef?.description || `${toolType} for ${activeTable.name}`,
        }
      })

      // 生成默认名称
      const instanceName = `${activeBase.name} - ${activeTable.name}`

      const result = await createMcpInstance({
        user_id: session.user.id,
        project_id: parseInt(activeBase.id),
        table_id: parseInt(activeTable.id),
        name: instanceName,
        json_pointer: '',
        tools_definition: toolsDefinition,
        register_tools: registerTools,
      })

      setPublishedResult(result)
    } catch (error) {
      console.error('Failed to publish MCP:', error)
      setPublishError(error instanceof Error ? error.message : 'Failed to publish MCP server')
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <AuthGuard>
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
                    activeTableId={activeTableId}
                    onActiveTableChange={setActiveTableId}
                    onTreePathChange={setCurrentTreePath}
                    showHeaderBar={false}
                    showBackButton={false}
                    editorType={editorType}
                    // 已配置的 Access Points，用于右侧 Gutter 显示徽章
                    configuredAccessPoints={accessPoints.map(ap => ({
                      path: ap.path,
                      permissions: ap.permissions
                    }))}
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
                onPublishMcp={handlePublishMcp}
                isPublishing={isPublishing}
                publishError={publishError}
                publishedResult={publishedResult}
                setPublishedResult={setPublishedResult}
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
        ) : activeView === 'mcp' ? (
          <McpContentView onBack={handleBackToProjects} />
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
    </AuthGuard>
  )
}

