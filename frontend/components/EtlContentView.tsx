'use client'

import { useState } from 'react'

type EtlContentViewProps = {
  onBack: () => void
}

type TransformMode = 'llm' | 'pipeline' | 'code'

interface SchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array'
  hint?: string
}

interface EtlStrategy {
  id: string
  name: string
  mode: TransformMode
  inputSample: string
  outputSchema: SchemaField[]
  lastOutput?: string
}

const mockStrategies: EtlStrategy[] = [
  {
    id: '1',
    name: 'User Data Sync',
    mode: 'llm',
    inputSample: `{
  "user_info": {
    "full_name": "John Doe",
    "email_addr": "john@example.com"
  },
  "comment": "Great product!"
}`,
    outputSchema: [
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'sentiment', type: 'string', hint: 'AI 分析情感' },
    ],
    lastOutput: `{
  "name": "John Doe",
  "email": "john@example.com",
  "sentiment": "positive"
}`,
  },
  {
    id: '2',
    name: 'Product Catalog',
    mode: 'llm',
    inputSample: `{
  "id": "001",
  "title": "  Widget Pro  ",
  "price": "29.99",
  "stock": "150"
}`,
    outputSchema: [
      { name: 'id', type: 'number' },
      { name: 'title', type: 'string', hint: 'trim' },
      { name: 'price', type: 'number' },
      { name: 'inStock', type: 'boolean', hint: 'stock > 0' },
    ],
    lastOutput: `{
  "id": 1,
  "title": "Widget Pro",
  "price": 29.99,
  "inStock": true
}`,
  },
]

export function EtlContentView({ onBack }: EtlContentViewProps) {
  const [strategies, setStrategies] = useState<EtlStrategy[]>(mockStrategies)
  const [selectedStrategy, setSelectedStrategy] = useState<EtlStrategy | null>(null)
  const [editingInput, setEditingInput] = useState('')
  const [editingSchema, setEditingSchema] = useState<SchemaField[]>([])
  const [editingMode, setEditingMode] = useState<TransformMode>('llm')
  const [outputPreview, setOutputPreview] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  const handleSelectStrategy = (strategy: EtlStrategy) => {
    setSelectedStrategy(strategy)
    setEditingInput(strategy.inputSample)
    setEditingSchema(strategy.outputSchema)
    setEditingMode(strategy.mode)
    setOutputPreview(strategy.lastOutput || '')
  }

  const handleBackToList = () => {
    setSelectedStrategy(null)
  }

  const handleAddField = () => {
    setEditingSchema([...editingSchema, { name: '', type: 'string' }])
  }

  const handleUpdateField = (index: number, field: Partial<SchemaField>) => {
    const updated = [...editingSchema]
    updated[index] = { ...updated[index], ...field }
    setEditingSchema(updated)
  }

  const handleRemoveField = (index: number) => {
    setEditingSchema(editingSchema.filter((_, i) => i !== index))
  }

  const handleRun = async () => {
    setIsRunning(true)
    setTimeout(() => {
      try {
        const input = JSON.parse(editingInput)
        const output: Record<string, any> = {}
        editingSchema.forEach(field => {
          if (field.name === 'name' && input.user_info?.full_name) {
            output[field.name] = input.user_info.full_name
          } else if (field.name === 'email' && input.user_info?.email_addr) {
            output[field.name] = input.user_info.email_addr
          } else if (field.name === 'sentiment') {
            output[field.name] = 'positive'
          } else if (field.name === 'id') {
            output[field.name] = parseInt(input.id) || 0
          } else if (field.name === 'title') {
            output[field.name] = (input.title || '').trim()
          } else if (field.name === 'price') {
            output[field.name] = parseFloat(input.price) || 0
          } else if (field.name === 'inStock') {
            output[field.name] = parseInt(input.stock) > 0
          } else {
            output[field.name] = null
          }
        })
        setOutputPreview(JSON.stringify(output, null, 2))
      } catch (e) {
        setOutputPreview('Error: Invalid JSON')
      }
      setIsRunning(false)
    }, 1000)
  }

  const handleSave = () => {
    if (!selectedStrategy) return
    const updated = {
      ...selectedStrategy,
      inputSample: editingInput,
      outputSchema: editingSchema,
      mode: editingMode,
      lastOutput: outputPreview,
    }
    setStrategies(strategies.map(s => s.id === updated.id ? updated : s))
    setSelectedStrategy(updated)
  }

  // Detail View
  if (selectedStrategy) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          height: 44, display: 'flex', alignItems: 'center', padding: '0 20px',
          borderBottom: '1px solid #262626', gap: 12, flexShrink: 0,
        }}>
          <button onClick={handleBackToList} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, background: 'transparent', border: 'none',
            borderRadius: 6, cursor: 'pointer', color: '#6D7177',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span style={{ fontSize: 13, color: '#CDCDCD', fontWeight: 500 }}>{selectedStrategy.name}</span>
          <div style={{ flex: 1 }} />
          <button onClick={handleRun} disabled={isRunning} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
            borderRadius: 6, border: 'none', background: '#1a1a1a',
            color: isRunning ? '#505050' : '#CDCDCD', fontSize: 12,
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}>
            {isRunning ? 'Processing...' : (
              <><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 2l7 4-7 4V2z" fill="currentColor"/>
              </svg>Run</>
            )}
          </button>
          <button onClick={handleSave} style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: '#2a2a2a', color: '#CDCDCD', fontSize: 12, cursor: 'pointer',
          }}>Save</button>
        </div>

        {/* Three Panel Layout */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          
          {/* Left: Source Card */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
            <div style={{
              flex: 1, background: '#111111', border: '1px solid #2a2a2a', borderRadius: 8,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #252525', fontSize: 11, color: '#808080' }}>
                Source
              </div>
              <textarea
                value={editingInput}
                onChange={(e) => setEditingInput(e.target.value)}
                placeholder="Paste JSON..."
                style={{
                  flex: 1, padding: 14, background: 'transparent', border: 'none',
                  color: '#a0a0a0', fontSize: 11, fontFamily: 'JetBrains Mono, Monaco, monospace',
                  lineHeight: 1.6, resize: 'none', outline: 'none',
                }}
                spellCheck={false}
              />
            </div>
          </div>

          {/* Center: n8n-style Node with connecting line */}
          <div style={{ 
            width: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            {/* Left connecting line */}
            <div style={{ 
              flex: 1, height: 2, background: 'linear-gradient(to right, #2a2a2a, #3a3a3a)',
              borderRadius: 1,
            }} />
            
            {/* n8n-style Node */}
            <div 
              style={{
                width: 72, height: 72, borderRadius: 14,
                background: 'linear-gradient(135deg, #1a1a1a 0%, #252525 100%)',
                border: '1px solid #3a3a3a',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              {/* Switch button - top right corner */}
              <button
                onClick={() => {
                  const modes: TransformMode[] = ['llm', 'pipeline', 'code']
                  const currentIndex = modes.indexOf(editingMode)
                  const nextMode = modes[(currentIndex + 1) % modes.length]
                  // For now only llm is available, so we cycle back
                  setEditingMode(nextMode === 'llm' ? nextMode : 'llm')
                }}
                style={{
                  position: 'absolute', top: -8, right: -8,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#2a2a2a', border: '1px solid #4a4a4a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                  transition: 'transform 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)'
                  e.currentTarget.style.background = '#3a3a3a'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.background = '#2a2a2a'
                }}
                title="Switch mode"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: '#909090' }}>
                  <path d="M9 4.5L6 1.5L3 4.5M3 7.5L6 10.5L9 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              {/* Mode icon - changes based on selected mode */}
              {editingMode === 'llm' && (
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ color: '#a0a0a0' }}>
                  <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10 11h8M10 14h6M10 17h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )}
              {editingMode === 'pipeline' && (
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ color: '#a0a0a0' }}>
                  <rect x="4" y="10" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="11" y="10" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="18" y="10" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              )}
              {editingMode === 'code' && (
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ color: '#a0a0a0' }}>
                  <path d="M10 9L5 14l5 5M18 9l5 5-5 5M15 7l-2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              
              {/* Mode label */}
              <span style={{ 
                fontSize: 9, color: '#808080', marginTop: 4, 
                textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500,
              }}>
                {editingMode}
              </span>
            </div>
            
            {/* Right connecting line with arrow */}
            <div style={{ 
              flex: 1, height: 2, background: 'linear-gradient(to right, #3a3a3a, #2a2a2a)',
              borderRadius: 1, position: 'relative',
            }}>
              <svg 
                width="8" height="8" viewBox="0 0 8 8" fill="none" 
                style={{ position: 'absolute', right: -4, top: -3, color: '#606060' }}
              >
                <path d="M1 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Right: Output Card */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
            <div style={{
              flex: 1, background: '#111111', border: '1px solid #2a2a2a', borderRadius: 8,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ 
                padding: '10px 14px', borderBottom: '1px solid #252525', 
                fontSize: 11, color: '#808080', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>Output</span>
                <button onClick={handleAddField} style={{
                  padding: '3px 10px', background: 'transparent', border: '1px solid #3a3a3a',
                  borderRadius: 4, color: '#707070', fontSize: 10, cursor: 'pointer',
                }}>+</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
                {editingSchema.map((field, index) => (
                  <div key={index} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                    borderBottom: '1px solid #1e1e1e',
                  }}>
                    <input
                      value={field.name}
                      onChange={(e) => handleUpdateField(index, { name: e.target.value })}
                      placeholder="field"
                      style={{
                        flex: 1, padding: '4px 8px', background: '#161616', border: '1px solid #2a2a2a',
                        borderRadius: 4, color: '#b0b0b0', fontSize: 11,
                        fontFamily: 'JetBrains Mono, Monaco, monospace', outline: 'none',
                      }}
                    />
                    <select
                      value={field.type}
                      onChange={(e) => handleUpdateField(index, { type: e.target.value as SchemaField['type'] })}
                      style={{
                        padding: '4px 6px', background: '#161616', border: '1px solid #2a2a2a',
                        borderRadius: 4, color: '#808080', fontSize: 10, outline: 'none',
                      }}
                    >
                      <option value="string">str</option>
                      <option value="number">num</option>
                      <option value="boolean">bool</option>
                    </select>
                    <button onClick={() => handleRemoveField(index)} style={{
                      background: 'none', border: 'none', color: '#505050', cursor: 'pointer', padding: 2,
                    }}>×</button>
                  </div>
                ))}
                {editingSchema.length === 0 && (
                  <div style={{ color: '#505050', fontSize: 11, textAlign: 'center', padding: 30 }}>
                    Add fields
                  </div>
                )}
              </div>
              
              {outputPreview && (
                <div style={{ borderTop: '1px solid #252525', padding: 10 }}>
                  <pre style={{
                    margin: 0, fontSize: 10, fontFamily: 'JetBrains Mono, Monaco, monospace',
                    color: '#808080', lineHeight: 1.4,
                  }}>{outputPreview}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // List View
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', padding: '0 20px',
        borderBottom: '1px solid #262626', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, background: 'transparent', border: 'none',
          borderRadius: 6, cursor: 'pointer', color: '#6D7177',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize: 13, color: '#CDCDCD', fontWeight: 500 }}>ETL Strategies</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            const newStrategy: EtlStrategy = {
              id: Date.now().toString(), name: 'New Strategy', mode: 'llm',
              inputSample: '{\n  \n}', outputSchema: [],
            }
            setStrategies([...strategies, newStrategy])
            handleSelectStrategy(newStrategy)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            borderRadius: 6, border: '1px solid #333', background: 'transparent',
            color: '#808080', fontSize: 12, cursor: 'pointer',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          New
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {strategies.map((strategy) => (
            <div
              key={strategy.id}
              onClick={() => handleSelectStrategy(strategy)}
              style={{
                display: 'flex', alignItems: 'center', padding: '12px 14px',
                background: '#111111', border: '1px solid #2a2a2a', borderRadius: 8,
                cursor: 'pointer', transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#404040' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a2a' }}
            >
              <div style={{ width: 120, flexShrink: 0, fontSize: 12, color: '#CDCDCD' }}>
                {strategy.name}
              </div>
              <div style={{
                flex: 1, fontSize: 10, fontFamily: 'JetBrains Mono, Monaco, monospace',
                color: '#707070', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {strategy.inputSample.replace(/\s+/g, ' ').slice(0, 30)}...
              </div>
              <div style={{ 
                width: 32, height: 32, borderRadius: 8, background: '#1a1a1a', 
                border: '1px solid #333333', display: 'flex', 
                alignItems: 'center', justifyContent: 'center', margin: '0 12px',
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="#606060" strokeWidth="1"/>
                  <path d="M5 5h4M5 7h3M5 9h3.5" stroke="#606060" strokeWidth="1" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {strategy.outputSchema.slice(0, 3).map((field, i) => (
                  <div key={i} style={{
                    padding: '2px 6px', background: '#1a1a1a', borderRadius: 3,
                    fontSize: 9, fontFamily: 'JetBrains Mono, Monaco, monospace', color: '#808080',
                  }}>
                    {field.name}
                  </div>
                ))}
                {strategy.outputSchema.length > 3 && (
                  <span style={{ fontSize: 9, color: '#606060' }}>+{strategy.outputSchema.length - 3}</span>
                )}
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#505050', marginLeft: 8 }}>
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
