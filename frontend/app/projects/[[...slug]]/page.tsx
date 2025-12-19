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
import { ParsingContentView } from '../../../components/ParsingContentView'
import { ChatSidebar } from '../../../components/ChatSidebar'
import { 
  type McpToolPermissions, 
  type McpToolType,
} from '../../../lib/mcpApi'

type ActiveView = 'projects' | 'mcp' | 'etl' | 'connect' | 'parsing' | 'test' | 'logs' | 'settings'

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
  // 收起的 path 列表 (默认全部展开)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  
  // Tool 定义编辑状态
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
    if (viewId === 'parsing') {
      setActiveView('parsing')
      window.history.pushState({}, '', '/parsing')
    } else if (viewId === 'mcp') {
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
                        query_data: 'query_data',
                        get_all_data: 'get_all_data',
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
                  
                  {/* Content - 按 Path 聚合，带颜色编码 */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {accessPoints.length === 0 ? (
                      <div style={{ 
                        padding: '24px 12px',
                        textAlign: 'center',
                      }}>
                        <div style={{ 
                          width: 40, 
                          height: 40, 
                          margin: '0 auto 12px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: 10,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5">
                            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
                          </svg>
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>No tools configured</div>
                        <div style={{ fontSize: 10, color: '#3f3f46' }}>
                          Click the 🐾 icon on JSON nodes to expose capabilities
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {(() => {
                          // 颜色编码定义
                          const TOOL_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
                            query_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
                            get_all_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
                            preview: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
                            select: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
                            create: { accent: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399' },
                            update: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', text: '#fbbf24' },
                            delete: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', text: '#f87171' },
                          }

                          // Tool 定义 - 使用 Agent 语言
                          // Tool 图标定义 - 和菜单保持一致
                          const TOOL_ICONS: Record<string, React.ReactNode> = {
                            query_data: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/>
                                <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                              </svg>
                            ),
                            get_all_data: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <rect x="2" y="2" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                                <rect x="2" y="6" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                                <rect x="2" y="10" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                              </svg>
                            ),
                            preview: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                              </svg>
                            ),
                            select: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                                <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            ),
                            create: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                              </svg>
                            ),
                            update: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              </svg>
                            ),
                            delete: (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                              </svg>
                            ),
                          }
                          
                          const TOOL_DEFS = [
                            { backendId: 'query_data' as McpToolType, label: 'Query' },
                            { backendId: 'get_all_data' as McpToolType, label: 'Get All' },
                            { backendId: 'preview' as McpToolType, label: 'Preview' },
                            { backendId: 'select' as McpToolType, label: 'Select' },
                            { backendId: 'create' as McpToolType, label: 'Create' },
                            { backendId: 'update' as McpToolType, label: 'Update' },
                            { backendId: 'delete' as McpToolType, label: 'Delete' },
                          ]

                          // 按 Path 聚合渲染
                          return accessPoints.map((ap, apIndex) => {
                            const enabledTools = TOOL_DEFS.filter(tool => ap.permissions[tool.backendId])
                            if (enabledTools.length === 0) return null
                            
                            const pathSegments = ap.path ? ap.path.split('/').filter(Boolean) : []
                            const displayPath = ap.path || '/'
                            const lastSegment = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : 'root'
                            const safeName = lastSegment.replace(/[^a-zA-Z0-9_]/g, '')

                            const isCollapsed = collapsedPaths.has(ap.path)
                            const toggleCollapse = () => {
                              setCollapsedPaths(prev => {
                                const next = new Set(prev)
                                if (next.has(ap.path)) {
                                  next.delete(ap.path)
                                } else {
                                  next.add(ap.path)
                                }
                                return next
                              })
                            }

                            return (
                              <div key={ap.id} style={{ marginBottom: 12 }}>
                                {/* Path 标题 - 可点击展开/收起 */}
                                <div 
                                  onClick={toggleCollapse}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    marginBottom: isCollapsed ? 0 : 8,
                                    padding: '4px 2px',
                                    cursor: 'pointer',
                                    borderRadius: 4,
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                                >
                                  {/* 展开/收起箭头 */}
                                  <svg 
                                    width="10" 
                                    height="10" 
                                    viewBox="0 0 10 10" 
                                    fill="none" 
                                    style={{ 
                                      color: '#525252', 
                                      flexShrink: 0,
                                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                                      transition: 'transform 0.15s',
                                    }}
                                  >
                                    <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  <span style={{ 
                                    fontSize: 11, 
                                    color: '#71717a',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: 1,
                                  }} title={displayPath}>
                                    {displayPath}
                                  </span>
                                  <span style={{ fontSize: 10, color: '#3f3f46' }}>
                                    {enabledTools.length}
                                  </span>
                                </div>
                                
                                {/* Tools 卡片列表 - 可折叠 */}
                                {!isCollapsed && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {enabledTools.map((tool) => {
                                    const colors = TOOL_COLORS[tool.backendId] || TOOL_COLORS.query_data
                                    const editKey = `${ap.path}::${tool.backendId}`
                                    const defaultToolName = `${tool.backendId}_${safeName}`
                                    const defaultDescription = `${tool.label} - ${activeBase?.name || 'Project'}`
                                    
                                    const currentDef = toolsDefinitionEdits[editKey] || {
                                      name: defaultToolName,
                                      description: defaultDescription
                                    }
                                    
                                    const toolFieldId = `${ap.path}::${tool.backendId}`
                                    const isEditingName = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'name'
                                    const isEditingDesc = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'description'

                                    return (
                                      <div 
                                        key={tool.backendId}
                                        style={{
                                          background: 'rgba(255,255,255,0.02)',
                                          border: '1px solid rgba(255,255,255,0.06)',
                                          borderRadius: 8,
                                          overflow: 'hidden',
                                          display: 'flex',
                                          transition: 'all 0.15s',
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                                        }}
                                      >
                                        {/* 左侧颜色条 */}
                                        <div style={{
                                          width: 3,
                                          background: colors.accent,
                                          flexShrink: 0,
                                        }} />
                                        
                                        {/* 内容区 */}
                                        <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                          {/* 顶部: Tool 图标 + 类型标签 + 删除按钮 */}
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                              {/* Tool 图标 */}
                                              <span style={{ color: colors.text, display: 'flex', alignItems: 'center' }}>
                                                {TOOL_ICONS[tool.backendId]}
                                              </span>
                                              <span style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                color: colors.text,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.3px',
                                              }}>
                                                {tool.label}
                                              </span>
                                            </div>
                                            {/* 删除按钮 */}
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                // 更新该 path 的 permissions，关闭这个 tool
                                                setAccessPoints(prev => {
                                                  return prev.map(existingAp => {
                                                    if (existingAp.path === ap.path) {
                                                      const newPermissions = { ...existingAp.permissions, [tool.backendId]: false }
                                                      // 如果没有任何权限了，返回 null 让后面 filter 掉
                                                      const hasAny = Object.values(newPermissions).some(Boolean)
                                                      if (!hasAny) return null as any
                                                      return { ...existingAp, permissions: newPermissions }
                                                    }
                                                    return existingAp
                                                  }).filter(Boolean)
                                                })
                                                // 清理编辑状态
                                                setToolsDefinitionEdits(prev => {
                                                  const newEdits = { ...prev }
                                                  delete newEdits[editKey]
                                                  return newEdits
                                                })
                                              }}
                                              style={{
                                                background: 'transparent',
                                                border: 'none',
                                                padding: 4,
                                                cursor: 'pointer',
                                                color: '#525252',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: 4,
                                                transition: 'all 0.15s',
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                                                e.currentTarget.style.color = '#ef4444'
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'transparent'
                                                e.currentTarget.style.color = '#525252'
                                              }}
                                              title="Remove this tool"
                                            >
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 6L6 18M6 6l12 12"/>
                                              </svg>
                                            </button>
                                          </div>
                                          
                                          {/* TOOL NAME 字段 */}
                                          <div>
                                            <div style={{ fontSize: 9, color: '#525252', marginBottom: 4, fontWeight: 500, letterSpacing: '0.3px' }}>TOOL NAME</div>
                                            {isEditingName ? (
                                              <input
                                                type="text"
                                                value={currentDef.name}
                                                onChange={(e) => setToolsDefinitionEdits(prev => ({
                                                  ...prev,
                                                  [editKey]: { ...currentDef, name: e.target.value }
                                                }))}
                                                onBlur={() => setEditingToolField(null)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') setEditingToolField(null)
                                                  if (e.key === 'Escape') {
                                                    setToolsDefinitionEdits(prev => {
                                                      const newEdits = { ...prev }
                                                      delete newEdits[editKey]
                                                      return newEdits
                                                    })
                                                    setEditingToolField(null)
                                                  }
                                                }}
                                                autoFocus
                                                style={{
                                                  width: '100%',
                                                  fontSize: 12,
                                                  fontWeight: 500,
                                                  color: '#e2e8f0',
                                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                                  background: 'rgba(0,0,0,0.3)',
                                                  border: '1px solid rgba(255,255,255,0.15)',
                                                  borderRadius: 4,
                                                  padding: '6px 8px',
                                                  outline: 'none',
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                            ) : (
                                              <div 
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setEditingToolField({ toolId: toolFieldId, field: 'name' })
                                                }}
                                                style={{ 
                                                  fontSize: 12, 
                                                  fontWeight: 500, 
                                                  color: '#d4d4d8',
                                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                                  cursor: 'text',
                                                  padding: '6px 8px',
                                                  background: 'rgba(0,0,0,0.2)',
                                                  borderRadius: 4,
                                                  border: '1px solid transparent',
                                                  transition: 'border-color 0.15s',
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
                                                title={currentDef.name}
                                              >
                                                {currentDef.name}
                                              </div>
                                            )}
                                          </div>

                                          {/* TOOL DESCRIPTION 字段 */}
                                          <div>
                                            <div style={{ fontSize: 9, color: '#525252', marginBottom: 4, fontWeight: 500, letterSpacing: '0.3px' }}>TOOL DESCRIPTION</div>
                                            {isEditingDesc ? (
                                              <input
                                                type="text"
                                                value={currentDef.description}
                                                onChange={(e) => setToolsDefinitionEdits(prev => ({
                                                  ...prev,
                                                  [editKey]: { ...currentDef, description: e.target.value }
                                                }))}
                                                onBlur={() => setEditingToolField(null)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') setEditingToolField(null)
                                                  if (e.key === 'Escape') {
                                                    setToolsDefinitionEdits(prev => {
                                                      const newEdits = { ...prev }
                                                      delete newEdits[editKey]
                                                      return newEdits
                                                    })
                                                    setEditingToolField(null)
                                                  }
                                                }}
                                                autoFocus
                                                style={{
                                                  width: '100%',
                                                  fontSize: 11,
                                                  color: '#9ca3af',
                                                  background: 'rgba(0,0,0,0.3)',
                                                  border: '1px solid rgba(255,255,255,0.15)',
                                                  borderRadius: 4,
                                                  padding: '6px 8px',
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
                                                  fontSize: 11,
                                                  color: currentDef.description ? '#71717a' : '#3f3f46',
                                                  cursor: 'text',
                                                  padding: '6px 8px',
                                                  background: 'rgba(0,0,0,0.2)',
                                                  borderRadius: 4,
                                                  border: '1px solid transparent',
                                                  transition: 'border-color 0.15s',
                                                  lineHeight: 1.4,
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
                                                title={currentDef.description || 'Click to edit'}
                                              >
                                                {currentDef.description || 'Click to edit...'}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                  </div>
                  
                  {/* Footer - 低调的引导链接 */}
                  {accessPoints.length > 0 && (
                    <div style={{ 
                      borderTop: '1px solid rgba(255,255,255,0.04)', 
                      padding: '10px 12px',
                      flexShrink: 0,
                      display: 'flex',
                      justifyContent: 'center',
                    }}>
                      <span 
                        style={{ 
                          fontSize: 10, 
                          color: '#525252',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#71717a' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                        onClick={() => handleUtilityNavClick('mcp')}
                      >
                        Publish in MCP →
                      </span>
                    </div>
                  )}
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
        ) : activeView === 'parsing' ? (
          <ParsingContentView onBack={handleBackToProjects} />
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

