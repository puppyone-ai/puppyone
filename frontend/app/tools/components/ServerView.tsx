'use client'

import { useState, useMemo, useEffect } from 'react'
import { createBindings, deleteBinding, updateMcpInstance } from '../../../lib/mcpApi'
import { useBoundTools, refreshToolsAndMcp } from '../../../lib/hooks/useData'
import { ToolsTable, ToolsEmptyState, FONT, TOOL_TYPE_CONFIG, type ToolItem } from './ToolsTable'

// Header 高度 (包含 border)
const HEADER_HEIGHT = 45

export function ServerView({ server, allTools, onDeleteServer, onRefresh }: any) {
  if (!server) return <div style={{ padding: 40, color: '#3f3f46', textAlign: 'center', fontSize: FONT.primary }}>Server not found</div>

  // 懒加载 bound tools（只有选中这个 server 时才请求）
  const { boundTools: rawBoundTools, isLoading: boundToolsLoading, refresh: refreshBoundTools } = useBoundTools(server.api_key)

  const [showAddTools, setShowAddTools] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'json' | 'yaml'>('json')
  const [copied, setCopied] = useState(false)
  
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(server.name || '')
  const [savingName, setSavingName] = useState(false)

  // 当 server 变化时重置 nameValue
  useEffect(() => {
    setNameValue(server.name || '')
  }, [server.name])

  const handleRemoveTool = async (toolId: number) => {
    try {
      await deleteBinding(server.api_key, toolId)
      refreshBoundTools()
    } catch (e) {
      console.error(e)
    }
  }

  const handleAddTools = async (toolIds: number[]) => {
    try {
      const bindings = toolIds.map(id => ({ tool_id: id, status: true }))
      await createBindings(server.api_key, bindings)
      setShowAddTools(false)
      refreshBoundTools()
    } catch (e) {
      console.error(e)
    }
  }

  // 转换为 ToolItem 格式
  const boundTools: ToolItem[] = rawBoundTools.map((t: any) => ({
    id: t.tool_id,
    tool_id: t.tool_id,
    name: t.name,
    type: t.type,
    description: t.description,
  }))

  const boundToolIds = new Set(rawBoundTools.map((t: any) => t.tool_id))
  const availableTools = allTools.filter((t: any) => !boundToolIds.has(t.id))
  const filteredAvailableTools = availableTools.filter((t: any) => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const mcpUrl = `${API_BASE_URL}/api/v1/mcp/server/${server.api_key}`
  const serverName = nameValue || server.name || 'unnamed-server'

  const configText = useMemo(() => {
    if (activeTab === 'json') {
      return JSON.stringify({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["-y", "mcp-remote", mcpUrl],
            env: {}
          }
        }
      }, null, 2)
    }
    return `mcpServers:
  ${serverName}:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
    env: {}`
  }, [activeTab, serverName, mcpUrl])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSaveName = async () => {
    if (!nameValue.trim()) return
    setSavingName(true)
    try {
      await updateMcpInstance(server.api_key, { name: nameValue.trim() })
      setEditingName(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to update name:', error)
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Empty Header */}
      <div style={{
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
        borderBottom: '1px solid #1a1a1c',
        flexShrink: 0,
        boxSizing: 'content-box',
      }} />

      {/* Main Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* Server Title Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {editingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                  autoFocus
                  style={{
                    height: 36,
                    background: '#0a0a0c',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    padding: '0 12px',
                    fontSize: 20,
                    fontWeight: 600,
                    color: '#e2e8f0',
                    outline: 'none',
                    width: 280,
                  }}
                />
                <span 
                  onClick={handleSaveName} 
                  style={{ fontSize: FONT.secondary, color: '#a1a1aa', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
                  onMouseLeave={e => e.currentTarget.style.color = '#a1a1aa'}
                >
                  {savingName ? '...' : 'Save'}
                </span>
                <span 
                  onClick={() => setEditingName(false)} 
                  style={{ fontSize: FONT.secondary, color: '#525252', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#71717a'}
                  onMouseLeave={e => e.currentTarget.style.color = '#525252'}
                >
                  Cancel
                </span>
              </div>
            ) : (
              <>
                <span 
                  onClick={() => { setEditingName(true); setNameValue(server.name || '') }}
                  style={{ fontSize: 20, fontWeight: 600, color: '#e2e8f0', cursor: 'text' }}
                >
                  {server.name || 'Unnamed Server'}
                </span>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: server.status ? '#22c55e' : '#3f3f46',
                }} />
                <span
                  onClick={() => onDeleteServer(server.api_key)}
                  style={{ fontSize: FONT.secondary, color: '#525252', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = '#525252'}
                >
                  Delete
                </span>
              </>
            )}
          </div>
        </div>
        
        {/* Tools Section Card */}
        <div style={{
          background: '#0f0f11',
          borderRadius: 10,
          border: '1px solid #1a1a1c',
          overflow: 'hidden',
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '12px 16px',
            borderBottom: '1px solid #141416',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: FONT.secondary, fontWeight: 600, color: '#a1a1aa' }}>
                Included Tools
              </span>
              <span style={{ 
                fontSize: FONT.tertiary, 
                color: '#3f3f46',
                background: '#1a1a1c',
                padding: '2px 6px',
                borderRadius: 4,
              }}>
                {boundToolsLoading ? '...' : boundTools.length}
              </span>
            </div>
            <span 
              onClick={() => setShowAddTools(true)}
              style={{ 
                fontSize: FONT.secondary, 
                color: '#525252', 
                cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
              onMouseLeave={e => e.currentTarget.style.color = '#525252'}
            >
              Add
            </span>
          </div>

          {boundToolsLoading ? (
            <div style={{ padding: '24px 16px', color: '#525252', fontSize: FONT.secondary, textAlign: 'center' }}>
              Loading tools...
            </div>
          ) : boundTools.length === 0 ? (
            <div style={{ padding: '16px' }}>
              <ToolsEmptyState 
                message="No tools included" 
                actionLabel="Add tools from library"
                onAction={() => setShowAddTools(true)}
              />
            </div>
          ) : (
            <div style={{ padding: '0' }}>
              <ToolsTable
                tools={boundTools}
                showPath={false}
                selectable={false}
                onRemove={handleRemoveTool}
                removeIcon="remove"
              />
            </div>
          )}
        </div>

        {/* API Key Row */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10,
          padding: '10px 16px',
          background: '#0f0f11',
          borderRadius: 8,
          border: '1px solid #1a1a1c',
        }}>
          <span style={{ fontSize: FONT.secondary, color: '#525252' }}>API Key</span>
          <code style={{ 
            flex: 1,
            fontSize: FONT.secondary, 
            color: '#71717a', 
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {server.api_key}
          </code>
          <span
            onClick={() => { navigator.clipboard.writeText(server.api_key); }}
            style={{ fontSize: FONT.secondary, color: '#525252', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
            onMouseLeave={e => e.currentTarget.style.color = '#525252'}
          >
            Copy
          </span>
        </div>

        {/* Configuration Section Card */}
        <div style={{
          background: '#0f0f11',
          borderRadius: 10,
          border: '1px solid #1a1a1c',
          overflow: 'hidden',
        }}>
          <div style={{ 
            padding: '12px 16px', 
            borderBottom: '1px solid #141416',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: FONT.secondary, fontWeight: 600, color: '#a1a1aa' }}>
              Configuration
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 2, background: '#0a0a0c', borderRadius: 5, padding: 2 }}>
                {(['json', 'yaml'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '4px 10px',
                      fontSize: FONT.tertiary,
                      fontWeight: 500,
                      color: activeTab === tab ? '#e2e8f0' : '#525252',
                      background: activeTab === tab ? '#1a1a1c' : 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                onClick={handleCopy}
                style={{
                  height: 26,
                  padding: '0 10px',
                  fontSize: FONT.tertiary,
                  fontWeight: 500,
                  color: copied ? '#4ade80' : '#525252',
                  background: copied ? 'rgba(34,197,94,0.1)' : '#0a0a0c',
                  border: 'none',
                  borderRadius: 5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {copied ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
          
          <pre style={{
            margin: 0,
            padding: '14px 16px',
            fontSize: FONT.secondary,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            color: '#71717a',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 200,
            overflow: 'auto',
            background: '#0a0a0c',
          }}>
            {configText}
          </pre>

          <div style={{ 
            padding: '12px 16px', 
            background: 'rgba(59, 130, 246, 0.03)', 
            borderTop: '1px solid #141416',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ marginTop: 2, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            <div>
              <div style={{ fontSize: FONT.secondary, color: '#60a5fa', fontWeight: 500, marginBottom: 2 }}>
                How to use
              </div>
              <div style={{ fontSize: FONT.secondary, color: '#525252', lineHeight: 1.5 }}>
                Copy and paste into your Claude Desktop or Cursor settings file.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Tools Modal */}
      {showAddTools && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            backdropFilter: 'blur(2px)',
          }}
          onClick={() => setShowAddTools(false)}
        >
          <div
            style={{
              background: '#0a0a0c',
              border: '1px solid #141416',
              borderRadius: 10,
              width: 520,
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #141416' }}>
              <div style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>
                Add Tools
              </div>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#111113',
                  border: '1px solid #1a1a1c',
                  borderRadius: 6,
                  color: '#e2e8f0',
                  fontSize: FONT.primary,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr 1fr 60px',
              padding: '8px 16px',
              borderBottom: '1px solid #111113',
              fontSize: FONT.tertiary,
              fontWeight: 500,
              color: '#3f3f46',
              textTransform: 'uppercase',
            }}>
              <div>Type</div>
              <div>Name</div>
              <div>Description</div>
              <div></div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredAvailableTools.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#3f3f46', fontSize: FONT.primary }}>
                  {searchQuery ? 'No matching tools' : 'All tools already added'}
                </div>
              ) : (
                filteredAvailableTools.map((t: any) => {
                  const typeConfig = TOOL_TYPE_CONFIG[t.type] || { label: t.type?.toUpperCase() || 'TOOL', color: '#71717a', bg: 'rgba(113,113,122,0.15)' }
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '70px 1fr 1fr 60px',
                        padding: '10px 16px',
                        alignItems: 'center',
                        borderBottom: '1px solid #0f0f11',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#0f0f11'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: FONT.tertiary,
                          fontWeight: 600,
                          color: typeConfig.color,
                          background: typeConfig.bg,
                        }}>
                          {typeConfig.label}
                        </span>
                      </div>

                      <div style={{
                        fontSize: FONT.primary,
                        fontWeight: 500,
                        color: '#e2e8f0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        paddingRight: 12,
                      }}>
                        {t.name}
                      </div>

                      <div style={{
                        fontSize: FONT.secondary,
                        color: '#525252',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        paddingRight: 12,
                      }}>
                        {t.description || '—'}
                      </div>

                      <div>
                        <button
                          onClick={() => handleAddTools([t.id])}
                          style={{
                            height: 24,
                            padding: '0 10px',
                            fontSize: FONT.tertiary,
                            fontWeight: 500,
                            color: '#60a5fa', 
                            background: 'transparent', 
                            border: '1px solid rgba(59,130,246,0.25)',
                            borderRadius: 4,
                            cursor: 'pointer', 
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; e.currentTarget.style.borderColor = '#60a5fa' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid #141416', textAlign: 'right' }}>
              <button
                onClick={() => setShowAddTools(false)}
                style={{ fontSize: FONT.secondary, color: '#e2e8f0', background: '#1a1a1c', border: 'none', borderRadius: 5, padding: '6px 14px', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
