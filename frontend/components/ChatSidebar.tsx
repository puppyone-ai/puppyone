'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import BotMessage from './chat/BotMessage';
import UserMessage from './chat/UserMessage';
import ModeSelector, { ChatMode } from './chat/ModeSelector';
// import MCPBar from './chat/MCPBar';

const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 600;
const DEFAULT_CHAT_WIDTH = 400;

type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

// 简化：消息部件（按时间顺序）
interface MessagePart {
  type: 'text' | 'tool';
  content?: string; // type='text' 时的文本
  toolId?: string; // type='tool' 时的工具ID
  toolName?: string; // type='tool' 时的工具名
  toolInput?: string; // type='tool' 时的输入参数
  toolStatus?: 'running' | 'completed' | 'error';
}

interface Message {
  role: MessageRole;
  content: string; // 保留用于简单消息
  timestamp?: Date;
  parts?: MessagePart[]; // Agent 模式：按顺序的部件
  isStreaming?: boolean; // 是否正在生成中
}

interface ChatSidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  chatWidth?: number;
  onChatWidthChange?: (width: number) => void;
  contextData?: unknown;
  workingDirectory?: string;
}

export function ChatSidebar({
  isOpen,
  onOpenChange,
  chatWidth = DEFAULT_CHAT_WIDTH,
  onChatWidthChange,
  contextData,
  workingDirectory,
}: ChatSidebarProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isResizing, setIsResizing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('agent');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Only auto-resize if there's content, otherwise use CSS default
    if (inputValue.trim()) {
      textarea.style.height = '0px';
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    } else {
      textarea.style.height = 'auto';
    }
  }, [inputValue]);

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

  const buildSystemPrompt = useCallback(() => {
    let systemPrompt = `You are Puppy 🐶, a helpful AI assistant that helps users understand and navigate their data context. 
You are friendly, concise, and knowledgeable. Always respond in the same language the user uses.`;
    if (contextData) {
      systemPrompt += `\n\nContext data:\n\`\`\`json\n${JSON.stringify(contextData, null, 2)}\n\`\`\``;
    }
    return systemPrompt;
  }, [contextData]);

  const handleAskSend = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMessage: Message = {
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMessage]);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role === 'tool' ? 'assistant' : m.role,
            content: m.content,
          })),
          systemPrompt: buildSystemPrompt(),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let accumulatedContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulatedContent += parsed.text;
                setMessages(prev => {
                  const newMessages = [...prev];
                  const last = newMessages[newMessages.length - 1];
                  if (last?.role === 'assistant')
                    last.content = accumulatedContent;
                  return newMessages;
                });
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last?.role === 'assistant')
          last.content = '抱歉，发生了错误。请稍后重试。';
        return newMessages;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [inputValue, isLoading, messages, buildSystemPrompt]);

  const handleAgentSend = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;
    const userMessage: Message = {
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: inputValue,
          allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch'],
          workingDirectory,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      // ===== 极简架构：用 parts 数组按顺序存储所有内容 =====
      const seen = new Set<string>();
      let buffer = '';

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
            const msg = JSON.parse(data);

            // UUID 去重
            if (msg.uuid) {
              if (seen.has(msg.uuid)) continue;
              seen.add(msg.uuid);
            }

            console.log('[Agent]', msg.type);

            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant') return prev;

              const parts = [...(last.parts || [])];
              const blocks = msg.message?.content;

              // ===== assistant: 文本和工具调用按顺序加入 =====
              if (msg.type === 'assistant' && Array.isArray(blocks)) {
                for (const b of blocks) {
                  if (b.type === 'text' && b.text) {
                    parts.push({ type: 'text', content: b.text });
                  }
                  if (
                    b.type === 'tool_use' &&
                    b.id &&
                    !parts.find(p => p.toolId === b.id)
                  ) {
                    // 提取工具输入（如搜索 query）
                    const toolInput =
                      b.input?.query || b.input?.path || b.input?.pattern || '';
                    parts.push({
                      type: 'tool',
                      toolId: b.id,
                      toolName: b.name || 'Tool',
                      toolInput,
                      toolStatus: 'running',
                    });
                  }
                }
              }

              // ===== user (tool_result): 更新工具状态 =====
              if (msg.type === 'user' && Array.isArray(blocks)) {
                for (const b of blocks) {
                  if (b.type === 'tool_result' && b.tool_use_id) {
                    const i = parts.findIndex(p => p.toolId === b.tool_use_id);
                    if (i !== -1)
                      parts[i] = { ...parts[i], toolStatus: 'completed' };
                  }
                }
              }

              // ===== result: 标记所有工具完成，停止 streaming =====
              let isStreaming = last.isStreaming;
              if (msg.type === 'result') {
                parts.forEach((p, i) => {
                  if (p.type === 'tool' && p.toolStatus === 'running') {
                    parts[i] = { ...p, toolStatus: 'completed' };
                  }
                });
                // 如果没有任何内容，用 result
                if (parts.length === 0 && msg.result) {
                  parts.push({ type: 'text', content: msg.result });
                }
                isStreaming = false; // 生成完成
              }

              // ===== error =====
              if (msg.type === 'error') {
                parts.push({
                  type: 'tool',
                  toolName: `Error: ${msg.error || msg.message}`,
                  toolStatus: 'error',
                });
                isStreaming = false; // 出错也停止
              }

              // 生成 content（用于复制等）
              const content = parts
                .filter(p => p.type === 'text')
                .map(p => p.content)
                .join('\n\n');

              return [
                ...prev.slice(0, -1),
                { ...last, content, parts, isStreaming },
              ];
            });
          } catch {}
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last?.role === 'assistant') {
          last.content += '\n\n**Error:** An unexpected error occurred.';
        }
        return newMessages;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [inputValue, isLoading, workingDirectory]);

  const handleSend = useCallback(() => {
    if (mode === 'agent') handleAgentSend();
    else handleAskSend();
  }, [mode, handleAgentSend, handleAskSend]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  const handleClear = useCallback(() => setMessages([]), []);

  const inputStyles = {
    wrapper: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      border: isFocused ? '1px solid #444' : '1px solid #2a2a2a',
      borderRadius: '8px',
      padding: '6px 8px',
      backgroundColor: '#181818',
      transition: 'all 0.2s ease',
    },
    textarea: {
      flex: 1,
      height: 'auto',
      padding: '4px',
      resize: 'none' as const,
      outline: 'none',
      fontSize: '13px',
      lineHeight: '1.5',
      fontFamily: 'inherit',
      backgroundColor: 'transparent',
      color: '#e5e5e5',
      border: 'none',
      minHeight: '32px',
      boxSizing: 'border-box' as const,
      maxHeight: '150px',
      overflowY: 'auto' as const,
    },
    sendButton: {
      width: '28px',
      height: '28px',
      borderRadius: '4px',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      flexShrink: 0,
    },
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <aside
      ref={sidebarRef}
      style={{
        width: isOpen ? chatWidth : 0,
        minWidth: isOpen ? chatWidth : 0,
        height: '100vh',
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
          <button
            title='Chat History'
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
              <circle cx='12' cy='12' r='10' />
              <polyline points='12 6 12 12 16 14' />
            </svg>
          </button>
          <button
            onClick={handleClear}
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
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              opacity: 0.5,
            }}
          >
            <svg
              width='32'
              height='32'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.5'
              strokeLinecap='round'
              strokeLinejoin='round'
              style={{ color: '#6b7280' }}
            >
              <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
            </svg>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 13,
                  color: '#888',
                  lineHeight: 1.6,
                  maxWidth: 240,
                }}
              >
                Ask questions or let Agent help you explore your data.
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) =>
            msg.role === 'user' ? (
              <UserMessage
                key={idx}
                message={{ content: msg.content, timestamp: msg.timestamp }}
                showAvatar={false}
              />
            ) : (
              <BotMessage
                key={idx}
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
      <div style={{ padding: '12px', flexShrink: 0, background: '#111111' }}>
        {/* Mode + MCP - Above input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <ModeSelector mode={mode} onModeChange={setMode} />

          {mode === 'agent' && (
            <>
              {/* <div style={{ width: '1px', height: '16px', background: '#444' }} />
              <MCPBar enabled={true} /> */}
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: '8px',
            minHeight: '80px',
            boxSizing: 'border-box',
            backgroundColor: '#1a1a1a',
            borderRadius: '16px',
            padding: '8px',
            border: '1.5px solid #3a3a3a',
          }}
        >
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={
              mode === 'agent'
                ? 'Ask Agent to read files or search...'
                : 'Ask a question...'
            }
            disabled={isLoading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e5e5e5',
              fontSize: '13px',
              lineHeight: '1.5',
              resize: 'none',
              maxHeight: '200px',
              fontFamily: 'inherit',
              padding: '4px 8px',
              overflowY: 'auto',
            }}
            rows={1}
          />

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: !inputValue.trim() || isLoading ? 'default' : 'pointer',
              backgroundColor:
                inputValue.trim() && !isLoading ? '#4a90e2' : '#3a3a3a',
              color: '#ffffff',
              transition: 'all 0.2s ease',
              opacity: !inputValue.trim() || isLoading ? 0.5 : 1,
              flexShrink: 0,
              alignSelf: 'flex-end',
            }}
          >
            {isLoading ? (
              <div
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
            ) : (
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M5 12h14' />
                <path d='M12 5l7 7-7 7' />
              </svg>
            )}
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
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
