'use client'

import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { McpInstance, McpToolDefinition, McpToolType, TOOL_INFO, updateMcpInstance } from '../lib/mcpApi'

interface McpInstanceInfoProps {
  instance: McpInstance
  onUpdate?: (updates: Partial<McpInstance>) => Promise<void>
}

export function McpInstanceInfo({ instance, onUpdate }: McpInstanceInfoProps) {
  const [activeTab, setActiveTab] = useState<'json' | 'yaml'>('json')
  const [copiedStates, setCopiedStates] = useState<{
    url: boolean
    config: boolean
  }>({
    url: false,
    config: false
  })
  
  // 内联编辑状态
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(instance.name || 'Unnamed Instance')
  const [savingName, setSavingName] = useState(false)
  
  const [editingTools, setEditingTools] = useState<Record<string, boolean>>({})
  const [toolsValues, setToolsValues] = useState<Record<string, McpToolDefinition>>(
    instance.tools_definition || {}
  )
  const [savingTool, setSavingTool] = useState<string | null>(null)

  // 保存name
  const handleSaveName = async () => {
    if (!onUpdate || !nameValue.trim()) return
    
    setSavingName(true)
    try {
      await updateMcpInstance(instance.api_key, { name: nameValue.trim() })
      setEditingName(false)
      if (onUpdate) {
        await onUpdate({ name: nameValue.trim() })
      }
    } catch (error) {
      console.error('Failed to update name:', error)
      alert('Failed to update name')
    } finally {
      setSavingName(false)
    }
  }

  // 保存工具定义
  const handleSaveTool = async (toolType: string) => {
    if (!onUpdate) return
    
    setSavingTool(toolType)
    try {
      const updatedToolsDef = {
        ...instance.tools_definition,
        [toolType]: toolsValues[toolType]
      }
      await updateMcpInstance(instance.api_key, { tools_definition: updatedToolsDef as any })
      setEditingTools(prev => ({ ...prev, [toolType]: false }))
      if (onUpdate) {
        await onUpdate({ tools_definition: updatedToolsDef as any })
      }
    } catch (error) {
      console.error('Failed to update tool:', error)
      alert('Failed to update tool definition')
    } finally {
      setSavingTool(null)
    }
  }

  const copyToClipboard = async (text: string, type: 'url' | 'config') => {
    await navigator.clipboard.writeText(text)
    setCopiedStates(prev => ({ ...prev, [type]: true }))
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [type]: false }))
    }, 2000)
  }

  // 使用 POST /api/v1/mcp 响应中的 url 字段
  // 如果 url 不存在（从列表获取的实例），则动态构建完整的 proxy URL
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const mcpUrl = instance.url || `${API_BASE_URL}/api/v1/mcp/server/${instance.api_key}`
  
  const config = {
    mcpServers: {
      [nameValue || 'unnamed-instance']: {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          mcpUrl
        ],
        env: {}
      }
    }
  }

  const customTheme = {
    ...vscDarkPlus,
    'code[class*="language-"]': {
      ...vscDarkPlus['code[class*="language-"]'],
      background: '#1a1a1a',
      color: '#9ca3af',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
      fontSize: '10px',
    },
    'pre[class*="language-"]': {
      ...vscDarkPlus['pre[class*="language-"]'],
      background: '#1a1a1a',
      color: '#9ca3af',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
      fontSize: '10px',
    },
  }

  const configText = activeTab === 'json' 
    ? JSON.stringify(config, null, 2)
    : `mcpServers:
  ${nameValue || 'unnamed-instance'}:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
    env: {}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Name (可编辑) */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500 }}>Instance Name</div>
          {!editingName && onUpdate && (
            <button
              onClick={() => setEditingName(true)}
              style={{
                background: 'transparent',
                border: '1px solid #374151',
                borderRadius: 3,
                color: '#6b7280',
                cursor: 'pointer',
                padding: '2px 6px',
                fontSize: 9,
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editingName ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              autoFocus
              style={{
                flex: 1,
                height: 28,
                background: '#1f1f1f',
                border: '1px solid #374151',
                borderRadius: 4,
                padding: '0 8px',
                fontSize: 11,
                color: '#fff',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || !nameValue.trim()}
              style={{
                height: 28,
                padding: '0 12px',
                background: '#34d399',
                border: 'none',
                borderRadius: 4,
                color: '#000',
                fontSize: 10,
                fontWeight: 600,
                cursor: savingName ? 'wait' : 'pointer',
              }}
            >
              {savingName ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setEditingName(false)
                setNameValue(instance.name || 'Unnamed Instance')
              }}
              style={{
                height: 28,
                padding: '0 12px',
                background: 'transparent',
                border: '1px solid #374151',
                borderRadius: 4,
                color: '#9ca3af',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{
            background: '#1f1f1f',
            borderRadius: 4,
            padding: '6px 8px',
            border: '1px solid #374151',
            fontSize: 12,
            color: '#EDEDED',
            fontWeight: 500,
          }}>
            {nameValue}
          </div>
        )}
      </div>

      {/* Registered Tools */}
      {instance.register_tools && instance.register_tools.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500, marginBottom: 6 }}>
            Registered Tools
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {instance.register_tools.map((toolType) => {
              const toolDef = toolsValues[toolType] || instance.tools_definition?.[toolType]
              const isEditing = editingTools[toolType]
              const isSaving = savingTool === toolType
              
              if (!toolDef) return null
              
              return (
                <div key={toolType} style={{
                  background: '#1f1f1f',
                  border: '1px solid #374151',
                  borderRadius: 4,
                  padding: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                      {TOOL_INFO[toolType as McpToolType]?.label || toolType}
                    </div>
                    {!isEditing && onUpdate && (
                      <button
                        onClick={() => setEditingTools(prev => ({ ...prev, [toolType]: true }))}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#6b7280',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: 9,
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={toolsValues[toolType]?.name || ''}
                        onChange={(e) => setToolsValues(prev => ({
                          ...prev,
                          [toolType]: { ...prev[toolType], name: e.target.value }
                        }))}
                        placeholder="Tool name"
                        style={{
                          width: '100%',
                          height: 24,
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: 3,
                          padding: '0 6px',
                          fontSize: 10,
                          color: '#fff',
                          outline: 'none',
                          marginBottom: 4,
                        }}
                      />
                      <input
                        type="text"
                        value={toolsValues[toolType]?.description || ''}
                        onChange={(e) => setToolsValues(prev => ({
                          ...prev,
                          [toolType]: { ...prev[toolType], description: e.target.value }
                        }))}
                        placeholder="Tool description"
                        style={{
                          width: '100%',
                          height: 24,
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: 3,
                          padding: '0 6px',
                          fontSize: 10,
                          color: '#fff',
                          outline: 'none',
                          marginBottom: 6,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleSaveTool(toolType)}
                          disabled={isSaving}
                          style={{
                            height: 24,
                            padding: '0 10px',
                            background: '#34d399',
                            border: 'none',
                            borderRadius: 3,
                            color: '#000',
                            fontSize: 9,
                            fontWeight: 600,
                            cursor: isSaving ? 'wait' : 'pointer',
                          }}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingTools(prev => ({ ...prev, [toolType]: false }))
                            setToolsValues(prev => ({
                              ...prev,
                              [toolType]: instance.tools_definition?.[toolType] || prev[toolType]
                            }))
                          }}
                          style={{
                            height: 24,
                            padding: '0 10px',
                            background: 'transparent',
                            border: '1px solid #374151',
                            borderRadius: 3,
                            color: '#9ca3af',
                            fontSize: 9,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, color: '#EDEDED', marginBottom: 3, fontWeight: 500 }}>
                        {toolDef.name}
                      </div>
                      <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1.4 }}>
                        {toolDef.description}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* URL */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500 }}>URL</div>
          <button
            onClick={() => copyToClipboard(mcpUrl, 'url')}
            style={{
              background: 'transparent',
              border: '1px solid #374151',
              borderRadius: 3,
              color: copiedStates.url ? '#34d399' : '#6b7280',
              cursor: 'pointer',
              padding: '2px 4px',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18
            }}
            title={copiedStates.url ? 'Copied!' : 'Copy'}
          >
            {copiedStates.url ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        </div>
        <div style={{
          background: '#1f1f1f',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid #374151'
        }}>
          <SyntaxHighlighter
            language="text"
            style={customTheme}
            customStyle={{
              margin: 0,
              padding: '4px 6px',
              fontSize: '9px',
              fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
              background: '#1f1f1f',
              wordBreak: 'break-all',
              overflowWrap: 'break-word',
              lineHeight: '1.3'
            }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {mcpUrl}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* MCP Config */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setActiveTab('json')}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeTab === 'json' ? '#3b82f6' : '#6b7280',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                fontWeight: activeTab === 'json' ? 600 : 400,
                transition: 'color 0.15s'
              }}
            >
              json
            </button>
            <button
              onClick={() => setActiveTab('yaml')}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeTab === 'yaml' ? '#3b82f6' : '#6b7280',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                fontWeight: activeTab === 'yaml' ? 600 : 400,
                transition: 'color 0.15s'
              }}
            >
              yaml
            </button>
          </div>
          <button
            onClick={() => copyToClipboard(configText, 'config')}
            style={{
              background: 'transparent',
              border: '1px solid #374151',
              borderRadius: 3,
              color: copiedStates.config ? '#34d399' : '#6b7280',
              cursor: 'pointer',
              padding: '2px 4px',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18
            }}
            title={copiedStates.config ? 'Copied!' : 'Copy'}
          >
            {copiedStates.config ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        </div>
        <div style={{
          background: '#1f1f1f',
          borderRadius: 4,
          overflow: 'hidden',
          maxHeight: 120,
          overflowY: 'auto',
          border: '1px solid #374151'
        }}>
          <SyntaxHighlighter
            language={activeTab === 'json' ? 'json' : 'yaml'}
            style={customTheme}
            customStyle={{
              margin: 0,
              padding: '4px 6px',
              fontSize: '9px',
              fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
              background: '#1f1f1f',
              lineHeight: '1.3'
            }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {configText}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  )
}
