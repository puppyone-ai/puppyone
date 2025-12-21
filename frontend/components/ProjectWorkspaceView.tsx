'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpBar } from './McpBar'
import { ErrorConsole, type ErrorLog } from './ErrorConsole'
import type { ProjectTableJSON } from '../lib/projectData'
import { updateTableData, type TableInfo } from '../lib/projectsApi'
import { useProjects, useTable, refreshProjects } from '../lib/hooks/useData'
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
// MCP 工具权限类型 - 对应后端 8 种工具
interface McpToolPermissions {
  get_data_schema?: boolean
  get_all_data?: boolean
  query_data?: boolean
  preview?: boolean
  select?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}

interface ConfiguredAccessPoint {
  path: string
  permissions: McpToolPermissions
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
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void
  onCancelSelection?: () => void
  publishPanel?: React.ReactNode  // Publish Panel 作为 slot 传入
  configuredAccessPoints?: ConfiguredAccessPoint[]  // 已配置的 Access Points，用于高亮显示
  // Pending 配置 - 用于在节点旁边显示浮动配置面板
  pendingConfig?: { path: string; permissions: McpToolPermissions } | null
  onPendingConfigChange?: (config: { path: string; permissions: McpToolPermissions } | null) => void
  onPendingConfigSave?: () => void
  // 统一交互模型：右侧 Gutter 配置 Agent 权限
  onAccessPointChange?: (path: string, permissions: McpToolPermissions) => void
  onAccessPointRemove?: (path: string) => void
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
  onAccessPointChange,
  onAccessPointRemove,
}: ProjectWorkspaceViewProps) {
  const { session, isAuthReady } = useAuth()
  const router = useRouter()
  
  // 使用 SWR 获取项目列表（自动缓存、去重）
  const { projects, refresh: refreshProjectsList } = useProjects()

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
  
  // 计算当前激活的表 ID
  const resolvedActiveTableId = isControlled ? activeTableIdProp ?? '' : internalActiveTableId
  
  // 使用 SWR 获取当前表数据（自动缓存、去重）
  const { tableData: rawTableData, refresh: refreshTableData } = useTable(projectId, resolvedActiveTableId)
  
  // 处理表数据格式（保持原有逻辑）
  const tableData = useMemo(() => {
    if (!rawTableData?.data) return undefined
    let displayData = rawTableData.data as any
    // 如果数据是数组且只有一个元素，且该元素是对象（可能是文件夹结构），则提取该对象
    if (Array.isArray(displayData) && displayData.length === 1 && typeof displayData[0] === 'object' && !Array.isArray(displayData[0])) {
      displayData = displayData[0]
    }
    return displayData as ProjectTableJSON
  }, [rawTableData])
  
  // 本地编辑状态（用于防抖保存）
  const [localTableData, setLocalTableData] = useState<ProjectTableJSON | undefined>(undefined)
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

  const activeTable = project?.tables.find((t: TableInfo) => t.id === resolvedActiveTableId)
  
  // 当 SWR 数据变化时，同步到本地状态
  useEffect(() => {
    setLocalTableData(tableData)
  }, [tableData])

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

    // 更新本地状态（用于即时显示）
    setLocalTableData(newData)

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

  // 切换表时重置状态
  useEffect(() => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      setSaving(false)
      setLastSaved(null)
  }, [resolvedActiveTableId])

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
            onProjectsRefresh={() => refreshProjects()}
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
                    {(localTableData ?? tableData) ? (
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {editorType === 'treeline-virtual' && (
                          <TreeLineVirtualEditor 
                            json={localTableData ?? tableData!} 
                            onPathChange={setCurrentTreePath}
                            onChange={handleTableDataChange}
                            isSelectingAccessPoint={isSelectingAccessPoint}
                            selectedAccessPath={selectedAccessPath}
                            onAddAccessPoint={onAddAccessPoint}
                            configuredAccessPoints={configuredAccessPoints}
                            onAccessPointChange={onAccessPointChange}
                            onAccessPointRemove={onAccessPointRemove}
                            projectId={Number(projectId)}
                            tableId={resolvedActiveTableId ? Number(resolvedActiveTableId) : undefined}
                            onImportSuccess={refreshTableData}
                          />
                        )}
                        {editorType === 'monaco' && (
                          <MonacoJsonEditor 
                          json={localTableData ?? tableData!} 
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
                        Select a context to view its data.
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
            {project ? 'No contexts available for this project.' : 'Loading project…'}
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


