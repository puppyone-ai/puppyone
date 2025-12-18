'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpInstanceInfo } from './McpInstanceInfo'

interface McpInstance {
  mcp_instance_id: string
  api_key: string
  user_id: string
  project_id: number
  table_id: number
  name: string | null
  json_pointer: string
  status: number
  port: number
  docker_info: any
  tools_definition: any
  register_tools: any
  preview_keys: any
}

type McpContentViewProps = {
  onBack: () => void
}

export function McpContentView({ onBack }: McpContentViewProps) {
  const { userId } = useAuth()
  const [instances, setInstances] = useState<McpInstance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userId) {
      fetchInstances()
    }
  }, [userId])

  const fetchInstances = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/mcp/list?user_id=${userId}`)
      const data = await response.json()
      if (data.code === 0) {
        setInstances(data.data || [])
      } else {
        console.error('Failed to fetch instances:', data.message)
      }
    } catch (e) {
      console.error('Failed to fetch instances', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (apiKey: string) => {
    if (!confirm('Are you sure you want to delete this instance?')) return

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/mcp/${apiKey}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (data.code === 0) {
        setInstances(prev => prev.filter(i => i.api_key !== apiKey))
      } else {
        alert('Failed to delete: ' + data.message)
      }
    } catch (e) {
      console.error('Failed to delete instance', e)
      alert('Error deleting instance')
    }
  }

  const handleToggleStatus = async (instance: McpInstance) => {
    const newStatus = instance.status === 1 ? 0 : 1
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/mcp/${instance.api_key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await response.json()
      if (data.code === 0) {
        setInstances(prev => prev.map(i => i.api_key === instance.api_key ? { ...i, status: newStatus } : i))
      } else {
        alert('Failed to update status: ' + data.message)
      }
    } catch (e) {
      console.error('Failed to update status', e)
      alert('Error updating status')
    }
  }

  const handleUpdateInstance = async (apiKey: string, updates: Partial<McpInstance>) => {
    // Update local state
    setInstances(prev => prev.map(i => i.api_key === apiKey ? { ...i, ...updates } : i))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom: '1px solid #404040',
        gap: 12,
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
            color: '#6D7177',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2C2C2C'
            e.currentTarget.style.color = '#CDCDCD'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#6D7177'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize: 13, color: '#CDCDCD', fontWeight: 500 }}>MCP Instances</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ color: '#6D7177', fontSize: 13 }}>Loading...</div>
        ) : instances.length === 0 ? (
          <div style={{ color: '#6D7177', fontSize: 13 }}>
            No MCP instances found. Create one from a project page.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
            {instances.map((instance) => {
              return (
                <div 
                  key={instance.mcp_instance_id}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 8,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#EDEDED', marginBottom: 4 }}>
                        {instance.name || 'Unnamed Instance'}
                      </div>
                      <div style={{ fontSize: 11, color: '#6D7177' }}>
                        Project: {instance.project_id}
                      </div>
                    </div>
                    <div style={{ 
                      padding: '2px 8px', 
                      borderRadius: 12, 
                      fontSize: 10, 
                      background: instance.status === 1 ? 'rgba(34,197,94,0.15)' : 'rgba(100,100,100,0.15)',
                      color: instance.status === 1 ? '#4ade80' : '#6D7177',
                      border: instance.status === 1 ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(100,100,100,0.3)'
                    }}>
                      {instance.status === 1 ? 'Running' : 'Stopped'}
                    </div>
                  </div>

                  <McpInstanceInfo 
                    instance={instance}
                    onUpdate={(updates) => handleUpdateInstance(instance.api_key, updates)}
                  />

                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: 8, 
                    marginTop: 'auto', 
                    paddingTop: 12, 
                    borderTop: '1px solid #333' 
                  }}>
                    <button
                      onClick={() => handleToggleStatus(instance)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #404040',
                        background: 'transparent',
                        color: '#CDCDCD',
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      {instance.status === 1 ? 'Stop' : 'Start'}
                    </button>
                    <button
                      onClick={() => handleDelete(instance.api_key)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid rgba(239,68,68,0.3)',
                        background: 'rgba(239,68,68,0.1)',
                        color: '#f87171',
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

