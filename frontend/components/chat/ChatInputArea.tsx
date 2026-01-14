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
  // Access 选项
  availableTools?: AccessOption[];
  selectedAccess?: Set<string>;
  onAccessChange?: (selected: Set<string>) => void;
}

export interface ChatInputAreaRef {
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}

// Bash 图标
const BashIcon = () => (
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
    <polyline points='4 17 10 11 4 5' />
    <line x1='12' y1='19' x2='20' y2='19' />
  </svg>
);

// Tool 图标 (扳手)
const ToolIcon = () => (
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
    <path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' />
  </svg>
);

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
      availableTools = [],
      selectedAccess,
      onAccessChange,
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const mentionMenuRef = useRef<HTMLDivElement>(null);
    const [showBashMenu, setShowBashMenu] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);

    // 分离 Bash (shell_access) 和 MCP Tools
    const bashTools = availableTools.filter(t => t.type === 'bash');
    const mcpTools = availableTools.filter(t => t.type === 'tool');

    // 内部管理选中状态（如果外部没有传入）
    // 默认不选中任何工具，用户需要主动启用
    const [internalSelected, setInternalSelected] = useState<Set<string>>(
      new Set()
    );

    // 同步 availableTools 变化到 internalSelected
    // 当工具被移除时，从选中集合中删除
    useEffect(() => {
      const availableIds = new Set(availableTools.map(t => t.id));
      setInternalSelected(prev => {
        const newSet = new Set<string>();
        // 只保留仍然存在的选中项，不自动添加新工具
        prev.forEach(id => {
          if (availableIds.has(id)) newSet.add(id);
        });
        return newSet;
      });
    }, [availableTools]);

    const selected = selectedAccess ?? internalSelected;
    const setSelected = onAccessChange ?? setInternalSelected;

    // 切换选中状态
    const toggleAccess = (id: string) => {
      const newSelected = new Set(selected);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelected(newSelected);
    };

    // 计算选中的 Bash 和 Tools 数量
    const activeBashCount = bashTools.filter(t => selected.has(t.id)).length;
    const activeToolsCount = mcpTools.filter(t => selected.has(t.id)).length;

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
      textarea.style.height = '28px';
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

    // 是否有对应类型的工具
    const hasBashTools = bashTools.length > 0;
    const hasMcpTools = mcpTools.length > 0;

    return (
      <div style={{ padding: '12px', flexShrink: 0, background: '#111111' }}>
        {/* Access 选择器 - 简化版 (移除外层框) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8, // 增加间距，让按钮独立
            marginBottom: 8,
            padding: '0 2px', // 微调对齐
            // 移除所有背景和边框
            background: 'transparent',
            border: 'none',
          }}
        >
          {/* Bash 选择器 - 始终显示 */}
          <div style={{ position: 'relative' }}>
            <button
              type='button'
              onClick={() => hasBashTools && setShowBashMenu(!showBashMenu)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 26,
                padding: '0 10px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: 'none',
                cursor: hasBashTools ? 'pointer' : 'default',
                transition: 'all 0.15s',
                background:
                  activeBashCount > 0
                    ? 'rgba(255, 167, 61, 0.12)' // 金橙色 - 和 Editor 统一
                    : 'transparent',
                color: !hasBashTools
                  ? '#444'
                  : activeBashCount > 0
                    ? '#ffa73d'
                    : '#666',
                opacity: hasBashTools ? 1 : 0.5,
              }}
              onMouseEnter={e => {
                if (hasBashTools && activeBashCount === 0) {
                  e.currentTarget.style.background = 'rgba(255, 167, 61, 0.08)';
                  e.currentTarget.style.color = '#d4a574';
                }
              }}
              onMouseLeave={e => {
                if (hasBashTools && activeBashCount === 0) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#666';
                }
              }}
            >
              <BashIcon />
              <span>Bash</span>
              {activeBashCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#ffa73d',
                    background: 'rgba(255, 167, 61, 0.15)',
                    padding: '1px 5px',
                    borderRadius: 4,
                  }}
                >
                  {activeBashCount}
                </span>
              )}
              {hasBashTools && (
                <svg
                  width='10'
                  height='10'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  style={{
                    transform: showBashMenu ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    opacity: 0.5,
                  }}
                >
                  <path d='M6 9l6 6 6-6' />
                </svg>
              )}
            </button>

            {/* Bash Menu */}
            {showBashMenu && hasBashTools && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setShowBashMenu(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 8,
                    width: 200,
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    padding: 4,
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      color: '#525252',
                      fontWeight: 600,
                    }}
                  >
                    BASH
                  </div>
                  {bashTools.map(tool => (
                    <div
                      key={tool.id}
                      onClick={() => toggleAccess(tool.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: selected.has(tool.id) ? '#e5e5e5' : '#737373',
                        background: selected.has(tool.id)
                          ? '#262626'
                          : 'transparent',
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!selected.has(tool.id))
                          e.currentTarget.style.background = '#1f1f1f';
                      }}
                      onMouseLeave={e => {
                        if (!selected.has(tool.id))
                          e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <BashIcon />
                        {tool.label}
                      </div>
                      {selected.has(tool.id) && (
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#e5e5e5',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* MCP Tools 选择器 - 始终显示 */}
          <div style={{ position: 'relative' }}>
            <button
              type='button'
              onClick={() => hasMcpTools && setShowToolsMenu(!showToolsMenu)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 26,
                padding: '0 10px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: 'none',
                cursor: hasMcpTools ? 'pointer' : 'default',
                transition: 'all 0.15s',
                background:
                  activeToolsCount > 0
                    ? 'rgba(255, 167, 61, 0.12)' // 金橙色 - 和 Editor 统一
                    : 'transparent',
                color: !hasMcpTools
                  ? '#444'
                  : activeToolsCount > 0
                    ? '#ffa73d'
                    : '#666',
                opacity: hasMcpTools ? 1 : 0.5,
              }}
              onMouseEnter={e => {
                if (hasMcpTools && activeToolsCount === 0) {
                  e.currentTarget.style.background = 'rgba(255, 167, 61, 0.08)';
                  e.currentTarget.style.color = '#d4a574';
                }
              }}
              onMouseLeave={e => {
                if (hasMcpTools && activeToolsCount === 0) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#666';
                }
              }}
            >
              <ToolIcon />
              <span>Tools</span>
              {activeToolsCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#ffa73d',
                    background: 'rgba(255, 167, 61, 0.15)',
                    padding: '1px 5px',
                    borderRadius: 4,
                  }}
                >
                  {activeToolsCount}
                </span>
              )}
              {hasMcpTools && (
                <svg
                  width='10'
                  height='10'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  style={{
                    transform: showToolsMenu
                      ? 'rotate(180deg)'
                      : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    opacity: 0.5,
                  }}
                >
                  <path d='M6 9l6 6 6-6' />
                </svg>
              )}
            </button>

            {/* Tools Menu Popup */}
            {showToolsMenu && hasMcpTools && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setShowToolsMenu(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 8,
                    width: 180,
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    padding: 4,
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      color: '#525252',
                      fontWeight: 600,
                    }}
                  >
                    MCP TOOLS
                  </div>
                  {mcpTools.map(tool => (
                    <div
                      key={tool.id}
                      onClick={() => toggleAccess(tool.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: selected.has(tool.id) ? '#e5e5e5' : '#737373',
                        background: selected.has(tool.id)
                          ? '#262626'
                          : 'transparent',
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!selected.has(tool.id))
                          e.currentTarget.style.background = '#1f1f1f';
                      }}
                      onMouseLeave={e => {
                        if (!selected.has(tool.id))
                          e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {tool.icon || <ToolIcon />}
                        {tool.label}
                      </div>
                      {selected.has(tool.id) && (
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#e5e5e5',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Input Container - 上下排布 */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxSizing: 'border-box',
            backgroundColor: '#1a1a1a',
            borderRadius: '12px',
            padding: '10px 12px',
            border: '1.5px solid #3a3a3a',
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
                height: '28px',
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

          {/* 发送按钮 - 靠右对齐 */}
          <button
            onClick={onSend}
            disabled={!inputValue.trim() || isLoading}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
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
