'use client'

import { useAuth } from '../supabase/SupabaseAuthProvider'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { McpInstanceInfo } from '../../components/McpInstanceInfo'

interface McpInstance {
  mcp_instance_id: string
  api_key: string
  user_id: string
  project_id: string
  context_id: string
  status: number
  port: number
  docker_info: any
  tools_definition: any
}

export default function McpInstancesPage() {
  const { session, userId } = useAuth()
  const router = useRouter()
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
      console.log('Fetch instances response:', data)
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
        body: JSON.stringify({
          status: newStatus,
          // tools_definition is optional, so we don't need to send it if we just want to update status
        }),
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


  const userAvatarUrl =
    (session?.user as any)?.user_metadata?.avatar_url || (session?.user as any)?.user_metadata?.picture

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ddd' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid #1f1f1f',
          background: '#0b0b0b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/puppybase.svg" alt="PuppyContext" width={18} height={18} />
          <div 
            onClick={() => router.push('/')}
            style={{ 
              fontSize: 14, 
              color: '#ddd', 
              letterSpacing: 0.2,
              cursor: 'pointer',
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#ddd'}
          >
            PuppyContext
          </div>
          <nav style={{ marginLeft: 24, display: 'flex', gap: 16, fontSize: 13 }}>
            <span style={{ color: '#94a3b8' }}>MCP Instances</span>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt="User"
              width={28}
              height={28}
              style={{ borderRadius: 999, border: '1px solid #2a2a2a', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: '1px solid #2a2a2a',
                display: 'grid',
                placeItems: 'center',
                color: '#aaa',
                background: '#151515',
                fontSize: 12,
              }}
            >
              U
            </div>
          )}
        </div>
      </header>
      <div style={{ padding: 24 }}>        
        {loading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : instances.length === 0 ? (
          <div style={{ color: '#94a3b8' }}>No MCP instances found. Create one from a project page.</div>
        ) : (
          <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))' }}>
            {instances.map((instance) => {
              const url = `http://localhost:${instance.port}/mcp`
              
              return (
                <div 
                  key={instance.mcp_instance_id}
                  style={{
                    background: '#161b22',
                    border: '1px solid rgba(148,163,184,0.1)',
                    borderRadius: 8,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
                        Project: {instance.project_id}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        Port: {instance.port}
                      </div>
                    </div>
                    <div style={{ 
                      padding: '2px 8px', 
                      borderRadius: 12, 
                      fontSize: 11, 
                      background: instance.status === 1 ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.2)',
                      color: instance.status === 1 ? '#86efac' : '#94a3b8',
                      border: instance.status === 1 ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.3)'
                    }}>
                      {instance.status === 1 ? 'Running' : 'Stopped'}
                    </div>
                  </div>

                  <McpInstanceInfo 
                    apiKey={instance.api_key} 
                    url={url} 
                    port={instance.port} 
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                    <button
                      onClick={() => handleToggleStatus(instance)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid rgba(148,163,184,0.35)',
                        background: 'transparent',
                        color: '#cbd5f5',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
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
                        color: '#fca5a5',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
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
    </main>
  )
}
