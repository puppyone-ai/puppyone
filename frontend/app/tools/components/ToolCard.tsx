'use client'

import { useState } from 'react'
import { updateTool } from '../../../lib/mcpApi'

// Tool 类型颜色配置 (Linear 风格配色)
const TOOL_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
  get_data_schema: { accent: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)', text: '#67e8f9' },
  query_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', text: '#60a5fa' },
  get_all_data: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', text: '#60a5fa' },
  preview: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', text: '#a78bfa' },
  select: { accent: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', text: '#a78bfa' },
  create: { accent: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', text: '#34d399' },
  update: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', text: '#fbbf24' },
  delete: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', text: '#f87171' },
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

// Tool 图标定义
const TOOL_ICONS: Record<string, React.ReactNode> = {
  get_data_schema: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <path d="M5.2 3.2c-1.2.6-2 1.8-2 3.8s.8 3.2 2 3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M8.8 3.2c1.2.6 2 1.8 2 3.8s-.8 3.2-2 3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M6.2 5.4h1.6M6.2 7h1.6M6.2 8.6h1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  query_data: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  get_all_data: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="6" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="10" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  preview: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  select: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  create: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  update: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  ),
  delete: (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
}

// Custom Checkbox Component - matches dark theme
function CustomCheckbox({ checked, onChange, visible }: { checked: boolean; onChange: () => void; visible: boolean }) {
  const [hovered, setHovered] = useState(false)
  
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: checked ? 'none' : `1.5px solid ${hovered ? '#60a5fa' : '#3f3f46'}`,
        background: checked ? '#3b82f6' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s',
        opacity: visible || checked ? 1 : 0,
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  )
}

export function ToolCard({ tool, selected, onToggleSelect, onDelete, onNavigateToTable, readOnly, customDeleteIcon }: any) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<{ field: 'name' | 'description', value: string } | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  // 颜色
  const colors = TOOL_COLORS[tool.type] || TOOL_COLORS.query_data
  const label = TOOL_LABELS[tool.type] || tool.type

  // 更新 Tool
  const handleSave = async () => {
    if (!editing) return
    try {
      await updateTool(tool.id, { [editing.field]: editing.value })
      tool[editing.field] = editing.value 
      setEditing(null)
    } catch (e) {
      console.error(e)
      alert('Failed to update')
    }
  }

  // Handle Drag Start
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('toolId', String(tool.id))
    e.dataTransfer.effectAllowed = 'copy'
  }

  // 是否显示选择相关 UI
  const showSelectionUI = !readOnly && onToggleSelect

  return (
    // Outer wrapper: extends hover area to include checkbox
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start', // Top align
        gap: 8,
        marginLeft: showSelectionUI ? -24 : 0, // Extend hover area to the left
        paddingLeft: showSelectionUI ? 0 : 0,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Checkbox Area - Always takes space when in Library */}
      {showSelectionUI && (
        <div style={{ 
          width: 24, 
          display: 'flex', 
          alignItems: 'flex-start',
          paddingTop: 12, // Align with first line of card content
          flexShrink: 0,
        }}>
          <CustomCheckbox 
            checked={selected} 
            onChange={onToggleSelect} 
            visible={isHovered}
          />
        </div>
      )}

      {/* Card Content */}
      <div 
        draggable={!readOnly}
        onDragStart={!readOnly ? handleDragStart : undefined}
        style={{
          flex: 1,
          background: isHovered ? '#1c1c1f' : (selected ? '#1a1a2e' : '#18181b'),
          borderRadius: 8, // Rounded 8px
          padding: '10px 12px',
          transition: 'all 0.15s ease',
          cursor: readOnly ? 'default' : 'grab',
          border: selected ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent', // Subtle border
        }}
      >
        {/* Main Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Type Badge - Unified 11px Font */}
          <div style={{
            height: 22, // Slightly taller
            display: 'flex', 
            alignItems: 'center', 
            gap: 5, 
            padding: '0 8px',
            background: colors.bg, 
            borderRadius: 5,
            flexShrink: 0,
          }}>
            <span style={{ color: colors.text, display: 'flex' }}>{TOOL_ICONS[tool.type]}</span>
            <span style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              color: colors.text, 
              textTransform: 'uppercase', 
              letterSpacing: '0.3px',
              paddingTop: 1 // Visual centering
            }}>{label}</span>
          </div>
          
          {/* Name - Unified 13px Font */}
          {editing?.field === 'name' ? (
            <div style={{ flex: 1, display: 'flex', gap: 6 }}>
              <input 
                autoFocus
                value={editing.value} 
                onChange={e => setEditing({ ...editing, value: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={handleSave}
                style={{ 
                  flex: 1, background: '#27272a', border: '1px solid #3f3f46', 
                  borderRadius: 4, padding: '4px 8px', color: '#f4f4f5', fontSize: 13, outline: 'none' 
                }} 
              />
            </div>
          ) : (
            <div 
              onClick={() => !readOnly && setEditing({ field: 'name', value: tool.name })}
              style={{ 
                flex: 1, 
                fontSize: 13, 
                fontWeight: 500, 
                color: '#f4f4f5', 
                cursor: readOnly ? 'default' : 'text',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tool.name}
            </div>
          )}
          
          {/* Actions - Right side (show on hover) */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            gap: 4, 
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.15s'
          }}>
            <ActionButton onClick={() => setExpanded(!expanded)} title={expanded ? 'Collapse' : 'Expand'}>
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: '0.15s' }}>
                <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </ActionButton>
            {tool.table_id && onNavigateToTable && (
              <ActionButton onClick={() => onNavigateToTable(tool.table_id)} title="Go to table">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </ActionButton>
            )}
            <ActionButton onClick={onDelete} title={readOnly ? "Remove from server" : "Delete"} danger>
              {customDeleteIcon || (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              )}
            </ActionButton>
          </div>
        </div>

        {/* Description Row (below main row) - Unified 12px Font */}
        {(tool.description || !readOnly) && (
          <div style={{ marginTop: 6 }}>
            {editing?.field === 'description' ? (
              <input 
                autoFocus
                value={editing.value} 
                onChange={e => setEditing({ ...editing, value: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={handleSave}
                placeholder="Add description..."
                style={{ 
                  width: '100%', background: '#27272a', border: '1px solid #3f3f46', 
                  borderRadius: 4, padding: '4px 8px', color: '#d4d4d8', fontSize: 12, outline: 'none' 
                }} 
              />
            ) : (
              <div 
                onClick={() => !readOnly && setEditing({ field: 'description', value: tool.description || '' })}
                style={{ 
                  fontSize: 12, 
                  color: tool.description ? '#a1a1aa' : '#525252', 
                  cursor: readOnly ? 'default' : 'text',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.5,
                }}
              >
                {tool.description || (readOnly ? '' : 'Click to add description...')}
              </div>
            )}
          </div>
        )}

        {/* Expanded Details */}
        {expanded && (
          <div style={{ 
            marginTop: 12, 
            paddingTop: 12, 
            borderTop: '1px solid #27272a', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 10,
          }}>
            <DetailRow label="JSON Path" value={tool.json_path || '/'} />
            {tool.input_schema && Object.keys(tool.input_schema).length > 0 && (
              <DetailRow label="Input Schema" value={
                <pre style={{ 
                  margin: 0, fontSize: 12, color: '#71717a', fontFamily: 'ui-monospace, monospace', 
                  background: '#111113', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 80 
                }}>
                  {JSON.stringify(tool.input_schema, null, 2)}
                </pre>
              } />
            )}
            {tool.output_schema && Object.keys(tool.output_schema).length > 0 && (
              <DetailRow label="Output Schema" value={
                <pre style={{ 
                  margin: 0, fontSize: 12, color: '#71717a', fontFamily: 'ui-monospace, monospace', 
                  background: '#111113', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 80 
                }}>
                  {JSON.stringify(tool.output_schema, null, 2)}
                </pre>
              } />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({ onClick, title, children, danger }: any) {
  const [hovered, setHovered] = useState(false)
  return (
    <button 
      onClick={onClick} 
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ 
        height: 24, 
        width: 24, 
        background: hovered ? (danger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)') : 'transparent', 
        border: 'none', 
        padding: 0, 
        cursor: 'pointer', 
        color: hovered ? (danger ? '#ef4444' : '#e2e8f0') : '#71717a', 
        borderRadius: 4,
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      {/* Unified 11px Label */}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#525252', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      {typeof value === 'string' ? (
        // Unified 12px Value
        <code style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'ui-monospace, monospace' }}>{value}</code>
      ) : (
        value
      )}
    </div>
  )
}

export { TOOL_ICONS }