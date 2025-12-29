'use client'

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { 
  getTools, 
  deleteTool,
  getMcpV2Instances,
  getBoundTools,
  createMcpV2,
  deleteMcpV2,
  createBindings,
  deleteBinding,
  type Tool,
  type McpV2Instance,
  type BoundTool,
} from '../lib/mcpApi'

type ToolsContentViewProps = {
  onBack: () => void
  onNavigateToTable?: (tableId: number) => void
}

// Tool 类型颜色配置
const TOOL_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
  get_data_schema: { accent: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', text: '#67e8f9' },
  query_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
  get_all_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
  preview: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
  select: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
  create: { accent: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399' },
  update: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', text: '#fbbf24' },
  delete: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', text: '#f87171' },
}

// Tool 类型标签
const TOOL_LABELS: Record<string, string> = {
  get_data_schema: 'Schema',
  query_data: 'Query',
  get_all_data: 'Get All',
  preview: 'Preview',
  select: 'Select',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
}

// MCP 实例及其绑定的 tools
interface McpWithBindings extends McpV2Instance {
  boundTools: BoundTool[]
}

export function ToolsContentView({ onBack, onNavigateToTable }: ToolsContentViewProps) {
  const { session } = useAuth()
  const userId = session?.user?.id
  
  // Tools 状态
  const [tools, setTools] = useState<Tool[]>([])
  const [toolsLoading, setToolsLoading] = useState(true)
  
  // MCP 状态
  const [mcpInstances, setMcpInstances] = useState<McpWithBindings[]>([])
  const [mcpLoading, setMcpLoading] = useState(true)
  
  // Bind Tool 弹窗状态
  const [bindingMcpKey, setBindingMcpKey] = useState<string | null>(null)
  
  // 创建 MCP 弹窗状态
  const [showCreateMcp, setShowCreateMcp] = useState(false)
  const [newMcpName, setNewMcpName] = useState('')
  const [creating, setCreating] = useState(false)

  // 获取 Tools
  useEffect(() => {
    if (userId) {
      fetchTools()
      fetchMcpInstances()
    }
  }, [userId])

  const fetchTools = async () => {
    try {
      const data = await getTools()
      setTools(data || [])
    } catch (e) {
      console.error('Failed to fetch tools', e)
    } finally {
      setToolsLoading(false)
    }
  }

  const fetchMcpInstances = async () => {
    try {
      const instances = await getMcpV2Instances()
      // 为每个 MCP 获取绑定的 tools
      const instancesWithBindings = await Promise.all(
        instances.map(async (instance) => {
          try {
            const boundTools = await getBoundTools(instance.api_key)
            return { ...instance, boundTools }
          } catch {
            return { ...instance, boundTools: [] }
          }
        })
      )
      setMcpInstances(instancesWithBindings)
    } catch (e) {
      console.error('Failed to fetch MCP instances', e)
    } finally {
      setMcpLoading(false)
    }
  }

  const handleDeleteTool = async (toolId: number) => {
    if (!confirm('Delete this tool?')) return
    try {
      await deleteTool(toolId)
      setTools(prev => prev.filter(t => t.id !== toolId))
      // 刷新 MCP bindings
      fetchMcpInstances()
    } catch (e) {
      console.error('Failed to delete tool', e)
      alert('Error deleting tool')
    }
  }

  const handleCreateMcp = async () => {
    if (!newMcpName.trim()) return
    setCreating(true)
    try {
      const newMcp = await createMcpV2({ name: newMcpName.trim() })
      setMcpInstances(prev => [...prev, { ...newMcp, boundTools: [] }])
      setShowCreateMcp(false)
      setNewMcpName('')
    } catch (e) {
      console.error('Failed to create MCP', e)
      alert('Error creating MCP instance')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteMcp = async (apiKey: string) => {
    if (!confirm('Delete this MCP instance?')) return
    try {
      await deleteMcpV2(apiKey)
      setMcpInstances(prev => prev.filter(m => m.api_key !== apiKey))
    } catch (e) {
      console.error('Failed to delete MCP', e)
      alert('Error deleting MCP instance')
    }
  }

  const handleBindTool = async (apiKey: string, toolId: number) => {
    try {
      await createBindings(apiKey, [{ tool_id: toolId, status: true }])
      // 刷新该 MCP 的 bindings
      const boundTools = await getBoundTools(apiKey)
      setMcpInstances(prev => prev.map(m => 
        m.api_key === apiKey ? { ...m, boundTools } : m
      ))
      setBindingMcpKey(null)
    } catch (e) {
      console.error('Failed to bind tool', e)
      alert('Error binding tool')
    }
  }

  const handleUnbindTool = async (apiKey: string, toolId: number) => {
    try {
      await deleteBinding(apiKey, toolId)
      setMcpInstances(prev => prev.map(m => 
        m.api_key === apiKey 
          ? { ...m, boundTools: m.boundTools.filter(t => t.tool_id !== toolId) }
          : m
      ))
    } catch (e) {
      console.error('Failed to unbind tool', e)
      alert('Error unbinding tool')
    }
  }

  // 按 table_id 分组 tools
  const toolsByTable = useMemo(() => {
    return tools.reduce((acc, tool) => {
      const tableId = tool.table_id ?? 'unassigned'
      if (!acc[tableId]) acc[tableId] = []
      acc[tableId].push(tool)
      return acc
    }, {} as Record<string | number, Tool[]>)
  }, [tools])

  // 获取当前 MCP 可绑定的 tools（未绑定到该 MCP 的）
  const getAvailableTools = (mcp: McpWithBindings) => {
    const boundIds = new Set(mcp.boundTools.map(t => t.tool_id))
    return tools.filter(t => !boundIds.has(t.id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0c' }}>
      {/* Header */}
      <div style={{
        height: 45,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid #2a2a2a',
        gap: 10,
        background: 'rgba(10,10,12,0.85)',
        backdropFilter: 'blur(12px)',
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
            color: '#525252',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            e.currentTarget.style.color = '#9ca3af'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#525252'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize: 13, color: '#9ca3af', fontWeight: 500 }}>Tools & MCP</span>
      </div>

      {/* Main Content - 左右分栏 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* 左侧：Tools 列表 */}
        <div style={{ 
          width: '50%', 
          borderRight: '1px solid #2a2a2a',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Tools Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1f1f1f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Tools
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#525252' }}>{tools.length} total</span>
          </div>

          {/* Tools Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {toolsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#525252', fontSize: 12 }}>Loading...</div>
            ) : tools.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#525252' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px', opacity: 0.5 }}>
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
                <div style={{ fontSize: 12 }}>No tools configured</div>
                <div style={{ fontSize: 11, color: '#404040', marginTop: 4 }}>Create tools from your JSON data</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(toolsByTable).map(([tableId, tableTools]) => (
                  <div key={tableId}>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#525252',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      Table {tableId}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {tableTools.map((tool) => {
                        const colors = TOOL_COLORS[tool.type] || TOOL_COLORS.query_data
                        const label = TOOL_LABELS[tool.type] || tool.type
                        return (
                          <div
                            key={tool.id}
                            style={{
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid #2a2a2a',
                              borderRadius: 6,
                              padding: '8px 10px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                              e.currentTarget.style.borderColor = '#333'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                              e.currentTarget.style.borderColor = '#2a2a2a'
                            }}
                          >
                            {/* 类型标签 */}
                            <span style={{
                              fontSize: 9,
                              fontWeight: 600,
                              color: colors.text,
                              background: colors.bg,
                              padding: '2px 6px',
                              borderRadius: 3,
                              textTransform: 'uppercase',
                              flexShrink: 0,
                            }}>
                              {label}
                            </span>
                            {/* 名称 */}
                            <span style={{
                              flex: 1,
                              fontSize: 11,
                              color: '#e2e8f0',
                              fontFamily: 'ui-monospace, monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {tool.name}
                            </span>
                            {/* 操作按钮 */}
                            <div style={{ display: 'flex', gap: 2 }}>
                              {tool.table_id && (
                                <button
                                  onClick={() => onNavigateToTable?.(tool.table_id!)}
                                  title="Go to table"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 4,
                                    cursor: 'pointer',
                                    color: '#525252',
                                    borderRadius: 3,
                                    display: 'flex',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#60a5fa' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteTool(tool.id)}
                                title="Delete"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 4,
                                  cursor: 'pointer',
                                  color: '#525252',
                                  borderRadius: 3,
                                  display: 'flex',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：MCP Instances */}
        <div style={{ 
          width: '50%',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* MCP Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #1f1f1f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
                <path d="m4.93 4.93 2.83 2.83m8.48 8.48 2.83 2.83m-2.83-14.14 2.83 2.83M4.93 19.07l2.83-2.83"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                MCP Instances
              </span>
            </div>
            <button
              onClick={() => setShowCreateMcp(true)}
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 11,
                color: '#60a5fa',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14m-7-7h14"/>
              </svg>
              New
            </button>
          </div>

          {/* MCP Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {mcpLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#525252', fontSize: 12 }}>Loading...</div>
            ) : mcpInstances.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#525252' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px', opacity: 0.5 }}>
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
                </svg>
                <div style={{ fontSize: 12 }}>No MCP instances</div>
                <div style={{ fontSize: 11, color: '#404040', marginTop: 4 }}>Create one to expose your tools</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mcpInstances.map((mcp) => (
                  <div
                    key={mcp.api_key}
                    style={{
                      background: '#161618',
                      border: '1px solid #2a2a2a',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    {/* MCP Card Header */}
                    <div style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #2a2a2a',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0' }}>
                          {mcp.name || 'Unnamed'}
                        </div>
                        <div style={{ fontSize: 10, color: '#525252', marginTop: 2 }}>
                          {mcp.boundTools.length} tool{mcp.boundTools.length !== 1 ? 's' : ''} bound
                        </div>
                      </div>
                      <div style={{
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 9,
                        fontWeight: 500,
                        background: mcp.status ? 'rgba(34,197,94,0.12)' : 'rgba(100,100,100,0.12)',
                        color: mcp.status ? '#34d399' : '#525252',
                      }}>
                        {mcp.status ? 'Active' : 'Inactive'}
                      </div>
                    </div>

                    {/* Bound Tools */}
                    <div style={{ padding: '8px 12px' }}>
                      {mcp.boundTools.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {mcp.boundTools.map((bt) => {
                            const colors = TOOL_COLORS[bt.type] || TOOL_COLORS.query_data
                            return (
                              <div
                                key={bt.tool_id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '4px 6px',
                                  background: 'rgba(255,255,255,0.02)',
                                  borderRadius: 4,
                                }}
                              >
                                <span style={{
                                  fontSize: 8,
                                  fontWeight: 600,
                                  color: colors.text,
                                  background: colors.bg,
                                  padding: '1px 4px',
                                  borderRadius: 2,
                                  textTransform: 'uppercase',
                                }}>
                                  {TOOL_LABELS[bt.type] || bt.type}
                                </span>
                                <span style={{
                                  flex: 1,
                                  fontSize: 10,
                                  color: '#9ca3af',
                                  fontFamily: 'ui-monospace, monospace',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {bt.name}
                                </span>
                                <button
                                  onClick={() => handleUnbindTool(mcp.api_key, bt.tool_id)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 2,
                                    cursor: 'pointer',
                                    color: '#525252',
                                    display: 'flex',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                  </svg>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: '#404040', textAlign: 'center', padding: 8 }}>
                          No tools bound
                        </div>
                      )}

                      {/* Add Tool Button */}
                      <button
                        onClick={() => setBindingMcpKey(mcp.api_key)}
                        style={{
                          width: '100%',
                          marginTop: 8,
                          padding: '6px',
                          background: 'transparent',
                          border: '1px dashed #333',
                          borderRadius: 4,
                          color: '#525252',
                          fontSize: 10,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#525252'
                          e.currentTarget.style.color = '#9ca3af'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#333'
                          e.currentTarget.style.color = '#525252'
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14m-7-7h14"/>
                        </svg>
                        Bind Tool
                      </button>
                    </div>

                    {/* API Key */}
                    <div style={{
                      padding: '8px 12px',
                      borderTop: '1px solid #2a2a2a',
                      background: 'rgba(0,0,0,0.2)',
                    }}>
                      <div style={{ fontSize: 9, color: '#525252', marginBottom: 4 }}>API Key</div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <code style={{
                          flex: 1,
                          fontSize: 10,
                          color: '#6b7280',
                          fontFamily: 'ui-monospace, monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {mcp.api_key}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(mcp.api_key)
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 4,
                            cursor: 'pointer',
                            color: '#525252',
                            borderRadius: 3,
                            display: 'flex',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#9ca3af' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteMcp(mcp.api_key)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 4,
                            cursor: 'pointer',
                            color: '#525252',
                            borderRadius: 3,
                            display: 'flex',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#525252' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bind Tool Modal */}
      {bindingMcpKey && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setBindingMcpKey(null)}
        >
          <div
            style={{
              background: '#161618',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              width: 360,
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #2a2a2a',
              fontSize: 13,
              fontWeight: 500,
              color: '#e2e8f0',
            }}>
              Select Tool to Bind
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              {(() => {
                const mcp = mcpInstances.find(m => m.api_key === bindingMcpKey)
                if (!mcp) return null
                const availableTools = getAvailableTools(mcp)
                if (availableTools.length === 0) {
                  return (
                    <div style={{ padding: 20, textAlign: 'center', color: '#525252', fontSize: 12 }}>
                      All tools are already bound
                    </div>
                  )
                }
                return availableTools.map((tool) => {
                  const colors = TOOL_COLORS[tool.type] || TOOL_COLORS.query_data
                  return (
                    <button
                      key={tool.id}
                      onClick={() => handleBindTool(bindingMcpKey, tool.id)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: 'transparent',
                        border: '1px solid #2a2a2a',
                        borderRadius: 6,
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: colors.text,
                        background: colors.bg,
                        padding: '2px 6px',
                        borderRadius: 3,
                        textTransform: 'uppercase',
                      }}>
                        {TOOL_LABELS[tool.type] || tool.type}
                      </span>
                      <span style={{
                        flex: 1,
                        fontSize: 11,
                        color: '#e2e8f0',
                        fontFamily: 'ui-monospace, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {tool.name}
                      </span>
                    </button>
                  )
                })
              })()}
            </div>
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid #2a2a2a',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setBindingMcpKey(null)}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: 6,
                  color: '#9ca3af',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create MCP Modal */}
      {showCreateMcp && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCreateMcp(false)}
        >
          <div
            style={{
              background: '#161618',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              width: 320,
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', marginBottom: 12 }}>
              Create MCP Instance
            </div>
            <input
              type="text"
              value={newMcpName}
              onChange={(e) => setNewMcpName(e.target.value)}
              placeholder="Instance name..."
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid #333',
                borderRadius: 6,
                color: '#e2e8f0',
                fontSize: 12,
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateMcp()
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setShowCreateMcp(false)}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: 6,
                  color: '#9ca3af',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMcp}
                disabled={!newMcpName.trim() || creating}
                style={{
                  padding: '6px 14px',
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  borderRadius: 6,
                  color: '#60a5fa',
                  fontSize: 12,
                  cursor: newMcpName.trim() && !creating ? 'pointer' : 'not-allowed',
                  opacity: newMcpName.trim() && !creating ? 1 : 0.5,
                }}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
