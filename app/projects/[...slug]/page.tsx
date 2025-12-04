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
  const [sidebarContent, setSidebarContent] = useState<'none' | 'chat' | 'publish'>('none')
  
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
      />

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#040404' }}>
        {activeView === 'projects' ? (
          <>
            <ProjectsHeader
              pathSegments={pathSegments}
              projectId={activeBase?.id ?? null}
              tableId={activeTableId || null}
              currentTreePath={currentTreePath}
              onProjectsRefresh={loadProjects}
              editorType={editorType}
              onEditorTypeChange={setEditorType}
              sidebarContent={sidebarContent}
              onSidebarContentChange={(content) => {
                setSidebarContent(content)
                // 打开 Publish 面板时自动进入选择模式
                setIsSelectingAccessPoint(content === 'publish')
              }}
            />
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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
                    onAddAccessPoint={(path) => {
                      // 设置待配置的路径，显示侧边栏配置表单
                      setPendingAccessPoint({
                        path,
                        permissions: { read: true, write: false },
                        capabilities: { get_all: true } // 默认开启 Get All
                      })
                      // 保持选择模式，用户配置完后可以继续选择其他节点
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
              
              {/* Right Sidebar */}
              {sidebarContent !== 'none' && (
                <aside style={{
                  width: 340,
                  borderLeft: '1px solid #262626',
                  background: '#0a0a0a',
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                }}>
                  {/* Content Area */}
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {sidebarContent === 'chat' && (
                      <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 24,
                        gap: 12,
                        height: '100%',
                      }}>
                        <span style={{ fontSize: 48, opacity: 0.3 }}>🐶</span>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af', marginBottom: 4 }}>
                            Chat with Context
                          </div>
                          <div style={{ fontSize: 12, color: '#525252', lineHeight: 1.5 }}>
                            Ask questions about your data
                          </div>
                        </div>
                      </div>
                    )}

                    {sidebarContent === 'publish' && (
                      <div style={{ 
                        padding: 14, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        height: '100%',
                        gap: 12,
                      }}>
                        {/* ========== 顶部：API Endpoint ========== */}
                        <div style={{
                          padding: '8px 10px',
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}>
                          <code style={{ 
                            flex: 1,
                            fontSize: 12, 
                            color: '#6b7280',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {activeBase?.id 
                              ? `/api/v1/projects/${activeBase.id}`
                              : 'No project selected'
                            }
                          </code>
                          <button
                            onClick={() => {
                              if (activeBase?.id) {
                                navigator.clipboard.writeText(
                                  `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/projects/${activeBase.id}`
                                )
                              }
                            }}
                            style={{
                              padding: '4px 8px',
                              background: 'rgba(255,255,255,0.05)',
                              border: 'none',
                              borderRadius: 4,
                              color: '#6b7280',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Copy
                          </button>
                        </div>

                        {/* ========== 配置区（选中节点后显示） ========== */}
                        {pendingAccessPoint && (
                          <div style={{
                            padding: 12,
                            background: '#111',
                            border: '1px solid #262626',
                            borderRadius: 8,
                          }}>
                            {/* Path Header */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 12,
                              paddingBottom: 10,
                              borderBottom: '1px solid #1f1f1f',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: '#34d399',
                                }} />
                                <code style={{ fontSize: 12, color: '#e2e8f0' }}>
                                  {pendingAccessPoint.path}
                                </code>
                              </div>
                              <button
                                onClick={() => setPendingAccessPoint(null)}
                                style={{
                                  padding: 2,
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#525252',
                                  cursor: 'pointer',
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="18" y1="6" x2="6" y2="18"/>
                                  <line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                              </button>
                            </div>

                            {/* READ Capabilities */}
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, color: '#525252', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Read
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {[
                                  { key: 'get_all', label: 'Get All' },
                                  { key: 'vector_retrieve', label: 'Vector' },
                                  { key: 'llm_retrieve', label: 'LLM' },
                                ].map(item => (
                                  <button
                                    key={item.key}
                                    onClick={() => setPendingAccessPoint(prev => prev ? {
                                      ...prev,
                                      capabilities: {
                                        ...prev.capabilities,
                                        [item.key]: !prev.capabilities?.[item.key]
                                      }
                                    } : null)}
                                    style={{
                                      padding: '5px 10px',
                                      fontSize: 12,
                                      background: pendingAccessPoint.capabilities?.[item.key] 
                                        ? 'rgba(52, 211, 153, 0.15)' 
                                        : 'transparent',
                                      border: '1px solid',
                                      borderColor: pendingAccessPoint.capabilities?.[item.key] 
                                        ? '#34d399' 
                                        : '#2a2a2a',
                                      borderRadius: 4,
                                      color: pendingAccessPoint.capabilities?.[item.key] 
                                        ? '#34d399' 
                                        : '#6b7280',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* WRITE Capabilities */}
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#525252', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Write
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {[
                                  { key: 'create', label: 'Create' },
                                  { key: 'update', label: 'Update' },
                                  { key: 'delete', label: 'Delete' },
                                ].map(item => (
                                  <button
                                    key={item.key}
                                    onClick={() => setPendingAccessPoint(prev => prev ? {
                                      ...prev,
                                      capabilities: {
                                        ...prev.capabilities,
                                        [item.key]: !prev.capabilities?.[item.key]
                                      }
                                    } : null)}
                                    style={{
                                      padding: '5px 10px',
                                      fontSize: 12,
                                      background: pendingAccessPoint.capabilities?.[item.key] 
                                        ? 'rgba(251, 191, 36, 0.15)' 
                                        : 'transparent',
                                      border: '1px solid',
                                      borderColor: pendingAccessPoint.capabilities?.[item.key] 
                                        ? '#fbbf24' 
                                        : '#2a2a2a',
                                      borderRadius: 4,
                                      color: pendingAccessPoint.capabilities?.[item.key] 
                                        ? '#fbbf24' 
                                        : '#6b7280',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Add Button */}
                            <button
                              onClick={() => {
                                const caps = pendingAccessPoint.capabilities || {}
                                const hasAny = caps.get_all || caps.vector_retrieve || caps.llm_retrieve || 
                                              caps.create || caps.update || caps.delete
                                if (hasAny) {
                                  setAccessPoints(prev => [...prev, {
                                    id: `ap-${Date.now()}`,
                                    path: pendingAccessPoint.path,
                                    permissions: {
                                      read: !!(caps.get_all || caps.vector_retrieve || caps.llm_retrieve),
                                      write: !!(caps.create || caps.update || caps.delete),
                                    },
                                    capabilities: caps,
                                  }])
                                  setPendingAccessPoint(null)
                                }
                              }}
                              style={{
                                width: '100%',
                                height: 34,
                                background: '#e2e8f0',
                                border: 'none',
                                borderRadius: 6,
                                color: '#0a0a0a',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Add Access Point
                            </button>
                          </div>
                        )}

                        {/* ========== 已配置列表 ========== */}
                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                          <div style={{ 
                            fontSize: 11, 
                            color: '#404040', 
                            marginBottom: 8,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>
                            Configured · {accessPoints.length}
                          </div>
                          
                          {accessPoints.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#333', padding: '8px 0' }}>
                              Select a node to add access
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {accessPoints.map((ap) => (
                                <div
                                  key={ap.id}
                                  style={{
                                    padding: '8px 10px',
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid #1f1f1f',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                  }}
                                >
                                  <code style={{ 
                                    flex: 1,
                                    fontSize: 12, 
                                    color: '#9ca3af',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {ap.path}
                                  </code>
                                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                    {ap.permissions.read && (
                                      <span style={{
                                        padding: '2px 5px',
                                        background: 'rgba(52, 211, 153, 0.12)',
                                        color: '#34d399',
                                        fontSize: 10,
                                        fontWeight: 500,
                                        borderRadius: 4,
                                      }}>R</span>
                                    )}
                                    {ap.permissions.write && (
                                      <span style={{
                                        padding: '2px 5px',
                                        background: 'rgba(251, 191, 36, 0.12)',
                                        color: '#fbbf24',
                                        fontSize: 10,
                                        fontWeight: 500,
                                        borderRadius: 4,
                                      }}>W</span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setAccessPoints(prev => prev.filter(p => p.id !== ap.id))}
                                    style={{
                                      padding: 4,
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#404040',
                                      cursor: 'pointer',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <line x1="18" y1="6" x2="6" y2="18"/>
                                      <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : activeView === 'mcp' ? (
          <McpContentView onBack={handleBackToProjects} />
        ) : activeView === 'etl' ? (
          <EtlContentView onBack={handleBackToProjects} />
        ) : null}
      </section>
    </main>
  )
}

