'use client';

import { useState, useCallback, useMemo, useRef } from 'react';

interface UseMentionOptions {
  data: unknown;
  onInputChange?: (value: string) => void;
}

interface UseMentionReturn {
  // State
  showMentionMenu: boolean;
  mentionIndex: number;
  mentionStartPos: number | null;
  filteredMentionOptions: string[];

  // Actions
  setMentionIndex: (index: number) => void;
  handleInputChange: (
    e: React.ChangeEvent<HTMLTextAreaElement>,
    currentValue: string,
    setValue: (v: string) => void
  ) => void;
  handleSelectMention: (
    key: string,
    inputValue: string,
    setInputValue: (v: string) => void,
    inputRef: {
      focus: () => void;
      setSelectionRange: (start: number, end: number) => void;
    } | null
  ) => void;
  handleKeyDown: (e: React.KeyboardEvent, onSend: () => void) => boolean; // 返回 true 表示已处理
  closeMentionMenu: () => void;
}

// 根据 path 获取对象的值
function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.match(/([^.\[\]]+)|\[(\d+)\]/g) || [];
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part.startsWith('[') && part.endsWith(']')) {
      const index = parseInt(part.slice(1, -1), 10);
      current = (current as unknown[])[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

// 获取当前 path 的子 keys
function getKeysForPath(data: unknown, path: string): string[] {
  if (!data) return [];
  const value = path ? getValueByPath(data, path) : data;
  if (Array.isArray(value)) {
    return value.map((_, i) => `[${i}]`);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value);
  }
  return [];
}

export function useMention({ data }: UseMentionOptions): UseMentionReturn {
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const [currentInputValue, setCurrentInputValue] = useState('');

  // 解析当前输入的 @path，分离已完成部分和正在输入部分
  const mentionInfo = useMemo(() => {
    if (mentionStartPos === null)
      return { basePath: '', query: '', keys: [] as string[] };

    const fullPath = currentInputValue.slice(mentionStartPos + 1); // 跳过 @

    // 找到最后一个 . 或 [ 的位置来分离 basePath 和 query
    const lastDotIndex = fullPath.lastIndexOf('.');
    const lastBracketIndex = fullPath.lastIndexOf('[');
    const lastSeparator = Math.max(lastDotIndex, lastBracketIndex);

    let basePath = '';
    let query = fullPath;

    if (lastSeparator >= 0) {
      if (lastBracketIndex > lastDotIndex) {
        // 最后是 [，检查是否已闭合
        const closingBracket = fullPath.indexOf(']', lastBracketIndex);
        if (closingBracket === -1) {
          // 未闭合的 [，正在输入数组索引
          basePath = fullPath.slice(0, lastBracketIndex);
          query = fullPath.slice(lastBracketIndex + 1); // 不含 [
        } else {
          // 已闭合，整个作为 basePath
          basePath = fullPath;
          query = '';
        }
      } else {
        // 最后是 .
        basePath = fullPath.slice(0, lastDotIndex);
        query = fullPath.slice(lastDotIndex + 1);
      }
    }

    const keys = getKeysForPath(data, basePath);
    return { basePath, query, keys };
  }, [currentInputValue, mentionStartPos, data]);

  // 过滤补全选项
  const filteredMentionOptions = useMemo(() => {
    const { query, keys } = mentionInfo;
    if (!query) return keys;
    const q = query.toLowerCase();
    return keys.filter(key => key.toLowerCase().includes(q));
  }, [mentionInfo]);

  const closeMentionMenu = useCallback(() => {
    setShowMentionMenu(false);
    setMentionStartPos(null);
  }, []);

  // 处理输入变化，检测 @ 触发补全
  const handleInputChange = useCallback(
    (
      e: React.ChangeEvent<HTMLTextAreaElement>,
      currentValue: string,
      setValue: (v: string) => void
    ) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart || 0;
      setValue(value);
      setCurrentInputValue(value);

      const charBeforeCursor = value[cursorPos - 1];

      // 检测是否刚输入了 @
      if (charBeforeCursor === '@') {
        const keys = getKeysForPath(data, '');
        if (keys.length > 0) {
          setMentionStartPos(cursorPos - 1);
          setShowMentionMenu(true);
          setMentionIndex(0);
        }
        return;
      }

      // 如果菜单已打开
      if (showMentionMenu && mentionStartPos !== null) {
        // 检查 @ 是否还存在
        if (cursorPos <= mentionStartPos || value[mentionStartPos] !== '@') {
          closeMentionMenu();
          return;
        }

        // 检查是否遇到空格（终止补全）
        const textAfterAt = value.slice(mentionStartPos + 1, cursorPos);
        if (/\s/.test(textAfterAt)) {
          closeMentionMenu();
          return;
        }

        // 检测是否刚输入了 . 或 [，重置选择索引
        if (charBeforeCursor === '.' || charBeforeCursor === '[') {
          setMentionIndex(0);
        }
      } else if (!showMentionMenu) {
        // 菜单未打开时，检测是否在已有的 @path 后输入了 . 或 [
        if (charBeforeCursor === '.' || charBeforeCursor === '[') {
          // 向前查找 @
          let atPos = -1;
          for (let i = cursorPos - 2; i >= 0; i--) {
            const ch = value[i];
            if (ch === '@') {
              atPos = i;
              break;
            }
            if (/\s/.test(ch)) break;
          }
          if (atPos >= 0) {
            const pathSoFar = value.slice(atPos + 1, cursorPos - 1);
            const keys = getKeysForPath(data, pathSoFar);
            if (keys.length > 0) {
              setMentionStartPos(atPos);
              setShowMentionMenu(true);
              setMentionIndex(0);
            }
          }
        }
      }
    },
    [showMentionMenu, mentionStartPos, data, closeMentionMenu]
  );

  // 选择补全项
  const handleSelectMention = useCallback(
    (
      key: string,
      inputValue: string,
      setInputValue: (v: string) => void,
      inputRef: {
        focus: () => void;
        setSelectionRange: (start: number, end: number) => void;
      } | null
    ) => {
      if (mentionStartPos === null) return;

      const { basePath } = mentionInfo;
      const before = inputValue.slice(0, mentionStartPos);

      // 计算要替换的结束位置
      const currentFullPath = inputValue.slice(mentionStartPos + 1);
      const pathEndMatch = currentFullPath.match(/^[^\s]*/);
      const pathEnd = pathEndMatch ? pathEndMatch[0].length : 0;
      const after = inputValue.slice(mentionStartPos + 1 + pathEnd);

      // 构建新路径
      let newPath: string;
      const isArrayIndex = key.startsWith('[');
      if (basePath) {
        newPath = isArrayIndex ? `${basePath}${key}` : `${basePath}.${key}`;
      } else {
        newPath = key;
      }

      const newValue = `${before}@${newPath}${after}`;
      setInputValue(newValue);
      setCurrentInputValue(newValue);

      // 检查选中的值是否还有子节点
      const selectedValue = getValueByPath(data, newPath);
      const hasChildren =
        selectedValue &&
        typeof selectedValue === 'object' &&
        (Array.isArray(selectedValue)
          ? selectedValue.length > 0
          : Object.keys(selectedValue).length > 0);

      const newCursorPos = mentionStartPos + 1 + newPath.length;

      if (hasChildren) {
        // 还有子节点，保持菜单打开
        setMentionIndex(0);
        setTimeout(() => {
          if (inputRef) {
            inputRef.focus();
            inputRef.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      } else {
        // 叶子节点，关闭菜单
        closeMentionMenu();
        setTimeout(() => {
          if (inputRef) {
            inputRef.focus();
            inputRef.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }
    },
    [mentionStartPos, mentionInfo, data, closeMentionMenu]
  );

  // 处理键盘事件（返回 true 表示已处理，不需要继续）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, onSend: () => void): boolean => {
      // 处理补全菜单的键盘导航
      if (showMentionMenu && filteredMentionOptions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex(prev => (prev + 1) % filteredMentionOptions.length);
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex(
            prev =>
              (prev - 1 + filteredMentionOptions.length) %
              filteredMentionOptions.length
          );
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          // 返回 true，让调用者知道需要选择当前项
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMentionMenu();
          return true;
        }
      }

      // 正常的发送逻辑
      if (e.key === 'Enter' && !e.shiftKey) {
        if (e.nativeEvent.isComposing) {
          return true;
        }
        e.preventDefault();
        onSend();
        return true;
      }

      return false;
    },
    [showMentionMenu, filteredMentionOptions.length, closeMentionMenu]
  );

  return {
    showMentionMenu,
    mentionIndex,
    mentionStartPos,
    filteredMentionOptions,
    setMentionIndex,
    handleInputChange,
    handleSelectMention,
    handleKeyDown,
    closeMentionMenu,
  };
}
