'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import BotMessage from './chat/BotMessage';
import UserMessage from './chat/UserMessage';
import ChatInputArea, {
  ChatInputAreaRef,
  type AccessOption,
} from './chat/ChatInputArea';
import {
  useChatSessions,
  useChatMessages,
  deleteSession,
  refreshChatSessions,
  refreshChatMessages,
  type ChatSession,
  type MessagePart,
} from '../lib/hooks/useChat';
import { useMention } from '../lib/hooks/useMention';
import { API_BASE_URL } from '../config/api';
import { getApiAccessToken } from '../lib/apiClient';

const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 600;
const DEFAULT_CHAT_WIDTH = 400;

type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

interface Message {
  id?: string; // 数据库 ID
  role: MessageRole;
  content: string;
  timestamp?: Date;
  parts?: MessagePart[];
  isStreaming?: boolean;
}

import { type McpToolPermissions, type Tool as DbTool } from '../lib/mcpApi';

// AccessPoint 类型（从 ToolsPanel 复用）
interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  chatWidth?: number;
  onChatWidthChange?: (width: number) => void;
  contextData?: unknown;
  workingDirectory?: string;
  tableData?: unknown;
  tableId?: number | string;
  projectId?: number | string;
  onDataUpdate?: (newData: unknown) => void;
  // Access 配置 - 直接使用 accessPoints
  accessPoints?: AccessPoint[];
  // 项目级 tools（聚合所有 tables）——用于 ChatSidebar 展示/选择
  projectTools?: DbTool[];
  tableNameById?: Record<number, string>;
}

export function ChatSidebar({
  isOpen,
  onOpenChange,
  chatWidth = DEFAULT_CHAT_WIDTH,
  onChatWidthChange,
  contextData,
  workingDirectory,
  tableData,
  tableId,
  projectId,
  onDataUpdate,
  accessPoints = [],
  projectTools,
  tableNameById,
}: ChatSidebarProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  // 从 accessPoints 提取工具列表
  // shell_access → bash, 其他 → tool
  const toolTypeLabels: Record<string, string> = {
    query_data: 'Query',
    get_all_data: 'Get All',
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    shell_access: 'Bash',
    shell_access_readonly: 'Bash (Read-only)',
  };

  // 展开 accessPoints / projectTools 为工具列表
  const availableTools: AccessOption[] = [];
  const optionIdToTool = new Map<string, DbTool>();
  const allToolTypes = [
    'shell_access',
    'shell_access_readonly', // 新增
    'query_data',
    'get_all_data',
    'create',
    'update',
    'delete',
  ] as const;

  if (projectTools && projectTools.length > 0) {
    // 项目级：直接使用 DB tools 列表
    for (const t of projectTools) {
      const type = (t.type || '').trim();
      const isBash = type === 'shell_access' || type === 'shell_access_readonly';
      const tid = typeof t.table_id === 'number' ? t.table_id : null;
      const tableName =
        tid && tableNameById?.[tid] ? tableNameById[tid] : tid ? `Table ${tid}` : 'Table';
      const scopePath = (t.json_path || '').trim() || 'root';
      const labelBase = toolTypeLabels[type] || type || 'tool';
      const label = `${tableName} · ${labelBase} · ${scopePath}`;
      const optionId = `tool:${t.id}`;
      availableTools.push({
        id: optionId,
        label,
        type: isBash ? ('bash' as const) : ('tool' as const),
        tableId: tid ?? undefined,
        tableName: tableName,
      });
      optionIdToTool.set(optionId, t);
    }
  } else {
    // 兼容旧逻辑：从 accessPoints 推导
    accessPoints.forEach(ap => {
      allToolTypes.forEach(toolType => {
        // @ts-ignore - 忽略类型检查，因为 shell_access_readonly 可能不在 AccessPoint 定义里完全匹配
        if (ap.permissions[toolType]) {
          availableTools.push({
            id: `${ap.id}-${toolType}`, // 唯一 ID
            label: toolTypeLabels[toolType] || toolType,
            type:
              toolType === 'shell_access' || toolType === 'shell_access_readonly'
                ? ('bash' as const)
                : ('tool' as const),
          });
        }
      });
    });
  }
  const [isResizing, setIsResizing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAccess, setSelectedAccess] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<ChatInputAreaRef>(null);
  const [isFullyOpen, setIsFullyOpen] = useState(isOpen);

  // 监听 isOpen 变化，延迟设置 isFullyOpen
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsFullyOpen(true), 220);
      return () => clearTimeout(timer);
    } else {
      setIsFullyOpen(false);
    }
  }, [isOpen]);

  // 数据库相关状态
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  // @ 提及补全 Hook
  const mention = useMention({ data: tableData });

  // 数据库 Hooks
  const { sessions, isLoading: sessionsLoading } = useChatSessions();
  const { messages: dbMessages, isLoading: messagesLoading } =
    useChatMessages(currentSessionId);

  // 跟踪上一次的 sessionId 和是否已加载，用于检测会话切换
  const prevSessionIdRef = useRef<string | null>(null);
  const hasLoadedForSessionRef = useRef<string | null>(null);

  // 【单一数据源原则】：本地 messages 状态是唯一事实来源
  // dbMessages 仅在【切换会话】时作为初始值加载一次
  useEffect(() => {
    const sessionId = currentSessionId;

    // 1. 如果没有会话，清空消息
    if (!sessionId) {
      if (prevSessionIdRef.current !== null) {
        setMessages([]);
      }
      prevSessionIdRef.current = null;
      hasLoadedForSessionRef.current = null;
      return;
    }

    // 2. 检测会话切换
    if (sessionId !== prevSessionIdRef.current) {
      // 会话已改变，重置加载标记，并清空当前消息（显示骨架屏）
      hasLoadedForSessionRef.current = null;
      prevSessionIdRef.current = sessionId;
      setMessages([]);
    }

    // 3. 如果正在加载 SWR 数据，等待
    if (messagesLoading) return;

    // 4. 如果已经为当前会话加载过数据，【绝对不要】再次加载
    // 这样可以防止 SWR 的后台 revalidation 覆盖我们本地正在流式传输的消息
    if (hasLoadedForSessionRef.current === sessionId) {
      return;
    }

    // 5. 首次加载数据
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

  // 点击外部关闭历史菜单
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        historyMenuRef.current &&
        !historyMenuRef.current.contains(e.target as Node)
      ) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    messages.length,
    messages[messages.length - 1]?.content,
    messages[messages.length - 1]?.parts?.length,
  ]);

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const newWidth = windowWidth - e.clientX;
      const clampedWidth = Math.min(
        Math.max(newWidth, MIN_CHAT_WIDTH),
        MAX_CHAT_WIDTH
      );
      onChatWidthChange?.(clampedWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onChatWidthChange]);

  // 新建会话
  const handleNewChat = useCallback(async () => {
    // 服务端会在第一次发送消息时创建会话并持久化
    setCurrentSessionId(null);
    setMessages([]);
    setShowHistory(false);
  }, []);

  // 选择历史会话
  const handleSelectSession = useCallback((session: ChatSession) => {
    setCurrentSessionId(session.id);
    setShowHistory(false);
  }, []);

  // 删除会话
  const handleDeleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await deleteSession(sessionId);
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to delete session:', err);
      }
    },
    [currentSessionId]
  );

  // 统一的发送函数 - 调用后端 /api/v1/agents
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);

    // 添加用户消息
    const userMessage: Message = {
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    // 添加空的 assistant 消息
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
    let finalContent = '';
    let effectiveSessionId: string | null = currentSessionId;

    try {
      // 构建聊天历史（提取文本内容）
      const chatHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          // 提取文本内容：优先使用 content，否则从 parts 中提取
          let textContent = m.content || '';
          if (!textContent && m.parts) {
            textContent = m.parts
              .filter(p => p.type === 'text' && p.content)
              .map(p => p.content)
              .join('\n');
          }
          return {
            role: m.role as 'user' | 'assistant',
            content: textContent,
          };
        })
        .filter(m => m.content); // 过滤空消息

      // ========== 简化版：只传 tool IDs ==========
      // 从 selectedAccess 中提取数字 ID（格式是 "tool:35" -> 35）
      const activeToolIds: number[] = [];
      for (const optionId of selectedAccess) {
        // optionId 格式是 "tool:35"
        const match = optionId.match(/^tool:(\d+)$/);
        if (match) {
          activeToolIds.push(parseInt(match[1], 10));
        }
      }
      
      console.log('[ChatSidebar] Sending active_tool_ids:', activeToolIds);

      const token = await getApiAccessToken();

      // 统一调用后端 /api/v1/agents - 只传 active_tool_ids
      const response = await fetch(`${API_BASE_URL}/api/v1/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: currentInput,
          session_id: effectiveSessionId,
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

            // session 事件：后端创建新会话后回传 sessionId
            if (event.type === 'session') {
              if (event.sessionId && typeof event.sessionId === 'string') {
                effectiveSessionId = event.sessionId;
                // 防止 sessionId 切换触发 useEffect 清空本地消息（本次对话仍是同一条流）
                prevSessionIdRef.current = event.sessionId;
                hasLoadedForSessionRef.current = event.sessionId;
                setCurrentSessionId(event.sessionId);
                refreshChatSessions();
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
                  const toolIdx = parts.findIndex(
                    p => p.toolId === String(event.toolId)
                  );
                  if (toolIdx !== -1) {
                    parts[toolIdx] = {
                      ...parts[toolIdx],
                      toolStatus: event.success ? 'completed' : 'error',
                      toolOutput: event.output, // 保存工具执行结果
                    };
                  }
                  break;
                }
                case 'text':
                  parts.push({ type: 'text', content: event.content });
                  break;
                case 'result':
                  if (event.updatedData && onDataUpdate) {
                    onDataUpdate(event.updatedData);
                  }
                  break;
                case 'error':
                  parts.push({
                    type: 'text',
                    content: `Error: ${event.message}`,
                  });
                  break;
              }

              const content = parts
                .filter(p => p.type === 'text')
                .map(p => p.content)
                .join('\n\n');
              finalParts = parts;
              finalContent = content;
              return [...newMessages.slice(0, -1), { ...last, content, parts }];
            });
          } catch {}
        }
      }

      // 流结束
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

      // 后端会负责持久化；这里仅刷新 SWR 缓存供历史列表/切换会话使用
      if (effectiveSessionId) {
        refreshChatMessages(effectiveSessionId);
        refreshChatSessions();
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
          parts.push({
            type: 'text',
            content: 'An error occurred, please try again.',
          });
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
    workingDirectory,
    tableData,
    tableId,
    onDataUpdate,
    currentSessionId,
    messages.length,
    selectedAccess,
    projectId,
    projectTools?.length,
  ]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  // 处理输入变化（包装 mention hook）
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      mention.handleInputChange(e, inputValue, setInputValue);
    },
    [mention, inputValue]
  );

  // 选择补全项（包装 mention hook）
  const handleSelectMention = useCallback(
    (key: string) => {
      mention.handleSelectMention(
        key,
        inputValue,
        setInputValue,
        inputAreaRef.current
      );
    },
    [mention, inputValue]
  );

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 中文输入法组合过程中，不处理任何 Enter 事件
      if (e.nativeEvent.isComposing) {
        return;
      }

      // 补全菜单特殊处理：Enter/Tab 需要选择当前项
      if (
        mention.showMentionMenu &&
        mention.filteredMentionOptions.length > 0
      ) {
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          handleSelectMention(
            mention.filteredMentionOptions[mention.mentionIndex]
          );
          return;
        }
      }
      // 其他键盘事件交给 hook 处理
      mention.handleKeyDown(e, handleSend);
    },
    [mention, handleSelectMention, handleSend]
  );

  return (
    <aside
      ref={sidebarRef}
      style={{
        width: isOpen ? chatWidth : 0,
        minWidth: isOpen ? chatWidth : 0,
        height: '100%', // 使用 100% 而非 100vh，让高度相对于父容器而非视口
        background: '#111111',
        borderLeft: isOpen ? '1px solid #222' : 'none',
        display: 'flex',
        flexDirection: 'column',
        transition: isResizing
          ? 'none'
          : 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Resize Handle */}
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
          onMouseEnter={e => {
            if (!isResizing)
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
          }}
          onMouseLeave={e => {
            if (!isResizing) e.currentTarget.style.background = 'transparent';
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          height: 45,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #222',
          flexShrink: 0,
          background: '#111111',
          zIndex: 5,
        }}
      >
        <button
          onClick={() => onOpenChange(false)}
          title='Close Panel'
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = '#9ca3af';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#6b7280';
          }}
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <rect x='3' y='3' width='18' height='18' rx='2' />
            <line x1='15' y1='3' x2='15' y2='21' />
          </svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div ref={historyMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              title='Chat History'
              style={{
                width: 28,
                height: 28,
                background: showHistory
                  ? 'rgba(255,255,255,0.08)'
                  : 'transparent',
                border: 'none',
                color: showHistory ? '#9ca3af' : '#6b7280',
                cursor: 'pointer',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = '#9ca3af';
              }}
              onMouseLeave={e => {
                if (!showHistory) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }
              }}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12 6 12 12 16 14' />
              </svg>
            </button>

            {/* History Dropdown Menu */}
            {showHistory && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  width: 240,
                  maxHeight: 320,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 8,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  zIndex: 100,
                  overflow: 'hidden',
                }}
              >
                <div style={{ overflowY: 'auto', padding: '4px' }}>
                  {sessionsLoading ? (
                    <div
                      style={{
                        color: '#666',
                        fontSize: 12,
                        textAlign: 'center',
                        padding: 12,
                      }}
                    >
                      Loading...
                    </div>
                  ) : sessions.length === 0 ? (
                    <div
                      style={{
                        color: '#555',
                        fontSize: 12,
                        textAlign: 'center',
                        padding: 12,
                      }}
                    >
                      No chat history
                    </div>
                  ) : (
                    sessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => handleSelectSession(session)}
                        style={{
                          height: 28,
                          padding: '0 8px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background:
                            currentSessionId === session.id
                              ? 'rgba(255,255,255,0.08)'
                              : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => {
                          if (currentSessionId !== session.id)
                            e.currentTarget.style.background =
                              'rgba(255,255,255,0.04)';
                        }}
                        onMouseLeave={e => {
                          if (currentSessionId !== session.id)
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color:
                              currentSessionId === session.id ? '#fff' : '#aaa',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {session.title || 'New Chat'}
                        </div>
                        <button
                          onClick={e => handleDeleteSession(session.id, e)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#555',
                            cursor: 'pointer',
                            padding: 2,
                            opacity: 0,
                            transition: 'opacity 0.1s',
                            display: 'flex',
                            flexShrink: 0,
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.color = '#ff6b6b';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = '0';
                            e.currentTarget.style.color = '#555';
                          }}
                        >
                          <svg
                            width='12'
                            height='12'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                          >
                            <path d='M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2' />
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleNewChat}
            title='New Chat'
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#9ca3af';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#6b7280';
            }}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M12 5v14' />
              <path d='M5 12h14' />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          background: '#111111',
          maskImage:
            'linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent)',
        }}
      >
        {messagesLoading ? (
          // Skeleton loading - 模拟聊天消息骨架屏
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              padding: '10px 0',
            }}
          >
            {/* 用户消息骨架 */}
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
            {/* 助手消息骨架 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  width: '90%',
                  height: 14,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
              <div
                style={{
                  width: '75%',
                  height: 14,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
              <div
                style={{
                  width: '60%',
                  height: 14,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
            </div>
            {/* 第二组消息骨架 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div
                style={{
                  width: '50%',
                  height: 28,
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
              <div
                style={{
                  width: '85%',
                  height: 14,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
              <div
                style={{
                  width: '70%',
                  height: 14,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.04)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className='skeleton-shimmer' />
              </div>
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
              opacity: isFullyOpen ? 1 : 0,
              transition: isFullyOpen ? 'opacity 0.15s ease' : 'none', // 收起时无动画，展开时淡入
              visibility: isFullyOpen ? 'visible' : 'hidden', // 收起时立即隐藏
            }}
          >
            {tableData ? (
              // 有数据时的空状态
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  width: '100%',
                  maxWidth: 300,
                  textAlign: 'center',
                }}
              >
                {/* 主标题 */}
                <div style={{ fontSize: 14, color: '#ccc', fontWeight: 500 }}>
                  Ask, modify, or add to your context.
                </div>

                {/* 快捷操作建议 */}
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  {[
                    'What is the value of @[path]?',
                    'Change @[path] to a new value',
                    'Add a new entry under @[path]',
                    'Summarize the structure of this data',
                  ].map((text, i) => (
                    <button
                      key={i}
                      onClick={() => setInputValue(text)}
                      style={{
                        padding: '6px 0',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.opacity = '0.6';
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: '#666',
                          lineHeight: 1.4,
                          opacity: 0.6,
                        }}
                      >
                        {text.split('@[path]').map((part, j, arr) => (
                          <span key={j}>
                            {part}
                            {j < arr.length - 1 && (
                              <span style={{ color: '#5a9fd4' }}>@path</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // 无数据时的空状态
              <div style={{ textAlign: 'center' }}>
                <svg
                  width='28'
                  height='28'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  style={{ color: '#555', marginBottom: 12 }}
                >
                  <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
                </svg>
                <div
                  style={{
                    fontSize: 13,
                    color: '#666',
                    lineHeight: 1.6,
                    maxWidth: 220,
                  }}
                >
                  Select a table to start asking, modifying, or adding to your
                  data.
                </div>
              </div>
            )}
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
        availableTools={availableTools}
        selectedAccess={selectedAccess}
        onAccessChange={setSelectedAccess}
        currentTableId={tableId ? Number(tableId) : undefined}
      />

      <style jsx global>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
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
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </aside>
  );
}
