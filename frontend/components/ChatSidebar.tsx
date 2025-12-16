'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const MIN_CHAT_WIDTH = 280
const MAX_CHAT_WIDTH = 500
const DEFAULT_CHAT_WIDTH = 340

interface ChatSidebarProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  chatWidth?: number
  onChatWidthChange?: (width: number) => void
}

export function ChatSidebar({ 
  isOpen, 
  onOpenChange,
  chatWidth = DEFAULT_CHAT_WIDTH,
  onChatWidthChange,
}: ChatSidebarProps) {
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [isResizing, setIsResizing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth
      const newWidth = windowWidth - e.clientX
      const clampedWidth = Math.min(Math.max(newWidth, MIN_CHAT_WIDTH), MAX_CHAT_WIDTH)
      onChatWidthChange?.(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onChatWidthChange])

  const handleSend = () => {
    if (!inputValue.trim()) return
    
    setMessages(prev => [...prev, { role: 'user', content: inputValue }])
    setInputValue('')
    
    // TODO: Implement actual chat logic
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'I can help you understand your context data. This feature is coming soon!' 
      }])
    }, 500)
  }

  return (
    <aside
      ref={sidebarRef}
      style={{
        width: isOpen ? chatWidth : 0,
        minWidth: isOpen ? chatWidth : 0,
        height: '100vh',
        background: '#0a0a0a',
        borderLeft: isOpen ? '1px solid #1a1a1a' : 'none',
        display: 'flex',
        flexDirection: 'column',
        transition: isResizing ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Resize Handle - on the left edge */}
      {isOpen && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            top: 0,
            left: -2,
            width: 4,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
            background: isResizing ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!isResizing) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.background = 'transparent'
            }
          }}
        />
      )}

      {/* Header - Same height as Context Header (45px) */}
      <div style={{
        height: 45,
        padding: '0 9px 0 9px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        {/* Collapse button on the left */}
        <button
          onClick={() => onOpenChange(false)}
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            borderRadius: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.color = '#9ca3af'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#6b7280'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
        
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🐶</span>
          <span style={{ 
            fontSize: 13, 
            fontWeight: 600, 
            color: '#e2e8f0',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          }}>
            Puppy Chat
          </span>
        </div>
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {messages.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            opacity: 0.5,
          }}>
            <span style={{ fontSize: 48 }}>🐶</span>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#9ca3af', marginBottom: 4 }}>
                Ask about your context
              </div>
              <div style={{ fontSize: 12, color: '#525252', lineHeight: 1.5 }}>
                I can help you understand<br/>and navigate your data
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: msg.role === 'user' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid',
                  borderColor: msg.role === 'user' ? 'rgba(52, 211, 153, 0.2)' : '#1f1f1f',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                <div style={{ 
                  fontSize: 13, 
                  color: '#e2e8f0', 
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: 12,
        borderTop: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          gap: 8,
          background: '#111',
          borderRadius: 8,
          padding: 8,
          border: '1px solid #262626',
        }}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about your data..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e2e8f0',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            style={{
              padding: '6px 12px',
              background: inputValue.trim() ? '#34d399' : '#262626',
              border: 'none',
              borderRadius: 6,
              color: inputValue.trim() ? '#000' : '#525252',
              fontSize: 12,
              fontWeight: 600,
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  )
}
