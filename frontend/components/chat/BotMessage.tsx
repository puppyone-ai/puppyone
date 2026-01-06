import { Copy, Check, ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { useState } from 'react'
import MarkdownRenderer from './MarkdownRenderer'

// 简化：消息部件（按时间顺序）
export interface MessagePart {
  type: 'text' | 'tool'
  content?: string
  toolId?: string
  toolName?: string
  toolInput?: string      // 工具输入参数（如命令）
  toolOutput?: string     // 工具执行结果
  toolStatus?: 'running' | 'completed' | 'error'
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export interface BotMessageProps {
  message: Message
  parts?: MessagePart[]  // 按顺序的部件
  isStreaming?: boolean  // 是否正在生成中
}

// 截断命令显示
function truncateCommand(cmd: string, maxLen = 50): string {
  if (!cmd) return '';
  // 简化：只取主命令部分
  const simplified = cmd
    .replace(/\/workspace\/data\.json/g, 'data.json')
    .replace(/\/tmp\/temp\.json/g, 'temp.json')
    .replace(/> \/tmp\/temp\.json && mv \/tmp\/temp\.json \/workspace\/data\.json/g, '→ save');
  
  if (simplified.length <= maxLen) return simplified;
  return simplified.substring(0, maxLen) + '...';
}

// 单个 Tool 组件
function ToolItem({ part, isExpanded, onToggle }: { 
  part: MessagePart; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = part.toolStatus === 'running';
  const isCompleted = part.toolStatus === 'completed';
  const isError = part.toolStatus === 'error';
  
  return (
    <div style={{ marginBottom: '4px' }}>
      <div 
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          height: '26px',
          padding: '0 8px',
          fontSize: '11px',
          color: isError ? '#ff8a8a' : 'rgba(255,255,255,0.6)',
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: '4px',
          cursor: part.toolInput ? 'pointer' : 'default',
          maxWidth: '100%',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      >
        {/* 状态指示器 */}
        {isRunning ? (
          <div style={{
            width: '10px',
            height: '10px',
            border: '1.5px solid rgba(255,255,255,0.2)',
            borderTopColor: 'rgba(255,255,255,0.6)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            flexShrink: 0
          }} />
        ) : (
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            border: `1.5px solid ${isError ? '#ff6b6b' : '#444'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            {isCompleted && <Check size={6} strokeWidth={3} style={{ color: '#555' }} />}
          </div>
        )}
        
        {/* 工具名 */}
        <Terminal size={11} style={{ color: '#666', flexShrink: 0 }} />
        
        {/* 命令（截断） */}
        <span style={{ 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '10px',
          opacity: 0.7
        }}>
          {truncateCommand(part.toolInput || '', 60)}
        </span>
        
        {/* 展开箭头 - 有内容可展开时显示 */}
        {(part.toolInput || part.toolOutput) && (
          isExpanded ? 
            <ChevronDown size={12} style={{ color: '#666', flexShrink: 0 }} /> :
            <ChevronRight size={12} style={{ color: '#666', flexShrink: 0 }} />
        )}
      </div>
      
      {/* 展开的详情：命令 + 输出 */}
      {isExpanded && (part.toolInput || part.toolOutput) && (
        <div style={{
          marginTop: '4px',
          marginLeft: '20px',
          padding: '8px 10px',
          backgroundColor: 'rgba(0,0,0,0.3)',
          borderRadius: '4px',
          fontSize: '10px',
          fontFamily: 'ui-monospace, monospace',
          lineHeight: '1.5',
          maxHeight: '200px',
          overflowY: 'auto',
        }}>
          {/* 命令输入 */}
          {part.toolInput && (
            <div style={{ color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <span style={{ color: '#6b7280', marginRight: '6px' }}>$</span>
              {part.toolInput}
            </div>
          )}
          
          {/* 执行结果 */}
          {part.toolOutput && (
            <div style={{ 
              color: 'rgba(255,255,255,0.7)', 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-all',
              marginTop: part.toolInput ? '8px' : 0,
              paddingTop: part.toolInput ? '8px' : 0,
              borderTop: part.toolInput ? '1px solid rgba(255,255,255,0.1)' : 'none',
            }}>
              {part.toolOutput}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function BotMessage({ message, parts = [], isStreaming = false }: BotMessageProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  const handleCopy = async () => {
    try {
      const copyPayload = message.content || ''
      if (!copyPayload) return
      await navigator.clipboard.writeText(copyPayload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const hasParts = parts.length > 0

  return (
    <div 
      style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '8px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 按原顺序渲染所有 parts */}
      {hasParts ? (
        parts.map((part, index) => {
          if (part.type === 'text' && part.content) {
            return (
              <div key={`text-${index}`} style={{ 
                fontSize: '13px', 
                color: '#d2d2d2', 
                lineHeight: '1.6',
                width: '100%'
              }}>
                <MarkdownRenderer
                  content={part.content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')}
                />
              </div>
            )
          }
          
          if (part.type === 'tool') {
            const toolKey = part.toolId || `tool-${index}`;
            return (
              <ToolItem 
                key={toolKey}
                part={part}
                isExpanded={expandedTools.has(toolKey)}
                onToggle={() => toggleTool(toolKey)}
              />
            );
          }
          
          return null
        })
      ) : message.content ? (
        // 回退：简单渲染 content
        <div style={{ fontSize: '13px', color: '#d2d2d2', lineHeight: '1.6', width: '100%' }}>
          <MarkdownRenderer content={message.content} />
        </div>
      ) : null}

      {/* 生成中提示 */}
      {isStreaming && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '8px'
        }}>
          <div style={{
            width: '12px',
            height: '12px',
            border: '1.5px solid rgba(255,255,255,0.15)',
            borderTopColor: 'rgba(255,255,255,0.5)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        </div>
      )}

      {/* Meta bar */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px', 
        marginTop: '2px',
        opacity: isHovered ? 0.6 : 0, 
        transition: 'opacity 0.2s ease',
        alignSelf: 'flex-start'
      }}>
        <div 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            width: '20px', 
            height: '20px', 
            borderRadius: '4px', 
            color: '#a0a0a0', 
            cursor: 'pointer' 
          }} 
          title={copied ? 'Copied' : 'Copy message'} 
          onClick={handleCopy}
        >
          {copied ? (
            <div style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

