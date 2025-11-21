'use client'

import { useState, useEffect } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface McpInstanceInfoProps {
  apiKey: string
  url: string
  port: number
}

export function McpInstanceInfo({ apiKey, url, port }: McpInstanceInfoProps) {
  const [activeTab, setActiveTab] = useState<'json' | 'yaml'>('json')
  const [copiedStates, setCopiedStates] = useState<{
    apiKey: boolean
    url: boolean
    config: boolean
  }>({
    apiKey: false,
    url: false,
    config: false
  })

  // 构建完整的 URL，包含 api_key 查询参数
  const mcpUrl = `${url}?api_key=${apiKey}`
  
  const config = {
    mcpServers: {
      "context-base": {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          mcpUrl
        ],
        env: {}
      }
    }
  }

  const copyToClipboard = async (text: string, type: 'apiKey' | 'url' | 'config') => {
    await navigator.clipboard.writeText(text)
    setCopiedStates(prev => ({ ...prev, [type]: true }))
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [type]: false }))
    }, 2000)
  }

  // 自定义深色主题
  const customTheme = {
    ...vscDarkPlus,
    'code[class*="language-"]': {
      ...vscDarkPlus['code[class*="language-"]'],
      background: '#0d1117',
      color: '#cbd5f5',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
    },
    'pre[class*="language-"]': {
      ...vscDarkPlus['pre[class*="language-"]'],
      background: '#0d1117',
      color: '#cbd5f5',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
    },
  }

  const configText = activeTab === 'json' 
    ? JSON.stringify(config, null, 2)
    : `mcpServers:
  context-base:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
    env: {}`

  // 添加滚动条样式（只添加一次）
  useEffect(() => {
    // 检查样式是否已存在
    const existingStyle = document.getElementById('mcp-code-block-styles')
    if (existingStyle) return

    // 添加滚动条样式
    const style = document.createElement('style')
    style.id = 'mcp-code-block-styles'
    style.textContent = `
      .mcp-code-block::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      .mcp-code-block::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .mcp-code-block::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.2);
        border-radius: 4px;
      }
      
      .mcp-code-block::-webkit-scrollbar-thumb:hover {
        background: rgba(148, 163, 184, 0.35);
      }
      
      .mcp-code-block {
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.2) transparent;
      }
    `
    document.head.appendChild(style)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* API Key */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>API Key</div>
            <button 
              onClick={() => copyToClipboard(apiKey, 'apiKey')} 
              style={{ 
                background: 'transparent', 
                border: '1px solid rgba(148,163,184,0.2)', 
                borderRadius: 4,
                color: copiedStates.apiKey ? '#86efac' : '#94a3b8', 
                cursor: 'pointer',
                padding: '4px 6px',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24
              }}
              title={copiedStates.apiKey ? 'Copied!' : 'Copy'}
            >
              {copiedStates.apiKey ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
          </div>
          <div className="mcp-code-block" style={{ 
            background: '#0d1117', 
            borderRadius: 6, 
            overflow: 'hidden',
            maxHeight: 60,
            overflowY: 'auto'
          }}>
            <SyntaxHighlighter
              language="text"
              style={customTheme}
              customStyle={{
                margin: 0,
                padding: '8px',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
                background: '#0d1117',
                wordBreak: 'break-all',
                overflowWrap: 'break-word'
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {apiKey}
            </SyntaxHighlighter>
        </div>
      </div>

      {/* URL */}
      <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>URL</div>
            <button 
              onClick={() => copyToClipboard(url, 'url')} 
              style={{ 
                background: 'transparent', 
                border: '1px solid rgba(148,163,184,0.2)', 
                borderRadius: 4,
                color: copiedStates.url ? '#86efac' : '#94a3b8', 
                cursor: 'pointer',
                padding: '4px 6px',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24
              }}
              title={copiedStates.url ? 'Copied!' : 'Copy'}
            >
              {copiedStates.url ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
        </div>
        <div className="mcp-code-block" style={{ 
          background: '#0d1117', 
          borderRadius: 6, 
          overflow: 'hidden'
        }}>
          <SyntaxHighlighter
              language="text"
              style={customTheme}
              customStyle={{
                margin: 0,
                padding: '8px',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
                background: '#0d1117',
                wordBreak: 'break-all',
                overflowWrap: 'break-word'
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {url}
            </SyntaxHighlighter>
        </div>
      </div>

      {/* MCP Config */}
      <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setActiveTab('json')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'json' ? '#60a5fa' : '#94a3b8',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: activeTab === 'json' ? 600 : 400,
                  transition: 'color 0.2s'
                }}
              >
                JSON
              </button>
              <button
                onClick={() => setActiveTab('yaml')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'yaml' ? '#60a5fa' : '#94a3b8',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: activeTab === 'yaml' ? 600 : 400,
                  transition: 'color 0.2s'
                }}
              >
                YAML
              </button>
            </div>
            <button 
              onClick={() => copyToClipboard(configText, 'config')} 
              style={{ 
                background: 'transparent', 
                border: '1px solid rgba(148,163,184,0.2)', 
                borderRadius: 4,
                color: copiedStates.config ? '#86efac' : '#94a3b8', 
                cursor: 'pointer',
                padding: '4px 6px',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24
              }}
              title={copiedStates.config ? 'Copied!' : 'Copy'}
            >
              {copiedStates.config ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
        </div>
        <div className="mcp-code-block" style={{ 
          background: '#0d1117', 
          borderRadius: 6, 
          overflow: 'hidden',
          maxHeight: 200,
          overflowY: 'auto'
        }}>
          <SyntaxHighlighter
              language={activeTab === 'json' ? 'json' : 'yaml'}
              style={customTheme}
              customStyle={{
                margin: 0,
                padding: '8px',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'Courier New', monospace",
                background: '#0d1117',
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {configText}
            </SyntaxHighlighter>
        </div>
      </div>
    </div>
  )
}
