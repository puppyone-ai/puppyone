'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { getProjects, createProject, createTable, type ProjectInfo } from '../lib/projectsApi'

interface ImportFolderDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  onLog?: (type: 'error' | 'warning' | 'info' | 'success', message: string) => void
}

// File system safe filtering and escaping
function sanitizeFileName(name: string): string {
  // Remove or replace illegal characters
  let sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove illegal characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/\.+/g, '.') // Replace multiple dots with single dot
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .trim()
  
  // If empty or only contains dots, generate default name
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    sanitized = ''
  }
  
  return sanitized
}

// Generate random unique name
function generateRandomName(prefix: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

export function ImportFolderDialog({ isOpen, onClose, onSuccess, onLog }: ImportFolderDialogProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [isCreatingNewProject, setIsCreatingNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [tableName, setTableName] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<FileList | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load project list
  useEffect(() => {
    if (isOpen) {
      loadProjects()
    }
  }, [isOpen])

  const loadProjects = async () => {
    try {
      const data = await getProjects()
      setProjects(data)
      if (data.length > 0 && !selectedProjectId) {
        setSelectedProjectId(data[0].id)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      onLog?.('error', `Failed to load projects: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const addErrorLog = (type: 'error' | 'warning' | 'info' | 'success', message: string) => {
    onLog?.(type, message)
  }

  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      setSelectedFolder(files)
      addErrorLog('info', `Folder selected: ${files[0].webkitRelativePath.split('/')[0]}`)
    }
  }

  const handleImport = async () => {
    if (!selectedFolder || selectedFolder.length === 0) {
      addErrorLog('error', 'Please select a folder')
      return
    }

    let finalProjectId = selectedProjectId

    // If creating a new project
    if (isCreatingNewProject) {
      const projectName = newProjectName.trim()
        ? sanitizeFileName(newProjectName.trim())
        : generateRandomName('project')
      
      if (!projectName) {
        addErrorLog('error', 'Invalid project name')
        return
      }

      try {
        addErrorLog('info', `Creating project: ${projectName}`)
        const newProject = await createProject(projectName)
        finalProjectId = newProject.id
        addErrorLog('success', `Project created successfully: ${newProject.name} (ID: ${newProject.id})`)
        // Update project list
        await loadProjects()
        setSelectedProjectId(finalProjectId)
      } catch (error) {
        addErrorLog('error', `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return
      }
    }

    // Generate table name
    const finalTableName = tableName.trim()
      ? sanitizeFileName(tableName.trim())
      : generateRandomName('table')

    if (!finalTableName) {
      addErrorLog('error', 'Invalid table name')
      return
    }

    setIsImporting(true)
    setProgress(0)

    try {
      // Build folder structure
      addErrorLog('info', 'Starting to parse folder structure...')
      const folderStructure = await parseFolderStructure(selectedFolder, (current, total) => {
        setProgress((current / total) * 100)
      })

      // Send to backend
      addErrorLog('info', 'Uploading to server...')
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'}/api/v1/projects/${finalProjectId}/import-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table_name: finalTableName,
          folder_structure: folderStructure,
        }),
      })

      const data = await response.json()
      if (data.code === 0) {
        addErrorLog('success', `Folder imported successfully! Table name: ${finalTableName}`)
        setProgress(100)
        setTimeout(() => {
          onSuccess?.()
          handleClose()
        }, 1000)
      } else {
        addErrorLog('error', `Import failed: ${data.message || 'Unknown error'}`)
      }
    } catch (error) {
      addErrorLog('error', `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsImporting(false)
    }
  }

  const parseFolderStructure = async (
    files: FileList,
    onProgress?: (current: number, total: number) => void
  ): Promise<Record<string, any>> => {
    const structure: Record<string, any> = {}
    const fileArray = Array.from(files)
    const totalFiles = fileArray.length
    let processedFiles = 0

    // Get root folder name (extracted from first file's path)
    let rootFolderName = 'root'
    if (fileArray.length > 0 && fileArray[0].webkitRelativePath) {
      const firstPathParts = fileArray[0].webkitRelativePath.split('/').filter(Boolean)
      if (firstPathParts.length > 0) {
        rootFolderName = firstPathParts[0]
      }
    }

    // Process each file
    for (const file of fileArray) {
      const path = file.webkitRelativePath
      if (!path) continue
      
      const parts = path.split('/').filter(Boolean)
      if (parts.length === 0) continue

      // Remove root folder name (first part)
      const relativeParts = parts.slice(1)
      if (relativeParts.length === 0) {
        // If file is directly in root directory, skip (shouldn't happen, but for safety)
        continue
      }

      // Build nested structure
      let current = structure
      for (let i = 0; i < relativeParts.length - 1; i++) {
        const part = relativeParts[i]
        if (!current[part]) {
          current[part] = {}
        }
        current = current[part]
      }

      // Process file
      const fileName = relativeParts[relativeParts.length - 1]
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || ''
      
      try {
        const content = await parseFileContent(file, fileExtension)
        current[fileName] = content
        addErrorLog('success', `Parsed: ${path}`)
      } catch (error) {
        addErrorLog('error', `Failed to parse ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        current[fileName] = 'fail to parse'
      }

      processedFiles++
      onProgress?.(processedFiles, totalFiles)
    }

    // Wrap root folder name as top-level key
    return { [rootFolderName]: structure }
  }

  const parseFileContent = async (file: File, extension: string): Promise<string> => {
    // Text file extensions
    const textExtensions = ['txt', 'md', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'py', 'java', 'cpp', 'c', 'h', 'hpp', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'vue', 'svelte']
    
    // Valuable binary file extensions (supported by MinerU)
    const valuableBinaryExtensions = ['pdf', 'docx', 'doc', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'bmp']

    if (textExtensions.includes(extension)) {
      // Text files: read directly
      return await file.text()
    } else if (extension === 'svg') {
      // SVG files: read as text (XML format)
      return await file.text()
    } else if (valuableBinaryExtensions.includes(extension)) {
      // Valuable binary files: parse via MinerU API
      try {
        return await parseWithMinerU(file, extension)
      } catch (error) {
        console.error(`Failed to parse ${extension} file with MinerU:`, error)
        return `[Failed to parse ${extension} file: ${error instanceof Error ? error.message : 'Unknown error'}]`
      }
    } else {
      // Other binary files
      return 'fail to parse'
    }
  }

  const parseWithMinerU = async (file: File, extension: string): Promise<string> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'
    
    // 创建 FormData
    const formData = new FormData()
    formData.append('file', file)
    formData.append('model_version', 'vlm')
    
    try {
      // 调用后端 API 上传并解析文件
      const response = await fetch(`${apiUrl}/api/v1/file-parser/parse-upload`, {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // 检查响应是否成功
      if (data.code === 0) {
        // 检查 content 字段是否存在（允许空字符串，因为有些文件可能真的没有文本内容）
        if (data.data && 'content' in data.data) {
          return data.data.content || '' // 如果 content 为空，返回空字符串而不是抛出错误
        } else {
          throw new Error('解析失败：响应中未包含 content 字段')
        }
      } else {
        // 业务错误
        throw new Error(data.message || '解析失败：未返回内容')
      }
    } catch (error) {
      // 如果解析失败，返回错误信息
      throw error
    }
  }

  const handleClose = () => {
    if (!isImporting) {
      setSelectedProjectId('')
      setIsCreatingNewProject(false)
      setNewProjectName('')
      setTableName('')
      setSelectedFolder(null)
      setProgress(0)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      onClose()
    }
  }

  if (!isOpen) return null

  const dialogContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
        overflow: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) {
          handleClose()
        }
      }}
    >
      <div
        style={{
          width: '90%',
          maxWidth: 600,
          maxHeight: 'calc(100vh - 40px)',
          background: '#0e1117',
          border: '1px solid rgba(148,163,184,0.25)',
          borderRadius: 10,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          margin: 'auto',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e5e7eb', margin: 0 }}>
            Import Folder as Table
          </h2>
          <button
            onClick={handleClose}
            disabled={isImporting}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 20,
              cursor: isImporting ? 'not-allowed' : 'pointer',
              padding: 0,
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Project Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#cbd5f5', fontWeight: 500 }}>
              Project
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={isCreatingNewProject ? '__new__' : selectedProjectId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setIsCreatingNewProject(true)
                    setSelectedProjectId('')
                  } else {
                    setIsCreatingNewProject(false)
                    setSelectedProjectId(e.target.value)
                  }
                }}
                disabled={isImporting}
                style={{
                  flex: 1,
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: '#161b22',
                  color: '#e5e7eb',
                  fontSize: 13,
                  cursor: isImporting ? 'not-allowed' : 'pointer',
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__new__">Create New Project</option>
              </select>
            </div>
          </div>

          {/* New Project Naming */}
          {isCreatingNewProject && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#cbd5f5', fontWeight: 500 }}>
                New Project Name (Optional)
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Leave empty to auto-generate"
                disabled={isImporting}
                style={{
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: '#161b22',
                  color: '#e5e7eb',
                  fontSize: 13,
                }}
              />
            </div>
          )}

          {/* Table Naming */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#cbd5f5', fontWeight: 500 }}>
              Table Name (Optional)
            </label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="Leave empty to auto-generate"
              disabled={isImporting}
              style={{
                height: 32,
                padding: '0 10px',
                borderRadius: 6,
                border: '1px solid rgba(148,163,184,0.35)',
                background: '#161b22',
                color: '#e5e7eb',
                fontSize: 13,
              }}
            />
          </div>

          {/* Folder Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#cbd5f5', fontWeight: 500 }}>
              Select Folder
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                {...({ webkitdirectory: '', directory: '' } as any)}
                onChange={handleFolderSelect}
                disabled={isImporting}
                style={{
                  position: 'absolute',
                  width: 0,
                  height: 0,
                  opacity: 0,
                  overflow: 'hidden',
                  zIndex: -1,
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: '#161b22',
                  color: '#e5e7eb',
                  fontSize: 13,
                  cursor: isImporting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Select Folder
              </button>
              <div
                style={{
                  flex: 1,
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: '#161b22',
                  color: selectedFolder && selectedFolder.length > 0 ? '#e5e7eb' : '#6b7280',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {selectedFolder && selectedFolder.length > 0
                  ? `${selectedFolder.length} files selected`
                  : 'No folder selected'}
              </div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {isImporting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#cbd5f5' }}>Processing Progress</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{Math.round(progress)}%</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                background: '#161b22',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#2563eb',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleClose}
            disabled={isImporting}
            style={{
              height: 32,
              padding: '0 16px',
              borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.35)',
              background: 'transparent',
              color: '#cbd5f5',
              fontSize: 13,
              cursor: isImporting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isImporting || !selectedFolder || selectedFolder.length === 0}
            style={{
              height: 32,
              padding: '0 16px',
              borderRadius: 6,
              border: 'none',
              background: isImporting || !selectedFolder || selectedFolder.length === 0 ? '#374151' : '#2563eb',
              color: isImporting || !selectedFolder || selectedFolder.length === 0 ? '#9ca3af' : '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              cursor: isImporting || !selectedFolder || selectedFolder.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}

