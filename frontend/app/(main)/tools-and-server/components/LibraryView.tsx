'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { createBindings, createMcpLegacy, updateTool, type Tool } from '@/lib/mcpApi'
import { useProjects } from '@/lib/hooks/useData'
import { FONT, TOOL_TYPE_CONFIG } from '@/lib/toolConfig'

// Header 高度 (包含 border)
const HEADER_HEIGHT = 45

export function LibraryView({ 
  tools, 
  mcpInstances, 
  onDeleteTool, 
  onNavigateToTable, 
  onRefresh, 
  onMcpCreated,
}: any) {
  const [selectedTools, setSelectedTools] = useState<Set<number>>(new Set())
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showCreateServer, setShowCreateServer] = useState(false)
  const [newServerName, setNewServerName] = useState('')
  const [creating, setCreating] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  
  // 编辑状态
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  
  // 列宽状态
  const [columnWidths, setColumnWidths] = useState({ name: 45, description: 55 })
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  
  const { projects } = useProjects()

  // 构建 tableId -> path 的映射
  const tablePathMap = useMemo(() => {
    const map = new Map<number, { path: string; projectId: number }>()
    projects.forEach(project => {
      project.tables.forEach(table => {
        map.set(Number(table.id), { 
          path: `${project.name}/${table.name}`,
          projectId: Number(project.id)
        })
      })
    })
    return map
  }, [projects])

  // 按 Path 分组并排序
  const groupedTools = useMemo(() => {
    const groups = new Map<string, Tool[]>()
    
    tools.forEach((tool: Tool) => {
      const path = tool.table_id ? tablePathMap.get(tool.table_id)?.path || '—' : '—'
      if (!groups.has(path)) {
        groups.set(path, [])
      }
      groups.get(path)!.push(tool)
    })
    
    // 按 path 排序
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [tools, tablePathMap])

  const toggleSelect = (id: number) => {
    const next = new Set(selectedTools)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedTools(next)
  }

  // 快捷添加函数
  const handleQuickAdd = (tool: Tool) => {
    // 如果没有选中的工具，或者选中的不包含当前工具，则只操作当前工具
    if (selectedTools.size === 0 || !selectedTools.has(tool.id)) {
      setSelectedTools(new Set([tool.id]))
    }
    // 如果有已部署的服务器，打开添加菜单；否则打开创建服务器弹窗
    if (mcpInstances.length > 0) {
      setShowAddMenu(true)
    } else {
      setShowCreateServer(true)
    }
  }

  const handleRunTest = (tool: Tool) => {
    console.log('Run tool:', tool.name)
    // TODO: Implement run/test logic
  }

  const clearSelection = () => {
    setSelectedTools(new Set())
    setShowAddMenu(false)
  }

  // 编辑函数
  const handleStartEdit = (tool: Tool) => {
    setEditingTool(tool)
    setEditName(tool.name)
    setEditDescription(tool.description || '')
  }

  const handleCancelEdit = () => {
    setEditingTool(null)
    setEditName('')
    setEditDescription('')
  }

  const handleSaveEdit = async () => {
    if (!editingTool) return
    setSaving(true)
    try {
      await updateTool(editingTool.id, { 
        name: editName.trim() || editingTool.name,
        description: editDescription.trim() || undefined 
      })
      handleCancelEdit()
      onRefresh()
    } catch (e) {
      console.error('Failed to update tool:', e)
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const handleAddToServer = async (apiKey: string) => {
    try {
      const bindings = Array.from(selectedTools).map(id => ({ tool_id: id, status: true }))
      await createBindings(apiKey, bindings)
      setShowAddMenu(false)
      clearSelection()
      onRefresh()
    } catch (e) {
      console.error(e)
      alert('Failed to add tools to server')
    }
  }

  const handleCreateServerAndAdd = async () => {
    if (!newServerName.trim() || selectedTools.size === 0) return
    
    const firstToolId = Array.from(selectedTools)[0]
    const firstTool = tools.find((t: Tool) => t.id === firstToolId)
    if (!firstTool?.table_id) return
    
    const tableInfo = tablePathMap.get(firstTool.table_id)
    if (!tableInfo) return
    
    setCreating(true)
    try {
      const newServer = await createMcpLegacy({
        name: newServerName.trim(),
        project_id: tableInfo.projectId,
        table_id: firstTool.table_id,
        json_pointer: '',
        register_tools: ['get_data_schema', 'create', 'update', 'delete', 'get_all_data', 'query_data']
      })
      
      if (selectedTools.size > 0 && newServer?.api_key) {
        const bindings = Array.from(selectedTools).map(id => ({ tool_id: id, status: true }))
        await createBindings(newServer.api_key, bindings)
      }
      
      setShowCreateServer(false)
      setNewServerName('')
      clearSelection()
      onMcpCreated?.(newServer)
      onRefresh()
    } catch (e: any) {
      console.error('Failed to create server:', e)
      alert(`Failed to create server: ${e?.message || 'Unknown error'}`)
    } finally {
      setCreating(false)
    }
  }

  // 拖拽调整列宽
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDraggingColumn('name')
    
    const startX = e.clientX
    const startWidths = { ...columnWidths }
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!headerRef.current) return
      const headerRect = headerRef.current.getBoundingClientRect()
      const fixedWidth = 40 + 70 + 36
      const flexAreaWidth = headerRect.width - fixedWidth
      const deltaX = e.clientX - startX
      const deltaPercent = (deltaX / flexAreaWidth) * 100
      const newName = Math.min(70, Math.max(25, startWidths.name + deltaPercent))
      setColumnWidths({ name: newName, description: 100 - newName })
    }
    
    const handleMouseUp = () => {
      setDraggingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [columnWidths])

  const gridTemplate = `40px 70px ${columnWidths.name}fr ${columnWidths.description}fr 220px`

  // 全局序号
  let globalIndex = 0

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0' }}>Tools List</div>
          <div style={{ fontSize: FONT.secondary, color: '#3f3f46' }}>{tools.length}</div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedTools.size > 0 && (
            <>
              <div style={{ fontSize: FONT.secondary, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{selectedTools.size}</span> selected
                <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#3f3f46', cursor: 'pointer', fontSize: FONT.tertiary }}>
                  Clear
                </button>
              </div>

              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 6, border: 'none',
                    background: '#2563eb', color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: FONT.secondary, fontWeight: 500,
                  }}
                >
                  Publish
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: showAddMenu ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.15s' }}>
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {showAddMenu && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: '#111113', border: '1px solid #1a1a1c', borderRadius: 8,
                    padding: 4, minWidth: 220, zIndex: 100, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  }}>
                    <button
                      onClick={() => { setShowAddMenu(false); setShowCreateServer(true) }}
                      style={{
                        width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
                        borderRadius: 4, color: '#60a5fa', fontSize: FONT.primary, textAlign: 'left', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10, fontWeight: 500,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1a1a1c'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      Create New Server
                    </button>
                    {mcpInstances.length > 0 && (
                      <>
                        <div style={{ height: 1, background: '#1a1a1c', margin: '4px 0' }} />
                        <div style={{ padding: '6px 12px', fontSize: FONT.tertiary, color: '#3f3f46', fontWeight: 600 }}>ADD TO EXISTING</div>
                        {mcpInstances.map((mcp: any) => (
                          <button
                            key={mcp.api_key}
                            onClick={() => handleAddToServer(mcp.api_key)}
                            style={{
                              width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
                              borderRadius: 4, color: '#e2e8f0', fontSize: FONT.primary, textAlign: 'left', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 10,
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#1a1a1c'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: mcp.status ? '#22c55e' : '#3f3f46' }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {mcp.name || 'Unnamed Server'}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showAddMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setShowAddMenu(false)} />}

      {/* Tools Table Card */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', overflow: 'hidden' }}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#0f0f11',
          borderRadius: 10,
          border: '1px solid #1a1a1c',
          overflow: 'hidden',
        }}>
          {/* Table Header */}
          <div 
            ref={headerRef}
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              padding: '10px 20px',
              borderBottom: '1px solid #141416',
              fontSize: FONT.tertiary,
              fontWeight: 500,
              color: '#525252',
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              userSelect: draggingColumn ? 'none' : 'auto',
              flexShrink: 0,
            }}
          >
            <div style={{ textAlign: 'center' }}>#</div>
            <div>Type</div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              Name
              <div
                onMouseDown={handleMouseDown}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 8,
                  cursor: 'col-resize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div style={{
                  width: 1,
                  height: 14,
                  background: draggingColumn === 'name' ? '#3b82f6' : '#1f1f22',
                  transition: 'background 0.15s',
                }} />
              </div>
            </div>
            <div>Description</div>
            <div></div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
        {tools.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#3f3f46' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4, margin: '0 auto 12px' }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <div style={{ fontSize: FONT.primary }}>No tools in library</div>
          </div>
        ) : (
          groupedTools.map(([path, pathTools], groupIndex) => (
            <div key={path}>
              {/* Path Divider - 放在 Type 列位置，使用 11px */}
              <div 
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  padding: '6px 20px',
                  alignItems: 'center',
                  borderTop: groupIndex > 0 ? '1px solid #141416' : 'none',
                  marginTop: groupIndex > 0 ? 4 : 0,
                }}
              >
                <div />
                <div 
                  style={{ 
                    gridColumn: 'span 2',
                    fontSize: FONT.tertiary,
                    color: '#3f3f46',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={path}
                >
                  {path}
                </div>
                <div />
                <div />
              </div>

              {/* Tools in this group */}
              {pathTools.map((tool: Tool) => {
                globalIndex++
                const isHovered = hoveredRow === tool.id
                const isSelected = selectedTools.has(tool.id)
                const typeConfig = TOOL_TYPE_CONFIG[tool.type] || { label: tool.type?.toUpperCase() || 'TOOL', color: '#71717a', bg: 'rgba(113,113,122,0.15)' }
                
                return (
                  <div
                    key={tool.id}
                    onMouseEnter={() => setHoveredRow(tool.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: gridTemplate,
                      padding: '0 20px',
                      height: 40,
                      alignItems: 'center',
                      background: isSelected ? 'rgba(59, 130, 246, 0.08)' : (isHovered ? '#141416' : 'transparent'),
                      borderLeft: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* # / Checkbox */}
                    <div 
                      onClick={() => toggleSelect(tool.id)}
                      style={{ 
                        textAlign: 'center', 
                        color: '#3f3f46', 
                        fontSize: FONT.secondary,
                        cursor: 'pointer',
                      }}
                    >
                      {isHovered || isSelected ? (
                        <div style={{
                          width: 14, height: 14, margin: '0 auto',
                          border: isSelected ? 'none' : '1.5px solid #3f3f46',
                          borderRadius: 3,
                          background: isSelected ? '#3b82f6' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSelected && (
                            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      ) : (
                        globalIndex
                      )}
                    </div>
                    
                    {/* Type Badge */}
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
                    
                    {/* Name + Edit Icon */}
                    <div style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                      paddingRight: 12,
                    }}>
                      <span style={{
                        fontSize: FONT.primary,
                        fontWeight: 500,
                        color: isHovered ? '#fff' : '#e2e8f0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {tool.name}
                      </span>
                      <button
                        onClick={() => handleStartEdit(tool)}
                        style={{
                          width: 26, height: 26, background: 'none', border: 'none',
                          color: '#52525b', cursor: 'pointer', borderRadius: 5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          marginLeft: 4,
                          flexShrink: 0,
                          opacity: isHovered ? 1 : 0,
                          pointerEvents: isHovered ? 'auto' : 'none',
                          transition: 'opacity 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#60a5fa'}
                        onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                        title="Edit"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </div>
                    
                    {/* Description + Edit Icon */}
                    <div style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                      paddingRight: 12,
                    }}>
                      <span style={{
                        fontSize: FONT.secondary,
                        color: '#525252',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {tool.description || '—'}
                      </span>
                      <button
                        onClick={() => handleStartEdit(tool)}
                        style={{
                          width: 26, height: 26, background: 'none', border: 'none',
                          color: '#52525b', cursor: 'pointer', borderRadius: 5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          marginLeft: 4,
                          flexShrink: 0,
                          opacity: isHovered ? 1 : 0,
                          pointerEvents: isHovered ? 'auto' : 'none',
                          transition: 'opacity 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#60a5fa'}
                        onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                        title="Edit"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </div>
                    
                    {/* Actions */}
                    <div style={{ 
                      opacity: isHovered ? 1 : 0, 
                      transition: 'opacity 0.1s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                    }}>
                      {/* Run / Test Button (Primary) */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRunTest(tool) }}
                        style={{
                          height: 24, padding: '0 8px 0 6px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                          color: '#34d399', cursor: 'pointer', borderRadius: 4,
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 500,
                          marginRight: 6,
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
                          e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                          e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Run
                      </button>

                      {/* Add to Server Button (Primary) */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleQuickAdd(tool) }}
                        style={{
                          height: 24, padding: '0 8px 0 6px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)',
                          color: '#60a5fa', cursor: 'pointer', borderRadius: 4,
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 500,
                          marginRight: 6,
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                          e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                          e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.2)';
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Add to Server
                      </button>

                      <div style={{ width: 1, height: 14, background: '#27272a', margin: '0 4px' }} />

                      {/* Delete Button (Secondary) */}
                      <button
                        onClick={() => onDeleteTool(tool.id)}
                        style={{
                          width: 24, height: 24, background: 'none', border: 'none',
                          color: '#3f3f46', cursor: 'pointer', borderRadius: 4,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          marginLeft: 2,
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#3f3f46'}
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
          </div>
        </div>
      </div>

      {/* Create Server Modal */}
      {showCreateServer && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowCreateServer(false)}>
          <div style={{
            background: '#111113', border: '1px solid #1a1a1c', borderRadius: 10, 
            width: 400, padding: 20, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>Create New Server</div>
            <div style={{ fontSize: FONT.secondary, color: '#525252', marginBottom: 16 }}>
              Create a new MCP server and add {selectedTools.size} selected tool{selectedTools.size > 1 ? 's' : ''}.
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: FONT.tertiary, color: '#71717a', display: 'block', marginBottom: 6 }}>Server Name</label>
              <input
                autoFocus
                value={newServerName}
                onChange={e => setNewServerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !creating && handleCreateServerAndAdd()}
                placeholder="e.g. Production, Staging..."
                style={{
                  width: '100%', padding: '10px 12px', background: '#0a0a0c',
                  border: '1px solid #1a1a1c', borderRadius: 6, color: '#e2e8f0', 
                  fontSize: FONT.primary, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowCreateServer(false)} style={{
                height: 28, padding: '0 14px', background: 'transparent', 
                border: '1px solid #27272a', borderRadius: 6, color: '#71717a', fontSize: FONT.secondary, cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button 
                onClick={handleCreateServerAndAdd} 
                disabled={!newServerName.trim() || creating}
                style={{
                  height: 28, padding: '0 14px', 
                  background: creating ? '#1e40af' : (newServerName.trim() ? '#2563eb' : '#1a1a1c'), 
                  border: 'none', borderRadius: 6, 
                  color: creating ? 'rgba(255,255,255,0.7)' : (newServerName.trim() ? '#fff' : '#3f3f46'), 
                  fontSize: FONT.secondary, 
                  cursor: creating ? 'wait' : (newServerName.trim() ? 'pointer' : 'not-allowed'),
                  opacity: creating ? 0.8 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {creating && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                )}
                {creating ? 'Creating...' : 'Create & Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tool Modal */}
      {editingTool && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(4px)',
        }} onClick={handleCancelEdit}>
          <div style={{
            background: '#111113', border: '1px solid #1a1a1c', borderRadius: 10, 
            width: 420, padding: 20, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>Edit Tool</div>
            
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: FONT.tertiary, color: '#71717a', display: 'block', marginBottom: 6 }}>Name</label>
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !saving && handleSaveEdit()}
                placeholder="Tool name"
                style={{
                  width: '100%', padding: '10px 12px', background: '#0a0a0c',
                  border: '1px solid #1a1a1c', borderRadius: 6, color: '#e2e8f0', 
                  fontSize: FONT.primary, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: FONT.tertiary, color: '#71717a', display: 'block', marginBottom: 6 }}>Description</label>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', background: '#0a0a0c',
                  border: '1px solid #1a1a1c', borderRadius: 6, color: '#e2e8f0', 
                  fontSize: FONT.secondary, outline: 'none', boxSizing: 'border-box',
                  resize: 'vertical', minHeight: 60,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={handleCancelEdit} style={{
                height: 28, padding: '0 14px', background: 'transparent', 
                border: '1px solid #27272a', borderRadius: 6, color: '#71717a', fontSize: FONT.secondary, cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button 
                onClick={handleSaveEdit} 
                disabled={saving}
                style={{
                  height: 28, padding: '0 14px', 
                  background: saving ? '#1e40af' : '#2563eb', 
                  border: 'none', borderRadius: 6, 
                  color: saving ? 'rgba(255,255,255,0.7)' : '#fff', 
                  fontSize: FONT.secondary, 
                  cursor: saving ? 'wait' : 'pointer',
                  opacity: saving ? 0.8 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {saving && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                )}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
