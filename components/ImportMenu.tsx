'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'

interface ImportMenuProps {
  projectId?: string
  onProjectsRefresh?: () => void
  onLog?: (type: 'error' | 'warning' | 'info' | 'success', message: string) => void
  onCloseOtherMenus?: () => void
}

export function ImportMenu({ projectId, onProjectsRefresh, onLog, onCloseOtherMenus }: ImportMenuProps) {
  const { session } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [tableName, setTableName] = useState('')
  const [menuPosition, setMenuPosition] = useState<'center' | 'right'>('center')
  const [urlInput, setUrlInput] = useState('')
  const [showServiceSubmenu, setShowServiceSubmenu] = useState(false)
  const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right')
  const serviceButtonRef = useRef<HTMLDivElement>(null)

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
        onLog?.('success', `Synced successfully as "${finalTableName}"`)
      } else {
        throw new Error(data.message || 'Sync failed')
      }
    } catch (error) {
      onLog?.('error', `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
        const content = await file.text()
        current[fileName] = { type: 'file', content }
      } catch (error) {
        console.error(`Failed to read file ${fileName}:`, error)
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
          <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/>
        </svg>
        <span>Sync</span>
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
            Sync to this context
          </div>

          {/* Main Content */}
          <div style={{ padding: 12 }}>
            {isImporting ? (
              /* Progress View */
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 10 }}>
                  Syncing... {Math.round(importProgress)}%
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
                  {/* URL Input */}
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
                      placeholder="Paste URL..."
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && urlInput.trim()) {
                          onLog?.('info', 'URL import coming soon!')
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
                        onClick={() => onLog?.('info', 'URL import coming soon!')}
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
                      >
                        Go
                      </button>
                    )}
                  </div>

                  {/* Connect Service with submenu */}
                  <div 
                    ref={serviceButtonRef}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => {
                      // Check if submenu would overflow right edge
                      if (serviceButtonRef.current) {
                        const rect = serviceButtonRef.current.getBoundingClientRect()
                        const submenuWidth = 160
                        if (rect.right + submenuWidth + 20 > window.innerWidth) {
                          setSubmenuPosition('left')
                        } else {
                          setSubmenuPosition('right')
                        }
                      }
                      setShowServiceSubmenu(true)
                    }}
                    onMouseLeave={() => setShowServiceSubmenu(false)}
                  >
                    <button
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        background: showServiceSubmenu ? 'rgba(255,255,255,0.05)' : 'transparent',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        color: '#9ca3af',
                        fontSize: 13,
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                      </svg>
                      <span style={{ flex: 1 }}>Connect Service</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>

                    {/* Submenu */}
                    {showServiceSubmenu && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        ...(submenuPosition === 'right' 
                          ? { left: '100%', marginLeft: 4 }
                          : { right: '100%', marginRight: 4 }
                        ),
                        width: 160,
                        background: '#161618',
                        border: '1px solid #2a2a2a',
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                        zIndex: 100,
                      }}>
                        <ServiceItem icon="notion" label="Notion" />
                        <ServiceItem icon="airtable" label="Airtable" />
                        <ServiceItem icon="supabase" label="Supabase" />
                        <ServiceItem icon="sheets" label="Google Sheets" />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ServiceItem({ 
  icon, 
  label, 
  disabled = false 
}: { 
  icon: string
  label: string
  disabled?: boolean
}) {
  const icons: Record<string, React.ReactNode> = {
    notion: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.234 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.187zM1.936 1.035L15.13 0c1.635-.14 2.055.093 2.755.606l3.8 2.66c.56.42.747.56.747 1.027v16.103c0 1.027-.374 1.634-1.681 1.727l-15.458.933c-.98.047-1.448-.093-1.962-.746L.873 18.97c-.56-.746-.793-1.306-.793-1.959V2.575c0-.84.373-1.447 1.856-1.54z"/>
      </svg>
    ),
    airtable: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.992 1.966L2.847 5.478a.75.75 0 0 0 0 1.394l9.145 3.512a.75.75 0 0 0 .533 0l9.145-3.512a.75.75 0 0 0 0-1.394l-9.145-3.512a.75.75 0 0 0-.533 0zM3 9.5v7.25a.75.75 0 0 0 .463.693l8.287 3.432a.75.75 0 0 0 .75-.134V12.5L3 9.5zm18 0l-9.5 3v8.241a.75.75 0 0 0 .75.134l8.287-3.432a.75.75 0 0 0 .463-.693V9.5z"/>
      </svg>
    ),
    supabase: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z"/>
      </svg>
    ),
    sheets: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.5 3H4.5C3.12 3 2 4.12 2 5.5v13C2 19.88 3.12 21 4.5 21h15c1.38 0 2.5-1.12 2.5-2.5v-13C22 4.12 20.88 3 19.5 3zM9 17H6v-2h3v2zm0-4H6v-2h3v2zm0-4H6V7h3v2zm9 8h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V7h6v2z"/>
      </svg>
    ),
    more: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="1"/>
        <circle cx="19" cy="12" r="1"/>
        <circle cx="5" cy="12" r="1"/>
      </svg>
    ),
  }

  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          // TODO: Handle service connection
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#404040' : '#9ca3af',
        fontSize: 13,
        textAlign: 'left',
        width: '100%',
        transition: 'all 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          e.currentTarget.style.color = '#e2e8f0'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = disabled ? '#404040' : '#9ca3af'
      }}
    >
      <span style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        width: 18,
      }}>
        {icons[icon]}
      </span>
      <span>{label}</span>
      {disabled && (
        <span style={{ fontSize: 12, color: '#404040', marginLeft: 'auto' }}>Soon</span>
      )}
    </button>
  )
}
