'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../supabase/SupabaseAuthProvider'
import { type ProjectInfo } from '../../lib/projectsApi'
import { useProjects, refreshProjects } from '../../lib/hooks/useData'
import { ProjectsSidebar } from '../../components/ProjectsSidebar'
import { McpContentView } from '../../components/McpContentView'

type ActiveView = 'projects' | 'mcp' | 'etl' | 'connect' | 'test' | 'logs' | 'settings'

const utilityNav = [
  { id: 'mcp', label: 'MCP', path: 'mcp', isAvailable: true },
  { id: 'etl', label: 'ETL Strategies', path: 'etl', isAvailable: true },
  { id: 'connect', label: 'Connect', path: 'connect', isAvailable: true },
  { id: 'test', label: 'Test', path: 'test', isAvailable: false },
  { id: 'logs', label: 'Logs', path: 'logs', isAvailable: false },
  { id: 'settings', label: 'Settings', path: 'settings', isAvailable: false },
]

export default function McpPage() {
  const router = useRouter()
  const { session } = useAuth()
  
  const { projects, isLoading: loading } = useProjects()
  
  const [activeBaseId, setActiveBaseId] = useState<string>('')
  const [activeTableId, setActiveTableId] = useState<string>('')
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(new Set())
  const [activeView] = useState<ActiveView>('mcp')

  useEffect(() => {
    if (projects.length > 0 && !activeBaseId) {
      setActiveBaseId(projects[0].id)
      setExpandedBaseIds(new Set([projects[0].id]))
      if (projects[0].tables.length > 0) {
        setActiveTableId(projects[0].tables[0].id)
      }
    }
  }, [projects, activeBaseId])

  useEffect(() => {
    const handleProjectsRefresh = () => {
      refreshProjects()
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
    if (activeBase) {
      setExpandedBaseIds(prev => new Set([...prev, activeBase.id]))
    }
  }, [activeBase])

  const userInitial = session?.user?.email?.[0]?.toUpperCase() || 'U'

  const handleProjectSelect = (projectId: string) => {
    setActiveBaseId(projectId)
    setExpandedBaseIds(prev => new Set([...prev, projectId]))
    router.push(`/projects/${encodeURIComponent(projectId)}`)
  }

  const handleTableSelect = (projectId: string, tableId: string) => {
    setActiveBaseId(projectId)
    setActiveTableId(tableId)
    router.push(`/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(tableId)}`)
  }

  const handleUtilityNavClick = (viewId: string) => {
    if (viewId === 'mcp') {
      router.push('/mcp')
    } else if (viewId === 'etl') {
      router.push('/etl')
    } else if (viewId === 'connect') {
      router.push('/connect')
    } else if (viewId === 'projects') {
      router.push('/projects')
    }
  }

  const handleBackToProjects = () => {
    router.push('/projects')
  }

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#040404' }}>
      <ProjectsSidebar
        projects={projects}
        activeBaseId={activeBaseId}
        expandedBaseIds={expandedBaseIds}
        activeTableId={activeTableId}
        activeView={activeView}
        onBaseClick={handleProjectSelect}
        onTableClick={handleTableSelect}
        utilityNav={utilityNav}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        loading={loading}
      />

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#040404' }}>
        <McpContentView onBack={handleBackToProjects} />
      </section>
    </main>
  )
}

