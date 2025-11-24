'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpBar } from './McpBar'
import type { ProjectTableJSON } from '../lib/projectData'
import { fetchProjectTableData, fetchProjectTablesData } from '../lib/projectData'
import { mockProjects } from '../lib/mock'

const JsonEditorWithNoSSR = dynamic(() => import('./JsonEditorComponent'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '20px', color: '#94a3b8', fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading Editor...
    </div>
  ),
})

type ProjectWorkspaceViewProps = {
  projectId: string
  activeTableId?: string
  onActiveTableChange?: (tableId: string) => void
  showHeaderBar?: boolean
  showBackButton?: boolean
  onNavigateBack?: () => void
  onProjectMissing?: () => void
}

export function ProjectWorkspaceView({
  projectId,
  activeTableId: activeTableIdProp,
  onActiveTableChange,
  showHeaderBar = true,
  showBackButton = true,
  onNavigateBack,
  onProjectMissing,
}: ProjectWorkspaceViewProps) {
  const { session, isAuthReady } = useAuth()
  const router = useRouter()

  const project = useMemo(() => mockProjects.find((p) => p.id === projectId), [projectId])

  const isControlled = activeTableIdProp !== undefined

  const [internalActiveTableId, setInternalActiveTableId] = useState<string>(() => {
    if (isControlled) {
      return activeTableIdProp ?? ''
    }
    return project?.tables[0]?.id ?? ''
  })
  const [tableData, setTableData] = useState<ProjectTableJSON | undefined>(undefined)
  const [gridData, setGridData] = useState<Record<string, ProjectTableJSON | undefined>>({})
  const [currentTreePath, setCurrentTreePath] = useState<string | null>(null)

  useEffect(() => {
    if (isControlled) {
      setInternalActiveTableId(activeTableIdProp ?? '')
    }
  }, [activeTableIdProp, isControlled])

  useEffect(() => {
    if (!isControlled) {
      const nextId = project?.tables?.[0]?.id ?? ''
      setInternalActiveTableId(nextId)
    }
  }, [projectId, project?.tables, isControlled])

  useEffect(() => {
    if (onProjectMissing && isAuthReady && session && !project) {
      onProjectMissing()
    }
  }, [onProjectMissing, isAuthReady, session, project])

  const resolvedActiveTableId = isControlled ? activeTableIdProp ?? '' : internalActiveTableId
  const activeTable = project?.tables.find((t) => t.id === resolvedActiveTableId)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!resolvedActiveTableId) {
        setTableData(undefined)
        return
      }
      const data = await fetchProjectTableData(projectId, resolvedActiveTableId)
      if (!cancelled) setTableData(data)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [projectId, resolvedActiveTableId])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!project?.tables?.length) return
      const ids = project.tables.map((t) => t.id)
      const all = await fetchProjectTablesData(projectId, ids)
      if (!cancelled) setGridData(all)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [projectId, project?.tables])

  const overlayMessage = !isAuthReady ? 'Loading…' : undefined

  const handleTableSelect = (tableId: string) => {
    if (!isControlled) {
      setInternalActiveTableId(tableId)
    }
    onActiveTableChange?.(tableId)
  }

  const handleBack = () => {
    if (!showBackButton) return
    if (onNavigateBack) {
      onNavigateBack()
    } else {
      router.push('/projects')
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {showHeaderBar && (
        <div
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            backgroundColor: '#0d1014',
            padding: '12px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            position: 'relative',
            zIndex: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {showBackButton && (
              <button
                onClick={handleBack}
                aria-label="Back to projects"
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  backgroundColor: 'transparent',
                  color: '#cbd5f5',
                  fontSize: 16,
                  lineHeight: '26px',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                }}
              >
                ←
              </button>
            )}
            <div
              style={{
                fontFamily: "'JetBrains Mono', SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                color: '#EDEDED',
                letterSpacing: 0.4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {[project?.name ?? 'Project', activeTable?.name ?? '—']
                .filter(Boolean)
                .map((segment, idx) => (
                  <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {idx > 0 && <span style={{ color: '#4F5561' }}>/</span>}
                    <span>{segment}</span>
                  </span>
                ))}
            </div>
          </div>
          <McpBar projectId={projectId} currentTreePath={currentTreePath} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {project && project.tables.length > 0 ? (
          <>
            <section style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050607' }}>
              <div style={{ flex: 1, padding: '24px', display: 'flex', gap: 16, overflow: 'hidden' }}>
                <div
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: 'rgba(13,18,24,0.75)',
                    border: '1px solid rgba(48,52,60,0.45)',
                    position: 'relative',
                  }}
                >
                  {tableData ? (
                    <JsonEditorWithNoSSR json={tableData} onPathChange={setCurrentTreePath} />
                  ) : (
                    <div
                      style={{
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#94a3b8',
                        fontSize: 13,
                      }}
                    >
                      Select a table to view its data.
                    </div>
                  )}
                </div>

                <aside
                  style={{
                    width: 220,
                    minWidth: 200,
                    borderRadius: 10,
                    border: '1px solid rgba(48,52,60,0.45)',
                    background: 'rgba(10,14,18,0.85)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    fontSize: 11,
                    color: '#8A8F98',
                  }}
                >
                  <InfoRow label="Table" value={activeTable?.name ?? '—'} />
                  <InfoRow label="Rows" value={String(activeTable?.rows ?? '—')} />
                  <InfoRow label="Last Sync" value="2 minutes ago" />
                </aside>
              </div>
            </section>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'grid',
              placeItems: 'center',
              color: '#94a3b8',
              fontSize: 14,
            }}
          >
            {project ? 'No tables available for this project.' : 'Loading project…'}
          </div>
        )}
      </div>

      {overlayMessage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            letterSpacing: 1,
            color: '#d4d4d8',
          }}
        >
          {overlayMessage}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: '#6F7580', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#C8CBD3' }}>{value}</span>
    </div>
  )
}

