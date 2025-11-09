'use client'

import { useState } from 'react'

export function McpBar() {
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [addedMethods, setAddedMethods] = useState<string[]>([])

  const methodOptions = [
    { value: 'get_all', label: 'Get All' },
    { value: 'vector_retrieve', label: 'Vector Retrieve' },
    { value: 'llm_retrieve', label: 'LLM Retrieve' },
    { value: 'create_element', label: 'Create Element' },
    { value: 'update_element', label: 'Update Element' },
    { value: 'delete_element', label: 'Delete Element' },
  ]

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
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
            width: 340,
            background: '#0e1117',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 50,
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
                    onClick={() => setSelected(m.value)} // select only for visual focus
                    style={{
                      height: 28,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: added ? '#86efac' : active ? '#bfdbfe' : '#cbd5f5',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {m.label}
                  </button>
                  <button
                    onClick={() => {
                      if (!added) setAddedMethods((prev) => [...prev, m.value])
                    }}
                    title={added ? 'Added' : 'Add'}
                    style={{
                      height: 24,
                      minWidth: 24,
                      padding: 0,
                      borderRadius: 6,
                      border: added ? '1px solid rgba(34,197,94,0.6)' : '1px solid rgba(148,163,184,0.35)',
                      background: added ? 'rgba(34,197,94,0.2)' : 'transparent',
                      color: added ? '#86efac' : '#cbd5f5',
                      fontSize: 14,
                      cursor: added ? 'default' : 'pointer',
                    }}
                    disabled={added}
                    aria-disabled={added}
                  >
                    {added ? '✓' : '+'}
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            Methods are placeholders for now. Selecting them has no effect.
          </div>
        </div>
      )}
    </div>
  )
}


