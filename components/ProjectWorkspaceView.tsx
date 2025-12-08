'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpBar } from './McpBar'
import { ErrorConsole, type ErrorLog } from './ErrorConsole'
import type { ProjectTableJSON } from '../lib/projectData'
import { getProjects, getTable, updateTableData, type TableInfo } from '../lib/projectsApi'
import type { EditorType } from './ProjectsHeader'

// Dynamic imports for editors (from editors/ folder)
const EditorLoading = () => (
    <div style={{ padding: '20px', color: '#94a3b8', fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading Editor...
    </div>
)

// Tree editor with virtual scrolling
const TreeLineVirtualEditor = dynamic(
  () => import('./editors/tree/TreeLineVirtualEditor'),
  { ssr: false, loading: EditorLoading }
)

// Monaco (raw JSON text editor)
const MonacoJsonEditor = dynamic(
  () => import('./editors/code/MonacoJsonEditor'),
  { ssr: false, loading: EditorLoading }
)

// Access Point 类型
interface ConfiguredAccessPoint {
  path: string
  permissions: { read: boolean; write: boolean }
}

type ProjectWorkspaceViewProps = {
  projectId: string
  activeTableId?: string
  onActiveTableChange?: (tableId: string) => void
  onTreePathChange?: (treePath: string | null) => void
  showHeaderBar?: boolean
  showBackButton?: boolean
  onNavigateBack?: () => void
  onProjectMissing?: () => void
  editorType?: EditorType
  isSelectingAccessPoint?: boolean
  selectedAccessPath?: string | null
  onAddAccessPoint?: (path: string, permissions: { read: boolean; write: boolean }) => void
  onCancelSelection?: () => void
  publishPanel?: React.ReactNode  // Publish Panel 作为 slot 传入
  configuredAccessPoints?: ConfiguredAccessPoint[]  // 已配置的 Access Points，用于高亮显示
  // Pending 配置 - 用于在节点旁边显示浮动配置面板
  pendingConfig?: { path: string; permissions: { read: boolean; write: boolean } } | null
  onPendingConfigChange?: (config: { path: string; permissions: { read: boolean; write: boolean } } | null) => void
  onPendingConfigSave?: () => void
}

export function ProjectWorkspaceView({
  projectId,
  activeTableId: activeTableIdProp,
  onActiveTableChange,
  onTreePathChange,
  publishPanel,
  configuredAccessPoints = [],
  pendingConfig = null,
  onPendingConfigChange,
  onPendingConfigSave,
  showHeaderBar = true,
  showBackButton = true,
  onNavigateBack,
  onProjectMissing,
  editorType = 'treeline-virtual',
  isSelectingAccessPoint = false,
  selectedAccessPath = null,
  onAddAccessPoint,
  onCancelSelection,
}: ProjectWorkspaceViewProps) {
  const { session, isAuthReady } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<any[]>([])

  // Load project data from API
  const loadProjects = async () => {
    try {
      const data = await getProjects()
      setProjects(data)
      // Table data will be automatically refreshed by useEffect when projects state changes
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }

  // Load projects on mount and when projectId changes
  useEffect(() => {
    loadProjects()
  }, [projectId]) // Reload when projectId changes

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

  // Listen for import log events (from ProjectsHeader's McpBar)
  useEffect(() => {
    const handleImportLog = (event: CustomEvent<{ type: 'error' | 'warning' | 'info' | 'success', message: string }>) => {
      const { type, message } = event.detail
      if (addErrorLogRef.current) {
        addErrorLogRef.current(type, message)
      }
    }
    window.addEventListener('import-log', handleImportLog as EventListener)
    return () => {
      window.removeEventListener('import-log', handleImportLog as EventListener)
    }
  }, [])


  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId])

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
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([])
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const errorIdCounterRef = useRef(0)
  const addErrorLogRef = useRef<((type: ErrorLog['type'], message: string) => void) | null>(null)

  // Notify parent component when tree path changes
  useEffect(() => {
    onTreePathChange?.(currentTreePath)
  }, [currentTreePath, onTreePathChange])

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
  const activeTable = project?.tables.find((t: TableInfo) => t.id === resolvedActiveTableId)

  // Add error log
  const addErrorLog = (type: ErrorLog['type'], message: string) => {
    errorIdCounterRef.current += 1
    const logEntry = {
      id: `error-${errorIdCounterRef.current}`,
      timestamp: new Date(),
      type,
      message,
    }
    
    // Sync to browser console
    const logPrefix = `[${type.toUpperCase()}]`
    switch (type) {
      case 'error':
        console.error(logPrefix, message)
        break
      case 'warning':
        console.warn(logPrefix, message)
        break
      case 'info':
        console.info(logPrefix, message)
        break
      case 'success':
        console.log(logPrefix, message)
        break
      default:
        console.log(logPrefix, message)
    }
    
    setErrorLogs((prev) => [...prev, logEntry])
  }

  // Store addErrorLog in ref for event listeners
  addErrorLogRef.current = addErrorLog

  // Clear error logs
  const clearErrorLogs = () => {
    setErrorLogs([])
  }

  // Expose addErrorLog for ImportFolderDialog
  const handleImportLog = (type: 'error' | 'warning' | 'info' | 'success', message: string) => {
    addErrorLog(type, message)
  }

  // 处理表数据变更，自动保存到后端
  const handleTableDataChange = async (newData: any) => {
    if (!resolvedActiveTableId || !projectId) return

    // 更新本地状态
    setTableData(newData)

    // 清除之前的保存定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // 防抖：等待用户停止编辑2s后再保存
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true)
        // 确保数据是数组格式
        const dataArray = Array.isArray(newData) ? newData : [newData]
        
        // 验证数据格式
        const isValid = dataArray.every(
          (item) => item !== null && typeof item === 'object' && !Array.isArray(item)
        )

        if (!isValid) {
          addErrorLog(
            'error',
            'Invalid data format: Data must be an array of objects. Each element must be an object (not null, not array).'
          )
          setSaving(false)
          return
        }

        // 保存数据到后端
        await updateTableData(projectId, resolvedActiveTableId, dataArray)

        setLastSaved(new Date())
        addErrorLog('success', 'Data saved successfully')
        console.log('Data saved successfully')
      } catch (error: any) {
        console.error('Failed to save data:', error)
        
        // 尝试获取详细的错误信息
        let errorMessage = 'Unknown error'
        
        // 检查错误对象是否包含详细的验证错误信息（从apiRequest中传递的）
        if (error && typeof error === 'object') {
          // 如果错误对象包含data字段（验证错误详情）
          if (error.data && Array.isArray(error.data)) {
            // 显示详细的验证错误
            errorMessage = `Validation Error:\n${error.data.join('\n')}`
          } else if (error.message) {
            errorMessage = error.message
          }
        } else if (error instanceof Error) {
          errorMessage = error.message
        }
        
        addErrorLog('error', `Failed to save changes: ${errorMessage}`)
      } finally {
        setSaving(false)
      }
    }, 2000) // 2秒防抖
  }

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!resolvedActiveTableId) {
        setTableData(undefined)
        setLastSaved(null)
        return
      }
      // 清除之前的保存定时器
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      setSaving(false)
      setLastSaved(null)
      // 切换表时不清除错误日志，保留历史记录
      
      try {
        const tableData = await getTable(projectId, resolvedActiveTableId)
        // 如果数据是数组且只有一个元素，且该元素是对象（可能是文件夹结构），则提取该对象
        let displayData = tableData.data as any
        if (Array.isArray(displayData) && displayData.length === 1 && typeof displayData[0] === 'object' && !Array.isArray(displayData[0])) {
          displayData = displayData[0]
        }
        if (!cancelled) setTableData(displayData)
      } catch (error) {
        console.error('Failed to load table data:', error)
        if (!cancelled) {
          setTableData(undefined)
          // 如果表数据加载失败，可能是项目数据过时了，重新加载项目数据
          try {
            const updatedProjects = await getProjects()
            if (!cancelled) setProjects(updatedProjects)
          } catch (e) {
            console.error('Failed to reload projects:', e)
          }
        }
      }
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
      try {
        const all: Record<string, ProjectTableJSON | undefined> = {}
        await Promise.all(
          project.tables.map(async (t: TableInfo) => {
            try {
              const tableData = await getTable(projectId, t.id)
              // 如果数据是数组且只有一个元素，且该元素是对象（可能是文件夹结构），则提取该对象
              let displayData = tableData.data as any
              if (Array.isArray(displayData) && displayData.length === 1 && typeof displayData[0] === 'object' && !Array.isArray(displayData[0])) {
                displayData = displayData[0]
              }
              all[t.id] = displayData
            } catch (error) {
              console.error(`Failed to load table ${t.id}:`, error)
              all[t.id] = undefined
            }
          })
        )
        if (!cancelled) setGridData(all)
      } catch (error) {
        console.error('Failed to load tables data:', error)
      }
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
    <>
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
          <McpBar 
            projectId={projectId} 
            currentTreePath={currentTreePath}
            onProjectsRefresh={loadProjects}
            onLog={handleImportLog}
          />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {project && project.tables.length > 0 ? (
          <>
            <section style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#050607' }}>
              <div style={{ flex: 1, padding: 24, display: 'flex', gap: 24, overflow: 'hidden' }}>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'transparent',
                      border: isSelectingAccessPoint ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid transparent',
                      position: 'relative',
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'border-color 0.2s ease',
                    }}
                  >
                    {tableData ? (
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {editorType === 'treeline-virtual' && (
                          <TreeLineVirtualEditor 
                            json={tableData} 
                            onPathChange={setCurrentTreePath}
                            onChange={handleTableDataChange}
                            isSelectingAccessPoint={isSelectingAccessPoint}
                            selectedAccessPath={selectedAccessPath}
                            onAddAccessPoint={onAddAccessPoint}
                            configuredAccessPoints={configuredAccessPoints}
                            pendingConfig={pendingConfig}
                            onPendingConfigChange={onPendingConfigChange}
                            onPendingConfigSave={onPendingConfigSave}
                          />
                        )}
                        {editorType === 'monaco' && (
                          <MonacoJsonEditor 
                          json={tableData} 
                          onPathChange={setCurrentTreePath}
                          onChange={handleTableDataChange}
                        />
                        )}
                      </div>
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
                  {/* Console hidden - logs only shown as toast notifications */}
                </div>
                
                {/* Publish Panel Slot - rendered inside the same padding container */}
                {publishPanel}
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
    </>
  )
}


