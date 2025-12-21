'use client'

import React, { useState, useCallback } from 'react'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { ImportModal } from './ImportModal'

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
  // Import Modal 状态
  const [showImportModal, setShowImportModal] = useState(false)
  const [importTargetPath, setImportTargetPath] = useState<string>('')
  const [importTargetValue, setImportTargetValue] = useState<any>(null)

  const handleMenuAction = useCallback((action: string, payload?: any) => {
    const { path, value } = state

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

    // Handle upload separately (doesn't need onChange for now)
    if (action === 'upload') {
      console.log('Upload action for path:', path)
      // TODO: Implement upload functionality
      onClose()
      return
    }

    // Handle import-from-url
    if (action === 'import-from-url') {
      if (!projectId || !tableId) {
        console.error('Cannot import: projectId or tableId is missing')
        onClose()
        return
      }
      setImportTargetPath(path)
      setImportTargetValue(value)
      setShowImportModal(true)
      // Do not close context menu immediately if we want to show modal? 
      // Actually we should close the menu but keep modal open.
      // ContextMenu component is controlled by parent via `state.visible`.
      // We call onClose() which sets parent's state.visible = false.
      // But ImportModal is rendered here, so it persists as long as this component is mounted.
      onClose()
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
    }

    onChange(newJson)
    onClose()
  }, [state, json, onChange, onClose, projectId, tableId])

  return (
    <>
      <ContextMenu
        state={state}
        onClose={onClose}
        onAction={handleMenuAction}
      />

      {/* Import Modal - Moved here to keep logic co-located */}
      {showImportModal && projectId && tableId && (
        <ImportModal
          visible={showImportModal}
          targetPath={importTargetPath}
          currentValue={importTargetValue}
          tableId={tableId}
          projectId={projectId}
          mode="import_to_table"
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false)
            onImportSuccess?.()
          }}
        />
      )}
    </>
  )
}

