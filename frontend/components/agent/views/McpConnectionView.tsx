'use client';

import React, { useState } from 'react';
import type { SavedAgent } from '@/components/AgentRail';

interface McpConnectionViewProps {
  agent: SavedAgent;
  onEdit: () => void;
  onDelete: () => void;
}

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

export function McpConnectionView({ agent, onEdit, onDelete }: McpConnectionViewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Get base URL from environment or default
  const baseUrl = typeof window !== 'undefined' 
    ? window.location.origin.replace('3000', '8000')  // Dev mode: frontend 3000 -> backend 8000
    : 'https://api.puppyone.com';
  
  const mcpUrl = agent.mcp_api_key 
    ? `${baseUrl}/api/v1/mcp/server/${agent.mcp_api_key}`
    : null;

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Claude Desktop config
  const claudeConfig = mcpUrl ? JSON.stringify({
    "mcpServers": {
      [agent.name.toLowerCase().replace(/\s+/g, '-')]: {
        "url": mcpUrl
      }
    }
  }, null, 2) : null;

  // Cursor config
  const cursorConfig = mcpUrl ? JSON.stringify({
    "mcp": {
      "servers": {
        [agent.name.toLowerCase().replace(/\s+/g, '-')]: {
          "url": mcpUrl
        }
      }
    }
  }, null, 2) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #222', 
        background: '#0d0d0d',
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexShrink: 0 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
            {agent.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button 
            onClick={onEdit} 
            title="Edit settings"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
              borderRadius: 4,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#aaa'}
            onMouseLeave={e => e.currentTarget.style.color = '#666'}
          >
            <SettingsIcon />
          </button>
          <button 
            onClick={onDelete} 
            title="Delete"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
              borderRadius: 4,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={e => e.currentTarget.style.color = '#666'}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {!mcpUrl ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            color: '#666' 
          }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
            <div>MCP key not available</div>
            <div style={{ fontSize: 12, marginTop: 4, color: '#525252' }}>
              Save the agent to generate MCP key
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* MCP URL */}
            <div>
              <label style={{ 
                fontSize: 11, 
                fontWeight: 600, 
                color: '#525252', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px',
                marginBottom: 8,
                display: 'block'
              }}>
                MCP Server URL
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                padding: '8px 12px',
              }}>
                <code style={{ 
                  flex: 1, 
                  fontSize: 11, 
                  color: '#a3a3a3',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all'
                }}>
                  {mcpUrl}
                </code>
                <button
                  onClick={() => handleCopy(mcpUrl, 'url')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: copiedField === 'url' ? '#4ade80' : '#666',
                    padding: 4,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {copiedField === 'url' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>

            {/* Claude Desktop Config */}
            <div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                marginBottom: 8 
              }}>
                <img 
                  src="/icons/claude.svg" 
                  alt="Claude" 
                  style={{ width: 16, height: 16 }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <label style={{ 
                  fontSize: 11, 
                  fontWeight: 600, 
                  color: '#525252', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px',
                }}>
                  Claude Desktop Config
                </label>
              </div>
              <div style={{
                background: '#0a0a0a',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                padding: 12,
                position: 'relative',
              }}>
                <pre style={{ 
                  fontSize: 11, 
                  color: '#a3a3a3',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                }}>
                  {claudeConfig}
                </pre>
                <button
                  onClick={() => handleCopy(claudeConfig!, 'claude')}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: copiedField === 'claude' ? '#4ade80' : '#666',
                    padding: 4,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {copiedField === 'claude' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#525252', marginTop: 6 }}>
                Add to: ~/Library/Application Support/Claude/claude_desktop_config.json
              </div>
            </div>

            {/* Cursor Config */}
            <div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                marginBottom: 8 
              }}>
                <img 
                  src="/icons/cursor.svg" 
                  alt="Cursor" 
                  style={{ width: 16, height: 16 }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <label style={{ 
                  fontSize: 11, 
                  fontWeight: 600, 
                  color: '#525252', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px',
                }}>
                  Cursor Config
                </label>
              </div>
              <div style={{
                background: '#0a0a0a',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                padding: 12,
                position: 'relative',
              }}>
                <pre style={{ 
                  fontSize: 11, 
                  color: '#a3a3a3',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                }}>
                  {cursorConfig}
                </pre>
                <button
                  onClick={() => handleCopy(cursorConfig!, 'cursor')}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: copiedField === 'cursor' ? '#4ade80' : '#666',
                    padding: 4,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {copiedField === 'cursor' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#525252', marginTop: 6 }}>
                Add to: .cursor/mcp.json or Cursor Settings → MCP
              </div>
            </div>

            {/* Webhook / API Info */}
            {agent.type === 'webhook' && (
              <div>
                <label style={{ 
                  fontSize: 11, 
                  fontWeight: 600, 
                  color: '#525252', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px',
                  marginBottom: 8,
                  display: 'block'
                }}>
                  N8N / Zapier Integration
                </label>
                <div style={{
                  background: '#161616',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  padding: 12,
                  color: '#666',
                  fontSize: 12,
                }}>
                  <div style={{ marginBottom: 8 }}>
                    Use the MCP Server URL above with HTTP Request nodes.
                  </div>
                  <div style={{ fontSize: 11, color: '#525252' }}>
                    • Method: POST<br />
                    • Content-Type: application/json<br />
                    • Tools are exposed as JSON-RPC endpoints
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}



