'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpInstanceInfo } from './McpInstanceInfo'
import { 
  getMcpInstances, 
  deleteMcpInstance, 
  updateMcpInstance,
  type McpInstance 
} from '../lib/mcpApi'

type McpContentViewProps = {
  onBack: () => void
}

export function McpContentView({ onBack }: McpContentViewProps) {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [instances, setInstances] = useState<McpInstance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userId) {
      fetchInstances()
    }
  }, [userId])

  const fetchInstances = async () => {
    try {
      const data = await getMcpInstances()
      setInstances(data || [])
    } catch (e) {
      console.error('Failed to fetch instances', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (apiKey: string) => {
    if (!confirm('Are you sure you want to delete this instance?')) return

    try {
      await deleteMcpInstance(apiKey)
      setInstances(prev => prev.filter(i => i.api_key !== apiKey))
    } catch (e) {
      console.error('Failed to delete instance', e)
      alert('Error deleting instance')
    }
  }

  const handleToggleStatus = async (instance: McpInstance) => {
    const newStatus = instance.status === 1 ? 0 : 1
    try {
      await updateMcpInstance(instance.api_key, { status: newStatus })
      setInstances(prev => prev.map(i => i.api_key === instance.api_key ? { ...i, status: newStatus } : i))
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0c' }}>
      {/* Header - 与 ImportMenu 风格一致 */}
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
        <span style={{ fontSize: 13, color: '#9ca3af', fontWeight: 500 }}>MCP Instances</span>
        <span style={{ fontSize: 11, color: '#525252', marginLeft: 'auto' }}>
          {instances.length} instance{instances.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ 
            padding: '40px 20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: '#525252' }}>Loading...</div>
          </div>
        ) : instances.length === 0 ? (
          <div style={{ 
            padding: '40px 20px',
            textAlign: 'center',
          }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              margin: '0 auto 16px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              </svg>
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 6 }}>No MCP instances</div>
            <div style={{ fontSize: 12, color: '#525252' }}>
              Create one from a context's Tools panel
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {instances.map((instance) => {
              return (
                <div 
                  key={instance.mcp_instance_id}
                  style={{
                    background: '#161618',
                    border: '1px solid #2a2a2a',
                    borderRadius: 10,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Card Header */}
                  <div style={{ 
                    padding: '12px 14px',
                    borderBottom: '1px solid #2a2a2a',
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', marginBottom: 2 }}>
                        {instance.name || 'Unnamed Instance'}
                      </div>
                      <div style={{ fontSize: 11, color: '#525252' }}>
                        Project: {instance.project_id}
                      </div>
                    </div>
                    <div style={{ 
                      padding: '3px 10px', 
                      borderRadius: 20, 
                      fontSize: 10, 
                      fontWeight: 500,
                      background: instance.status === 1 ? 'rgba(34,197,94,0.12)' : 'rgba(100,100,100,0.12)',
                      color: instance.status === 1 ? '#34d399' : '#525252',
                      border: instance.status === 1 ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(100,100,100,0.25)'
                    }}>
                      {instance.status === 1 ? 'Running' : 'Stopped'}
                    </div>
                  </div>

                  {/* Card Content */}
                  <div style={{ padding: 12, flex: 1 }}>
                  <McpInstanceInfo 
                    instance={instance}
                    onUpdate={(updates) => handleUpdateInstance(instance.api_key, updates)}
                  />
                  </div>

                  {/* Card Footer */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: 8, 
                    padding: '10px 14px', 
                    borderTop: '1px solid #2a2a2a',
                    background: 'rgba(0,0,0,0.2)',
                  }}>
                    <button
                      onClick={() => handleToggleStatus(instance)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: '1px solid #333',
                        background: 'transparent',
                        color: '#9ca3af',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#525252'
                        e.currentTarget.style.color = '#e2e8f0'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#333'
                        e.currentTarget.style.color = '#9ca3af'
                      }}
                    >
                      {instance.status === 1 ? 'Stop' : 'Start'}
                    </button>
                    <button
                      onClick={() => handleDelete(instance.api_key)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: '1px solid rgba(239,68,68,0.25)',
                        background: 'rgba(239,68,68,0.08)',
                        color: '#f87171',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(239,68,68,0.15)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(239,68,68,0.08)'
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

