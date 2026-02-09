'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  McpInstance,
  McpToolDefinition,
  McpToolType,
  TOOL_INFO,
  updateMcpInstance,
} from '../lib/mcpApi';

interface McpInstanceInfoProps {
  instance: McpInstance;
  onUpdate?: (updates: Partial<McpInstance>) => Promise<void>;
}

export function McpInstanceInfo({ instance, onUpdate }: McpInstanceInfoProps) {
  const [activeTab, setActiveTab] = useState<'json' | 'yaml'>('json');
  const [copiedStates, setCopiedStates] = useState<{
    url: boolean;
    config: boolean;
  }>({
    url: false,
    config: false,
  });

  // 内联编辑状态
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(
    instance.name || 'Unnamed Instance'
  );
  const [savingName, setSavingName] = useState(false);

  const [editingTools, setEditingTools] = useState<Record<string, boolean>>({});
  const [toolsValues, setToolsValues] = useState<
    Record<string, McpToolDefinition>
  >(instance.tools_definition || {});
  const [savingTool, setSavingTool] = useState<string | null>(null);

  // 保存name
  const handleSaveName = async () => {
    if (!onUpdate || !nameValue.trim()) return;

    setSavingName(true);
    try {
      await updateMcpInstance(instance.api_key, { name: nameValue.trim() });
      setEditingName(false);
      if (onUpdate) {
        await onUpdate({ name: nameValue.trim() });
      }
    } catch (error) {
      console.error('Failed to update name:', error);
      alert('Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  // 保存工具定义
  const handleSaveTool = async (toolType: string) => {
    if (!onUpdate) return;

    setSavingTool(toolType);
    try {
      const updatedToolsDef = {
        ...instance.tools_definition,
        [toolType]: toolsValues[toolType],
      };
      await updateMcpInstance(instance.api_key, {
        tools_definition: updatedToolsDef as any,
      });
      setEditingTools(prev => ({ ...prev, [toolType]: false }));
      if (onUpdate) {
        await onUpdate({ tools_definition: updatedToolsDef as any });
      }
    } catch (error) {
      console.error('Failed to update tool:', error);
      alert('Failed to update tool definition');
    } finally {
      setSavingTool(null);
    }
  };

  const copyToClipboard = async (text: string, type: 'url' | 'config') => {
    await navigator.clipboard.writeText(text);
    setCopiedStates(prev => ({ ...prev, [type]: true }));
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [type]: false }));
    }, 2000);
  };

  // 使用 POST /api/v1/mcp 响应中的 url 字段
  // 如果 url 不存在（从列表获取的实例），则动态构建完整的 proxy URL
  const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';
  const mcpUrl =
    instance.url || `${API_BASE_URL}/api/v1/mcp/server/${instance.api_key}`;

  const config = {
    mcpServers: {
      [nameValue || 'unnamed-instance']: {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpUrl],
        env: {},
      },
    },
  };

  const customTheme = {
    ...vscDarkPlus,
    'code[class*="language-"]': {
      ...vscDarkPlus['code[class*="language-"]'],
      background: 'rgba(0,0,0,0.3)',
      color: '#9ca3af',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '11px',
    },
    'pre[class*="language-"]': {
      ...vscDarkPlus['pre[class*="language-"]'],
      background: 'rgba(0,0,0,0.3)',
      color: '#9ca3af',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '11px',
    },
  };

  const configText =
    activeTab === 'json'
      ? JSON.stringify(config, null, 2)
      : `mcpServers:
  ${nameValue || 'unnamed-instance'}:
    command: npx
    args:
      - -y
      - mcp-remote
      - ${mcpUrl}
    env: {}`;

  return (
    <>
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #0a0a0a;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #374151 #0a0a0a;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Name (可编辑) */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: '#525252',
                fontWeight: 500,
                letterSpacing: '0.3px',
              }}
            >
              INSTANCE NAME
            </div>
            {!editingName && onUpdate && (
              <button
                onClick={() => setEditingName(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#525252',
                  cursor: 'pointer',
                  padding: 2,
                  fontSize: 9,
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#9ca3af';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = '#525252';
                }}
              >
                <svg width='10' height='10' viewBox='0 0 14 14' fill='none'>
                  <path
                    d='M10 2l2 2-7 7H3v-2l7-7z'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinejoin='round'
                  />
                </svg>
              </button>
            )}
          </div>
          {editingName ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type='text'
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                autoFocus
                style={{
                  flex: 1,
                  height: 32,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 12,
                  color: '#e2e8f0',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSaveName}
                disabled={savingName || !nameValue.trim()}
                style={{
                  height: 32,
                  padding: '0 14px',
                  background: '#34d399',
                  border: 'none',
                  borderRadius: 6,
                  color: '#000',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: savingName ? 'wait' : 'pointer',
                }}
              >
                {savingName ? '...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setNameValue(instance.name || 'Unnamed Instance');
                }}
                style={{
                  height: 32,
                  padding: '0 14px',
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: 6,
                  color: '#9ca3af',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 6,
                padding: '8px 10px',
                border: '1px solid transparent',
                fontSize: 14,
                color: '#e2e8f0',
                fontWeight: 500,
              }}
            >
              {nameValue}
            </div>
          )}
        </div>

        {/* Registered Tools */}
        {instance.register_tools && instance.register_tools.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                color: '#525252',
                fontWeight: 500,
                marginBottom: 6,
                letterSpacing: '0.3px',
              }}
            >
              REGISTERED TOOLS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {instance.register_tools.map(toolType => {
                const toolDef =
                  toolsValues[toolType] ||
                  instance.tools_definition?.[toolType];
                const isEditing = editingTools[toolType];
                const isSaving = savingTool === toolType;

                if (!toolDef) return null;

                return (
                  <div
                    key={toolType}
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid transparent',
                      borderRadius: 6,
                      padding: '8px 10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: '#3b82f6',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          letterSpacing: '0.3px',
                        }}
                      >
                        {TOOL_INFO[toolType as McpToolType]?.label || toolType}
                      </div>
                      {!isEditing && onUpdate && (
                        <button
                          onClick={() =>
                            setEditingTools(prev => ({
                              ...prev,
                              [toolType]: true,
                            }))
                          }
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#525252',
                            cursor: 'pointer',
                            padding: 2,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = '#9ca3af';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = '#525252';
                          }}
                        >
                          <svg
                            width='10'
                            height='10'
                            viewBox='0 0 14 14'
                            fill='none'
                          >
                            <path
                              d='M10 2l2 2-7 7H3v-2l7-7z'
                              stroke='currentColor'
                              strokeWidth='1.2'
                              strokeLinejoin='round'
                            />
                          </svg>
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <>
                        <input
                          type='text'
                          value={toolsValues[toolType]?.name || ''}
                          onChange={e =>
                            setToolsValues(prev => ({
                              ...prev,
                              [toolType]: {
                                ...prev[toolType],
                                name: e.target.value,
                              },
                            }))
                          }
                          placeholder='Tool name'
                          style={{
                            width: '100%',
                            height: 32,
                            boxSizing: 'border-box',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 4,
                            padding: '0 8px',
                            fontSize: 12,
                            color: '#e2e8f0',
                            outline: 'none',
                            marginBottom: 6,
                          }}
                        />
                        <input
                          type='text'
                          value={toolsValues[toolType]?.description || ''}
                          onChange={e =>
                            setToolsValues(prev => ({
                              ...prev,
                              [toolType]: {
                                ...prev[toolType],
                                description: e.target.value,
                              },
                            }))
                          }
                          placeholder='Tool description'
                          style={{
                            width: '100%',
                            height: 32,
                            boxSizing: 'border-box',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 4,
                            padding: '0 8px',
                            fontSize: 12,
                            color: '#9ca3af',
                            outline: 'none',
                            marginBottom: 8,
                          }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            justifyContent: 'flex-end',
                          }}
                        >
                          <button
                            onClick={() => handleSaveTool(toolType)}
                            disabled={isSaving}
                            style={{
                              height: 26,
                              padding: '0 12px',
                              background: '#34d399',
                              border: 'none',
                              borderRadius: 4,
                              color: '#000',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: isSaving ? 'wait' : 'pointer',
                            }}
                          >
                            {isSaving ? '...' : 'Save'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingTools(prev => ({
                                ...prev,
                                [toolType]: false,
                              }));
                              setToolsValues(prev => ({
                                ...prev,
                                [toolType]:
                                  instance.tools_definition?.[toolType] ||
                                  prev[toolType],
                              }));
                            }}
                            style={{
                              height: 26,
                              padding: '0 12px',
                              background: 'transparent',
                              border: '1px solid #333',
                              borderRadius: 4,
                              color: '#9ca3af',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#e2e8f0',
                            marginBottom: 2,
                            fontWeight: 500,
                          }}
                        >
                          {toolDef.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#71717a',
                            lineHeight: 1.4,
                          }}
                        >
                          {toolDef.description}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* URL */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: '#525252',
                fontWeight: 500,
                letterSpacing: '0.3px',
              }}
            >
              URL
            </div>
            <button
              onClick={() => copyToClipboard(mcpUrl, 'url')}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                color: copiedStates.url ? '#34d399' : '#525252',
                cursor: 'pointer',
                padding: 2,
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => {
                if (!copiedStates.url) e.currentTarget.style.color = '#9ca3af';
              }}
              onMouseLeave={e => {
                if (!copiedStates.url) e.currentTarget.style.color = '#525252';
              }}
              title={copiedStates.url ? 'Copied!' : 'Copy'}
            >
              {copiedStates.url ? (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <polyline points='20 6 9 17 4 12'></polyline>
                </svg>
              ) : (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect>
                  <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path>
                </svg>
              )}
            </button>
          </div>
          <div
            className='custom-scrollbar'
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              overflow: 'auto',
              border: '1px solid transparent',
              maxHeight: 80,
            }}
          >
            <SyntaxHighlighter
              language='text'
              style={customTheme}
              customStyle={{
                margin: 0,
                padding: '8px 10px',
                fontSize: '11px',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                background: 'transparent',
                wordBreak: 'break-all',
                overflowWrap: 'break-word',
                lineHeight: '1.4',
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {mcpUrl}
            </SyntaxHighlighter>
          </div>
        </div>

        {/* MCP Config */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setActiveTab('json')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'json' ? '#3b82f6' : '#525252',
                  fontSize: 10,
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: activeTab === 'json' ? 600 : 400,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  transition: 'color 0.15s',
                }}
              >
                json
              </button>
              <button
                onClick={() => setActiveTab('yaml')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'yaml' ? '#3b82f6' : '#525252',
                  fontSize: 10,
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: activeTab === 'yaml' ? 600 : 400,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  transition: 'color 0.15s',
                }}
              >
                yaml
              </button>
            </div>
            <button
              onClick={() => copyToClipboard(configText, 'config')}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                color: copiedStates.config ? '#34d399' : '#525252',
                cursor: 'pointer',
                padding: 2,
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => {
                if (!copiedStates.config)
                  e.currentTarget.style.color = '#9ca3af';
              }}
              onMouseLeave={e => {
                if (!copiedStates.config)
                  e.currentTarget.style.color = '#525252';
              }}
              title={copiedStates.config ? 'Copied!' : 'Copy'}
            >
              {copiedStates.config ? (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <polyline points='20 6 9 17 4 12'></polyline>
                </svg>
              ) : (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect>
                  <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path>
                </svg>
              )}
            </button>
          </div>
          <div
            className='custom-scrollbar'
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              overflow: 'auto',
              maxHeight: 140,
              border: '1px solid transparent',
            }}
          >
            <SyntaxHighlighter
              language={activeTab === 'json' ? 'json' : 'yaml'}
              style={customTheme}
              customStyle={{
                margin: 0,
                padding: '8px 10px',
                fontSize: '11px',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                background: 'transparent',
                lineHeight: '1.4',
              }}
              wrapLines={true}
              wrapLongLines={true}
            >
              {configText}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>
    </>
  );
}
