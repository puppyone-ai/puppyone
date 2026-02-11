'use client';
import React, { useState, useRef, useEffect } from 'react';

interface SimpleJSONEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

const SimpleJSONEditor: React.FC<SimpleJSONEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter JSON data...',
  className = '',
  style = {},
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isValid, setIsValid] = useState(true);
  const [isEmpty, setIsEmpty] = useState(!value || value.trim().length === 0);
  const [lineCount, setLineCount] = useState(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 同步外部 value 变化
  useEffect(() => {
    setLocalValue(value);
    const empty = !value || value.trim().length === 0;
    setIsEmpty(empty);

    // 计算行数
    if (!empty) {
      const lines = value.split('\n').length;
      setLineCount(lines);
    } else {
      setLineCount(1);
    }
  }, [value]);

  // JSON 验证函数
  const validateJSON = (jsonString: string): boolean => {
    if (!jsonString.trim()) return true; // 空值是有效的
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  };

  // 格式化 JSON
  const formatJSON = (jsonString: string): string => {
    try {
      const parsed = JSON.parse(jsonString);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonString;
    }
  };

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    const empty = !newValue || newValue.trim().length === 0;
    setIsEmpty(empty);

    // 计算行数
    if (!empty) {
      const lines = newValue.split('\n').length;
      setLineCount(lines);
    } else {
      setLineCount(1);
    }

    const valid = validateJSON(newValue);
    setIsValid(valid);

    // 始终传递值给父组件，即使 JSON 无效
    onChange(newValue);
  };

  // 处理键盘快捷键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab 键插入缩进而不是切换焦点
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue =
        localValue.substring(0, start) + '  ' + localValue.substring(end);
      setLocalValue(newValue);
      onChange(newValue);

      // 设置光标位置
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // 生成行号
  const generateLineNumbers = () => {
    const numbers = [];
    for (let i = 1; i <= lineCount; i++) {
      numbers.push(
        <div
          key={i}
          className='text-[#6D7177] text-sm leading-6 text-right pr-2 select-none'
        >
          {i}
        </div>
      );
    }
    return numbers;
  };

  return (
    <div
      className={`relative flex flex-col border-none rounded-[8px] cursor-pointer pl-[2px] pt-[8px] bg-[#1C1D1F] h-full ${className}`}
      style={style}
    >
      {/* 占位符 - 参考 JSONForm 的样式 */}
      {isEmpty && (
        <div className='absolute top-0 left-0 w-full h-full flex items-start justify-start p-[8px] pl-[44px] text-[#6D7177] bg-transparent text-[14px] font-[500] leading-normal pointer-events-none z-[10] font-jetbrains-mono'>
          {placeholder}
        </div>
      )}

      {/* 编辑器容器 */}
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        {/* 行号区域 - 只在非空时显示 */}
        {!isEmpty && (
          <div className='flex flex-col min-w-[32px] pt-2 pb-2 pl-2 overflow-y-auto'>
            {generateLineNumbers()}
          </div>
        )}

        {/* JSON 编辑器 */}
        <textarea
          ref={textareaRef}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`flex-1 bg-transparent border-none focus:outline-none resize-none font-jetbrains-mono overflow-auto ${
            !isValid ? 'text-red-400' : 'text-[#CDCDCD]'
          } ${isEmpty ? 'pl-[42px]' : 'pl-2'}`}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '14px',
            fontWeight: 'light',
            lineHeight: '28px',
            padding: '8px 8px 8px 0',
            scrollbarWidth: 'thin',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            ...style,
          }}
          spellCheck={false}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
        />
      </div>

      {/* 状态指示器 - 简化版本 */}
      {!isEmpty && (
        <div className='absolute bottom-2 right-2 flex items-center gap-1 z-20'>
          {/* JSON 有效性指示器 */}
          <div
            className={`w-3 h-3 flex items-center justify-center ${
              isValid ? 'text-green-500' : 'text-red-500'
            }`}
            title={isValid ? 'Valid JSON' : 'Invalid JSON'}
          >
            {isValid ? (
              // 对号 outline 图标
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
                <polyline points='20,6 9,17 4,12'></polyline>
              </svg>
            ) : (
              // 叉号 outline 图标
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
                <line x1='18' y1='6' x2='6' y2='18'></line>
                <line x1='6' y1='6' x2='18' y2='18'></line>
              </svg>
            )}
          </div>

          {/* 格式化按钮 */}
          {isValid && localValue.trim() && (
            <button
              onClick={() => {
                const formatted = formatJSON(localValue);
                setLocalValue(formatted);
                onChange(formatted);
              }}
              className='text-[10px] text-[#888] hover:text-[#CDCDCD] transition-colors px-1 py-0.5 rounded bg-[#333] hover:bg-[#444]'
              title='Format JSON'
            >
              Format
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleJSONEditor;
