'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { McpInstanceInfo } from './McpInstanceInfo'

interface McpBarProps {
  projectId?: string
}

export function McpBar({ projectId }: McpBarProps) {
  const { userId, session } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [addedMethods, setAddedMethods] = useState<string[]>([])
  const [isApplying, setIsApplying] = useState(false)
  const [result, setResult] = useState<{ apiKey: string; url: string; port: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const methodOptions = [
    { value: 'get_all', label: 'Get All' },
    { value: 'vector_retrieve', label: 'Vector Retrieve' },
    { value: 'llm_retrieve', label: 'LLM Retrieve' },
    { value: 'create_element', label: 'Create Element' },
    { value: 'update_element', label: 'Update Element' },
    { value: 'delete_element', label: 'Delete Element' },
  ]

  // 调试：输出 userId 和 projectId
  useEffect(() => {
    console.log('McpBar mounted/updated:', { userId, projectId, session })
  }, [userId, projectId, session])

  // 点击外部关闭bar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleApply = async () => {
    console.log('handleApply called', { userId, projectId, session })
    // 检查 userId 和 projectId 是否有效（不能为空字符串、null 或 undefined）
    if (!userId || (typeof userId === 'string' && userId.trim() === '') || !projectId || (typeof projectId === 'string' && projectId.trim() === '')) {
      alert(`Missing user ID or project ID\nuserId: ${userId || 'undefined'}\nprojectId: ${projectId || 'undefined'}`)
      return
    }

    setIsApplying(true)
    try {
      const toolsDefinition: any = {}
      if (addedMethods.includes('get_all') || addedMethods.includes('vector_retrieve') || addedMethods.includes('llm_retrieve')) {
         toolsDefinition['get'] = {
            tool_name: 'get_context',
            tool_desc_template: 'Get context. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }]
         }
      }
      if (addedMethods.includes('create_element')) {
         toolsDefinition['create'] = {
            tool_name: 'create_element',
            tool_desc_template: 'Create element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }]
         }
      }
      if (addedMethods.includes('update_element')) {
         toolsDefinition['update'] = {
            tool_name: 'update_element',
            tool_desc_template: 'Update element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }]
         }
      }
      if (addedMethods.includes('delete_element')) {
         toolsDefinition['delete'] = {
            tool_name: 'delete_element',
            tool_desc_template: 'Delete element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }]
         }
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'}/api/v1/mcp/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          project_id: projectId,
          context_id: projectId,
          tools_definition: Object.keys(toolsDefinition).length > 0 ? toolsDefinition : undefined
        }),
      })

      const data = await response.json()
      console.log('Create MCP instance response:', data)
      if (data.code === 0) {
        const apiKey = data.data.api_key
        const url = data.data.url
        // 从 URL 中提取端口号
        const portMatch = url.match(/localhost:(\d+)/)
        const port = portMatch ? parseInt(portMatch[1]) : 0
        setResult({ apiKey, url, port })
      } else {
        alert('Failed to create MCP instance: ' + data.message)
      }
    } catch (e) {
      console.error(e)
      alert('Error creating MCP instance')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div ref={barRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          height: 28,
          padding: '0 10px',
          borderRadius: 6,
          border: '1px solid rgba(148,163,184,0.35)',
          background: 'transparent',
          color: '#cbd5f5',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Configure MCP
      </button>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            width: 400,
            background: '#0e1117',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 50,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>MCP Configuration</div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                height: 24,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid rgba(148,163,184,0.35)',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          
          {!result ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {methodOptions.map((m) => {
                  const active = selected === m.value
                  const added = addedMethods.includes(m.value)
                  return (
                    <div
                      key={m.value}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: added
                          ? '1px solid rgba(34,197,94,0.6)'
                          : active
                          ? '1px solid rgba(59,130,246,0.7)'
                          : '1px solid rgba(148,163,184,0.35)',
                        background: added
                          ? 'rgba(34,197,94,0.18)'
                          : active
                          ? 'rgba(30,64,175,0.35)'
                          : 'transparent',
                      }}
                    >
                      <button
                        onClick={() => setSelected(m.value)}
                        style={{
                          height: 28,
                          padding: '0 8px',
                          borderRadius: 6,
                          border: '1px solid transparent',
                          background: 'transparent',
                          color: added ? '#86efac' : active ? '#bfdbfe' : '#cbd5f5',
                          fontSize: 12,
                          cursor: 'pointer',
                          textAlign: 'left',
                          flex: 1,
                        }}
                      >
                        {m.label}
                      </button>
                      <button
                        onClick={() => {
                          if (added) {
                            setAddedMethods((prev) => prev.filter((v) => v !== m.value))
                          } else {
                            setAddedMethods((prev) => [...prev, m.value])
                          }
                        }}
                        title={added ? 'Remove' : 'Add'}
                        style={{
                          height: 24,
                          minWidth: 24,
                          padding: 0,
                          borderRadius: 6,
                          border: added ? '1px solid rgba(34,197,94,0.6)' : '1px solid rgba(148,163,184,0.35)',
                          background: added ? 'rgba(34,197,94,0.2)' : 'transparent',
                          color: added ? '#86efac' : '#cbd5f5',
                          fontSize: 14,
                          cursor: 'pointer',
                        }}
                      >
                        {added ? '✓' : '+'}
                      </button>
                    </div>
                  )
                })}
              </div>
              {(!userId || !projectId) && (
                <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
                  {!userId && 'Missing user ID. '}
                  {!projectId && 'Missing project ID. '}
                  Please refresh the page.
                </div>
              )}
              {addedMethods.length === 0 && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  Please select at least one method to enable.
                </div>
              )}
              <button
                onClick={handleApply}
                disabled={isApplying || addedMethods.length === 0 || !userId || !projectId}
                title={
                  !userId || !projectId
                    ? 'Missing user ID or project ID'
                    : addedMethods.length === 0
                    ? 'Please select at least one method'
                    : ''
                }
                style={{
                  marginTop: 8,
                  height: 32,
                  borderRadius: 6,
                  border: 'none',
                  background: isApplying || addedMethods.length === 0 || !userId || !projectId ? '#374151' : '#2563eb',
                  color: isApplying || addedMethods.length === 0 || !userId || !projectId ? '#9ca3af' : '#ffffff',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isApplying || addedMethods.length === 0 || !userId || !projectId ? 'not-allowed' : 'pointer',
                }}
              >
                {isApplying ? 'Creating Instance...' : 'Create MCP Instance'}
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <McpInstanceInfo 
                apiKey={result.apiKey} 
                url={result.url} 
                port={result.port} 
              />
              <button
                onClick={() => setResult(null)}
                style={{
                  marginTop: 8,
                  height: 32,
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'transparent',
                  color: '#cbd5f5',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Back to Configuration
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
