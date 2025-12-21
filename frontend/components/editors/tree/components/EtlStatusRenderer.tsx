'use client'

import React from 'react'

interface EtlStatusValue {
  status: 'pending' | 'failed'
  message?: string
  progress?: number
}

interface EtlStatusRendererProps {
  value: EtlStatusValue
}

/**
 * 检查一个 JSON 值是否是 ETL 状态对象
 */
export function isEtlStatusValue(value: any): value is EtlStatusValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'status' in value &&
    (value.status === 'pending' || value.status === 'failed')
  )
}

/**
 * 渲染 ETL 处理状态（Processing / Failed）
 * 用于显示文件解析、数据导入等长时间任务的状态
 */
export function EtlStatusRenderer({ value }: EtlStatusRendererProps) {
  const isPending = value.status === 'pending'
  const message = String(value.message || (isPending ? 'Processing...' : 'Failed'))

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 8,
      padding: '4px 8px',
      background: isPending ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
      borderRadius: 4,
      border: `1px solid ${isPending ? 'rgba(59, 130, 246, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
    }}>
      {isPending ? (
        // Loading spinner
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 14 14" 
          fill="none"
          style={{ 
            animation: 'etl-spin 1s linear infinite',
            color: '#3b82f6'
          }}
        >
          <style>{`
            @keyframes etl-spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
          <circle 
            cx="7" 
            cy="7" 
            r="5" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round"
            strokeDasharray="24 8"
          />
        </svg>
      ) : (
        // Error icon
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#ef4444' }}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="7" cy="9.5" r="0.5" fill="currentColor"/>
        </svg>
      )}
      <span style={{ 
        fontSize: 13, 
        color: isPending ? '#60a5fa' : '#f87171',
        fontStyle: 'italic'
      }}>
        {message}
      </span>
      {isPending && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            // 触发表格刷新
            window.dispatchEvent(new CustomEvent('projects-refresh'))
          }}
          style={{
            marginLeft: 'auto',
            padding: '2px 8px',
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: 3,
            color: '#60a5fa',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          title="Refresh to check status"
        >
          Refresh
        </button>
      )}
    </div>
  )
}

export default EtlStatusRenderer

