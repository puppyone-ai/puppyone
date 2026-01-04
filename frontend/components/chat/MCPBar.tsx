import React from 'react'
import { Plus } from 'lucide-react'

// Simplified types for now
export interface MCPBarProps {
  // In the future, this can be dynamic
  enabled: boolean
}

export default function MCPBar({ enabled }: MCPBarProps) {
  // Only show MCP configuration if enabled (Agent mode)
  if (!enabled) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {/* Add Source / Configure MCP Button */}
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: 'transparent',
          border: '1px dashed rgba(255,255,255,0.2)',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#666',
          cursor: 'pointer',
          transition: 'all 0.2s',
          height: '28px'
        }}
        onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
            e.currentTarget.style.color = '#a0a0a0'
        }}
        onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
            e.currentTarget.style.color = '#666'
        }}
        title="Configure External MCP Servers"
      >
        <Plus size={12} />
        <span>Source</span>
      </button>
    </div>
  )
}
