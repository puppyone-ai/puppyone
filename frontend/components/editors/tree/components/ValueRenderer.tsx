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
  isExpanded: boolean
  isExpandable: boolean
  isSelectingAccessPoint?: boolean
  onChange: (newValue: JsonValue) => void
  onToggle: () => void
  onSelect: () => void
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
const PREVIEW_CHARS = 250

// ============================================
// Sub-components
// ============================================

// 基础类型值渲染器
function PrimitiveValueEditor({
  value,
  isSelectingAccessPoint,
  onChange,
  onSelect,
}: {
  value: JsonValue
  isSelectingAccessPoint?: boolean
  onChange: (newValue: JsonValue) => void
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
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

  // 字符串类型
  if (typeof value === 'string') {
    const str = value
    const processedStr = str.replace(/\\n/g, '\n')
    const isLong = processedStr.length > PREVIEW_CHARS
    const displayContent = (expanded || !isLong) ? processedStr : processedStr.slice(0, PREVIEW_CHARS)
    
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
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
            lineHeight: 1.5,
            padding: '3.5px 0',
            margin: '0',
            borderRadius: 3,
            outline: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            cursor: isSelectingAccessPoint ? 'pointer' : 'text',
            transition: 'background 0.15s',
            pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
          }}
          onFocus={(e) => {
            e.currentTarget.style.background = 'transparent' 
          }}
          onMouseEnter={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'transparent'
            }
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'transparent'
            }
          }}
        >
          {displayContent}
        </div>
        {isLong && !expanded && !isSelectingAccessPoint && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              padding: '3px 10px',
              background: 'transparent',
              border: '1px solid #3a3f47',
              borderRadius: 4,
              color: '#9ca3af',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {`Expand (${processedStr.length} chars)`}
          </button>
        )}
        {isLong && expanded && !isSelectingAccessPoint && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              padding: '3px 10px',
              background: 'transparent',
              border: '1px solid #3a3f47',
              borderRadius: 4,
              color: '#9ca3af',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Collapse
          </button>
        )}
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
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: -6 }}
        onMouseEnter={() => setIconHovered(true)}
        onMouseLeave={() => setIconHovered(false)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: isArr ? '#fbbf24' : '#34d399' }}>
          {iconHovered ? (
            isExpanded ? (
              <path d="M5 7L9 12L13 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M7 5L12 9L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )
          ) : (
            isArr ? (
              !isExpanded ? (
                <rect x="5" y="5" width="8" height="8" rx="1" fill="currentColor" />
              ) : (
                <>
                  <path d="M3 4h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </>
              )
            ) : (
              !isExpanded ? (
                <path d="M9 4L13.33 6.5V11.5L9 14L4.67 11.5V6.5L9 4Z" fill="currentColor" />
              ) : (
                <>
                  <path 
                    d="M9 1.5L15.5 5.25V12.75L9 16.5L2.5 12.75V5.25L9 1.5Z" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinejoin="round"
                  />
                  <path 
                    d="M9 16V9M9 9L15.5 5.25M9 9L2.5 5.25" 
                    stroke="currentColor" 
                    strokeLinecap="round"
                  />
                </>
              )
            )
          )}
        </svg>
        <span style={{ 
          fontSize: 10,
          fontWeight: 700,
          color: '#000000',
          background: '#4b5563',
          padding: '0 4px',
          borderRadius: 99,
          fontFamily: "'JetBrains Mono', monospace",
          marginLeft: 4,
          height: 14,
          minWidth: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>{count}</span>
      </div>
    </span>
  )
}

// ============================================
// Main Component
// ============================================
export function ValueRenderer({
  value,
  isExpanded,
  isExpandable,
  isSelectingAccessPoint,
  onChange,
  onToggle,
  onSelect,
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
      isSelectingAccessPoint={isSelectingAccessPoint}
      onChange={onChange}
      onSelect={onSelect}
    />
  )
}

export default ValueRenderer

