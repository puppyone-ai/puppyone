'use client'

import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

interface DocumentEditorProps {
  path: string
  value: string
  onSave: (newValue: string) => void
  onClose: () => void
  isFullScreen?: boolean
  onToggleFullScreen?: () => void
}

export function DocumentEditor({ path, value, onSave, onClose, isFullScreen = false, onToggleFullScreen }: DocumentEditorProps) {
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const [editedValue, setEditedValue] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  // 同步外部值变化
  useEffect(() => {
    setEditedValue(value)
  }, [value])

  // Raw 模式时自动聚焦
  useEffect(() => {
    if (mode === 'raw' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [mode])

  const hasChanges = editedValue !== value
  
  // 切换到 Preview 时自动保存（如果有改动）
  const handleModeChange = (newMode: 'preview' | 'raw') => {
    if (mode === 'raw' && newMode === 'preview' && hasChanges) {
      onSave(editedValue)
    }
    setMode(newMode)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#0f0f11', // 与卡片背景一致
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{
        height: 46,
        padding: '0 16px',
        borderBottom: '1px solid #1a1a1c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        background: '#0f0f11',
      }}>
        {/* 左侧：收起按钮 + 全屏按钮 + Preview / Raw 切换 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 收起按钮 */}
          <button 
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: 0,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
            title="Collapse sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>

          {/* 全屏按钮 - 28x28 统一尺寸 */}
          <button 
            onClick={onToggleFullScreen}
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: 0,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
            title={isFullScreen ? "Exit full screen" : "Open full screen"}
          >
            {isFullScreen ? (
              // 退出全屏图标
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              // 进入全屏图标 (Open as page / Fullscreen)
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>

          {/* Preview / Raw 切换 */}
          <div style={{ 
            display: 'flex', 
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 6,
            padding: 2,
          }}>
          <button
            onClick={() => handleModeChange('preview')}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 500,
              color: mode === 'preview' ? '#e2e8f0' : '#6b7280',
              background: mode === 'preview' ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            Preview
          </button>
          <button
            onClick={() => handleModeChange('raw')}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 500,
              color: mode === 'raw' ? '#e2e8f0' : '#6b7280',
              background: mode === 'raw' ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Raw
            {hasChanges && mode === 'raw' && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#f59e0b',
              }}/>
            )}
          </button>
        </div>
      </div>
        
        {/* 右侧：字数统计 (关闭按钮已移至左侧) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, color: '#525252', fontFamily: 'monospace' }}>
            {editedValue.length.toLocaleString()} chars
          </span>
        </div>
      </div>

      {/* 主体内容区 */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {mode === 'preview' ? (
          /* 预览模式 - 渲染 Markdown/HTML */
          <div style={{ padding: '12px 16px', minHeight: '100%' }}>
            {editedValue ? (
              <div className="markdown-preview">
                <ReactMarkdown rehypePlugins={[rehypeRaw]}>{editedValue}</ReactMarkdown>
                <style jsx global>{`
                  .markdown-preview {
                    font-size: 14px;
                    line-height: 1.7;
                    color: #d4d4d4;
                  }
                  .markdown-preview h1, 
                  .markdown-preview h2, 
                  .markdown-preview h3, 
                  .markdown-preview h4, 
                  .markdown-preview h5, 
                  .markdown-preview h6 {
                    color: #e2e8f0;
                    margin-top: 1.5em;
                    margin-bottom: 0.5em;
                    font-weight: 600;
                  }
                  .markdown-preview h1 { font-size: 1.5em; }
                  .markdown-preview h2 { font-size: 1.3em; }
                  .markdown-preview h3 { font-size: 1.15em; }
                  .markdown-preview p {
                    margin: 0.8em 0;
                  }
                  .markdown-preview code {
                    background: rgba(255,255,255,0.08);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 0.9em;
                    color: #f472b6;
                  }
                  .markdown-preview pre {
                    background: rgba(0,0,0,0.4);
                    padding: 12px 16px;
                    border-radius: 8px;
                    overflow-x: auto;
                    margin: 1em 0;
                  }
                  .markdown-preview pre code {
                    background: transparent;
                    padding: 0;
                    color: #d4d4d4;
                  }
                  .markdown-preview ul, .markdown-preview ol {
                    padding-left: 1.5em;
                    margin: 0.8em 0;
                  }
                  .markdown-preview li {
                    margin: 0.3em 0;
                  }
                  .markdown-preview blockquote {
                    border-left: 3px solid #525252;
                    padding-left: 1em;
                    margin: 1em 0;
                    color: #9ca3af;
                  }
                  .markdown-preview a {
                    color: #60a5fa;
                    text-decoration: none;
                  }
                  .markdown-preview a:hover {
                    text-decoration: underline;
                  }
                  .markdown-preview hr {
                    border: none;
                    border-top: 1px solid #333;
                    margin: 1.5em 0;
                  }
                  /* 表格样式 - 支持 HTML table */
                  .markdown-preview table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1em 0;
                    font-size: 13px;
                  }
                  .markdown-preview th, .markdown-preview td {
                    border: 1px solid #333;
                    padding: 8px 12px;
                    text-align: left;
                  }
                  .markdown-preview th {
                    background: rgba(255,255,255,0.05);
                    font-weight: 600;
                  }
                  .markdown-preview tr:nth-child(even) {
                    background: rgba(255,255,255,0.02);
                  }
                  .markdown-preview img {
                    max-width: 100%;
                    border-radius: 8px;
                  }
                `}</style>
              </div>
            ) : (
              <div style={{ color: '#525252', fontStyle: 'italic' }}>
                (Empty content)
              </div>
            )}
          </div>
        ) : (
          /* Raw 模式 - 原始文本编辑 */
          <textarea
            ref={textareaRef}
            value={editedValue}
            onChange={(e) => setEditedValue(e.target.value)}
            style={{
              width: '100%',
              height: '100%',
              padding: '12px 16px',
              fontSize: 13,
              lineHeight: 1.6,
              color: '#e2e8f0',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              boxSizing: 'border-box',
            }}
            placeholder="Enter content..."
          />
        )}
      </div>
    </div>
  )
}
