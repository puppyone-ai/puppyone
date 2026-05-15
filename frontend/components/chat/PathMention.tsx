'use client';

import React from 'react';

interface PathMentionProps {
  path: string;
  onClick?: (path: string) => void;
}

/**
 * 渲染 @path 提及样式
 */
export function PathMention({ path, onClick }: PathMentionProps) {
  return (
    <span
      onClick={() => onClick?.(path)}
      style={{
        background: 'var(--po-selected)',
        color: 'var(--po-accent)',
        padding: '1px 5px',
        borderRadius: 4,
        fontFamily: 'var(--po-font-sans)',
        fontSize: '0.9em',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => {
        if (onClick)
          e.currentTarget.style.background =
            'color-mix(in srgb, var(--po-accent) 24%, transparent)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--po-selected)';
      }}
      title={`JSON Path: ${path}`}
    >
      @{path}
    </span>
  );
}

/**
 * 解析文本中的 @path 并返回带高亮的内容
 * 支持格式: @key, @key.subkey, @key[0], @key[0].subkey, @key.subkey[1].field
 */
export function parsePathMentions(
  text: string,
  onPathClick?: (path: string) => void
): React.ReactNode[] {
  // 匹配 @path 格式，支持 . 和 [] 嵌套
  // @key, @key.sub, @key[0], @key[0].sub[1].field 等
  const pathRegex =
    /@([a-zA-Z_][a-zA-Z0-9_]*(?:(?:\.[a-zA-Z_][a-zA-Z0-9_]*)|(?:\[\d+\]))*)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = pathRegex.exec(text)) !== null) {
    // 添加 @ 之前的文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // 添加高亮的 path
    const path = match[1];
    parts.push(
      <PathMention
        key={`path-${keyIndex++}`}
        path={path}
        onClick={onPathClick}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export default PathMention;
