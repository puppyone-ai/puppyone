'use client'

import { useState, useEffect } from 'react'
import { parseUrl, importData, type ParseUrlResponse, type DataField } from '../lib/connectApi'
import { getNotionStatus, connectNotion, disconnectNotion, type NotionStatusResponse } from '../lib/oauthApi'
import type { ProjectInfo } from '../lib/projectsApi'
import { useProjects } from '../lib/hooks/useData'

type ConnectContentViewProps = {
  onBack: () => void
}

// SaaS Platform definitions
const saasPlat = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Databases, pages, wikis',
    status: 'supported' as const,
    requiresAuth: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.234 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.187z"/>
      </svg>
    ),
  },
  {
    id: 'github',
    name: 'Linear',
    description: 'Issues, projects, roadmaps',
    status: 'coming-soon' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 3L3 21M21 3L21 10M21 3L14 3"/>
      </svg>
    ),
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Bases, tables, views',
    status: 'coming-soon' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.992 1.966L2.847 5.478a.75.75 0 0 0 0 1.394l9.145 3.512a.75.75 0 0 0 .533 0l9.145-3.512a.75.75 0 0 0 0-1.394l-9.145-3.512a.75.75 0 0 0-.533 0zM3 9.5v7.25a.75.75 0 0 0 .463.693l8.287 3.432a.75.75 0 0 0 .75-.134V12.5L3 9.5zm18 0l-9.5 3v8.241a.75.75 0 0 0 .75.134l8.287-3.432a.75.75 0 0 0 .463-.693V9.5z"/>
      </svg>
    ),
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Spreadsheets, worksheets',
    status: 'coming-soon' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.5 3H4.5C3.12 3 2 4.12 2 5.5v13C2 19.88 3.12 21 4.5 21h15c1.38 0 2.5-1.12 2.5-2.5v-13C22 4.12 20.88 3 19.5 3zM9 17H6v-2h3v2zm0-4H6v-2h3v2zm0-4H6V7h3v2zm9 8h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V7h6v2z"/>
      </svg>
    ),
  },
]

export function ConnectContentView({ onBack }: ConnectContentViewProps) {
  const { projects } = useProjects()

  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseUrlResponse | null>(null)

  // OAuth states
  const [notionStatus, setNotionStatus] = useState<NotionStatusResponse>({ connected: false })
  const [showNotionAuth, setShowNotionAuth] = useState(false)
  const [isLoadingNotion, setIsLoadingNotion] = useState(false)

  // Import settings
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [targetTableId, setTargetTableId] = useState<number | null>(null)
  const [newTableName, setNewTableName] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)

  // Panel expansion state
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null)

  // Check Notion status on mount
  // TODO: Re-enable when Notion OAuth is properly configured
  // useEffect(() => {
  //   checkNotionStatus()
  // }, [])

  // Check URL params for OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('auth') === 'notion') {
      setShowNotionAuth(true)
    }
  }, [])

  const checkNotionStatus = async () => {
    try {
      const status = await getNotionStatus()
      setNotionStatus(status)
    } catch (err) {
      console.error('Failed to check Notion status:', err)
    }
  }

  const handleNotionConnect = async () => {
    setIsLoadingNotion(true)
    try {
      await connectNotion()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Notion')
    } finally {
      setIsLoadingNotion(false)
    }
  }

  const handleNotionDisconnect = async () => {
    try {
      await disconnectNotion()
      setNotionStatus({ connected: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect from Notion')
    }
  }

  const isNotionUrl = (url: string) => {
    return url.includes('notion.so') || url.includes('notion.site')
  }

  const handleParse = async () => {
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }

    // Check if Notion URL and not authenticated
    if (isNotionUrl(url) && !notionStatus?.connected) {
      setShowNotionAuth(true)
      return
    }

    setIsLoading(true)
    setError(null)
    setParseResult(null)
    setImportSuccess(false)

    try {
      const result = await parseUrl(url)
      setParseResult(result)

      // Auto-select first project if available
      if (projects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(Number(projects[0].id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse URL')

      // Check if error is related to authentication
      if (err instanceof Error && isNotionUrl(url) && err.message.toLowerCase().includes('auth')) {
        setShowNotionAuth(true)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleImport = async () => {
    if (!parseResult || !selectedProjectId) {
      setError('Please select a target project')
      return
    }

    // If no table selected and no new table name, use parsed title or default
    const tableName = targetTableId ? undefined : (newTableName || parseResult.title || 'Imported Data')

    setIsImporting(true)
    setError(null)

    try {
      await importData({
        url: parseResult.url,
        project_id: selectedProjectId,
        table_id: targetTableId || undefined,
        table_name: tableName,
        table_description: `Imported from ${parseResult.source_type}`,
      })

      setImportSuccess(true)

      // Reset after 2 seconds
      setTimeout(() => {
        setUrl('')
        setParseResult(null)
        setTargetTableId(null)
        setNewTableName('')
        setImportSuccess(false)
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import data')
    } finally {
      setIsImporting(false)
    }
  }

  const selectedProject = projects.find(p => Number(p.id) === selectedProjectId)

  return (
    <>
      {/* Dark scrollbar styles for preview area */}
      <style>{`
        /* For Chrome, Safari, Edge */
        .connect-preview-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-track {
          background: #0a0a0a;
          border-radius: 4px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 4px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        /* For Firefox */
        .connect-preview-scrollbar {
          scrollbar-color: #404040 #0a0a0a;
          scrollbar-width: thin;
        }
      `}</style>
      
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}>
      {/* Header */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom: '1px solid #262626',
        gap: 12,
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            color: '#6D7177',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2C2C2C'
            e.currentTarget.style.color = '#CDCDCD'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#6D7177'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize: 13, color: '#CDCDCD', fontWeight: 500 }}>Connect</span>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 20,
      }}>
        <div style={{
          maxWidth: 760,
          margin: '0 auto',
        }}>
          {/* SaaS Platforms */}
          <div style={{
            background: '#111111',
            border: '1px solid #2a2a2a',
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#8B8B8B',
              marginBottom: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Supported Platforms
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}>
              {saasPlat.map((platform) => {
                const isConnected = platform.id === 'notion' && notionStatus?.connected
                const isExpanded = expandedPlatform === platform.id
                const isClickable = platform.status === 'supported'

                return (
                  <div
                    key={platform.id}
                    onClick={() => {
                      if (isClickable) {
                        setExpandedPlatform(isExpanded ? null : platform.id)
                      }
                    }}
                    style={{
                      background: isExpanded ? '#1f1f1f' : '#1a1a1a',
                      border: `1px solid ${isExpanded ? '#404040' : platform.status === 'supported' ? '#3a3a3a' : '#2a2a2a'}`,
                      borderRadius: 6,
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      position: 'relative',
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      color: platform.status === 'supported' ? '#CDCDCD' : '#5D6065',
                      opacity: platform.status === 'coming-soon' ? 0.5 : 1,
                    }}>
                      {platform.icon}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: platform.status === 'supported' ? '#CDCDCD' : '#5D6065',
                        marginBottom: 2,
                      }}>
                        {platform.name}
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: '#8B8B8B',
                      }}>
                        {platform.status === 'supported' ? platform.description : 'Coming soon'}
                      </div>
                    </div>

                    {/* Expand/collapse indicator for supported platforms */}
                    {isClickable && (
                      <svg 
                        width="12" 
                        height="12" 
                        viewBox="0 0 12 12" 
                        fill="none"
                        style={{
                          color: '#5D6065',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}
                      >
                        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notion URL Input Panel - shown when Notion card is expanded */}
          {expandedPlatform === 'notion' && (
            <div style={{
              background: '#111111',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: 20,
              marginBottom: 16,
              marginTop: -8,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Notion URL
              </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading) {
                    handleParse()
                  }
                }}
                placeholder="https://yourworkspace.notion.so/page-id..."
                disabled={isLoading || isImporting}
                style={{
                  flex: 1,
                  background: '#0a0a0a',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                  color: '#CDCDCD',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#404040'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#2a2a2a'}
              />

              <button
                onClick={handleParse}
                disabled={isLoading || isImporting || !url.trim()}
                style={{
                  background: isLoading || isImporting || !url.trim() ? '#1a1a1a' : '#2a2a2a',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: isLoading || isImporting || !url.trim() ? '#505050' : '#CDCDCD',
                  cursor: isLoading || isImporting || !url.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isLoading && !isImporting && url.trim()) {
                    e.currentTarget.style.background = '#353535'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isLoading && !isImporting && url.trim()) {
                    e.currentTarget.style.background = '#2a2a2a'
                  }
                }}
              >
                {isLoading ? 'Parsing...' : 'Parse'}
              </button>
            </div>

            <div style={{
              fontSize: 11,
              color: '#5D6065',
              marginTop: 10,
            }}>
              Paste a Notion page URL to import its content
            </div>

          {/* Notion Auth Modal */}
          {showNotionAuth && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}>
              <div style={{
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: 8,
                padding: 24,
                maxWidth: 400,
                width: '90%',
              }}>
                <h3 style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#CDCDCD',
                  marginBottom: 12,
                }}>
                  Connect Notion Account
                </h3>

                <p style={{
                  fontSize: 13,
                  color: '#8B8B8B',
                  marginBottom: 20,
                  lineHeight: 1.5,
                }}>
                  This Notion page requires authorization. Please connect your Notion account to access private content.
                </p>

                <div style={{
                  display: 'flex',
                  gap: 10,
                }}>
                  <button
                    onClick={() => setShowNotionAuth(false)}
                    style={{
                      flex: 1,
                      background: '#2a2a2a',
                      border: '1px solid #3a3a3a',
                      borderRadius: 6,
                      padding: '8px 16px',
                      fontSize: 13,
                      color: '#CDCDCD',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={() => {
                      setShowNotionAuth(false)
                      handleNotionConnect()
                    }}
                    style={{
                      flex: 1,
                      background: '#2a2a2a',
                      border: '1px solid #404040',
                      borderRadius: 6,
                      padding: '8px 16px',
                      fontSize: 13,
                      color: '#CDCDCD',
                      cursor: 'pointer',
                    }}
                  >
                    Connect Notion
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              background: '#2a1a1a',
              border: '1px solid #4a2a2a',
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
            }}>
              <div style={{
                fontSize: 12,
                color: '#f87171',
                marginBottom: 4,
              }}>
                Error
              </div>
              <div style={{
                fontSize: 13,
                color: '#b91c1c',
              }}>
                {error}
              </div>
            </div>
          )}

          {/* Parse Result */}
          {parseResult && (
            <div style={{
              background: '#111111',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: 20,
              marginBottom: 16,
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Preview - {parseResult.title}
              </div>

              {/* Source Info */}
              <div style={{
                display: 'flex',
                gap: 16,
                marginBottom: 16,
                fontSize: 12,
                color: '#8B8B8B',
              }}>
                <span>Source: {parseResult.source_type}</span>
                <span>Items: {parseResult.total_items}</span>
                <span>Structure: {parseResult.data_structure}</span>
              </div>

              {/* Sample Data */}
              {parseResult.sample_data && parseResult.sample_data.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#8B8B8B',
                    marginBottom: 8,
                  }}>
                    Sample Data ({parseResult.sample_data.length} items)
                  </div>

                  <div 
                    className="connect-preview-scrollbar"
                    style={{
                      background: '#0a0a0a',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      padding: 12,
                      fontSize: 11,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}>
                    <pre style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      color: '#CDCDCD',
                    }}>
                      {JSON.stringify(parseResult.sample_data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Fields */}
              {parseResult.fields && parseResult.fields.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#8B8B8B',
                    marginBottom: 8,
                  }}>
                    Detected Fields
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 8,
                  }}>
                    {parseResult.fields.map((field, index) => (
                      <div
                        key={index}
                        style={{
                          background: '#0a0a0a',
                          border: '1px solid #2a2a2a',
                          borderRadius: 4,
                          padding: '6px 8px',
                          fontSize: 11,
                        }}
                      >
                        <div style={{
                          fontWeight: 500,
                          color: '#CDCDCD',
                          marginBottom: 2,
                        }}>
                          {field.name}
                        </div>
                        <div style={{
                          color: '#8B8B8B',
                          fontSize: 10,
                        }}>
                          {field.type}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import Settings */}
          {parseResult && (
            <div style={{
              background: '#111111',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: 20,
              marginBottom: 16,
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Import Settings
              </div>

              {/* Project Selection */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#CDCDCD',
                  marginBottom: 8,
                }}>
                  Target Project
                </div>

                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  disabled={isImporting}
                  style={{
                    width: '100%',
                    background: '#0a0a0a',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 13,
                    color: '#CDCDCD',
                    outline: 'none',
                  }}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Table Name */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#CDCDCD',
                  marginBottom: 8,
                }}>
                  Table Name
                </div>

                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder={parseResult.title || 'Imported Data'}
                  disabled={isImporting}
                  style={{
                    width: '100%',
                    background: '#0a0a0a',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 13,
                    color: '#CDCDCD',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Import Button */}
              <button
                onClick={handleImport}
                disabled={isImporting || !selectedProjectId}
                style={{
                  width: '100%',
                  background: isImporting || !selectedProjectId ? '#1a1a1a' : '#2a2a2a',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: isImporting || !selectedProjectId ? '#505050' : '#CDCDCD',
                  cursor: isImporting || !selectedProjectId ? 'not-allowed' : 'pointer',
                }}
              >
                {isImporting ? 'Importing...' : `Import ${parseResult.total_items} items`}
              </button>
            </div>
          )}

          {/* Success Message */}
          {importSuccess && (
            <div style={{
              background: '#1a2a1a',
              border: '1px solid #2a4a2a',
              borderRadius: 6,
              padding: 16,
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: 14,
                color: '#10b981',
                marginBottom: 4,
              }}>
                Import Successful!
              </div>
              <div style={{
                fontSize: 12,
                color: '#8B8B8B',
              }}>
                Data has been imported to your project
              </div>
            </div>
          )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}