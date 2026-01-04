import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

// 简化：消息部件（按时间顺序）
export interface MessagePart {
  type: 'text' | 'tool';
  content?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: string; // 工具输入参数（如搜索 query）
  toolStatus?: 'running' | 'completed' | 'error';
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface BotMessageProps {
  message: Message;
  parts?: MessagePart[]; // 按顺序的部件
  isStreaming?: boolean; // 是否正在生成中
}

export default function BotMessage({
  message,
  parts = [],
  isStreaming = false,
}: BotMessageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const copyPayload = message.content || '';
      if (!copyPayload) return;
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // 如果没有 parts，回退到简单的 content 渲染
  const hasParts = parts.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        gap: '8px',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 按顺序渲染所有 parts */}
      {hasParts ? (
        parts.map((part, index) => {
          if (part.type === 'text' && part.content) {
            return (
              <div
                key={index}
                style={{
                  fontSize: '13px',
                  color: '#d2d2d2',
                  lineHeight: '1.6',
                  width: '100%',
                }}
              >
                <MarkdownRenderer
                  content={part.content
                    .replace(/\r\n/g, '\n')
                    .replace(/\n{3,}/g, '\n\n')}
                />
              </div>
            );
          }

          if (part.type === 'tool') {
            const isRunning = part.toolStatus === 'running';
            const isCompleted = part.toolStatus === 'completed';
            const isError = part.toolStatus === 'error';

            return (
              <div
                key={part.toolId || index}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  height: '28px',
                  padding: '0 10px',
                  fontSize: '12px',
                  color: isError ? '#ff8a8a' : 'rgba(255,255,255,0.6)',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                {/* 状态指示器 */}
                {isRunning ? (
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      border: '1.5px solid rgba(255,255,255,0.2)',
                      borderTopColor: 'rgba(255,255,255,0.6)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      border: `1.5px solid ${isError ? '#ff6b6b' : '#555'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {isCompleted && (
                      <Check
                        size={7}
                        strokeWidth={2.5}
                        style={{ color: '#666' }}
                      />
                    )}
                  </div>
                )}

                {/* 工具名 + query */}
                <span>
                  {part.toolName}
                  {part.toolInput && (
                    <span style={{ opacity: 0.5, marginLeft: '6px' }}>
                      {part.toolInput}
                    </span>
                  )}
                </span>
              </div>
            );
          }

          return null;
        })
      ) : message.content ? (
        // 回退：简单渲染 content
        <div
          style={{
            fontSize: '13px',
            color: '#d2d2d2',
            lineHeight: '1.6',
            width: '100%',
          }}
        >
          <MarkdownRenderer content={message.content} />
        </div>
      ) : null}

      {/* 生成中提示 */}
      {isStreaming && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <div
            style={{
              width: '12px',
              height: '12px',
              border: '1.5px solid rgba(255,255,255,0.15)',
              borderTopColor: 'rgba(255,255,255,0.5)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      )}

      {/* Meta bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '2px',
          opacity: isHovered ? 0.6 : 0,
          transition: 'opacity 0.2s ease',
          alignSelf: 'flex-start',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: '4px',
            color: '#a0a0a0',
            cursor: 'pointer',
          }}
          title={copied ? 'Copied' : 'Copy message'}
          onClick={handleCopy}
        >
          {copied ? (
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check style={{ width: '12px', height: '12px', color: '#000' }} />
            </div>
          ) : (
            <Copy style={{ width: '14px', height: '14px' }} />
          )}
        </div>
      </div>

      {/* Animations */}
      <style jsx global>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
