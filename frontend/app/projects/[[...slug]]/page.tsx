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
import { EtlContentView } from '../../../components/EtlContentView'
import { ConnectContentView } from '../../../components/ConnectContentView'
import { ChatSidebar } from '../../../components/ChatSidebar'
import { ImportMenu } from '../../../components/ImportMenu'
import { 
  type McpToolPermissions, 
  type McpToolType,
  createMcpInstance, 
  permissionsToRegisterTools,
  TOOL_INFO 
} from '../../../lib/mcpApi'

type ActiveView = 'projects' | 'mcp' | 'etl' | 'connect' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'etl', label: 'ETL Strategies', path: 'etl', isAvailable: true },
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

// 已发布的 MCP 实例信息
interface PublishedMcpInstance {
  apiKey: string
  url: string
  publishedAt: Date
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
  
  // Agent Dashboard 抽屉状态
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)
  
  // Access Points 状态 - 用于存储已配置的 MCP 工具权限
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([])
  // 展开的 access point id
  const [expandedAccessPointId, setExpandedAccessPointId] = useState<string | null>(null)
  
  // 已发布的 MCP 实例
  const [publishedInstance, setPublishedInstance] = useState<PublishedMcpInstance | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [mcpInstanceName, setMcpInstanceName] = useState<string>('')
  const [toolsDefinitionEdits, setToolsDefinitionEdits] = useState<Record<string, { name: string; description: string }>>({})
  const [editingToolField, setEditingToolField] = useState<{ toolId: string; field: 'name' | 'description' } | null>(null)

  // 如果访问 /projects（slug 为空），重定向到第一个项目
  useEffect(() => {
    if (!slug || slug.length === 0) {
      if (projects.length > 0 && !loading) {
        router.replace(`/projects/${projects[0].id}`)
      }
    }
  }, [slug, projects, loading, router])

  // 如果正在加载或等待重定向，显示 loading
  if (!slug || slug.length === 0) {
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
    if (projects.length === 0) {
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          backgroundColor: '#040404',
          color: '#9ca3af',
          fontSize: 14,
        }}>
          <div>No projects found</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Create a project to get started</div>
        </div>
      )
    }
    // 等待重定向
    return null
  }

  // Extract projectId and tableId from slug
  const [projectId, tableId] = slug || []
  const [activeBaseId, setActiveBaseId] = useState<string>(projectId || '')
  const [activeTableId, setActiveTableId] = useState<string>(tableId || '')

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

  const userInitial =
    (session?.user?.email?.[0] || session?.user?.user_metadata?.name?.[0] || 'U').toUpperCase()

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
    } else if (viewId === 'etl') {
      setActiveView('etl')
      window.history.pushState({}, '', '/etl')
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

  const pathSegments = useMemo(() => {
    const segments = ['Context']
    if (activeBase) segments.push(activeBase.name)
    if (activeTable) segments.push(activeTable.name)
    return segments
  }, [activeBase, activeTable])

  // 发布 MCP 实例
  const handlePublishMcp = async () => {
    if (!activeBaseId || !activeTableId || accessPoints.length === 0 || !mcpInstanceName.trim()) return
    
    setIsPublishing(true)
    setPublishError(null)
    
    try {
      // 合并所有 access points 的权限，选择第一个有效的 json_pointer
      // 注意：后端目前只支持单个 json_pointer，如果有多个 access points 需要创建多个实例
      // 这里简化处理，只取第一个 access point
      const firstAp = accessPoints[0]
      const allTools = permissionsToRegisterTools(
        accessPoints.reduce((acc, ap) => {
          Object.entries(ap.permissions).forEach(([key, value]) => {
            if (value) acc[key as McpToolType] = true
          })
          return acc
        }, {} as McpToolPermissions)
      )
      
      // 构建工具定义 - 使用用户编辑的或默认值
      const tools_definition: Record<string, { name: string; description: string }> = {}
      allTools.forEach(toolType => {
        const edited = toolsDefinitionEdits[toolType]
        tools_definition[toolType] = edited || {
          name: `${toolType}_${activeTableId}`,
          description: `${TOOL_INFO[toolType as keyof typeof TOOL_INFO]?.label || toolType} - ${activeBase?.name || 'Project'}`
        }
      })

      const response = await createMcpInstance({
        user_id: session?.user?.id || '', // 从 session 获取用户 UUID
        project_id: Number(activeBaseId),
        table_id: Number(activeTableId),
        name: mcpInstanceName.trim(),
        json_pointer: firstAp.path || '',
        tools_definition,
        register_tools: allTools,
      })
      
      setPublishedInstance({
        apiKey: response.api_key,
        url: response.url,
        publishedAt: new Date(),
      })
      
      // 重置表单
      setMcpInstanceName('')
      setToolsDefinitionEdits({})
    } catch (error: any) {
      console.error('Failed to publish MCP instance:', error)
      setPublishError(error.message || 'Failed to publish MCP instance')
    } finally {
      setIsPublishing(false)
    }
  }
  
  // 复制到剪贴板
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
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
              {/* Main Editor Area */}
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
                      // 如果该 path 已存在，更新权限；否则添加新的
                      setAccessPoints(prev => {
                        const existing = prev.find(ap => ap.path === path)
                        const hasAnyPermission = Object.values(permissions).some(Boolean)
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
                  />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'grid',
                      placeItems: 'center',
                      color: '#6F7580',
                      fontSize: 13,
                      letterSpacing: 0.4,
                    }}
                  >
                    Select a base to inspect its tables.
                  </div>
                )}
              </div>

              {/* Agent Sidebar - Right side of Editor */}
              {isAgentPanelOpen && (
                <div style={{
                  width: 268, // 260 + 8 左侧间距补偿
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                  padding: 8, // 四周都有 8px 间距，呈现卡片感
                }}>
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#1a1a1e',
                    borderRadius: 8,
                    border: '1px solid #333',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    overflow: 'hidden',
                  }}>
                    {/* Header - 更低调的样式 */}
                    <div style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #2a2a2e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexShrink: 0,
                    }}>
                    <svg width="12" height="10" viewBox="0 0 33 26" fill="none" style={{ color: '#6b7280' }}>
                      <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.0321" transform="rotate(14 27.9463 11.0849)" fill="currentColor"/>
                      <ellipse cx="11.5129" cy="4.75922" rx="3.45608" ry="4.3201" transform="rotate(-8 11.5129 4.75922)" fill="currentColor"/>
                      <ellipse cx="20.7294" cy="4.7593" rx="3.45608" ry="4.3201" transform="rotate(8 20.7294 4.7593)" fill="currentColor"/>
                      <ellipse cx="4.32887" cy="11.0848" rx="3.45608" ry="4.0321" transform="rotate(-14 4.32887 11.0848)" fill="currentColor"/>
                      <path d="M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z" fill="currentColor"/>
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>Agent Tools</span>
                    {(() => {
                      // 使用简化的UI工具类型映射到实际的后端类型
                      const uiToolMapping = {
                        query: 'query_data',
                        preview: 'preview',
                        select: 'select',
                        create: 'create',
                        update: 'update',
                        delete: 'delete'
                      } as const

                      const toolIds = Object.keys(uiToolMapping) as Array<keyof typeof uiToolMapping>
                      const count = toolIds.filter(id => {
                        const backendType = uiToolMapping[id] as McpToolType
                        return accessPoints.some(ap => ap.permissions[backendType])
                      }).length

                      return count > 0 && (
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: 10,
                          color: '#525252',
                        }}>{count} active</span>
                      )
                    })()}
                  </div>
                  
                  {/* Content */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                    {accessPoints.length === 0 ? (
                      <div style={{ 
                        padding: '16px 8px',
                        textAlign: 'center',
                        color: '#525252',
                        fontSize: 11,
                      }}>
                        <div style={{ marginBottom: 4 }}>No tools configured</div>
                        <div style={{ fontSize: 10, color: '#3f3f46' }}>
                          Click 🐾 on JSON elements
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(() => {
                          // UI工具定义映射到后端类型
                          const TOOL_DEFS = [
                            {
                              uiId: 'query' as const,
                              backendId: 'query_data' as McpToolType,
                              label: 'Query',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/><path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                            },
                            {
                              uiId: 'preview' as const,
                              backendId: 'preview' as McpToolType,
                              label: 'Preview',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
                            },
                            {
                              uiId: 'select' as const,
                              backendId: 'select' as McpToolType,
                              label: 'Select',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            },
                            {
                              uiId: 'create' as const,
                              backendId: 'create' as McpToolType,
                              label: 'Create',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                            },
                            {
                              uiId: 'update' as const,
                              backendId: 'update' as McpToolType,
                              label: 'Update',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                            },
                            {
                              uiId: 'delete' as const,
                              backendId: 'delete' as McpToolType,
                              label: 'Delete',
                              icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                            },
                          ]

                          return TOOL_DEFS.map(tool => {
                            const paths = accessPoints.filter(ap => ap.permissions[tool.backendId])
                            if (paths.length === 0) return null
                            
                            return (
                              <div key={tool.uiId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {/* Section Title - 小字 */}
                                <div style={{
                                  fontSize: 10,
                                  color: '#525252',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  paddingLeft: 2,
                                  fontWeight: 600,
                                }}>{tool.label}</div>
                                
                                {/* Tool Elements List */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {paths.map((ap, index) => {
                                    // 模拟 Tool Name 生成
                                    const pathSegments = ap.path ? ap.path.split('/').filter(Boolean) : []
                                    const lastSegment = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : 'root'
                                    // 简单的命名规则：tool_lastSegment (e.g. query_users)
                                    // 移除非字母数字字符
                                    const safeName = lastSegment.replace(/[^a-zA-Z0-9_]/g, '')
                                    const defaultToolName = `${tool.backendId}_${safeName}`
                                    const defaultDescription = `${TOOL_INFO[tool.backendId as keyof typeof TOOL_INFO]?.label || tool.backendId} - ${activeBase?.name || 'Project'}`
                                    
                                    const currentDef = toolsDefinitionEdits[tool.backendId] || {
                                      name: defaultToolName,
                                      description: defaultDescription
                                    }
                                    
                                    const toolFieldId = `${tool.backendId}-${ap.path}-${index}`
                                    const isEditingName = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'name'
                                    const isEditingDesc = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'description'

                                    return (
                                      <div 
                                        key={`${ap.path}-${index}`}
                                        style={{
                                          background: 'rgba(255,255,255,0.03)',
                                          border: '1px solid rgba(255,255,255,0.05)',
                                          borderRadius: 8,
                                          padding: '10px',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                          transition: 'all 0.1s',
                                          position: 'relative',
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'
                                        }}
                                      >
                                        {/* Header: Logo + Tool Name (可编辑) */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <span style={{ color: '#9ca3af', display: 'flex', flexShrink: 0 }}>
                                            {tool.icon}
                                          </span>
                                          {isEditingName ? (
                                            <input
                                              type="text"
                                              value={currentDef.name}
                                              onChange={(e) => setToolsDefinitionEdits(prev => ({
                                                ...prev,
                                                [tool.backendId]: { ...currentDef, name: e.target.value }
                                              }))}
                                              onBlur={() => setEditingToolField(null)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') setEditingToolField(null)
                                                if (e.key === 'Escape') {
                                                  setToolsDefinitionEdits(prev => {
                                                    const newEdits = { ...prev }
                                                    delete newEdits[tool.backendId]
                                                    return newEdits
                                                  })
                                                  setEditingToolField(null)
                                                }
                                              }}
                                              autoFocus
                                              style={{
                                                flex: 1,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: '#e2e8f0',
                                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                                background: 'rgba(0,0,0,0.3)',
                                                border: '1px solid rgba(255,255,255,0.1)',
                                                borderRadius: 4,
                                                padding: '4px 6px',
                                                outline: 'none',
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                          ) : (
                                            <span 
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setEditingToolField({ toolId: toolFieldId, field: 'name' })
                                              }}
                                              style={{ 
                                                flex: 1,
                                                fontSize: 12, 
                                                fontWeight: 600, 
                                                color: '#e2e8f0',
                                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                                cursor: 'text',
                                                padding: '4px 6px',
                                                borderRadius: 4,
                                                transition: 'background 0.1s',
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'transparent'
                                              }}
                                            >
                                              {currentDef.name}
                                            </span>
                                          )}
                                        </div>

                                        {/* Description (可编辑) */}
                                        {isEditingDesc ? (
                                          <input
                                            type="text"
                                            value={currentDef.description}
                                            onChange={(e) => setToolsDefinitionEdits(prev => ({
                                              ...prev,
                                              [tool.backendId]: { ...currentDef, description: e.target.value }
                                            }))}
                                            onBlur={() => setEditingToolField(null)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') setEditingToolField(null)
                                              if (e.key === 'Escape') {
                                                setToolsDefinitionEdits(prev => {
                                                  const newEdits = { ...prev }
                                                  delete newEdits[tool.backendId]
                                                  return newEdits
                                                })
                                                setEditingToolField(null)
                                              }
                                            }}
                                            autoFocus
                                            style={{
                                              width: '100%',
                                              fontSize: 10,
                                              color: '#9ca3af',
                                              lineHeight: 1.4,
                                              background: 'rgba(0,0,0,0.3)',
                                              border: '1px solid rgba(255,255,255,0.1)',
                                              borderRadius: 4,
                                              padding: '4px 6px',
                                              outline: 'none',
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        ) : (
                                          <div 
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setEditingToolField({ toolId: toolFieldId, field: 'description' })
                                            }}
                                            style={{
                                              fontSize: 10,
                                              color: currentDef.description ? '#9ca3af' : '#525252',
                                              lineHeight: 1.4,
                                              cursor: 'text',
                                              padding: '4px 6px',
                                              borderRadius: 4,
                                              transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.background = 'transparent'
                                            }}
                                          >
                                            {currentDef.description || 'Click to add description'}
                                          </div>
                                        )}
                                        
                                        {/* Path (Muted) */}
                                        <div style={{ 
                                          fontSize: 10, 
                                          color: '#525252',
                                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 4,
                                        }}>
                                          <span style={{ opacity: 0.7 }}>Target:</span>
                                          <span style={{ color: '#6b7280' }}>{ap.path || '/'}</span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                  </div>
                  
                  {/* Footer - Publish Button and Published Instance */}
                  <div style={{ 
                    borderTop: '1px solid #333', 
                    padding: 8,
                    flexShrink: 0,
                  }}>
                    {publishedInstance ? (
                      // 已发布状态
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 6,
                          padding: '6px 8px',
                          background: 'rgba(52, 211, 153, 0.1)',
                          borderRadius: 4,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2">
                            <path d="M20 6L9 17l-5-5"/>
                          </svg>
                          <span style={{ fontSize: 10, color: '#34d399', fontWeight: 500 }}>MCP Published</span>
                          <button
                            onClick={() => setPublishedInstance(null)}
                            style={{
                              marginLeft: 'auto',
                              background: 'transparent',
                              border: 'none',
                              color: '#6b7280',
                              fontSize: 10,
                              cursor: 'pointer',
                              padding: '2px 6px',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        
                        {/* API Key */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>API Key</div>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: 4,
                            padding: '6px 8px',
                          }}>
                            <code style={{ 
                              flex: 1, 
                              fontSize: 9, 
                              color: '#9ca3af',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontFamily: 'ui-monospace, monospace',
                            }}>
                              {publishedInstance.apiKey.slice(0, 32)}...
                            </code>
                            <button
                              onClick={() => copyToClipboard(publishedInstance.apiKey)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#6b7280',
                                cursor: 'pointer',
                                padding: 4,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                              title="Copy API Key"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"/>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                        
                        {/* URL */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>URL</div>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: 4,
                            padding: '6px 8px',
                          }}>
                            <code style={{ 
                              flex: 1, 
                              fontSize: 9, 
                              color: '#9ca3af',
                              fontFamily: 'ui-monospace, monospace',
                            }}>
                              {publishedInstance.url}
                            </code>
                            <button
                              onClick={() => copyToClipboard(publishedInstance.url)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#6b7280',
                                cursor: 'pointer',
                                padding: 4,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                              title="Copy URL"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"/>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // 未发布状态
                      <>
                        {/* Name 输入框 */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>
                            Instance Name *
                          </label>
                          <input
                            type="text"
                            value={mcpInstanceName}
                            onChange={(e) => setMcpInstanceName(e.target.value)}
                            placeholder="e.g., My Knowledge Base"
                            style={{
                              width: '100%',
                              height: 28,
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: 4,
                              padding: '0 8px',
                              fontSize: 11,
                              color: '#fff',
                              outline: 'none',
                            }}
                          />
                        </div>

                        {publishError && (
                          <div style={{
                            padding: '6px 8px',
                            marginBottom: 8,
                            background: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: 4,
                            fontSize: 10,
                            color: '#ef4444',
                          }}>
                            {publishError}
                          </div>
                        )}
                        <button
                          onClick={handlePublishMcp}
                          disabled={accessPoints.length === 0 || isPublishing || !mcpInstanceName.trim()}
                          style={{
                            width: '100%',
                            height: 32,
                            background: (accessPoints.length === 0 || !mcpInstanceName.trim()) ? 'rgba(255,167,61,0.2)' : '#FFA73D',
                            border: 'none',
                            borderRadius: 6,
                            color: (accessPoints.length === 0 || !mcpInstanceName.trim()) ? '#9ca3af' : '#000',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: (accessPoints.length === 0 || !mcpInstanceName.trim()) ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            transition: 'all 0.15s',
                            opacity: isPublishing ? 0.7 : 1,
                          }}
                        >
                          {isPublishing ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                                <path d="M12 2a10 10 0 0110 10" strokeLinecap="round"/>
                              </svg>
                              Publishing...
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 19V5M5 12l7-7 7 7"/>
                              </svg>
                              Publish MCP
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeView === 'mcp' ? (
          <McpContentView onBack={handleBackToProjects} />
        ) : activeView === 'etl' ? (
          <EtlContentView onBack={handleBackToProjects} />
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
  )
}

