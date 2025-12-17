'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { ImportModal } from './editors/tree/components/ImportModal'

interface ImportMenuProps {
  projectId?: string
  onProjectsRefresh?: () => void
  onLog?: (type: 'error' | 'warning' | 'info' | 'success', message: string) => void
  onCloseOtherMenus?: () => void
}

// 辅助函数：检查文件是否为文本文件
async function isTextFileType(file: File): Promise<boolean> {
  const textFileExtensions = [
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h',
    '.html', '.css', '.scss', '.less', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
    '.sql', '.sh', '.bat', '.ps1', '.log', '.csv', '.tsv', '.r', '.m', '.pl', '.rb',
    '.go', '.rs', '.swift', '.kt', '.scala', '.php', '.rb', '.coffee', '.dart', '.lua'
  ]

  const binaryFileExtensions = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.tar', '.gz',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.ico', '.mp3', '.mp4',
    '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.exe', '.dll', '.so', '.dylib', '.bin',
    '.iso', '.img', '.dmg', '.pkg', '.deb', '.rpm', '.msi', '.app', '.apk', '.ipa'
  ]

  const fileName = file.name.toLowerCase()
  const extension = fileName.substring(fileName.lastIndexOf('.'))

  // 明确的二进制文件
  if (binaryFileExtensions.some(ext => fileName.endsWith(ext))) {
    return false
  }

  // 明确的文本文件
  if (textFileExtensions.some(ext => fileName.endsWith(ext))) {
    return true
  }

  // 对于未知扩展名，检查文件头
  const buffer = await file.slice(0, 1024).arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // 检查是否包含null字节（二进制文件的典型特征）
  if (bytes.includes(0)) {
    return false
  }

  // 检查是否大部分为可打印ASCII字符
  let printableCount = 0
  for (let i = 0; i < Math.min(bytes.length, 512); i++) {
    const byte = bytes[i]
    if (byte >= 32 && byte <= 126 || byte === 9 || byte === 10 || byte === 13) {
      printableCount++
    }
  }

  return printableCount / Math.min(bytes.length, 512) > 0.7
}

// 辅助函数：清理Unicode内容
function sanitizeUnicodeContent(content: string): string {
  return content
    // 移除null字符和其他控制字符
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    // 替换其他可能有问题的Unicode字符
    .replace(/[\uFFFE\uFFFF]/g, '')
    // 确保字符串以有效的JSON开头（如果是JSON的话）
    .trim()
}

export function ImportMenu({ projectId, onProjectsRefresh, onLog, onCloseOtherMenus }: ImportMenuProps) {
  const router = useRouter()
  const { session } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [tableName, setTableName] = useState('')
  const [menuPosition, setMenuPosition] = useState<'center' | 'right'>('center')
  const [urlInput, setUrlInput] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<HTMLDivElement>(null)

  // Calculate menu position to prevent overflow
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuWidth = 280
      const rightEdge = buttonRect.left + buttonRect.width / 2 + menuWidth / 2
      const viewportWidth = window.innerWidth
      
      if (rightEdge > viewportWidth - 16) {
        setMenuPosition('right')
      } else {
        setMenuPosition('center')
      }
    }
  }, [isOpen])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === dropzoneRef.current) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      // Check if it's a folder
      const item = items[0]
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry()
        if (entry?.isDirectory) {
          // For folders, we need to use the file input
          // Show a message that folder needs to be selected via browse
          onLog?.('info', 'For folders, please use "Browse folder" option')
          fileInputRef.current?.click()
          return
        }
      }
    }
    
    // Handle files
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFilesSelected(files)
    }
  }, [onLog])

  const handleFilesSelected = async (files: FileList) => {
    if (!projectId) {
      onLog?.('error', 'No project selected')
      return
    }

    const finalTableName = tableName.trim()
      ? tableName.replace(/[^a-zA-Z0-9_-]/g, '_')
      : `context_${Date.now()}`

    setIsImporting(true)
    setImportProgress(0)

    try {
      onLog?.('info', 'Parsing folder structure...')
      const folderStructure = await parseFolderStructure(files, (current, total) => {
        setImportProgress((current / total) * 50)
      })

      onLog?.('info', 'Uploading...')
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/projects/${projectId}/import-folder`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            table_name: finalTableName,
            folder_structure: folderStructure,
          }),
        }
      )

      const data = await response.json()
      if (data.code === 0) {
        setImportProgress(100)
        onProjectsRefresh?.()
        setTableName('')
        setIsOpen(false)
        onLog?.('success', `Imported successfully as "${finalTableName}"`)
      } else {
        throw new Error(data.message || 'Import failed')
      }
    } catch (error) {
      onLog?.('error', `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsImporting(false)
      setImportProgress(0)
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

    let rootFolderName = 'root'
    if (fileArray.length > 0 && fileArray[0].webkitRelativePath) {
      const firstPathParts = fileArray[0].webkitRelativePath.split('/').filter(Boolean)
      if (firstPathParts.length > 0) {
        rootFolderName = firstPathParts[0]
      }
    }

    structure[rootFolderName] = { type: 'folder', children: {} }

    for (const file of fileArray) {
      const pathParts = file.webkitRelativePath.split('/').filter(Boolean)
      let current = structure[rootFolderName].children

      for (let i = 1; i < pathParts.length - 1; i++) {
        if (!current[pathParts[i]]) {
          current[pathParts[i]] = { type: 'folder', children: {} }
        }
        current = current[pathParts[i]].children
      }

      const fileName = pathParts[pathParts.length - 1]
      try {
        // 检查是否为文本文件
        const isTextFile = await isTextFileType(file)
        let content = null

        if (isTextFile) {
          content = await file.text()
          // 清理无效的Unicode字符
          content = sanitizeUnicodeContent(content)
        }

        current[fileName] = {
          type: 'file',
          content,
          size: file.size,
          lastModified: file.lastModified
        }
      } catch (error) {
        console.error(`Failed to read file ${fileName}:`, error)
        current[fileName] = {
          type: 'file',
          content: null,
          size: file.size,
          lastModified: file.lastModified,
          error: 'Failed to read file content'
        }
      }

      processedFiles++
      onProgress?.(processedFiles, totalFiles)
    }

    return structure
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={() => {
          setIsOpen(!isOpen)
          onCloseOtherMenus?.()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 28,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid',
          borderColor: isOpen ? '#525252' : '#404040',
          background: isOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
          color: isOpen ? '#e2e8f0' : '#9ca3af',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = '#525252'
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
            e.currentTarget.style.color = '#e2e8f0'
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = '#404040'
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#9ca3af'
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>Import</span>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: 36,
            ...(menuPosition === 'center' 
              ? { left: '50%', transform: 'translateX(-50%)' }
              : { right: 0 }
            ),
            width: 280,
            background: '#161618',
            border: '1px solid #2a2a2a',
            borderRadius: 10,
            zIndex: 50,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Header */}
          <div style={{ 
            padding: '12px 14px', 
            borderBottom: '1px solid #2a2a2a',
            fontSize: 13,
            fontWeight: 500,
            color: '#9ca3af',
          }}>
            Import to this context
          </div>

          {/* Main Content */}
          <div style={{ padding: 12 }}>
            {isImporting ? (
              /* Progress View */
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 10 }}>
                  Importing... {Math.round(importProgress)}%
                </div>
                <div style={{
                  height: 4,
                  background: '#2a2a2a',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${importProgress}%`,
                    height: '100%',
                    background: '#34d399',
                    transition: 'width 0.2s',
                  }} />
                </div>
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
                  multiple
                  style={{ display: 'none' }}
                />

                {/* Dropzone */}
                <div
                  ref={dropzoneRef}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '16px',
                    border: '1px dashed',
                    borderColor: isDragging ? '#525252' : '#333',
                    borderRadius: 8,
                    background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                    marginBottom: 10,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <div style={{ fontSize: 13, color: '#9ca3af' }}>
                    Drop files or folder here
                  </div>
                </div>

                {/* Options */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* URL Input - Opens /connect page */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="Paste URL (opens in Connect page)..."
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && urlInput.trim()) {
                          setShowImportModal(true)
                        }
                      }}
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontSize: 13,
                        color: '#e2e8f0',
                      }}
                    />
                    {urlInput.trim() && (
                      <button
                        onClick={() => {
                          setShowImportModal(true)
                        }}
                        style={{
                          padding: '4px 10px',
                          background: '#34d399',
                          border: 'none',
                          borderRadius: 4,
                          color: '#000',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#2dd38d'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#34d399'
                        }}
                      >
                        Go
                      </button>
                    )}
                  </div>

                  {/* Connect Service - Link to /connect page */}
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      router.push('/connect')
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: '#9ca3af',
                      fontSize: 13,
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                      e.currentTarget.style.color = '#e2e8f0'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = '#9ca3af'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <ellipse cx="12" cy="5" rx="9" ry="3"/>
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                    </svg>
                    <span style={{ flex: 1 }}>Connect Service</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17L17 7M17 7H7M17 7V17"/>
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Import Modal for URL import */}
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={Number(projectId)}
          mode="create_table"
          tableName={tableName}
          initialUrl={urlInput}
          onClose={() => {
            setShowImportModal(false)
            setUrlInput('')
          }}
          onSuccess={(result) => {
            setShowImportModal(false)
            setUrlInput('')
            setIsOpen(false)
            onProjectsRefresh?.()
            onLog?.('success', `Table created successfully`)
          }}
        />
      )}
    </div>
  )
}

