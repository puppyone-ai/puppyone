'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../supabase/SupabaseAuthProvider'
import { type ProjectInfo } from '../../lib/projectsApi'
import { useProjects, refreshProjects } from '../../lib/hooks/useData'
import { ProjectWorkspaceView } from '../../components/ProjectWorkspaceView'
import { ProjectsSidebar } from '../../components/ProjectsSidebar'
import { ProjectsHeader, type EditorType } from '../../components/ProjectsHeader'
import { McpContentView } from '../../components/McpContentView'
import { EtlContentView } from '../../components/EtlContentView'

type ActiveView = 'projects' | 'mcp' | 'etl' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'etl', label: 'ETL Strategies', path: 'etl', isAvailable: true },
  { id: 'test', label: 'Test', path: 'test', isAvailable: false },
  { id: 'logs', label: 'Logs', path: 'logs', isAvailable: false },
  { id: 'settings', label: 'Settings', path: 'settings', isAvailable: false },
]

export default function ProjectsPage() {
  const router = useRouter()
  const { session } = useAuth()
  
  // 使用 SWR 获取项目列表（自动缓存、去重）
  const { projects, isLoading: loading } = useProjects()
  
  const [activeBaseId, setActiveBaseId] = useState<string>('')
  const [activeTableId, setActiveTableId] = useState<string>('')
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(new Set())
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('projects')
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [editorType, setEditorType] = useState<EditorType>('treeline-virtual')

  // 初始化默认选中的项目
  useEffect(() => {
    if (projects.length > 0 && !activeBaseId) {
      setActiveBaseId(projects[0].id)
      setExpandedBaseIds(new Set([projects[0].id]))
      if (projects[0].tables.length > 0) {
        setActiveTableId(projects[0].tables[0].id)
        }
      }
  }, [projects, activeBaseId])

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

  useEffect(() => {
    if (activeBase?.tables?.length) {
      setActiveTableId(activeBase.tables[0].id)
    } else {
      setActiveTableId('')
    }
    // Auto-expand active project
    if (activeBaseId) {
      setExpandedBaseIds(prev => new Set([...prev, activeBaseId]))
    }
    // Reset tree path when switching projects
    setCurrentTreePath(null)
  }, [activeBaseId, activeBase?.tables])

  // Reset tree path when switching tables
  useEffect(() => {
    setCurrentTreePath(null)
  }, [activeTableId])

  const userInitial =
    (session?.user?.email?.[0] || session?.user?.user_metadata?.name?.[0] || 'U').toUpperCase()

  const handleProjectSelect = (projectId: string) => {
    setActiveBaseId(projectId)
    setExpandedBaseIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(projectId)) {
        newSet.delete(projectId)
      } else {
        newSet.add(projectId)
      }
      return newSet
    })
    // Update URL
    const project = projects.find(p => p.id === projectId)
    if (project) {
      const url = `/projects/${encodeURIComponent(projectId)}`
      window.history.pushState({}, '', url)
    }
  }

  const handleTableSelect = (projectId: string, tableId: string) => {
    setActiveBaseId(projectId)
    setActiveTableId(tableId)
    // Update URL
    const project = projects.find(p => p.id === projectId)
    const table = project?.tables.find(t => t.id === tableId)
    if (project && table) {
      const url = `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(tableId)}`
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
        onBaseClick={(projectId) => {
          handleProjectSelect(projectId)
          setActiveView('projects')
        }}
        onTableClick={(projectId, tableId) => {
          handleTableSelect(projectId, tableId)
          setActiveView('projects')
        }}
        utilityNav={utilityNav}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        loading={loading}
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
              
              {/* Detail Panel */}
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


