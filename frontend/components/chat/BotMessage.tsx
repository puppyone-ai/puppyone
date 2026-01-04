import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useEffect } from 'react'
import MarkdownRenderer from './MarkdownRenderer'

// Types (simplified for this context)
interface SourceItem {
  service: string
  query: string
  url: string
}

export type ActionStepStatus = 'pending' | 'running' | 'completed' | 'error'

export interface ActionStep {
  id?: string
  text: string
  status?: ActionStepStatus
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolName?: string
  isToolResult?: boolean
  sources?: SourceItem[]
}

export interface BotMessageProps {
  message: Message
  actionSteps?: ActionStep[]
}

export default function BotMessage({ message, actionSteps }: BotMessageProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(true)
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  // Add global mouse move listener to detect when mouse leaves link areas
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!hoveredUrl) return
      
      // Check if mouse is over any link element
      const target = e.target as HTMLElement
      const isOverLink = target.tagName === 'A' || target.closest('a')
      
      if (!isOverLink) {
        setHoveredUrl(null)
      }
    }
    
    document.addEventListener('mousemove', handleGlobalMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
    }
  }, [hoveredUrl])

  const handleCopy = async () => {
    try {
      const copyPayload = message.content || ''
      if (!copyPayload) return
      await navigator.clipboard.writeText(copyPayload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const handleLinkHover = (url: string, event: React.MouseEvent) => {
    setHoveredUrl(url)
    // Position tooltip relative to the link element
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    // Position below the link with some offset
    const x = rect.left
    const y = rect.bottom + 8
    setTooltipPosition({ x, y })
  }

  const handleLinkLeave = () => {
    setHoveredUrl(null)
  }

  // Extract domain from URL for favicon
  const getFaviconUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`
    } catch {
      return null
    }
  }

  // 极简：仅使用显式 props
  const resolvedActionSteps: ActionStep[] = Array.isArray(actionSteps) ? actionSteps : []
  const contentToRender = message.content || ''
  const shouldShowContent = contentToRender.length > 0 && message.role === 'assistant'
  const sources: SourceItem[] = Array.isArray(message.sources) ? message.sources : []
  
  const hasToolSteps = resolvedActionSteps.length > 0

  return (
    <div 
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0px', width: '100%' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 🔧 Tool Steps */}
      {hasToolSteps && (
        <div style={{ 
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderRadius: '0',
          padding: '0 0 8px 0',
          marginBottom: shouldShowContent ? '4px' : '0',
          zIndex: 0,
          position: 'relative',
          transition: 'all 0.2s ease'
        }}>
            {/* Toggle Header */}
            <div 
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                marginBottom: isExpanded ? '14px' : '0',
                color: 'rgba(255,255,255,0.6)',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'color 0.2s',
                width: 'fit-content'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
            >
              <div style={{ width: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '-4px' }}>
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
              <span>Tools</span>
              {!isExpanded && resolvedActionSteps.length > 0 && (
                <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '4px', background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: '10px' }}>
                  {resolvedActionSteps.length}
                </span>
              )}
            </div>

            {/* Collapsible Content - 工具调用时间轴 */}
            <div style={{ 
              display: isExpanded ? 'flex' : 'none', 
              flexDirection: 'column',
              width: '100%',
              position: 'relative',
              paddingLeft: '16px'
            }}>
              {/* 竖线 */}
              <div style={{
                position: 'absolute',
                left: '3px',
                top: '4px',
                bottom: '4px',
                width: '1px',
                backgroundColor: 'rgba(255, 255, 255, 0.12)'
              }} />
              
              {/* 工具调用步骤 */}
              {resolvedActionSteps.map((step, index) => {
                const status: ActionStepStatus | undefined = step.status
                const isCompleted = status === 'completed'
                const isRunning = status === 'running'
                const isError = status === 'error'
                const isLast = index === resolvedActionSteps.length - 1
                return (
                  <div 
                    key={step.id ?? `action-step-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      paddingTop: index === 0 ? '0' : '8px',
                      paddingBottom: isLast ? '0' : '8px',
                      position: 'relative'
                    }}
                  >
                    {/* 圆点 - 在竖线上 */}
                    <div style={{
                      position: 'absolute',
                      left: '-16px',
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: isCompleted ? '#555' : (isError ? '#ff6b6b' : '#1a1a1a'),
                      border: `1.5px solid ${isCompleted ? '#555' : (isError ? '#ff6b6b' : '#555')}`,
                      animation: isRunning ? 'breathe 1.5s ease-in-out infinite' : 'none'
                    }} />
                    
                    <span style={{
                      fontSize: '13px',
                      color: isError ? '#ff8a8a' : 'rgba(255, 255, 255, 0.5)',
                      lineHeight: '1.4',
                      animation: isRunning ? 'textFade 1.5s ease-in-out infinite' : 'none'
                    }}>
                      {step.text}
                    </span>
                  </div>
                )
              })}
            </div>
        </div>
      )}

      {/* 📄 Report Card (The "Front" Card) */}
      {shouldShowContent && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'flex-start', 
          width: '100%', 
          minWidth: 0, 
          padding: '0', 
          borderRadius: '0', 
          border: 'none',
          backgroundColor: 'transparent',
          zIndex: 1,
          position: 'relative',
          boxShadow: 'none'
        }}>
            <div style={{ 
              fontSize: '13px', 
              color: '#d2d2d2', 
              whiteSpace: 'normal', 
              lineHeight: '1.6', 
              margin: 0, 
              textAlign: 'left', 
              wordBreak: 'break-word', 
              overflowWrap: 'break-word', 
              width: '100%'
            }}>
              <MarkdownRenderer
                content={(contentToRender || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')}
                onLinkEnter={(href, e) => { e.stopPropagation(); handleLinkHover(href, e) }}
                onLinkLeave={(e) => { e.stopPropagation(); handleLinkLeave() }}
                onLinkMove={(href, e) => {
                  if (hoveredUrl && href) {
                    const target = e.currentTarget as HTMLElement
                    const rect = target.getBoundingClientRect()
                    const x = rect.left
                    const y = rect.bottom + 8
                    setTooltipPosition({ x, y })
                  }
                }}
              />
            </div>
        </div>
      )}

      {/* Meta bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', marginLeft: '4px', opacity: isHovered ? 0.6 : 0, transition: 'opacity 0.2s ease', justifyContent: 'flex-start', alignSelf: 'flex-start' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '4px', color: '#a0a0a0', cursor: 'pointer' }} title={copied ? 'Copied' : 'Copy message'} onClick={handleCopy}>
          {copied ? (
            <div style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check style={{ width: '12px', height: '12px', color: '#000000' }} />
            </div>
          ) : (
            <Copy style={{ width: '14px', height: '14px' }} />
          )}
        </div>
      </div>

      {/* Link Tooltip */}
      {hoveredUrl && (
        <div
          style={{
            position: 'fixed',
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            background: '#222',
            border: '1px solid #444',
            padding: '6px 10px',
            borderRadius: '6px',
            zIndex: 9999,
            fontSize: '12px',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: '300px',
            overflow: 'hidden'
          }}
        >
          {getFaviconUrl(hoveredUrl) && (
            <img 
              src={getFaviconUrl(hoveredUrl) || ''} 
              alt="favicon"
              style={{ width: 14, height: 14, borderRadius: 2 }}
            />
          )}
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoveredUrl}</div>
        </div>
      )}
      
      {/* Styles for breathing animations */}
      <style jsx global>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes textFade {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.7; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

