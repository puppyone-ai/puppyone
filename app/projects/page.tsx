'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../supabase/SupabaseAuthProvider'
import { getProjects, type ProjectInfo } from '../../lib/projectsApi'
import { ProjectWorkspaceView } from '../../components/ProjectWorkspaceView'
import { ProjectsSidebar } from '../../components/ProjectsSidebar'
import { ProjectsHeader } from '../../components/ProjectsHeader'

const utilityNav = [
  { id: 'mcp', label: '🔌 MCP', path: '/mcp-instances', isAvailable: true },
  { id: 'test', label: '▶ Test', path: '/', isAvailable: false },
  { id: 'logs', label: '☰ Logs', path: '/', isAvailable: false },
  { id: 'settings', label: '⚙ Settings', path: '/', isAvailable: false },
]

export default function ProjectsPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBaseId, setActiveBaseId] = useState<string>('')
  const [activeTableId, setActiveTableId] = useState<string>('')
  const [expandedBaseId, setExpandedBaseId] = useState<string>('')
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)

  // 从API加载项目列表
  useEffect(() => {
    async function loadProjects() {
      try {
        setLoading(true)
        const data = await getProjects()
        setProjects(data)
        // 设置默认选中的项目
        if (data.length > 0 && !activeBaseId) {
          setActiveBaseId(data[0].id)
          setExpandedBaseId(data[0].id)
          if (data[0].tables.length > 0) {
            setActiveTableId(data[0].tables[0].id)
          }
        }
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProjects()
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
    setExpandedBaseId(activeBaseId)
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
    setExpandedBaseId((prev) => (prev === projectId ? '' : projectId))
  }

  const handleTableSelect = (projectId: string, tableId: string) => {
    setActiveBaseId(projectId)
    setActiveTableId(tableId)
  }

  const handleUtilityNavClick = (path: string) => {
    router.push(path)
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
        minHeight: '100vh',
        display: 'flex',
        backgroundColor: '#040404',
        color: '#EDEDED',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <ProjectsSidebar
        projects={projects}
        activeBaseId={activeBaseId}
        expandedBaseId={expandedBaseId}
        activeTableId={activeTableId}
        onBaseClick={handleProjectSelect}
        onTableClick={handleTableSelect}
        utilityNav={utilityNav}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        onProjectsChange={setProjects}
        loading={loading}
      />

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#040404' }}>
        <ProjectsHeader
          pathSegments={pathSegments}
          projectId={activeBase?.id ?? null}
          currentTreePath={currentTreePath}
        />
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
      </section>
    </main>
  )
}


