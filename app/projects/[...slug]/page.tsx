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
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual')

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
              detailPanelOpen={detailPanelOpen}
              onToggleDetailPanel={() => setDetailPanelOpen(!detailPanelOpen)}
              editorType={editorType}
              onEditorTypeChange={setEditorType}
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
              
              {detailPanelOpen && (
                <aside style={{
                  width: 240,
                  borderLeft: '1px solid #262626',
                  background: '#0a0a0a',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '16px',
                  gap: 16,
                  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#6D7177' }}>Details</div>
                  
                  {activeTable && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#5D6065' }}>Table</span>
                        <span style={{ fontSize: 13, color: '#CDCDCD' }}>{activeTable.name}</span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#5D6065' }}>Rows</span>
                        <span style={{ fontSize: 13, color: '#CDCDCD' }}>—</span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#5D6065' }}>Fields</span>
                        <span style={{ fontSize: 13, color: '#CDCDCD' }}>—</span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#5D6065' }}>Last Sync</span>
                        <span style={{ fontSize: 13, color: '#CDCDCD' }}>—</span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#5D6065' }}>Created</span>
                        <span style={{ fontSize: 13, color: '#CDCDCD' }}>—</span>
                      </div>
                    </div>
                  )}
                  
                  {!activeTable && (
                    <div style={{ fontSize: 12, color: '#5D6065' }}>
                      Select a table to view details
                    </div>
                  )}
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

