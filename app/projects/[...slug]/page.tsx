'use client'

import { useEffect, useMemo, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../supabase/SupabaseAuthProvider'
import { getProjects, type ProjectInfo } from '../../../lib/projectsApi'
import { ProjectWorkspaceView } from '../../../components/ProjectWorkspaceView'
import { ProjectsSidebar } from '../../../components/ProjectsSidebar'
import { ProjectsHeader, type EditorType } from '../../../components/ProjectsHeader'
import { McpContentView } from '../../../components/McpContentView'
import { EtlContentView } from '../../../components/EtlContentView'
import { ChatSidebar } from '../../../components/ChatSidebar'
import { ImportMenu } from '../../../components/ImportMenu'

type ActiveView = 'projects' | 'mcp' | 'etl' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'etl', label: 'ETL Strategies', path: 'etl', isAvailable: true },
  { id: 'test', label: 'Test', path: 'test', isAvailable: false },
  { id: 'logs', label: 'Logs', path: 'logs', isAvailable: false },
  { id: 'settings', label: 'Settings', path: 'settings', isAvailable: false },
]

export default function ProjectsSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  // Unwrap params Promise with React.use()
  const { slug } = use(params)
  
  const router = useRouter()
  const { session } = useAuth()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(new Set())
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('projects')
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual')
  
  // Global State (App Shell Level)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isNavCollapsed, setIsNavCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [chatWidth, setChatWidth] = useState(340)
  
  // Project State - Publish is project-specific
  const [isPublishOpen, setIsPublishOpen] = useState(false)
  
  // Publish Mode States
  const [isSelectingAccessPoint, setIsSelectingAccessPoint] = useState(false)
  const [accessPoints, setAccessPoints] = useState<Array<{
    id: string
    path: string
    permissions: { read: boolean; write: boolean }
    capabilities?: Record<string, boolean>
  }>>([])
  // Pending configuration - when user selects a node in tree
  const [pendingAccessPoint, setPendingAccessPoint] = useState<{
    path: string
    permissions: { read: boolean; write: boolean }
    capabilities?: Record<string, boolean>
  } | null>(null)
  // 展开的 access point id
  const [expandedAccessPointId, setExpandedAccessPointId] = useState<string | null>(null)

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

  // Load project list from API
  const loadProjects = async () => {
    try {
      setLoading(true)
      const data = await getProjects()
      setProjects(data)
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  // Listen for projects refresh event
  useEffect(() => {
    const handleProjectsRefresh = () => {
      loadProjects()
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
        onProjectsChange={setProjects}
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
              onProjectsRefresh={loadProjects}
              editorType={editorType}
              onEditorTypeChange={setEditorType}
              isPublishOpen={isPublishOpen}
              onPublishOpenChange={(open) => {
                setIsPublishOpen(open)
                // 不再自动进入选取模式，用户需要手动点击 "Select Node" 按钮
                if (!open) {
                  setIsSelectingAccessPoint(false)
                }
              }}
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
                    isSelectingAccessPoint={isSelectingAccessPoint}
                    selectedAccessPath={pendingAccessPoint?.path ?? null}
                    onAddAccessPoint={(path) => {
                      setPendingAccessPoint({
                        path,
                        permissions: { read: true, write: false },
                        capabilities: { get_all: true }
                      })
                    }}
                    onCancelSelection={() => {
                      setIsSelectingAccessPoint(false)
                      setPendingAccessPoint(null)
                    }}
                    // 当 Publish Panel 打开时，传入已配置的 Access Points 用于高亮显示
                    configuredAccessPoints={isPublishOpen ? accessPoints.map(ap => ({
                      path: ap.path,
                      permissions: ap.permissions
                    })) : []}
                    // Pending 配置 - 用于在节点旁边显示浮动配置面板
                    pendingConfig={pendingAccessPoint ? {
                      path: pendingAccessPoint.path,
                      permissions: pendingAccessPoint.permissions
                    } : null}
                    onPendingConfigChange={(config) => {
                      if (config) {
                        setPendingAccessPoint({
                          path: config.path,
                          permissions: config.permissions,
                          capabilities: { 
                            get_all: config.permissions.read, 
                            update: config.permissions.write 
                          }
                        })
                      } else {
                        setPendingAccessPoint(null)
                        setIsSelectingAccessPoint(false)
                      }
                    }}
                    onPendingConfigSave={() => {
                      if (pendingAccessPoint && (pendingAccessPoint.permissions.read || pendingAccessPoint.permissions.write)) {
                        setAccessPoints(prev => [...prev, {
                          id: `ap-${Date.now()}`,
                          path: pendingAccessPoint.path,
                          permissions: pendingAccessPoint.permissions,
                          capabilities: pendingAccessPoint.capabilities
                        }])
                        setPendingAccessPoint(null)
                        setIsSelectingAccessPoint(false)
                      }
                    }}
                    publishPanel={isPublishOpen ? (
                <div style={{
                  width: 260,
                  margin: 0,
                  borderRadius: 10,
                  background: 'rgba(12,12,14,0.75)',
                  border: '1px solid rgba(45,45,50,0.45)',
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                  overflow: 'hidden',
                  flexShrink: 0,
                  height: '100%',
                  // Selection Mode: 轻微"退后"，让用户视线转向 JSON Editor
                  opacity: isSelectingAccessPoint ? 0.6 : 1,
                  transition: 'opacity 0.3s ease',
                }}>
                  {/* Publish Panel Header - Now shows Context Title & Count */}
                  <div style={{
                    height: 36,
                    padding: '0 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid rgba(45,45,50,0.45)',
                    flexShrink: 0,
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ 
                          fontSize: 11, 
                          fontWeight: 600, 
                          color: '#e2e8f0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          Agent View
                        </span>
                        {accessPoints.length > 0 && (
                          <span style={{ 
                            background: 'rgba(255,255,255,0.1)', 
                            padding: '1px 5px', 
                            borderRadius: 3, 
                            color: '#9ca3af',
                            fontSize: 9,
                            fontWeight: 500,
                          }}>
                            {accessPoints.length}
                          </span>
                        )}
                      </div>
                      <span style={{ 
                        fontSize: 9, 
                        color: '#525252',
                        letterSpacing: '0.3px',
                      }}>
                        What agents can see
                      </span>
                    </div>
                  </div>
                  
                  {/* Publish Content */}
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    {/* ========== Section 1: Access Management (Primary Focus) ========== */}
                    <div style={{ 
                      flex: 1, 
                      padding: 12, 
                      display: 'flex', 
                      flexDirection: 'column',
                      overflowY: 'auto', // Enable scrolling for the whole section
                      minHeight: 0,
                    }}>
                      
                      {/* Rules List - Natural height */}
                      <div style={{ marginBottom: 12 }}>
                        {accessPoints.length === 0 && !pendingAccessPoint && !isSelectingAccessPoint ? (
                          <div style={{ 
                            padding: '20px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            gap: 8,
                          }}>
                            <div style={{ 
                              fontSize: 12, 
                              color: '#6b7280',
                            }}>
                              Agent can't see anything yet
                            </div>
                            <div style={{ 
                              fontSize: 11, 
                              color: '#525252',
                            }}>
                              Select data from the left to share
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {accessPoints.map((ap) => {
                              // 从 path 提取最后一级作为 title
                              const pathParts = ap.path.split('/').filter(Boolean)
                              const title = pathParts[pathParts.length - 1] || ap.path
                              const isExpanded = expandedAccessPointId === ap.id
                              
                              return (
                                <div key={ap.id} style={{
                                  background: 'rgba(255,255,255,0.02)',
                                  border: '1px solid',
                                  borderColor: isExpanded ? 'rgba(52, 211, 153, 0.3)' : 'rgba(45,45,50,0.3)',
                                  borderRadius: 5,
                                  overflow: 'hidden',
                                  transition: 'all 0.15s',
                                }}>
                                  {/* Header - 可点击展开/收起 */}
                                  <div 
                                    onClick={() => setExpandedAccessPointId(isExpanded ? null : ap.id)}
                                    style={{
                                      padding: '8px 10px',
                                      cursor: 'pointer',
                                      transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'transparent'
                                    }}
                                  >
                                    {/* 第一行：Title + 权限 + 展开箭头 */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                      <span style={{ 
                                        flex: 1, 
                                        fontSize: 12, 
                                        fontWeight: 500,
                                        color: '#e2e8f0', 
                                        overflow: 'hidden', 
                                        textOverflow: 'ellipsis', 
                                        whiteSpace: 'nowrap' 
                                      }}>
                                        {title}
                                      </span>
                                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                        {ap.permissions.read && <span style={{ padding: '2px 6px', background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', fontSize: 9, fontWeight: 600, borderRadius: 3 }}>R</span>}
                                        {ap.permissions.write && <span style={{ padding: '2px 6px', background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', fontSize: 9, fontWeight: 600, borderRadius: 3 }}>W</span>}
                                      </div>
                                      <svg 
                                        width="12" height="12" 
                                        viewBox="0 0 24 24" 
                                        fill="none" 
                                        stroke="#525252" 
                                        strokeWidth="2"
                                        style={{ 
                                          flexShrink: 0,
                                          transition: 'transform 0.15s',
                                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                        }}
                                      >
                                        <polyline points="6 9 12 15 18 9" />
                                      </svg>
                                    </div>
                                    {/* 第二行：Path 作为 description，弱化 */}
                                    <div style={{ 
                                      fontSize: 10, 
                                      color: '#525252', 
                                      overflow: 'hidden', 
                                      textOverflow: 'ellipsis', 
                                      whiteSpace: 'nowrap',
                                      fontFamily: 'monospace',
                                    }}>
                                      {ap.path}
                                    </div>
                                  </div>
                                  
                                  {/* 展开的内容 - Checkbox 样式 */}
                                  {isExpanded && (
                                    <div style={{
                                      borderTop: '1px solid rgba(45,45,50,0.3)',
                                    }}>
                                      {/* Checkbox 列表 */}
                                      <div style={{ padding: '6px 0' }}>
                                        {/* Read 选项 */}
                                        <label 
                                          style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: 10,
                                            padding: '6px 10px',
                                            cursor: 'pointer',
                                            transition: 'background 0.1s',
                                          }}
                                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div 
                                            onClick={() => {
                                              setAccessPoints(prev => prev.map(p => 
                                                p.id === ap.id 
                                                  ? { ...p, permissions: { ...p.permissions, read: !p.permissions.read } }
                                                  : p
                                              ))
                                            }}
                                            style={{
                                              width: 14,
                                              height: 14,
                                              borderRadius: 3,
                                              border: '1px solid',
                                              borderColor: ap.permissions.read ? '#34d399' : '#404040',
                                              background: ap.permissions.read ? '#34d399' : 'transparent',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              transition: 'all 0.15s',
                                              flexShrink: 0,
                                            }}
                                          >
                                            {ap.permissions.read && (
                                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                              </svg>
                                            )}
                                          </div>
                                          <span style={{ fontSize: 11, color: '#e2e8f0' }}>Read</span>
                                        </label>
                                        
                                        {/* Write 选项 */}
                                        <label 
                                          style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: 10,
                                            padding: '6px 10px',
                                            cursor: 'pointer',
                                            transition: 'background 0.1s',
                                          }}
                                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div 
                                            onClick={() => {
                                              setAccessPoints(prev => prev.map(p => 
                                                p.id === ap.id 
                                                  ? { ...p, permissions: { ...p.permissions, write: !p.permissions.write } }
                                                  : p
                                              ))
                                            }}
                                            style={{
                                              width: 14,
                                              height: 14,
                                              borderRadius: 3,
                                              border: '1px solid',
                                              borderColor: ap.permissions.write ? '#fbbf24' : '#404040',
                                              background: ap.permissions.write ? '#fbbf24' : 'transparent',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              transition: 'all 0.15s',
                                              flexShrink: 0,
                                            }}
                                          >
                                            {ap.permissions.write && (
                                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                              </svg>
                                            )}
                                          </div>
                                          <span style={{ fontSize: 11, color: '#e2e8f0' }}>Write</span>
                                        </label>
                                      </div>
                                      
                                      {/* 删除按钮 */}
                                      <div style={{ 
                                        padding: '8px 10px',
                                        borderTop: '1px solid rgba(45,45,50,0.3)',
                                      }}>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setAccessPoints(prev => prev.filter(p => p.id !== ap.id))
                                            setExpandedAccessPointId(null)
                                          }}
                                          style={{
                                            width: '100%',
                                            height: 28,
                                            fontSize: 11,
                                            fontWeight: 500,
                                            background: 'transparent',
                                            border: '1px solid rgba(239, 68, 68, 0.25)',
                                            borderRadius: 4,
                                            color: '#ef4444',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                            opacity: 0.8,
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
                                            e.currentTarget.style.opacity = '1'
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'transparent'
                                            e.currentTarget.style.opacity = '0.8'
                                          }}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Add Rule Button / Cancel Button */}
                      {!pendingAccessPoint && (
                        <button
                          onClick={() => {
                            if (isSelectingAccessPoint) {
                              // Cancel: 退出 Selection Mode
                              setIsSelectingAccessPoint(false)
                            } else {
                              // 进入 Selection Mode
                              setIsSelectingAccessPoint(true)
                            }
                          }}
                          style={{
                            width: '100%',
                            height: 34,
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            background: isSelectingAccessPoint ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                            border: isSelectingAccessPoint ? '1px solid rgba(239, 68, 68, 0.3)' : '1px dashed rgba(255,255,255,0.15)',
                            borderRadius: 6,
                            color: isSelectingAccessPoint ? '#ef4444' : '#6b7280',
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            if (isSelectingAccessPoint) {
                              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'
                            } else {
                              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'
                              e.currentTarget.style.color = '#9ca3af'
                              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (isSelectingAccessPoint) {
                              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'
                              e.currentTarget.style.color = '#ef4444'
                            } else {
                              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
                              e.currentTarget.style.color = '#6b7280'
                              e.currentTarget.style.background = 'transparent'
                            }
                          }}
                        >
                          {isSelectingAccessPoint ? (
                            <>
                              {/* X icon for cancel */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                              Cancel
                            </>
                          ) : (
                            <>
                              {/* Simple plus icon */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M12 5v14M5 12h14" />
                              </svg>
                              Select & Share
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    
                    {/* ========== Section 2: Connection Details (Bottom/Secondary) ========== */}
                    <div style={{ 
                      padding: 12, 
                      borderTop: '1px solid rgba(45,45,50,0.4)',
                      background: 'rgba(0,0,0,0.2)',
                      flexShrink: 0,
                    }}>
                      <div style={{ 
                        fontSize: 10, 
                        color: '#404040', 
                        marginBottom: 8,
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        fontWeight: 600,
                      }}>
                        Agent Connection
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* API */}
                        <div style={{ 
                          padding: '6px 8px',
                          background: 'rgba(255,255,255,0.01)',
                          borderRadius: 4,
                          border: '1px solid rgba(45,45,50,0.2)',
                          opacity: 0.7,
                          transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280' }}>HTTP API</span>
                            <button onClick={() => {
                              if (activeBase?.id) navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/projects/${activeBase.id}`);
                            }} style={{ fontSize: 9, color: '#34d399', background: 'none', border: 'none', cursor: 'pointer' }}>COPY</button>
                          </div>
                          <div style={{ fontSize: 9, color: '#404040', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/api/v1/projects/...</div>
                        </div>
                        
                        {/* MCP */}
                        <div style={{ 
                          padding: '6px 8px',
                          background: 'rgba(255,255,255,0.01)',
                          borderRadius: 4,
                          border: '1px solid rgba(45,45,50,0.2)',
                          opacity: 0.7,
                          transition: 'opacity 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280' }}>MCP</span>
                            <span style={{ fontSize: 9, color: '#60a5fa' }}>READY</span>
                          </div>
                          <div style={{ fontSize: 9, color: '#404040' }}>Standard Protocol</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                    ) : null}
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
            </div>
          </>
        ) : activeView === 'mcp' ? (
          <McpContentView onBack={handleBackToProjects} />
        ) : activeView === 'etl' ? (
          <EtlContentView onBack={handleBackToProjects} />
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

