'use client';

import {
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';

// Access 选项类型
export interface AccessOption {
  id: string;
  label: string;
  type: 'bash' | 'tool'; // bash = shell_access, tool = MCP tools
  icon?: React.ReactNode;
  tableId?: string; // 所属 table 的 ID
  tableName?: string; // 所属 table 的名称
}

interface ChatInputAreaProps {
  inputValue: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  isLoading: boolean;
  // @ 补全相关
  showMentionMenu: boolean;
  filteredMentionOptions: string[];
  mentionIndex: number;
  onMentionSelect: (key: string) => void;
  onMentionIndexChange: (index: number) => void;
  onBlur?: () => void;
  // 可选
  placeholder?: string;
  disabled?: boolean;
}

export interface ChatInputAreaRef {
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}

const ChatInputArea = forwardRef<ChatInputAreaRef, ChatInputAreaProps>(
  function ChatInputArea(
    {
      inputValue,
      onInputChange,
      onKeyDown,
      onSend,
      isLoading,
      showMentionMenu,
      filteredMentionOptions,
      mentionIndex,
      onMentionSelect,
      onMentionIndexChange,
      onBlur,
      placeholder,
      disabled = false,
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const mentionMenuRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      setSelectionRange: (start: number, end: number) => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(start, end);
      },
    }));

    // Auto-resize textarea：初始 28px，随内容增加而变高
    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // 先重置高度以获取正确的 scrollHeight
      textarea.style.height = '32px';
      const scrollHeight = textarea.scrollHeight;
      // 最小 28px，最大 200px
      const newHeight = Math.max(28, Math.min(scrollHeight, 200));
      textarea.style.height = `${newHeight}px`;

      // 同步更新容器高度
      const container = textarea.parentElement;
      if (container) {
        container.style.height = `${newHeight}px`;
      }
    }, [inputValue]);

    const defaultPlaceholder = 'Ask a question or let Agent help...';

    return (
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        {/* Input Container - 上下排布 */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxSizing: 'border-box',
            backgroundColor: '#1f1f1f',
            borderRadius: '8px',
            padding: '10px 12px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* @ 提及补全菜单 */}
          {showMentionMenu && filteredMentionOptions.length > 0 && (
            <div
              ref={mentionMenuRef}
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 8,
                marginBottom: 6,
                width: 200,
                maxHeight: 200,
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                zIndex: 100,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid #333',
                  fontSize: 11,
                  color: '#666',
                }}
              >
                Select data path
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 160 }}>
                {filteredMentionOptions.map((key, index) => (
                  <div
                    key={key}
                    onClick={() => onMentionSelect(key)}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      color: index === mentionIndex ? '#fff' : '#aaa',
                      background:
                        index === mentionIndex
                          ? 'rgba(107, 179, 248, 0.2)'
                          : 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onMouseEnter={() => onMentionIndexChange(index)}
                  >
                    <span style={{ color: '#6bb3f8', opacity: 0.7 }}>@</span>
                    {key}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 输入框容器 - 用于 @path 高亮 */}
          <div style={{ position: 'relative', minHeight: '28px' }}>
            {/* 高亮层 - 显示所有文本和样式 */}
            <div
              aria-hidden='true'
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                minHeight: '28px',
                padding: '4px 0',
                fontSize: '13px',
                lineHeight: '20px',
                fontFamily: 'inherit',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                wordBreak: 'break-word',
                pointerEvents: 'none',
                overflow: 'hidden',
              }}
            >
              {inputValue ? (
                inputValue
                  .split(/(@(?:\[\d+\]|[\w\u4e00-\u9fa5\.\-\_]+)+)/)
                  .map((part, i) => {
                    if (part && part.startsWith('@')) {
                      return (
                        <span
                          key={i}
                          style={{
                            background: 'rgba(107, 179, 248, 0.2)',
                            color: '#6bb3f8',
                            padding: '1px 0',
                            borderRadius: 3,
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                          }}
                        >
                          {part}
                        </span>
                      );
                    }
                    return (
                      <span key={i} style={{ color: '#e5e5e5' }}>
                        {part}
                      </span>
                    );
                  })
              ) : (
                <span style={{ color: '#666' }}>
                  {placeholder || defaultPlaceholder}
                </span>
              )}
            </div>

            {/* 实际的 textarea - 文字透明，只保留光标 */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              placeholder=''
              disabled={disabled || isLoading}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '32px',
                minHeight: '28px',
                maxHeight: '200px',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'transparent',
                fontSize: '13px',
                lineHeight: '20px',
                resize: 'none',
                fontFamily: 'inherit',
                padding: '4px 0',
                overflowY: 'auto',
                caretColor: '#e5e5e5',
                letterSpacing: 'normal',
              }}
              rows={1}
            />
          </div>

          {/* 发送按钮 - 靠右对齐，正方形 */}
          <button
            onClick={onSend}
            disabled={!inputValue.trim() || isLoading}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: !inputValue.trim() || isLoading ? 'default' : 'pointer',
              backgroundColor:
                inputValue.trim() && !isLoading ? '#525252' : '#2a2a2a',
              color: '#ffffff',
              transition: 'all 0.15s ease',
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
                <path d='M12 19v-14' />
                <path d='M5 12l7-7 7 7' />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }
);

export default ChatInputArea;
