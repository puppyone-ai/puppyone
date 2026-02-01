'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import BotMessage from '../../chat/BotMessage';
import UserMessage from '../../chat/UserMessage';
import ChatInputArea, {
  ChatInputAreaRef,
  type AccessOption,
} from '../../chat/ChatInputArea';
import {
  useChatSessions,
  useChatMessages,
  refreshChatSessions,
  refreshChatMessages,
  type MessagePart,
} from '../../../lib/hooks/useChat';
import { useMention } from '../../../lib/hooks/useMention';
import { API_BASE_URL } from '../../../config/api';
import { getApiAccessToken } from '../../../lib/apiClient';
import { useAgent } from '@/contexts/AgentContext';

// Access Point 图标 - 动物 emoji（和 ProjectsHeader 保持一致）
const ACCESS_ICONS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦉',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌',
  '🐙', '🦑', '🦐', '🦀', '🐠', '🐬', '🦈', '🐳',
];
const parseAgentIcon = (icon?: string): string => {
  if (!icon) return '💬';
  const idx = parseInt(icon);
  if (isNaN(idx)) return icon; // 如果不是数字，可能是直接存的 emoji
  return ACCESS_ICONS[idx % ACCESS_ICONS.length] || '💬';
};

// 时间格式化
const getTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
};
import { type Tool as DbTool } from '../../../lib/mcpApi';

type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

interface Message {
  id?: string;
  role: MessageRole;
  content: string;
  timestamp?: Date;
  parts?: MessagePart[];
  isStreaming?: boolean;
}

interface ChatRuntimeViewProps {
  availableTools: AccessOption[];
  tableData?: unknown;
  tableId?: number | string;
  projectId?: number | string;
  onDataUpdate?: (newData: unknown) => void;
  projectTools?: DbTool[];
}

// Sub-component for agent name button with hover state
function AgentNameButton({ 
  agentIcon, 
  agentName, 
  isEditing, 
  canEdit, 
  onClick 
}: { 
  agentIcon: string; 
  agentName: string; 
  isEditing: boolean; 
  canEdit: boolean; 
  onClick: () => void; 
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      onClick={onClick}
      disabled={!canEdit}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 8px',
        background: isEditing ? 'rgba(255,255,255,0.08)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: '1px solid transparent',
        borderRadius: 6,
        cursor: canEdit ? 'pointer' : 'default',
        transition: 'all 0.15s',
      }}
    >
      {/* Agent icon */}
      <span style={{ fontSize: 14 }}>{agentIcon}</span>
      {/* Agent name */}
      <span style={{ fontSize: 13, fontWeight: 500, color: '#a1a1aa' }}>{agentName}</span>
      {/* Edit pencil icon - only show on hover */}
      {canEdit && (
        <svg 
          width="12" 
          height="12" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="#525252" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{
            opacity: isHovered || isEditing ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
        >
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
        </svg>
      )}
    </button>
  );
}

export function ChatRuntimeView({
  availableTools,
  tableData,
  tableId,
  projectId,
  onDataUpdate,
  projectTools,
}: ChatRuntimeViewProps) {
  const { 
    selectedCapabilities, 
    toggleCapability, 
    currentAgentId, 
    savedAgents,
    draftResources,
    addDraftResource,
    updateDraftResource,
    removeDraftResource,
    deleteAgent,
    updateAgentInfo,
  } = useAgent();

  const currentAgent = currentAgentId ? savedAgents.find(a => a.id === currentAgentId) : null;
  const agentName = currentAgent ? currentAgent.name : 'Agent';

  // --- Local State ---
  const [inputValue, setInputValue] = useState('');
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<ChatInputAreaRef>(null);
  const isInitialScrollRef = useRef(true); // Track if this is initial load or agent switch

  // 编辑 agent 信息
  const [editingName, setEditingName] = useState('');
  const [editingIconIdx, setEditingIconIdx] = useState(0);
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // Chat history 菜单
  const [isHistoryMenuOpen, setIsHistoryMenuOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const editPopoverRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) {
        setIsHistoryMenuOpen(false);
      }
      if (editPopoverRef.current && !editPopoverRef.current.contains(e.target as Node)) {
        setIsEditingInfo(false);
      }
    };
    if (isHistoryMenuOpen || isEditingInfo) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isHistoryMenuOpen, isEditingInfo]);

  // 初始化编辑值（当打开编辑弹窗时）
  useEffect(() => {
    if (isEditingInfo && currentAgent) {
      setEditingName(currentAgent.name);
      const iconIdx = parseInt(currentAgent.icon || '0');
      setEditingIconIdx(isNaN(iconIdx) ? ACCESS_ICONS.indexOf(currentAgent.icon || '') : iconIdx);
    }
  }, [isEditingInfo, currentAgent]);

  // 保存 agent 信息
  const handleSaveAgentInfo = useCallback(() => {
    if (currentAgentId && editingName.trim()) {
      updateAgentInfo(currentAgentId, editingName.trim(), String(editingIconIdx));
      setIsEditingInfo(false);
    }
  }, [currentAgentId, editingName, editingIconIdx, updateAgentInfo]);

  // 当展开设置面板时，初始化编辑值
  useEffect(() => {
    if (isSettingsExpanded && currentAgent) {
      setEditingName(currentAgent.name);
      const iconIdx = parseInt(currentAgent.icon || '0');
      setEditingIconIdx(isNaN(iconIdx) ? ACCESS_ICONS.indexOf(currentAgent.icon || '') : iconIdx);
    }
  }, [isSettingsExpanded, currentAgent]);

  // Database state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isNewChatMode, setIsNewChatMode] = useState(false); // 标记用户是否主动点击了"新建聊天"
  const prevAgentIdRef = useRef<string | null>(null);

  // @ mention Hook
  const mention = useMention({ data: tableData });

  // Database Hooks - 按 agent 过滤 session
  const { sessions } = useChatSessions(currentAgentId);
  const { messages: dbMessages, isLoading: messagesLoading } = useChatMessages(currentSessionId);

  const prevSessionIdRef = useRef<string | null>(null);
  const hasLoadedForSessionRef = useRef<string | null>(null);

  // 当切换 agent 时，重置 session
  useEffect(() => {
    if (prevAgentIdRef.current !== currentAgentId) {
      // Agent 切换了，重置 session
      setCurrentSessionId(null);
      setMessages([]);
      setIsNewChatMode(false); // 切换 agent 时重置新建聊天模式
      prevSessionIdRef.current = null;
      hasLoadedForSessionRef.current = null;
      prevAgentIdRef.current = currentAgentId;
      isInitialScrollRef.current = true; // Reset scroll behavior for new agent
    }
  }, [currentAgentId]);

  // 当 sessions 加载后，自动选择最新的 session（但如果用户主动新建聊天则不自动选择）
  useEffect(() => {
    if (sessions.length > 0 && currentSessionId === null && !isNewChatMode) {
      // 选择最新的 session（第一个）
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId, isNewChatMode]);

  // Sync dbMessages to local messages (on session switch only)
  useEffect(() => {
    const sessionId = currentSessionId;
    if (!sessionId) {
      if (prevSessionIdRef.current !== null) {
        setMessages([]);
      }
      prevSessionIdRef.current = null;
      hasLoadedForSessionRef.current = null;
      return;
    }

    if (sessionId !== prevSessionIdRef.current) {
      hasLoadedForSessionRef.current = null;
      prevSessionIdRef.current = sessionId;
      setMessages([]);
    }

    if (messagesLoading) return;
    if (hasLoadedForSessionRef.current === sessionId) return;

    hasLoadedForSessionRef.current = sessionId;

    if (dbMessages && dbMessages.length > 0) {
      const localMessages: Message[] = dbMessages.map(m => ({
        id: m.id,
        role: m.role as MessageRole,
        content: m.content || '',
        parts: m.parts || undefined,
        timestamp: new Date(m.created_at),
      }));
      setMessages(localMessages);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, dbMessages, messagesLoading]);

  // Auto-scroll
  useEffect(() => {
    if (isInitialScrollRef.current) {
      // Initial load or agent switch: jump instantly without animation
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      // After first scroll, use smooth scrolling for subsequent updates
      if (messages.length > 0) {
        isInitialScrollRef.current = false;
      }
    } else {
      // New message arrived: smooth scroll
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [
    messages.length,
    messages[messages.length - 1]?.content,
    messages[messages.length - 1]?.parts?.length,
  ]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);

    const userMessage: Message = {
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        parts: [],
        isStreaming: true,
      },
    ]);

    let finalParts: MessagePart[] = [];
    let effectiveSessionId: string | null = currentSessionId;

    try {
      const chatHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          let textContent = m.content || '';
          if (!textContent && m.parts) {
            textContent = m.parts
              .filter(p => p.type === 'text' && p.content)
              .map(p => p.content)
              .join('\n');
          }
          return { role: m.role as 'user' | 'assistant', content: textContent };
        })
        .filter(m => m.content);

      const activeToolIds: string[] = [];
      for (const optionId of selectedCapabilities) {
        const match = optionId.match(/^tool:(.+)$/);
        if (match) {
          activeToolIds.push(match[1]);
        }
      }

      const token = await getApiAccessToken();

      const response = await fetch(`${API_BASE_URL}/api/v1/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: currentInput,
          session_id: effectiveSessionId,
          agent_id: currentAgentId || undefined,
          chatHistory,
          active_tool_ids: activeToolIds.length > 0 ? activeToolIds : undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'session') {
              if (event.sessionId && typeof event.sessionId === 'string') {
                effectiveSessionId = event.sessionId;
                prevSessionIdRef.current = event.sessionId;
                hasLoadedForSessionRef.current = event.sessionId;
                setCurrentSessionId(event.sessionId);
                setIsNewChatMode(false); // 新 session 创建成功，重置新建聊天模式
                refreshChatSessions(currentAgentId);
              }
              continue;
            }

            setMessages(prev => {
              const newMessages = [...prev];
              const last = newMessages[newMessages.length - 1];
              if (!last || last.role !== 'assistant') return prev;

              const parts = [...(last.parts || [])];

              switch (event.type) {
                case 'status':
                  break;
                case 'tool_start':
                  parts.push({
                    type: 'tool',
                    toolId: String(event.toolId),
                    toolName: event.toolName || 'tool',
                    toolInput: event.toolInput,
                    toolStatus: 'running',
                  });
                  break;
                case 'tool_end': {
                  const toolIdx = parts.findIndex(p => p.toolId === String(event.toolId));
                  if (toolIdx !== -1) {
                    parts[toolIdx] = {
                      ...parts[toolIdx],
                      toolStatus: event.success ? 'completed' : 'error',
                      toolOutput: event.output,
                    };
                  }
                  break;
                }
                case 'text':
                  parts.push({ type: 'text', content: event.content });
                  break;
                case 'text_delta': {
                  let lastTextIdx = -1;
                  for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].type === 'text') {
                      lastTextIdx = i;
                      break;
                    }
                  }
                  if (lastTextIdx !== -1) {
                    parts[lastTextIdx] = {
                      ...parts[lastTextIdx],
                      content: (parts[lastTextIdx].content || '') + event.content,
                    };
                  } else {
                    parts.push({ type: 'text', content: event.content });
                  }
                  break;
                }
                case 'result':
                  if (event.updatedData && onDataUpdate) {
                    onDataUpdate(event.updatedData);
                  }
                  break;
                case 'error':
                  parts.push({ type: 'text', content: `Error: ${event.message}` });
                  break;
              }

              const content = parts
                .filter(p => p.type === 'text')
                .map(p => p.content)
                .join('\n\n');
              finalParts = parts;
              return [...newMessages.slice(0, -1), { ...last, content, parts }];
            });
          } catch {}
        }
      }

      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last?.role === 'assistant') {
          const parts = [...(last.parts || [])];
          parts.forEach((p, i) => {
            if (p.type === 'tool' && p.toolStatus === 'running') {
              parts[i] = { ...p, toolStatus: 'completed' };
            }
          });
          last.parts = parts;
          last.isStreaming = false;
          finalParts = parts;
        }
        return newMessages;
      });

      if (effectiveSessionId) {
        refreshChatMessages(effectiveSessionId);
        refreshChatSessions(currentAgentId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last?.role === 'assistant') {
          const parts = [...(last.parts || [])];
          parts.forEach((p, i) => {
            if (p.type === 'tool' && p.toolStatus === 'running') {
              parts[i] = { ...p, toolStatus: 'error' };
            }
          });
          parts.push({ type: 'text', content: 'An error occurred, please try again.' });
          last.content = 'An error occurred, please try again.';
          last.parts = parts;
          last.isStreaming = false;
        }
        return newMessages;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    inputValue,
    isLoading,
    tableData,
    tableId,
    onDataUpdate,
    currentSessionId,
    messages.length,
    selectedCapabilities,
    projectId,
    projectTools?.length,
  ]);

  // Input handling with mention
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      mention.handleInputChange(e, inputValue, setInputValue);
    },
    [mention, inputValue]
  );

  const handleSelectMention = useCallback(
    (key: string) => {
      mention.handleSelectMention(key, inputValue, setInputValue, inputAreaRef.current);
    },
    [mention, inputValue]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;

      if (mention.showMentionMenu && mention.filteredMentionOptions.length > 0) {
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          handleSelectMention(mention.filteredMentionOptions[mention.mentionIndex]);
          return;
        }
      }
      mention.handleKeyDown(e, handleSend);
    },
    [mention, handleSelectMention, handleSend]
  );

  // 新建聊天会话
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setIsNewChatMode(true); // 标记为新建聊天模式，防止自动选择最新 session
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#141414' }}>
      {/* Header - 48px height (47px + 1px border) */}
      <div style={{ 
        height: 47,
        padding: '0 16px', 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexShrink: 0 
      }}>
        {/* Left: Agent name with edit button */}
        <div style={{ position: 'relative' }} ref={editPopoverRef}>
          <AgentNameButton
            agentIcon={currentAgent ? parseAgentIcon(currentAgent.icon) : '💬'}
            agentName={agentName}
            isEditing={isEditingInfo}
            canEdit={!!currentAgentId}
            onClick={() => currentAgentId && setIsEditingInfo(!isEditingInfo)}
          />

          {/* Edit Popover - Compact inline design */}
          {isEditingInfo && currentAgent && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              background: '#161616',
              border: '1px solid #262626',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              zIndex: 100,
              overflow: 'hidden',
            }}>
              {/* Input row with icon selector */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center',
                padding: 8,
                gap: 8,
                borderBottom: '1px solid #222',
              }}>
                {/* Current icon button - click to show picker */}
                <button
                  onClick={() => {
                    const next = (editingIconIdx + 1) % ACCESS_ICONS.length;
                    setEditingIconIdx(next);
                  }}
                  title="Click to change icon"
                  style={{
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1f1f1f',
                    border: '1px solid #333',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {ACCESS_ICONS[editingIconIdx]}
                </button>
                
                {/* Name input */}
                <input
                  type="text"
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => { 
                    if (e.key === 'Enter') handleSaveAgentInfo(); 
                    if (e.key === 'Escape') setIsEditingInfo(false);
                  }}
                  placeholder="Agent name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 32,
                    padding: '0 10px',
                    background: '#1f1f1f',
                    border: '1px solid #333',
                    borderRadius: 6,
                    color: '#e4e4e7',
                    fontSize: 13,
                    outline: 'none',
                  }}
                  autoFocus
                />
                
                {/* Save button */}
                <button
                  onClick={handleSaveAgentInfo}
                  disabled={!editingName.trim()}
                  style={{
                    height: 32,
                    padding: '0 12px',
                    background: editingName.trim() ? '#22c55e' : '#262626',
                    border: 'none',
                    borderRadius: 6,
                    color: editingName.trim() ? '#fff' : '#525252',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: editingName.trim() ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                  }}
                >
                  Save
                </button>
              </div>

              {/* Icon grid - compact */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(8, 1fr)', 
                gap: 2,
                padding: 6,
                maxHeight: 96,
                overflowY: 'auto',
              }}>
                {ACCESS_ICONS.map((icon, idx) => (
                  <button
                    key={idx}
                    onClick={() => setEditingIconIdx(idx)}
                    style={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: editingIconIdx === idx ? '#333' : 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 14,
                      opacity: editingIconIdx === idx ? 1 : 0.6,
                      transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#2a2a2a'; }}
                    onMouseLeave={e => { 
                      e.currentTarget.style.opacity = editingIconIdx === idx ? '1' : '0.6'; 
                      e.currentTarget.style.background = editingIconIdx === idx ? '#333' : 'transparent'; 
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Right side buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Chat History Button - 点击显示菜单 */}
          {currentAgentId && (
            <div style={{ position: 'relative' }} ref={historyMenuRef}>
              <button 
                onClick={() => setIsHistoryMenuOpen(!isHistoryMenuOpen)}
                title={sessions.length > 0 ? `${sessions.length} chat${sessions.length > 1 ? 's' : ''} - Click to view` : 'No chat history yet'}
                style={{
                  width: 28,
                  height: 28,
                  background: isHistoryMenuOpen ? '#252525' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: isHistoryMenuOpen ? '#fff' : (sessions.length > 0 ? '#888' : '#444'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!isHistoryMenuOpen) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = '#252525'; }}}
                onMouseLeave={e => { if (!isHistoryMenuOpen) { e.currentTarget.style.color = sessions.length > 0 ? '#888' : '#444'; e.currentTarget.style.background = 'transparent'; }}}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
              
              {/* Chat History 下拉菜单 */}
              {isHistoryMenuOpen && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  minWidth: 220,
                  maxHeight: 300,
                  overflowY: 'auto',
                  background: '#161616',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  zIndex: 100,
                }}>
                  {sessions.length > 0 ? (
                    sessions.map((session, idx) => {
                      // 计算时间显示
                      const createdAt = session.created_at ? new Date(session.created_at) : null;
                      const timeAgo = createdAt ? getTimeAgo(createdAt) : '';
                      return (
                        <button
                          key={session.id}
                          onClick={() => {
                            setCurrentSessionId(session.id);
                            setIsHistoryMenuOpen(false);
                          }}
                          style={{
                            width: '100%',
                            height: 32,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '0 12px',
                            background: session.id === currentSessionId ? '#252525' : 'transparent',
                            border: 'none',
                            borderBottom: idx < sessions.length - 1 ? '1px solid #1f1f1f' : 'none',
                            color: session.id === currentSessionId ? '#fff' : '#a3a3a3',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: 13,
                          }}
                          onMouseEnter={e => { if (session.id !== currentSessionId) e.currentTarget.style.background = '#1f1f1f'; }}
                          onMouseLeave={e => { if (session.id !== currentSessionId) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {session.title || `Chat ${sessions.length - idx}`}
                        </span>
                          {timeAgo && <span style={{ fontSize: 11, color: '#525252', flexShrink: 0 }}>{timeAgo}</span>}
                        </button>
                      );
                    })
                  ) : (
                    <div style={{ padding: '16px 12px', fontSize: 13, color: '#525252', textAlign: 'center' }}>
                      No chat history yet
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* New Chat Button */}
          {currentAgentId && (
            <button 
              onClick={handleNewChat}
              title="New chat"
              style={{
                width: 28,
                height: 28,
                background: currentSessionId === null && messages.length === 0 ? '#252525' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: currentSessionId === null && messages.length === 0 ? '#fff' : '#666',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = '#252525'; }}
              onMouseLeave={e => { 
                e.currentTarget.style.color = currentSessionId === null && messages.length === 0 ? '#fff' : '#666'; 
                e.currentTarget.style.background = currentSessionId === null && messages.length === 0 ? '#252525' : 'transparent';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          )}

          {/* Settings Button */}
          {currentAgentId && (
            <button 
              onClick={() => setIsSettingsExpanded(!isSettingsExpanded)} 
              title={isSettingsExpanded ? "Close settings" : "Edit settings"}
              style={{
                width: 28,
                height: 28,
                background: isSettingsExpanded ? '#252525' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: isSettingsExpanded ? '#fff' : '#666',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isSettingsExpanded) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = '#252525'; }}}
              onMouseLeave={e => { if (!isSettingsExpanded) { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'transparent'; }}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expandable Settings Panel */}
      {isSettingsExpanded && currentAgent && (
        <div style={{
          padding: '12px 16px',
          background: '#1a1a1a',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {/* 编辑名字和图标 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* 图标按钮 - 点击切换 */}
            <button
              onClick={() => setEditingIconIdx((editingIconIdx + 1) % ACCESS_ICONS.length)}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#252525'; e.currentTarget.style.borderColor = '#3a3a3a'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
              title="Click to change icon"
            >
              {ACCESS_ICONS[editingIconIdx] || parseAgentIcon(currentAgent.icon)}
            </button>
            
            {/* 名字输入 */}
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              style={{
                flex: 1,
                height: 32,
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 4,
                padding: '0 10px',
                color: '#e5e5e5',
                fontSize: 14,
                outline: 'none',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#4ade80'}
              onBlur={e => e.currentTarget.style.borderColor = '#2a2a2a'}
            />
            
            {/* 保存按钮 */}
            <button
              onClick={async () => {
                if (currentAgentId && editingName.trim()) {
                  await updateAgentInfo(currentAgentId, editingName.trim(), ACCESS_ICONS[editingIconIdx]);
                }
              }}
              disabled={!editingName.trim() || (editingName === currentAgent.name && ACCESS_ICONS[editingIconIdx] === parseAgentIcon(currentAgent.icon))}
              style={{
                height: 32,
                padding: '0 12px',
                background: editingName.trim() && (editingName !== currentAgent.name || ACCESS_ICONS[editingIconIdx] !== parseAgentIcon(currentAgent.icon)) ? '#4ade80' : '#262626',
                color: editingName.trim() && (editingName !== currentAgent.name || ACCESS_ICONS[editingIconIdx] !== parseAgentIcon(currentAgent.icon)) ? '#000' : '#525252',
                border: 'none',
                borderRadius: 4,
                cursor: editingName.trim() && (editingName !== currentAgent.name || ACCESS_ICONS[editingIconIdx] !== parseAgentIcon(currentAgent.icon)) ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              Save
            </button>
          </div>

          {/* Agent's bash access - 和 AgentSettingView 保持一致 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>Agent's bash access</span>
          </div>
          <div 
            style={{ 
              minHeight: 88,
              background: 'transparent',
              border: '1px dashed #2a2a2a',
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = '#4ade80';
              e.currentTarget.style.background = 'rgba(74, 222, 128, 0.04)';
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a2a';
              e.currentTarget.style.background = 'transparent';
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = '#2a2a2a';
              e.currentTarget.style.background = 'transparent';
              try {
                const data = e.dataTransfer.getData('application/json');
                if (data) {
                  const node = JSON.parse(data);
                  const isFolder = node.type === 'folder';
                  const isJson = node.type === 'json';
                  addDraftResource({
                    nodeId: node.id,
                    nodeName: node.name,
                    nodeType: isFolder ? 'folder' : (isJson ? 'json' : 'file'),
                    readonly: false, // 默认 Write 模式
                  });
                }
              } catch (err) {
                console.error('Drop failed', err);
              }
            }}
          >
            {/* 文件列表 */}
            <div style={{ padding: currentAgent.resources && currentAgent.resources.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {currentAgent.resources && currentAgent.resources.map(resource => {
                // 使用新的 readonly 字段，向后兼容 terminalReadonly
                const isReadonly = resource.readonly ?? resource.terminalReadonly ?? true;
                return (
                  <div 
                    key={resource.nodeId}
                    style={{ 
                      height: 32,
                      display: 'flex', 
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 10px',
                      borderRadius: 4,
                      background: '#1a1a1a',
                      border: '1px solid #252525',
                      transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                  >
                    {/* 左侧：名称 */}
                    <span style={{ fontSize: 14, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                      {resource.nodeName}
                    </span>
                    
                    {/* 右侧：权限切换 + 删除 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {/* Segmented Control: Read | Write */}
                      <div style={{
                        display: 'flex',
                        background: '#0f0f0f',
                        border: '1px solid #2a2a2a',
                        borderRadius: 4,
                        padding: 2,
                        gap: 1,
                      }}>
                        <button 
                          onClick={() => updateDraftResource(resource.nodeId, { readonly: true })}
                          style={{
                            background: isReadonly ? '#333' : 'transparent',
                            border: 'none',
                            borderRadius: 3,
                            color: isReadonly ? '#e5e5e5' : '#505050',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '2px 8px',
                            fontWeight: 500,
                            transition: 'all 0.1s',
                          }}
                        >
                          Read
                        </button>
                        <button 
                          onClick={() => updateDraftResource(resource.nodeId, { readonly: false })}
                          style={{
                            background: !isReadonly ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                            border: 'none',
                            borderRadius: 3,
                            color: !isReadonly ? '#fbbf24' : '#505050',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '2px 8px',
                            fontWeight: 500,
                            transition: 'all 0.1s',
                          }}
                        >
                          Write
                        </button>
                      </div>
                      
                      <button
                        onClick={() => removeDraftResource(resource.nodeId)}
                        style={{ 
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 20, height: 20, borderRadius: 4,
                          background: 'transparent', 
                          border: 'none', 
                          color: '#505050', 
                          cursor: 'pointer',
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* 拖拽提示 */}
            <div style={{ 
              minHeight: currentAgent.resources && currentAgent.resources.length > 0 ? 32 : 88,
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              color: '#525252',
            }}>
              <span style={{ fontSize: 12 }}>
                {currentAgent.resources && currentAgent.resources.length > 0 ? 'Drag more' : 'Drag items into this'}
              </span>
            </div>
          </div>

          {/* Delete Button */}
          <button
            onClick={() => {
              if (confirm(`Delete "${currentAgent.name}"? This cannot be undone.`)) {
                deleteAgent(currentAgent.id);
              }
            }}
            style={{
              marginTop: 4,
              padding: '6px 10px',
              background: 'transparent',
              border: '1px solid #2a2a2a',
              borderRadius: 4,
              color: '#525252',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#ef4444';
              e.currentTarget.style.color = '#ef4444';
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#2a2a2a';
              e.currentTarget.style.color = '#525252';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete Access
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          background: '#141414',
        }}
      >
        {messagesLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div
                style={{
                  width: '70%',
                  height: 36,
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[90, 75, 60].map((w, i) => (
                <div
                  key={i}
                  style={{
                    width: `${w}%`,
                    height: 14,
                    borderRadius: 4,
                    background: 'rgba(255, 255, 255, 0.04)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div className='skeleton-shimmer' />
                </div>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
                style={{ color: '#444', marginBottom: 10 }}
              >
                <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
              </svg>
              <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, maxWidth: 200 }}>
                {`Ask ${agentName} a question...`}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) =>
            msg.role === 'user' ? (
              <UserMessage
                key={msg.id || `user-${idx}`}
                message={{ content: msg.content, timestamp: msg.timestamp }}
                showAvatar={false}
              />
            ) : (
              <BotMessage
                key={msg.id || `assistant-${idx}`}
                message={{ role: 'assistant', content: msg.content }}
                parts={msg.parts}
                isStreaming={msg.isStreaming}
              />
            )
          )
        )}
        <div ref={messagesEndRef} style={{ height: 1 }} />
      </div>

      {/* Input Area */}
      <ChatInputArea
        ref={inputAreaRef}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        isLoading={isLoading}
        showMentionMenu={mention.showMentionMenu}
        filteredMentionOptions={mention.filteredMentionOptions}
        mentionIndex={mention.mentionIndex}
        onMentionSelect={handleSelectMention}
        onMentionIndexChange={mention.setMentionIndex}
        onBlur={() => setTimeout(() => mention.closeMentionMenu(), 150)}
      />

      <style jsx global>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .skeleton-shimmer {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.08),
            transparent
          );
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  );
}

