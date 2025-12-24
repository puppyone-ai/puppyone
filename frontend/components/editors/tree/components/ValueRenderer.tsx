'use client'

import React, { useState, useCallback, useRef } from 'react'
import { EtlStatusRenderer, isEtlStatusValue } from './EtlStatusRenderer'

// ============================================
// Types
// ============================================
type JsonValue = string | number | boolean | null | JsonObject | JsonArray
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[]

export interface ValueRendererProps {
  value: JsonValue
  path?: string  // 当前节点的路径（用于打开文档编辑器）
  isExpanded: boolean
  isExpandable: boolean
  isSelectingAccessPoint?: boolean
  onChange: (newValue: JsonValue) => void
  onToggle: () => void
  onSelect: () => void
  onOpenDocument?: (path: string, value: string) => void  // 打开长文本编辑器
}

// ============================================
// Utils
// ============================================
function getTypeInfo(value: JsonValue): { type: string; color: string } {
  if (value === null) return { type: 'null', color: '#6b7280' }
  if (typeof value === 'string') return { type: 'string', color: '#e2e8f0' }
  if (typeof value === 'number') return { type: 'number', color: '#c084fc' }
  if (typeof value === 'boolean') return { type: 'boolean', color: '#fb7185' }
  if (Array.isArray(value)) return { type: 'array', color: '#fbbf24' }
  if (typeof value === 'object') return { type: 'object', color: '#34d399' }
  return { type: 'unknown', color: '#9ca3af' }
}

// ============================================
// Constants
// ============================================
const COLLAPSE_THRESHOLD = 50  // 超过这个长度或包含换行符时，默认折叠为单行胶囊

// ============================================
// Sub-components
// ============================================

// 基础类型值渲染器
function PrimitiveValueEditor({
  value,
  path,
  isSelectingAccessPoint,
  onChange,
  onSelect,
  onOpenDocument,
}: {
  value: JsonValue
  path?: string
  isSelectingAccessPoint?: boolean
  onChange: (newValue: JsonValue) => void
  onSelect: () => void
  onOpenDocument?: (path: string, value: string) => void
}) {
  const editableRef = useRef<HTMLDivElement>(null)
  const typeInfo = getTypeInfo(value)

  // 处理 contentEditable 保存
  const handleContentEditableBlur = useCallback(() => {
    if (editableRef.current) {
      const newValue = editableRef.current.innerText
      if (newValue !== String(value)) {
        let parsedValue: JsonValue = newValue
        if (newValue === 'true') parsedValue = true
        else if (newValue === 'false') parsedValue = false
        else if (newValue === 'null') parsedValue = null
        else if (!isNaN(Number(newValue)) && newValue.trim() !== '') parsedValue = Number(newValue)
        onChange(parsedValue)
      }
    }
  }, [value, onChange])

  const handleContentEditableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editableRef.current) {
        editableRef.current.innerText = String(value)
      }
      editableRef.current?.blur()
      return
    }
    
    if (e.key === 'Enter') {
      if (typeof value === 'string') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          editableRef.current?.blur()
        }
      } else {
        e.preventDefault()
        editableRef.current?.blur()
      }
    }
  }, [value])

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
  }

  // 特殊处理：ETL 处理状态对象
  if (isEtlStatusValue(value)) {
    return <EtlStatusRenderer value={value} />
  }

  // 字符串类型 - 简化版：短文本可编辑，长文本只显示字数
  if (typeof value === 'string') {
    const str = value
    const hasNewline = str.includes('\n')
    const isLong = str.length > COLLAPSE_THRESHOLD || hasNewline

    // 长文本：只显示字数，点击打开文档编辑器
    if (isLong) {
      const handleOpenDoc = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (onOpenDocument && path) {
          onOpenDocument(path, str)
        } else {
          onSelect()
        }
      }
      
      return (
        <div 
          onClick={handleOpenDoc}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 4px',
            margin: '0 -4px',
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
            border: '1px solid transparent',
            width: '100%',
            overflow: 'hidden',
            height: 28,
            userSelect: 'none',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {/* 图标 */}
          <div style={{ display: 'flex', alignItems: 'center', color: '#6b7280', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          {/* 字数统计 */}
          <span style={{ 
            fontSize: 14,
            color: '#6b7280',
            whiteSpace: 'nowrap',
            lineHeight: '28px',
          }}>
            {str.length.toLocaleString()} chars
          </span>
        </div>
      )
    }

    // 短文本：可原地编辑
    return (
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 4px',
          margin: '0 -4px',
          width: '100%',
          overflow: 'hidden',
          height: 28,
        }}
      >
        {/* 图标 */}
        <div style={{ display: 'flex', alignItems: 'center', color: '#6b7280', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </div>
        {/* 可编辑内容 */}
        <div
          ref={editableRef}
          contentEditable={!isSelectingAccessPoint}
          suppressContentEditableWarning
          onBlur={handleContentEditableBlur}
          onKeyDown={handleContentEditableKeyDown}
          onClick={isSelectingAccessPoint ? undefined : handleEditClick}
          style={{
            color: typeInfo.color,
            fontSize: 14,
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '28px',
            borderRadius: 3,
            outline: 'none',
            cursor: isSelectingAccessPoint ? 'pointer' : 'text',
            transition: 'background 0.15s',
            pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
          }}
          onFocus={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
          }}
          onMouseEnter={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
            }
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'transparent'
            }
          }}
        >
          {str}
        </div>
      </div>
    )
  }

  // 其他类型（number, boolean, null）
  return (
    <div
      ref={editableRef}
      contentEditable={!isSelectingAccessPoint}
      suppressContentEditableWarning
      onBlur={handleContentEditableBlur}
      onKeyDown={handleContentEditableKeyDown}
      onClick={isSelectingAccessPoint ? undefined : handleEditClick}
      style={{
        color: typeInfo.color,
        padding: '2px 4px',
        margin: '-2px -4px',
        borderRadius: 3,
        outline: 'none',
        cursor: isSelectingAccessPoint ? 'pointer' : 'text',
        transition: 'background 0.15s',
        pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
      }}
      onFocus={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
      }}
      onMouseEnter={(e) => {
        if (document.activeElement !== e.currentTarget) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
        }
      }}
      onMouseLeave={(e) => {
        if (document.activeElement !== e.currentTarget) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      {String(value)}
    </div>
  )
}

// 可展开类型切换器 (Object/Array)
function ExpandableToggle({
  value,
  isExpanded,
  isSelectingAccessPoint,
  onToggle,
}: {
  value: JsonValue
  isExpanded: boolean
  isSelectingAccessPoint?: boolean
  onToggle: () => void
}) {
  const [iconHovered, setIconHovered] = useState(false)
  
  const count = Array.isArray(value) 
    ? value.length 
    : Object.keys(value as object).length
  const isArr = Array.isArray(value)
  
  // 颜色调整：使用更低调的灰绿色/灰黄色
  const iconColor = isArr ? '#d97706' : '#059669' // 降低亮度和饱和度 (amber-600 / emerald-600)
  
  return (
    <span
      onClick={isSelectingAccessPoint ? undefined : (e) => { e.stopPropagation(); onToggle() }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
        fontFamily: 'inherit',
        pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
        userSelect: 'none',
        padding: '2px 0',
      }}
    >
      <div 
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: -6, position: 'relative' }}
        onMouseEnter={() => setIconHovered(true)}
        onMouseLeave={() => setIconHovered(false)}
      >
        {/* 图标尺寸 18px，保持清晰可辨识 */}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: iconColor, opacity: 0.85 }}>
          {iconHovered ? (
            // Hover 状态：显示展开/收起箭头
            isExpanded ? (
              <path d="M5 7L9 12L13 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M7 5L12 9L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )
          ) : (
            isArr ? (
              // Array (List) 图标
              !isExpanded ? (
                // 收起态：三条横线（暗示里面有内容）
                <>
                  <path d="M4 5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M4 9h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M4 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </>
              ) : (
                // 展开态：空心圆角矩形（内容已展开）
                <rect x="4" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
              )
            ) : (
              // Object (Dictionary) 图标
              !isExpanded ? (
                // 收起态：立体盒子（暗示里面有内容）
                <>
                  <path d="M9 3L14 5.5V12.5L9 15L4 12.5V5.5L9 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M9 15V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9 9L14 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9 9L4 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </>
              ) : (
                // 展开态：空心六边形（内容已展开）
                <path d="M9 3L14 5.5V12.5L9 15L4 12.5V5.5L9 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              )
            )
          )}
        </svg>
        {/* 数字：只在收起态显示，紧贴图标右侧 */}
        {!isExpanded && (
          <span style={{
            fontSize: 10,
            fontWeight: 500,
            color: iconColor,
            fontFamily: "'JetBrains Mono', monospace",
            marginLeft: 2,
            opacity: 0.7,
          }}>{count}</span>
        )}
      </div>
    </span>
  )
}

// ============================================
// Main Component
// ============================================
export function ValueRenderer({
  value,
  path,
  isExpanded,
  isExpandable,
  isSelectingAccessPoint,
  onChange,
  onToggle,
  onSelect,
  onOpenDocument,
}: ValueRendererProps) {
  if (isExpandable) {
    return (
      <ExpandableToggle
        value={value}
        isExpanded={isExpanded}
        isSelectingAccessPoint={isSelectingAccessPoint}
        onToggle={onToggle}
      />
    )
  }
  
  return (
    <PrimitiveValueEditor
      value={value}
      path={path}
      isSelectingAccessPoint={isSelectingAccessPoint}
      onChange={onChange}
      onSelect={onSelect}
      onOpenDocument={onOpenDocument}
    />
  )
}

export default ValueRenderer

