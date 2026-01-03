'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTable } from '../lib/hooks/useData'
import { updateTableData, type TableInfo, type ProjectInfo } from '../lib/projectsApi'
import { EditorSkeleton } from './Skeleton'
import TreeLineVirtualEditor from './editors/tree/TreeLineVirtualEditor'
import MonacoJsonEditor from './editors/code/MonacoJsonEditor'
import type { EditorType } from './ProjectsHeader'
import type { ProjectTableJSON } from '../lib/projectData'
import { type McpToolPermissions } from '../lib/mcpApi'

// 简化版 ProjectWorkspaceView
export function ProjectWorkspaceView({
  projectId,
  activeTableId,
  onActiveTableChange,
  editorType = 'treeline-virtual',
  ...props // 忽略其他非核心 props
}: any) {
  
  // 1. 数据获取
  // 确保 activeTableId 是字符串
  const validTableId = activeTableId ? String(activeTableId) : undefined
  const { tableData: rawTableData, isLoading, error } = useTable(projectId, validTableId)

  // 2. 数据处理
  const tableData = useMemo(() => {
    if (!rawTableData?.data) return undefined
    let data = rawTableData.data as any
    // 兼容处理：如果最外层包裹了数组且只有一个对象，取出来
    if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      data = data[0]
    }
    return data as ProjectTableJSON
  }, [rawTableData])

  // 3. 本地状态
  const [localData, setLocalData] = useState<any>(undefined)
  const [isSaving, setIsSaving] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // 当从后端获取到新数据，且本地没有未保存的更改时，同步数据
    if (tableData && !isSaving) {
        setLocalData(tableData)
    }
  }, [tableData]) // 移除 isSaving 依赖，防止保存状态变化导致的回滚

  // 4. 保存逻辑 (带防抖)
  const handleDataChange = (newData: any) => {
    setLocalData(newData)
    
    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // 2秒防抖保存
    saveTimeoutRef.current = setTimeout(async () => {
      if (!projectId || !validTableId) return
      
      setIsSaving(true)
      try {
        // 确保数据是数组格式 (兼容后端要求)
        const dataToSave = Array.isArray(newData) ? newData : [newData]
        await updateTableData(projectId, validTableId, dataToSave)
        console.log('[AutoSave] Saved successfully')
      } catch (err) {
        console.error('[AutoSave] Failed:', err)
        // 这里后续可以对接全局 Toast 报错
      } finally {
        setIsSaving(false)
      }
    }, 2000)
  }

  // 5. 渲染
  // 强制全屏容器
  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      position: 'relative', 
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      
      {/* 编辑器区域 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div style={{ 
            position: 'absolute', 
            top: 10, 
            right: 20, 
            zIndex: 10,
            pointerEvents: 'none'
        }}>
            {isSaving ? (
                <span style={{ 
                    background: 'rgba(0,0,0,0.6)', 
                    color: '#ddd', 
                    padding: '4px 8px', 
                    borderRadius: 4, 
                    fontSize: 12 
                }}>
                    Saving...
                </span>
            ) : null}
        </div>

        {isLoading && !tableData ? (
            <div style={{ position: 'absolute', inset: 0, padding: 20 }}>
                <EditorSkeleton />
            </div>
        ) : error ? (
            <div style={{ padding: 40, color: 'red', textAlign: 'center' }}>
                Failed to load table data: {error.message}
            </div>
        ) : (localData || tableData) ? (
            editorType === 'treeline-virtual' ? (
                <div style={{ position: 'absolute', inset: 0 }}>
                    <TreeLineVirtualEditor 
                        json={localData || tableData}
                        onChange={handleDataChange}
                        // 传递所有业务回调
                        onPathChange={props.onTreePathChange}
                        onAddAccessPoint={props.onAddAccessPoint}
                        onAccessPointChange={props.onAccessPointChange}
                        onAccessPointRemove={props.onAccessPointRemove}
                        configuredAccessPoints={props.configuredAccessPoints}
                        projectId={Number(projectId)}
                        tableId={validTableId ? Number(validTableId) : undefined}
                        onImportSuccess={props.onImportSuccess}
                        onOpenDocument={props.onOpenDocument}
                    />
                </div>
            ) : (
                <div style={{ position: 'absolute', inset: 0 }}>
                    <MonacoJsonEditor 
                        json={localData || tableData}
                        onChange={handleDataChange}
                    />
                </div>
            )
        ) : (
            <div style={{ 
                height: '100%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                color: '#666'
            }}>
                Select a table to view data
            </div>
        )}
      </div>
    </div>
  )
}


