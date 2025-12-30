'use client'

import { useState, useMemo } from 'react'
import { createBindings, deleteBinding, updateMcpInstance } from '../../../lib/mcpApi'
import { ToolsTable, ToolsEmptyState, FONT, TOOL_TYPE_CONFIG, type ToolItem } from './ToolsTable'

// Header 高度 (包含 border)
const HEADER_HEIGHT = 45

export function ServerView({ server, allTools, onDeleteServer, onRefresh }: any) {
  if (!server) return <div style={{ padding: 40, color: '#3f3f46', textAlign: 'center', fontSize: FONT.primary }}>Server not found</div>

  const [showAddTools, setShowAddTools] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'json' | 'yaml'>('json')
  const [copied, setCopied] = useState(false)
  
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(server.name || '')
  const [savingName, setSavingName] = useState(false)

  const handleRemoveTool = async (toolId: number) => {
    try {
      await deleteBinding(server.api_key, toolId)
      onRefresh()
    } catch (e) {
      console.error(e)
    }
  }

  const handleAddTools = async (toolIds: number[]) => {
    try {
      const bindings = toolIds.map(id => ({ tool_id: id, status: true }))
      await createBindings(server.api_key, bindings)
      setShowAddTools(false)
      onRefresh()
    } catch (e) {
      console.error(e)
    }
  }

  // 转换为 ToolItem 格式
  const boundTools: ToolItem[] = server.boundTools.map((t: any) => ({
    id: t.tool_id,
    tool_id: t.tool_id,
    name: t.name,
    type: t.type,
    description: t.description,
  }))

  const boundToolIds = new Set(server.boundTools.map((t: any) => t.tool_id))
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
      {/* Header - 45px + 1px border = 46px total */}
      <div style={{
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
        padding: '0 24px',
        borderBottom: '1px solid #1a1a1c',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        boxSizing: 'content-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                autoFocus
                style={{
                  height: 28,
                  background: '#0a0a0c',
                  border: '1px solid #3b82f6',
                  borderRadius: 5,
                  padding: '0 10px',
                  fontSize: FONT.primary,
                  fontWeight: 500,
                  color: '#e2e8f0',
                  outline: 'none',
                  width: 180,
                }}
              />
              <button onClick={handleSaveName} disabled={savingName} style={{ fontSize: FONT.secondary, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>
                {savingName ? '...' : 'Save'}
              </button>
              <button onClick={() => setEditingName(false)} style={{ fontSize: FONT.secondary, color: '#525252', background: 'none', border: 'none', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          ) : (
            <span 
              onClick={() => { setEditingName(true); setNameValue(server.name || '') }}
              style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0', cursor: 'text' }}
            >
              {server.name || 'Unnamed Server'}
            </span>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            borderRadius: 4,
            background: server.status ? 'rgba(34,197,94,0.1)' : 'rgba(113,113,122,0.1)',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: server.status ? '#22c55e' : '#3f3f46',
            }} />
            <span style={{ fontSize: FONT.tertiary, color: server.status ? '#4ade80' : '#525252' }}>
              {server.status ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            style={{
              height: 28,
              padding: '0 12px',
              fontSize: FONT.secondary,
              color: '#71717a',
              background: 'transparent',
              border: '1px solid #27272a',
              borderRadius: 5,
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#e2e8f0' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#27272a'; e.currentTarget.style.color = '#71717a' }}
          >
            {server.status ? 'Stop' : 'Start'}
          </button>
          <button
            onClick={() => onDeleteServer(server.api_key)}
            style={{
              height: 28,
              padding: '0 12px',
              fontSize: FONT.secondary,
              color: '#f87171',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: 5,
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        
        {/* Tools Section */}
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '14px 24px 8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: FONT.secondary, fontWeight: 600, color: '#525252' }}>
                Included Tools
              </span>
              <span style={{ fontSize: FONT.tertiary, color: '#3f3f46' }}>
                {boundTools.length}
              </span>
            </div>
            <button 
              onClick={() => setShowAddTools(true)}
              style={{ 
                fontSize: FONT.secondary, 
                color: '#60a5fa', 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M7 3v8M3 7h8"/>
              </svg>
              Add
            </button>
          </div>

          {boundTools.length === 0 ? (
            <div style={{ padding: '0 24px' }}>
              <ToolsEmptyState 
                message="No tools included" 
                actionLabel="Add tools from library"
                onAction={() => setShowAddTools(true)}
              />
            </div>
          ) : (
            <ToolsTable
              tools={boundTools}
              showPath={false}
              selectable={false}
              onRemove={handleRemoveTool}
              removeIcon="remove"
            />
          )}
        </div>

        {/* Configuration Section */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: FONT.secondary, fontWeight: 600, color: '#525252' }}>
              Configuration
            </span>
          </div>

          <div style={{
            background: '#0a0a0c',
            border: '1px solid #141416',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              borderBottom: '1px solid #111113',
            }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {(['json', 'yaml'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '4px 10px',
                      fontSize: FONT.tertiary,
                      fontWeight: 500,
                      color: activeTab === tab ? '#a1a1aa' : '#3f3f46',
                      background: activeTab === tab ? '#141416' : 'transparent',
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
                  padding: '4px 10px',
                  fontSize: FONT.tertiary,
                  fontWeight: 500,
                  color: copied ? '#4ade80' : '#3f3f46',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {copied ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            
            <pre style={{
              margin: 0,
              padding: '14px 16px',
              fontSize: FONT.secondary,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: '#525252',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 180,
              overflow: 'auto',
            }}>
              {configText}
            </pre>
          </div>

          <div style={{ 
            marginTop: 12, 
            padding: '10px 12px', 
            background: 'rgba(59, 130, 246, 0.04)', 
            borderRadius: 6,
            border: '1px solid rgba(59, 130, 246, 0.08)',
          }}>
            <div style={{ fontSize: FONT.secondary, color: '#3b82f6', fontWeight: 500, marginBottom: 4 }}>
              How to use
            </div>
            <div style={{ fontSize: FONT.secondary, color: '#525252', lineHeight: 1.5 }}>
              Copy and paste into your Claude Desktop or Cursor settings file.
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
