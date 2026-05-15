'use client';

import {
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';
import { Dots } from '@/components/loading';

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
      <div style={{ padding: '8px 12px', flexShrink: 0 }}>
        {/* Input Container - 上下排布 */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            boxSizing: 'border-box',
            backgroundColor: 'var(--po-panel-raised)',
            borderRadius: '12px',
            padding: '10px 12px',
            border: '1px solid var(--po-border-subtle)',
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
                background: 'var(--po-panel-raised)',
                border: '1px solid var(--po-border-strong)',
                borderRadius: 8,
                boxShadow: '0 4px 16px var(--po-shadow)',
                zIndex: 100,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--po-border-strong)',
                  fontSize: 11,
                  color: 'var(--po-text-subtle)',
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
                      color: index === mentionIndex ? 'var(--po-text)' : 'var(--po-text-muted)',
                      background:
                        index === mentionIndex
                          ? 'var(--po-selected)'
                          : 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'var(--po-font-sans)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onMouseEnter={() => onMentionIndexChange(index)}
                  >
                    <span style={{ color: 'var(--po-accent)', opacity: 0.7 }}>@</span>
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
                            background: 'var(--po-selected)',
                            color: 'var(--po-accent)',
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
                      <span key={i} style={{ color: 'var(--po-text)' }}>
                        {part}
                      </span>
                    );
                  })
              ) : (
                <span style={{ color: 'var(--po-text-subtle)' }}>
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
                caretColor: 'var(--po-text)',
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
                inputValue.trim() && !isLoading ? 'var(--po-text-disabled)' : 'var(--po-border)',
              color: 'var(--po-text-inverse)',
              transition: 'all 0.15s ease',
              opacity: !inputValue.trim() || isLoading ? 0.5 : 1,
              flexShrink: 0,
              alignSelf: 'flex-end',
            }}
          >
            {isLoading ? (
              <Dots size="xs" />
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
