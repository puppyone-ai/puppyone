'use client'

import React, { useState } from 'react'
import { type McpToolPermissions, type McpToolType } from '../../lib/mcpApi'

// Access Point 类型定义
interface AccessPoint {
  id: string
  path: string
  permissions: McpToolPermissions
}

interface ToolsPanelProps {
  accessPoints: AccessPoint[]
  setAccessPoints: React.Dispatch<React.SetStateAction<AccessPoint[]>>
  activeBaseName?: string
  onClose: () => void
  onPublishMcp: () => void
  isPublishing: boolean
  publishError: string | null
  publishedResult: { api_key: string; url: string } | null
  setPublishedResult: React.Dispatch<React.SetStateAction<{ api_key: string; url: string } | null>>
  onViewAllMcp?: () => void
}

// 颜色编码定义
const TOOL_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
  query_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
  get_all_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa' },
  preview: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
  select: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa' },
  create: { accent: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399' },
  update: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', text: '#fbbf24' },
  delete: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', text: '#f87171' },
}

// Tool 图标定义
const TOOL_ICONS: Record<string, React.ReactNode> = {
  query_data: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  get_all_data: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="6" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="10" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  preview: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  select: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  create: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  update: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  ),
  delete: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
}

const TOOL_DEFS = [
  { backendId: 'query_data' as McpToolType, label: 'Query' },
  { backendId: 'get_all_data' as McpToolType, label: 'Get All' },
  { backendId: 'preview' as McpToolType, label: 'Preview' },
  { backendId: 'select' as McpToolType, label: 'Select' },
  { backendId: 'create' as McpToolType, label: 'Create' },
  { backendId: 'update' as McpToolType, label: 'Update' },
  { backendId: 'delete' as McpToolType, label: 'Delete' },
]

export function ToolsPanel({
  accessPoints,
  setAccessPoints,
  activeBaseName,
  onClose,
  onPublishMcp,
  isPublishing,
  publishError,
  publishedResult,
  setPublishedResult,
  onViewAllMcp,
}: ToolsPanelProps) {
  // 收起的 path 列表 (默认全部展开)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  
  // Tool 定义编辑状态
  const [toolsDefinitionEdits, setToolsDefinitionEdits] = useState<Record<string, { name: string; description: string }>>({})
  const [editingToolField, setEditingToolField] = useState<{ toolId: string; field: 'name' | 'description' } | null>(null)

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#161618',
      // 移除卡片样式
      // borderRadius: 10,
      // border: '1px solid #2a2a2a',
      // boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Header - 只有关闭按钮 */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: '#525252',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.color = '#9ca3af'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#525252'
          }}
          title="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      
      {/* Content - 按 Path 聚合，带颜色编码 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {accessPoints.length === 0 ? (
          <div style={{ 
            padding: '20px 16px',
            textAlign: 'center',
          }}>
            <div style={{ 
              width: 36, 
              height: 36, 
              margin: '0 auto 10px',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="1.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 4 }}>No tools configured</div>
            <div style={{ fontSize: 11, color: '#525252' }}>
              Click the 🐾 icon on JSON nodes to expose capabilities
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {accessPoints.map((ap) => {
              const enabledTools = TOOL_DEFS.filter(tool => ap.permissions[tool.backendId])
              if (enabledTools.length === 0) return null
              
              const pathSegments = ap.path ? ap.path.split('/').filter(Boolean) : []
              const displayPath = ap.path || '/'
              const lastSegment = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : 'root'
              const safeName = lastSegment.replace(/[^a-zA-Z0-9_]/g, '')

              const isCollapsed = collapsedPaths.has(ap.path)
              const toggleCollapse = () => {
                setCollapsedPaths(prev => {
                  const next = new Set(prev)
                  if (next.has(ap.path)) {
                    next.delete(ap.path)
                  } else {
                    next.add(ap.path)
                  }
                  return next
                })
              }

              return (
                <div key={ap.id} style={{ marginBottom: 12 }}>
                  {/* Path 标题 - 可点击展开/收起 */}
                  <div 
                    onClick={toggleCollapse}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: isCollapsed ? 0 : 8,
                      padding: '6px 8px',
                      cursor: 'pointer',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { 
                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    }}
                    onMouseLeave={(e) => { 
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                      e.currentTarget.style.borderColor = 'transparent'
                    }}
                  >
                    {/* 展开/收起箭头 */}
                    <svg 
                      width="10" 
                      height="10" 
                      viewBox="0 0 10 10" 
                      fill="none" 
                      style={{ 
                        color: '#525252', 
                        flexShrink: 0,
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 0.15s',
                      }}
                    >
                      <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ 
                      fontSize: 12, 
                      color: '#9ca3af',
                      fontWeight: 500,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }} title={displayPath}>
                      {displayPath}
                    </span>
                    <span style={{ 
                      fontSize: 10, 
                      color: '#525252',
                      background: 'rgba(255,255,255,0.05)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}>
                      {enabledTools.length}
                    </span>
                  </div>
                  
                  {/* Tools 卡片列表 - 可折叠 */}
                  {!isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 10 }}>
                    {enabledTools.map((tool) => {
                      const colors = TOOL_COLORS[tool.backendId] || TOOL_COLORS.query_data
                      const editKey = `${ap.path}::${tool.backendId}`
                      const defaultToolName = `${tool.backendId}_${safeName}`
                      const defaultDescription = `${tool.label} - ${activeBaseName || 'Project'}`
                      
                      const currentDef = toolsDefinitionEdits[editKey] || {
                        name: defaultToolName,
                        description: defaultDescription
                      }
                      
                      const toolFieldId = `${ap.path}::${tool.backendId}`
                      const isEditingName = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'name'
                      const isEditingDesc = editingToolField?.toolId === toolFieldId && editingToolField?.field === 'description'

                      return (
                        <div 
                          key={tool.backendId}
                          style={{
                            background: 'rgba(255,255,255,0.015)',
                            border: '1px solid #2a2a2a',
                            borderRadius: 8,
                            overflow: 'hidden',
                            display: 'flex',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                            e.currentTarget.style.borderColor = '#333'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.015)'
                            e.currentTarget.style.borderColor = '#2a2a2a'
                          }}
                        >
                          {/* 左侧颜色条 */}
                          <div style={{
                            width: 3,
                            background: colors.accent,
                            flexShrink: 0,
                          }} />
                          
                          {/* 内容区 */}
                          <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* 顶部: Tool 图标 + 类型标签 + 删除按钮 */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                {/* Tool 图标 */}
                                <span style={{ color: colors.text, display: 'flex', alignItems: 'center' }}>
                                  {TOOL_ICONS[tool.backendId]}
                                </span>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: colors.text,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.4px',
                                }}>
                                  {tool.label}
                                </span>
                              </div>
                              {/* 删除按钮 */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // 更新该 path 的 permissions，关闭这个 tool
                                  setAccessPoints(prev => {
                                    return prev.map(existingAp => {
                                      if (existingAp.path === ap.path) {
                                        const newPermissions = { ...existingAp.permissions, [tool.backendId]: false }
                                        // 如果没有任何权限了，返回 null 让后面 filter 掉
                                        const hasAny = Object.values(newPermissions).some(Boolean)
                                        if (!hasAny) return null as any
                                        return { ...existingAp, permissions: newPermissions }
                                      }
                                      return existingAp
                                    }).filter(Boolean)
                                  })
                                  // 清理编辑状态
                                  setToolsDefinitionEdits(prev => {
                                    const newEdits = { ...prev }
                                    delete newEdits[editKey]
                                    return newEdits
                                  })
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 4,
                                  cursor: 'pointer',
                                  color: '#525252',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: 4,
                                  transition: 'all 0.15s',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                                  e.currentTarget.style.color = '#ef4444'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'transparent'
                                  e.currentTarget.style.color = '#525252'
                                }}
                                title="Remove this tool"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                              </button>
                            </div>
                            
                            {/* TOOL NAME 字段 */}
                            <div>
                              <div style={{ fontSize: 10, color: '#525252', marginBottom: 4, fontWeight: 500, letterSpacing: '0.4px' }}>TOOL NAME</div>
                              {isEditingName ? (
                                <input
                                  type="text"
                                  value={currentDef.name}
                                  onChange={(e) => setToolsDefinitionEdits(prev => ({
                                    ...prev,
                                    [editKey]: { ...currentDef, name: e.target.value }
                                  }))}
                                  onBlur={() => setEditingToolField(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') setEditingToolField(null)
                                    if (e.key === 'Escape') {
                                      setToolsDefinitionEdits(prev => {
                                        const newEdits = { ...prev }
                                        delete newEdits[editKey]
                                        return newEdits
                                      })
                                      setEditingToolField(null)
                                    }
                                  }}
                                  autoFocus
                                  style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: '#e2e8f0',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                    background: 'rgba(0,0,0,0.4)',
                                    border: '1px solid #404040',
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    outline: 'none',
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingToolField({ toolId: toolFieldId, field: 'name' })
                                  }}
                                  style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 13, 
                                    fontWeight: 500, 
                                    color: '#e2e8f0',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                    cursor: 'text',
                                    padding: '6px 10px',
                                    background: 'rgba(0,0,0,0.25)',
                                    borderRadius: 6,
                                    border: '1px solid transparent',
                                    transition: 'all 0.15s',
                                  }}
                                  onMouseEnter={(e) => { 
                                    e.currentTarget.style.borderColor = '#333'
                                    e.currentTarget.style.background = 'rgba(0,0,0,0.35)'
                                  }}
                                  onMouseLeave={(e) => { 
                                    e.currentTarget.style.borderColor = 'transparent'
                                    e.currentTarget.style.background = 'rgba(0,0,0,0.25)'
                                  }}
                                  title="Click to edit"
                                >
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {currentDef.name}
                                  </span>
                                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{ color: '#525252', flexShrink: 0 }}>
                                    <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* TOOL DESCRIPTION 字段 */}
                            <div>
                              <div style={{ fontSize: 10, color: '#525252', marginBottom: 4, fontWeight: 500, letterSpacing: '0.4px' }}>TOOL DESCRIPTION</div>
                              {isEditingDesc ? (
                                <input
                                  type="text"
                                  value={currentDef.description}
                                  onChange={(e) => setToolsDefinitionEdits(prev => ({
                                    ...prev,
                                    [editKey]: { ...currentDef, description: e.target.value }
                                  }))}
                                  onBlur={() => setEditingToolField(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') setEditingToolField(null)
                                    if (e.key === 'Escape') {
                                      setToolsDefinitionEdits(prev => {
                                        const newEdits = { ...prev }
                                        delete newEdits[editKey]
                                        return newEdits
                                      })
                                      setEditingToolField(null)
                                    }
                                  }}
                                  autoFocus
                                  style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    fontSize: 12,
                                    color: '#9ca3af',
                                    background: 'rgba(0,0,0,0.4)',
                                    border: '1px solid #404040',
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    outline: 'none',
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingToolField({ toolId: toolFieldId, field: 'description' })
                                  }}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 12,
                                    color: currentDef.description ? '#9ca3af' : '#525252',
                                    cursor: 'text',
                                    padding: '6px 10px',
                                    background: 'rgba(0,0,0,0.25)',
                                    borderRadius: 6,
                                    border: '1px solid transparent',
                                    transition: 'all 0.15s',
                                    lineHeight: 1.4,
                                  }}
                                  onMouseEnter={(e) => { 
                                    e.currentTarget.style.borderColor = '#333'
                                    e.currentTarget.style.background = 'rgba(0,0,0,0.35)'
                                  }}
                                  onMouseLeave={(e) => { 
                                    e.currentTarget.style.borderColor = 'transparent'
                                    e.currentTarget.style.background = 'rgba(0,0,0,0.25)'
                                  }}
                                  title="Click to edit"
                                >
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {currentDef.description || 'Add description...'}
                                  </span>
                                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{ color: '#525252', flexShrink: 0 }}>
                                    <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Footer - 发布 MCP */}
      {accessPoints.length > 0 && (
        <div style={{ 
          borderTop: '1px solid #2a2a2a', 
          padding: '12px',
          flexShrink: 0,
        }}>
          {/* 发布结果显示 */}
          {publishedResult && (
            <div style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 10,
            }}>
              <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 500, marginBottom: 6 }}>
                ✓ Published Successfully
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>API Key:</div>
              <div 
                style={{ 
                  fontSize: 10, 
                  color: '#e2e8f0', 
                  fontFamily: 'monospace',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '6px 8px',
                  borderRadius: 4,
                  wordBreak: 'break-all',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  navigator.clipboard.writeText(publishedResult.api_key)
                }}
                title="Click to copy"
              >
                {publishedResult.api_key.slice(0, 50)}...
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, marginBottom: 4 }}>URL:</div>
              <div 
                style={{ 
                  fontSize: 10, 
                  color: '#e2e8f0', 
                  fontFamily: 'monospace',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '6px 8px',
                  borderRadius: 4,
                  wordBreak: 'break-all',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  navigator.clipboard.writeText(publishedResult.url)
                }}
                title="Click to copy"
              >
                {publishedResult.url}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPublishedResult(null)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#9ca3af',
                    background: 'transparent',
                    border: '1px solid #333',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Dismiss
                </button>
                <button
                  onClick={onViewAllMcp}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#e2e8f0',
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  View All →
                </button>
              </div>
            </div>
          )}
          
          {/* 错误显示 */}
          {publishError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 10,
              fontSize: 11,
              color: '#ef4444',
            }}>
              {publishError}
            </div>
          )}
          
          {/* 发布按钮 */}
          {!publishedResult && (
            <button
              onClick={onPublishMcp}
              disabled={isPublishing}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 500,
                color: isPublishing ? '#525252' : '#e2e8f0',
                background: isPublishing ? 'rgba(255,255,255,0.05)' : 'rgba(59, 130, 246, 0.15)',
                border: `1px solid ${isPublishing ? '#333' : 'rgba(59, 130, 246, 0.4)'}`,
                borderRadius: 8,
                cursor: isPublishing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isPublishing) {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isPublishing) {
                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'
                }
              }}
            >
              {isPublishing ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M12 2v4m0 12v4m-7.07-14.07l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                  </svg>
                  Publishing...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                  Publish as MCP Server
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

