'use client'

import React, { useState, useCallback, useRef } from 'react'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { DataImportDialog } from './DataImportDialog'

interface NodeContextMenuProps {
  state: ContextMenuState
  json: any
  projectId?: number
  tableId?: number
  onClose: () => void
  onChange?: (newJson: any) => void
  onImportSuccess?: () => void
}

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

export function NodeContextMenu({
  state,
  json,
  projectId,
  tableId,
  onClose,
  onChange,
  onImportSuccess,
}: NodeContextMenuProps) {
  // Import Dialog 状态
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importMode, setImportMode] = useState<'url' | 'file'>('url')
  const [importTargetPath, setImportTargetPath] = useState<string>('')
  const [importTargetValue, setImportTargetValue] = useState<any>(null)
  const [importedFileData, setImportedFileData] = useState<any>(null)
  
  // 文件选择器 ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleMenuAction = useCallback((action: string, payload?: any) => {
    const { path, value } = state

    // Handle copy-value (doesn't need onChange)
    if (action === 'copy-value') {
      const valueStr = typeof value === 'object' 
        ? JSON.stringify(value, null, 2) 
        : String(value ?? '')
      navigator.clipboard.writeText(valueStr).then(() => {
        console.log('Value copied to clipboard')
      }).catch(err => {
        console.error('Failed to copy value:', err)
      })
      onClose()
      return
    }

    // Handle copy-path separately (doesn't need onChange)
    if (action === 'copy-path') {
      const displayPath = path || '/' // 根节点显示为 '/'
      navigator.clipboard.writeText(displayPath).then(() => {
        console.log('Path copied to clipboard:', displayPath)
      }).catch(err => {
        console.error('Failed to copy path:', err)
      })
      onClose()
      return
    }

    // Handle import actions
    if (action === 'import-url') {
      setImportMode('url')
      setImportTargetPath(path)
      setImportTargetValue(value)
      setImportedFileData(null)
      setShowImportDialog(true)
      onClose()
      return
    }

    // For file import, directly trigger file picker
    if (action === 'import-file') {
      setImportTargetPath(path)
      setImportTargetValue(value)
      setImportedFileData(null)
      onClose()
      // 直接触发文件选择器
      setTimeout(() => {
        fileInputRef.current?.click()
      }, 0)
      return
    }

    if (!onChange) return

    // Deep clone JSON for mutation
    const newJson = JSON.parse(JSON.stringify(json))
    const parts = path.split('/').filter(Boolean)

    // Navigate to parent
    let parent: any = newJson
    // Root node case: path is empty string, parts is empty array
    if (path === '') {
       // Root node operations are limited
       // Convert/Duplicate/Delete on root is tricky. 
       // Usually we operate on parent[key]. 
       // For root, we might need to change the whole json structure.
       // Let's assume we can modify root properties if it's an object/array.
    }

    // Special handling for root node if needed, or normal traversal
    // For simplicity, let's assume we modify parent[lastKey]
    
    // Find parent and lastKey
    let lastKey: string | number = ''
    
    if (parts.length > 0) {
      for (let i = 0; i < parts.length - 1; i++) {
        parent = parent[parts[i]]
      }
      lastKey = parts[parts.length - 1]
    } else {
      // Root node operations
      // If action is add-child, we operate on newJson directly
      if (action === 'add-child') {
        if (Array.isArray(newJson)) {
          newJson.push(null)
        } else if (typeof newJson === 'object' && newJson !== null) {
          const newKey = `newKey${Object.keys(newJson).length}`
          newJson[newKey] = null
        }
        onChange(newJson)
        onClose()
        return
      }
      // Other actions on root might replace the whole JSON
      // e.g. convert root object to array
      if (action === 'convert') {
         // ... implementation for root conversion
      }
      
      onClose()
      return
    }

    switch (action) {
      case 'convert': {
        let newValue: JsonValue
        switch (payload) {
          case 'object':
            if (typeof value === 'object' && value !== null) {
              newValue = Array.isArray(value)
                ? Object.fromEntries(value.map((v: any, i: number) => [String(i), v]))
                : value
            } else {
              newValue = { value: value }
            }
            break
          case 'array':
            if (typeof value === 'object' && value !== null) {
              newValue = Array.isArray(value) ? value : Object.values(value)
            } else {
              newValue = [value]
            }
            break
          case 'string':
            newValue = String(value ?? '')
            break
          case 'number':
            newValue = Number(value) || 0
            break
          case 'boolean':
            newValue = Boolean(value)
            break
          case 'null':
            newValue = null
            break
          default:
            newValue = value
        }
        parent[lastKey] = newValue
        break
      }

      case 'add-child': {
        if (Array.isArray(parent[lastKey])) {
          parent[lastKey].push(null)
        } else if (typeof parent[lastKey] === 'object' && parent[lastKey] !== null) {
          const newKey = `newKey${Object.keys(parent[lastKey]).length}`
          parent[lastKey][newKey] = null
        }
        break
      }

      case 'duplicate': {
        const duplicated = JSON.parse(JSON.stringify(value))
        if (Array.isArray(parent)) {
          parent.splice(Number(lastKey) + 1, 0, duplicated)
        } else {
          parent[`${lastKey}_copy`] = duplicated
        }
        break
      }

      case 'delete': {
        if (Array.isArray(parent)) {
          parent.splice(Number(lastKey), 1)
        } else {
          delete parent[lastKey]
        }
        break
      }

      case 'clear-value': {
        parent[lastKey] = null
        break
      }
    }

    onChange(newJson)
    onClose()
  }, [state, json, onChange, onClose, projectId, tableId])

  // 文件读取帮助函数
  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  // 处理文件选择
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    try {
      let parsedData: any

      // 如果只有一个文件且是 JSON，直接解析
      if (files.length === 1 && files[0].name.endsWith('.json') && !files[0].webkitRelativePath.includes('/')) {
        const text = await readFileAsText(files[0])
        try {
          parsedData = JSON.parse(text)
        } catch {
          parsedData = text
        }
      } else {
        // 多文件/文件夹：构建结构
        const result: any = {}
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const path = file.webkitRelativePath || file.name
          const parts = path.split('/')
          
          let current = result
          if (parts.length > 1) {
            for (let j = 0; j < parts.length - 1; j++) {
              const part = parts[j]
              if (!current[part]) current[part] = {}
              current = current[part]
            }
            const fileName = parts[parts.length - 1]
            const text = await readFileAsText(file)
            try {
              current[fileName] = JSON.parse(text)
            } catch {
              current[fileName] = text
            }
          } else {
            const text = await readFileAsText(file)
            try {
              result[file.name] = JSON.parse(text)
            } catch {
              result[file.name] = text
            }
          }
        }
        
        parsedData = result
      }

      // 文件解析完成后，设置数据并打开对话框
      setImportedFileData(parsedData)
      setImportMode('file')
      setShowImportDialog(true)
    } catch (err) {
      console.error('Failed to parse files:', err)
    }

    // 清空 input，允许再次选择同一文件
    e.target.value = ''
  }, [])

  const handleImportData = useCallback((data: any, strategy: 'merge' | 'replace') => {
    if (!onChange) return

    // Deep clone
    const newJson = JSON.parse(JSON.stringify(json))
    const path = importTargetPath
    const parts = path.split('/').filter(Boolean)

    let parent: any = newJson
    let lastKey: string | number = ''

    if (path === '') {
      // Import to Root
      if (strategy === 'replace') {
        onChange(data)
      } else {
        // Merge into root
        if (Array.isArray(newJson) && Array.isArray(data)) {
          onChange([...newJson, ...data])
        } else if (typeof newJson === 'object' && newJson && typeof data === 'object' && data && !Array.isArray(data)) {
          onChange({ ...newJson, ...data })
        } else {
          // Type mismatch fallback
          onChange(data)
        }
      }
      return
    }

    // Navigate to parent
    if (parts.length > 0) {
      for (let i = 0; i < parts.length - 1; i++) {
        parent = parent[parts[i]]
      }
      lastKey = parts[parts.length - 1]
    }

    const currentVal = parent[lastKey]

    if (strategy === 'replace') {
      parent[lastKey] = data
    } else {
      // Merge
      if (Array.isArray(currentVal) && Array.isArray(data)) {
        parent[lastKey] = [...currentVal, ...data]
      } else if (typeof currentVal === 'object' && currentVal && typeof data === 'object' && data && !Array.isArray(data)) {
        parent[lastKey] = { ...currentVal, ...data }
      } else {
        // Type mismatch fallback
        parent[lastKey] = data
      }
    }

    onChange(newJson)
    onImportSuccess?.()
  }, [json, onChange, importTargetPath, onImportSuccess])

  return (
    <>
      <ContextMenu
        state={state}
        onClose={onClose}
        onAction={handleMenuAction}
      />

      {/* 隐藏的文件选择器 - 支持文件和文件夹 */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
        multiple
        onChange={handleFileChange}
      />

      {showImportDialog && (
        <DataImportDialog
          visible={showImportDialog}
          mode={importMode}
          targetPath={importTargetPath}
          currentValue={importTargetValue}
          initialData={importedFileData}
          onClose={() => {
            setShowImportDialog(false)
            setImportedFileData(null)
          }}
          onSuccess={handleImportData}
        />
      )}
    </>
  )
}

