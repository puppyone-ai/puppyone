'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpInstanceInfo } from './McpInstanceInfo'
import { treePathToJsonPointer } from '../lib/jsonPointer'

interface ConnectPanelProps {
  projectId?: string
  tableId?: string
  currentTreePath?: string | null
  onCloseOtherMenus?: () => void
  onTargetPathChange?: (path: string | null) => void
}

type ActiveTab = 'access' | 'configure'

export function ConnectPanel({ 
  projectId, 
  tableId, 
  currentTreePath, 
  onCloseOtherMenus,
  onTargetPathChange 
}: ConnectPanelProps) {
  const { userId, session } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('access')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  
  // MCP Configuration state (from original McpBar)
  const [readCapabilities, setReadCapabilities] = useState({
    get_all: true,
    vector_retrieve: false,
    llm_retrieve: false,
  })
  const [writeCapabilities, setWriteCapabilities] = useState({
    create_element: false,
    update_element: false,
    delete_element: false,
  })
  const [usePathScope, setUsePathScope] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [mcpResult, setMcpResult] = useState<{ apiKey: string; url: string; port: number } | null>(null)
  const [menuPosition, setMenuPosition] = useState<'center' | 'right'>('center')

  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const mcpEndpoint = `mcp://${apiBaseUrl.replace(/^https?:\/\//, '')}/mcp`
  const restEndpoint = tableId 
    ? `${apiBaseUrl}/api/v1/projects/${projectId}/tables/${tableId}`
    : `${apiBaseUrl}/api/v1/projects/${projectId}`

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
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

  // Calculate menu position to prevent overflow
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const menuWidth = 340
      const rightEdge = buttonRect.left + buttonRect.width / 2 + menuWidth / 2
      const viewportWidth = window.innerWidth
      
      if (rightEdge > viewportWidth - 16) {
        setMenuPosition('right')
      } else {
        setMenuPosition('center')
      }
    }
  }, [isOpen])

  // Notify parent when path scope changes
  useEffect(() => {
    if (usePathScope && currentTreePath) {
      onTargetPathChange?.(currentTreePath)
    } else {
      onTargetPathChange?.(null)
    }
  }, [usePathScope, currentTreePath, onTargetPathChange])

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  const handleCreateMcp = async () => {
    if (!userId || !projectId) {
      alert(`Missing user ID or project ID\nuserId: ${userId || 'undefined'}\nprojectId: ${projectId || 'undefined'}`)
      return
    }

    const selectedMethods = [
      ...(readCapabilities.get_all || readCapabilities.vector_retrieve || readCapabilities.llm_retrieve ? ['get_all'] : []),
      ...(writeCapabilities.create_element ? ['create_element'] : []),
      ...(writeCapabilities.update_element ? ['update_element'] : []),
      ...(writeCapabilities.delete_element ? ['delete_element'] : []),
    ]

    if (selectedMethods.length === 0) {
      alert('Please select at least one capability')
      return
    }

    setIsCreating(true)
    try {
      const toolsDefinition: any = {}
      if (readCapabilities.get_all || readCapabilities.vector_retrieve || readCapabilities.llm_retrieve) {
        toolsDefinition['get'] = {
          tool_name: 'get_context',
          tool_desc_template: 'Get context. Project: {project_name}',
          tool_desc_parameters: [{ project_name: projectId }]
        }
      }
      if (writeCapabilities.create_element) {
        toolsDefinition['create'] = {
          tool_name: 'create_element',
          tool_desc_template: 'Create element. Project: {project_name}',
          tool_desc_parameters: [{ project_name: projectId }]
        }
      }
      if (writeCapabilities.update_element) {
        toolsDefinition['update'] = {
          tool_name: 'update_element',
          tool_desc_template: 'Update element. Project: {project_name}',
          tool_desc_parameters: [{ project_name: projectId }]
        }
      }
      if (writeCapabilities.delete_element) {
        toolsDefinition['delete'] = {
          tool_name: 'delete_element',
          tool_desc_template: 'Delete element. Project: {project_name}',
          tool_desc_parameters: [{ project_name: projectId }]
        }
      }

      const requestBody: any = {
        user_id: userId,
        project_id: projectId,
        context_id: tableId || projectId,
        tools_definition: Object.keys(toolsDefinition).length > 0 ? toolsDefinition : undefined
      }

      if (usePathScope && currentTreePath && currentTreePath !== '') {
        const jsonPointer = treePathToJsonPointer(currentTreePath)
        requestBody.json_pointer = jsonPointer
      }

      const response = await fetch(`${apiBaseUrl}/api/v1/mcp/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()
      if (data.code === 0) {
        const apiKey = data.data.api_key
        const url = data.data.url
        const portMatch = url.match(/localhost:(\d+)/)
        const port = portMatch ? parseInt(portMatch[1]) : 0
        setMcpResult({ apiKey, url, port })
        setActiveTab('access') // Switch to access tab to show result
      } else {
        alert('Failed to create MCP instance: ' + data.message)
      }
    } catch (e) {
      console.error(e)
      alert('Error creating MCP instance')
    } finally {
      setIsCreating(false)
    }
  }

  const hasAnyReadCapability = readCapabilities.get_all || readCapabilities.vector_retrieve || readCapabilities.llm_retrieve
  const hasAnyWriteCapability = writeCapabilities.create_element || writeCapabilities.update_element || writeCapabilities.delete_element

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
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
          borderColor: isOpen ? '#22c55e' : '#404040',
          background: isOpen ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
          color: isOpen ? '#22c55e' : '#9ca3af',
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
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        <span>Publish</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            ...(menuPosition === 'center' 
              ? { left: '50%', transform: 'translateX(-50%)' }
              : { right: 0 }
            ),
            width: 340,
            background: '#161618',
            border: '1px solid #2a2a2a',
            borderRadius: 12,
            zIndex: 100,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden',
          }}
        >
          {/* Tabs */}
          <div style={{ 
            display: 'flex', 
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.2)',
          }}>
            <button
              onClick={() => setActiveTab('access')}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'access' ? '2px solid #34d399' : '2px solid transparent',
                color: activeTab === 'access' ? '#e2e8f0' : '#6b7280',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Access
            </button>
            <button
              onClick={() => setActiveTab('configure')}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'configure' ? '2px solid #34d399' : '2px solid transparent',
                color: activeTab === 'configure' ? '#e2e8f0' : '#6b7280',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Configure
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: 14 }}>
            {activeTab === 'access' ? (
              /* Access Tab */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mcpResult ? (
                  /* Show MCP Result */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>✓</span>
                      <span>MCP Instance Created</span>
                    </div>
                    <McpInstanceInfo
                      apiKey={mcpResult.apiKey}
                      url={mcpResult.url}
                      port={mcpResult.port}
                    />
                    <button
                      onClick={() => setMcpResult(null)}
                      style={{
                        height: 32,
                        borderRadius: 6,
                        border: '1px solid #333',
                        background: '#1a1a1a',
                        color: '#9ca3af',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Create Another
                    </button>
                  </div>
                ) : (
                  /* Show Endpoints */
                  <>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>
                      Publish to Agents
                    </div>

                    {/* MCP Endpoint */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={tagStyle('#34d399')}>MCP</span>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>Claude Desktop / Cursor</span>
                      </div>
                      <div style={endpointBoxStyle}>
                        <code style={{ flex: 1, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {mcpEndpoint}
                        </code>
                        <button onClick={() => handleCopy(mcpEndpoint, 'mcp')} style={copyBtnStyle(copiedField === 'mcp')}>
                          {copiedField === 'mcp' ? '✓' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    {/* REST Endpoint */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={tagStyle('#60a5fa')}>REST</span>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>n8n / Custom Agent</span>
                      </div>
                      <div style={endpointBoxStyle}>
                        <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>GET</span>
                        <code style={{ flex: 1, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {restEndpoint}
                        </code>
                        <button onClick={() => handleCopy(`curl "${restEndpoint}"`, 'rest')} style={copyBtnStyle(copiedField === 'rest')}>
                          {copiedField === 'rest' ? '✓' : 'cURL'}
                        </button>
                      </div>
                    </div>

                    {/* Quick Tip */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '10px 12px',
                      background: 'rgba(251, 191, 36, 0.08)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#a3a3a3',
                      lineHeight: 1.5,
                      marginTop: 4,
                    }}>
                      <span style={{ color: '#fbbf24', flexShrink: 0 }}>💡</span>
                      <span>
                        For advanced capabilities (Semantic Search, Write Access), switch to <strong style={{ color: '#e2e8f0' }}>Configure</strong> tab.
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Configure Tab */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* READ Capabilities */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>READ INTERFACES</span>
                    <span style={{ fontSize: 12, color: '#525252', fontWeight: 400 }}>(Agent retrieves data)</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CapabilityRow
                      label="Standard Retrieval"
                      description="Full JSON access (get_all)"
                      enabled={readCapabilities.get_all}
                      onChange={(v) => setReadCapabilities(prev => ({ ...prev, get_all: v }))}
                    />
                    <CapabilityRow
                      label="Semantic Search"
                      description="Vector-based retrieval"
                      enabled={readCapabilities.vector_retrieve}
                      onChange={(v) => setReadCapabilities(prev => ({ ...prev, vector_retrieve: v }))}
                    />
                    <CapabilityRow
                      label="LLM Query"
                      description="Agentic retrieval"
                      enabled={readCapabilities.llm_retrieve}
                      onChange={(v) => setReadCapabilities(prev => ({ ...prev, llm_retrieve: v }))}
                    />
                  </div>
                </div>

                {/* WRITE Capabilities */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>WRITE INTERFACES</span>
                    <span style={{ fontSize: 12, color: '#525252', fontWeight: 400 }}>(Agent modifies data)</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CapabilityRow
                      label="Create Element"
                      description="Add new items"
                      enabled={writeCapabilities.create_element}
                      onChange={(v) => setWriteCapabilities(prev => ({ ...prev, create_element: v }))}
                      warning
                    />
                    <CapabilityRow
                      label="Update Element"
                      description="Modify existing items"
                      enabled={writeCapabilities.update_element}
                      onChange={(v) => setWriteCapabilities(prev => ({ ...prev, update_element: v }))}
                      warning
                    />
                    <CapabilityRow
                      label="Delete Element"
                      description="Remove items"
                      enabled={writeCapabilities.delete_element}
                      onChange={(v) => setWriteCapabilities(prev => ({ ...prev, delete_element: v }))}
                      warning
                    />
                  </div>
                </div>

                {/* Path Scope */}
                <div style={{ 
                  padding: '12px', 
                  background: 'rgba(0,0,0,0.3)', 
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      id="pathScope"
                      checked={usePathScope}
                      onChange={(e) => setUsePathScope(e.target.checked)}
                      disabled={!currentTreePath || currentTreePath === ''}
                      style={{
                        width: 14,
                        height: 14,
                        cursor: currentTreePath && currentTreePath !== '' ? 'pointer' : 'not-allowed',
                        accentColor: '#34d399',
                      }}
                    />
                    <label
                      htmlFor="pathScope"
                      style={{
                        fontSize: 13,
                        color: currentTreePath && currentTreePath !== '' ? '#e2e8f0' : '#525252',
                        cursor: currentTreePath && currentTreePath !== '' ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                      }}
                    >
                      Limit to Selected Path
                    </label>
                  </div>
                  {currentTreePath && currentTreePath !== '' ? (
                    <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 22 }}>
                      Target: <code style={{ color: '#34d399' }}>{currentTreePath}</code>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#525252', marginLeft: 22 }}>
                      Select a node in the tree to enable path scoping
                    </div>
                  )}
                </div>

                {/* Validation Messages */}
                {(!userId || !projectId) && (
                  <div style={{ fontSize: 12, color: '#f87171', padding: '8px 10px', background: 'rgba(248, 113, 113, 0.1)', borderRadius: 4 }}>
                    {!userId && 'Missing user ID. '}
                    {!projectId && 'Missing project ID.'}
                  </div>
                )}

                {/* Create Button */}
                <button
                  onClick={handleCreateMcp}
                  disabled={isCreating || (!hasAnyReadCapability && !hasAnyWriteCapability) || !userId || !projectId}
                  style={{
                    height: 38,
                    borderRadius: 6,
                    border: 'none',
                    background: isCreating || (!hasAnyReadCapability && !hasAnyWriteCapability) || !userId || !projectId 
                      ? '#374151' 
                      : '#34d399',
                    color: isCreating || (!hasAnyReadCapability && !hasAnyWriteCapability) || !userId || !projectId 
                      ? '#9ca3af' 
                      : '#000',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: isCreating || (!hasAnyReadCapability && !hasAnyWriteCapability) || !userId || !projectId 
                      ? 'not-allowed' 
                      : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {isCreating ? 'Creating MCP Instance...' : 'Create MCP Instance'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Helper Components
function CapabilityRow({ 
  label, 
  description, 
  enabled, 
  onChange, 
  warning = false 
}: { 
  label: string
  description: string
  enabled: boolean
  onChange: (enabled: boolean) => void
  warning?: boolean
}) {
  return (
    <div
      onClick={() => onChange(!enabled)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        background: enabled ? 'rgba(52, 211, 153, 0.08)' : 'transparent',
        border: '1px solid',
        borderColor: enabled ? 'rgba(52, 211, 153, 0.2)' : '#2a2a2a',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, color: enabled ? '#e2e8f0' : '#9ca3af', fontWeight: 500 }}>
            {label}
          </span>
          {warning && enabled && (
            <span style={{ fontSize: 12, color: '#fbbf24' }}>⚠️</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: '#525252' }}>{description}</span>
      </div>
      <div
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          background: enabled ? '#34d399' : '#333',
          position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: enabled ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </div>
    </div>
  )
}

// Style helpers
const tagStyle = (color: string): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 600,
  color: color,
  padding: '3px 6px',
  background: `${color}20`,
  borderRadius: 4,
})

const endpointBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.4)',
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', monospace",
}

const copyBtnStyle = (copied: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  background: copied ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255,255,255,0.08)',
  border: 'none',
  borderRadius: 4,
  color: copied ? '#34d399' : '#9ca3af',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'all 0.15s',
})

