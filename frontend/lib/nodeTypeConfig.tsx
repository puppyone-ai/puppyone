/**
 * Node Type Configuration
 * 
 * 定义每种节点类型的渲染方式、图标、颜色等配置
 * 支持基础类型和同步类型（SaaS 数据）
 */

import React from 'react';

// === 渲染类型 ===
export type RenderAs = 'folder' | 'json' | 'markdown' | 'image' | 'file';

// === SaaS Logo 图标 ===
// 使用项目中的实际 Logo 图片

export const GithubIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

export const NotionIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/notion.svg" 
    alt="Notion" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const AirtableIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/airtable.png" 
    alt="Airtable" 
    width={size} 
    height={size} 
    style={{ display: 'block', borderRadius: 2 }}
  />
);

export const LinearIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M3.357 3.357a1.068 1.068 0 011.51 0l15.776 15.776a1.068 1.068 0 01-1.51 1.51L3.357 4.867a1.068 1.068 0 010-1.51z"/>
    <path d="M2 7.5A5.5 5.5 0 017.5 2h9a5.5 5.5 0 015.5 5.5v9a5.5 5.5 0 01-5.5 5.5h-9A5.5 5.5 0 012 16.5z" fillOpacity="0.3"/>
  </svg>
);

export const SheetsIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/Google_Docs_logo.png" 
    alt="Google Sheets" 
    width={size} 
    height={size} 
    style={{ display: 'block', borderRadius: 2 }}
  />
);

export const LockIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);

// === 节点类型配置 ===

export interface NodeTypeConfig {
  renderAs: RenderAs;
  color: string;
  label: string;
  badgeIcon?: React.ComponentType<{ size?: number }>;
  isReadOnly: boolean;
}

export const NODE_TYPE_CONFIG: Record<string, NodeTypeConfig> = {
  // === 基础类型 ===
  'folder': {
    renderAs: 'folder',
    color: '#a1a1aa',
    label: 'Folder',
    isReadOnly: false,
  },
  'json': {
    renderAs: 'json',
    color: '#34d399',
    label: 'JSON',
    isReadOnly: false,
  },
  'markdown': {
    renderAs: 'markdown',
    color: '#60a5fa',
    label: 'Markdown',
    isReadOnly: false,
  },
  'image': {
    renderAs: 'image',
    color: '#f472b6',
    label: 'Image',
    isReadOnly: false,
  },
  'pdf': {
    renderAs: 'file',
    color: '#ef4444',
    label: 'PDF',
    isReadOnly: false,
  },
  'video': {
    renderAs: 'file',
    color: '#a855f7',
    label: 'Video',
    isReadOnly: false,
  },
  'file': {
    renderAs: 'file',
    color: '#71717a',
    label: 'File',
    isReadOnly: false,
  },
  'pending': {
    renderAs: 'file',
    color: '#fbbf24',
    label: 'Processing...',
    isReadOnly: true,
  },

  // === GitHub 类型 ===
  'github_repo': {
    renderAs: 'json',  // 不是 folder！显示 repo 元信息
    color: '#6366f1',  // 紫色，区别于普通 JSON
    label: 'GitHub Repository',
    badgeIcon: GithubIcon,
    isReadOnly: false,  // 允许用户删除/重命名
  },
  'github_issue': {
    renderAs: 'json',
    color: '#34d399',
    label: 'GitHub Issue',
    badgeIcon: GithubIcon,
    isReadOnly: false,
  },
  'github_pr': {
    renderAs: 'json',
    color: '#34d399',
    label: 'GitHub PR',
    badgeIcon: GithubIcon,
    isReadOnly: false,
  },
  'github_file': {
    renderAs: 'markdown',
    color: '#60a5fa',
    label: 'GitHub File',
    badgeIcon: GithubIcon,
    isReadOnly: false,
  },

  // === Notion 类型 ===
  'notion_database': {
    renderAs: 'json',
    color: '#34d399',
    label: 'Notion Database',
    badgeIcon: NotionIcon,
    isReadOnly: false,  // 允许用户删除/重命名
  },
  'notion_page': {
    renderAs: 'markdown',  // Notion Page 现在正确存储为 Markdown
    color: '#60a5fa',      // 蓝色（与其他 markdown 类型一致）
    label: 'Notion Page',
    badgeIcon: NotionIcon,
    isReadOnly: false,
  },

  // === Airtable 类型 ===
  'airtable_table': {
    renderAs: 'json',
    color: '#34d399',
    label: 'Airtable Table',
    badgeIcon: AirtableIcon,
    isReadOnly: false,
  },

  // === Linear 类型 ===
  'linear_project': {
    renderAs: 'json',
    color: '#34d399',
    label: 'Linear Project',
    badgeIcon: LinearIcon,
    isReadOnly: false,
  },
  'linear_issue': {
    renderAs: 'json',
    color: '#34d399',
    label: 'Linear Issue',
    badgeIcon: LinearIcon,
    isReadOnly: false,
  },

  // === Google Sheets 类型 ===
  'sheets_table': {
    renderAs: 'json',
    color: '#34d399',
    label: 'Google Sheets',
    badgeIcon: SheetsIcon,
    isReadOnly: false,
  },
};

// === 辅助函数 ===

/**
 * 获取节点类型配置
 * 如果类型未知，返回默认配置
 */
export function getNodeTypeConfig(type: string): NodeTypeConfig {
  if (NODE_TYPE_CONFIG[type]) {
    return NODE_TYPE_CONFIG[type];
  }
  
  // 未知同步类型的默认配置
  if (type.includes('_')) {
    return {
      renderAs: 'json',
      color: '#71717a',
      label: type,
      isReadOnly: true,
    };
  }
  
  // 未知基础类型的默认配置
  return {
    renderAs: 'file',
    color: '#71717a',
    label: type,
    isReadOnly: false,
  };
}

/**
 * 判断节点类型是否为同步类型
 */
export function isSyncedType(type: string): boolean {
  return type.includes('_');
}

/**
 * 从类型中提取同步来源
 * github_repo -> github
 */
export function getSyncSource(type: string): string | null {
  if (!type.includes('_')) return null;
  return type.split('_')[0];
}

/**
 * 从类型中提取资源类型
 * github_repo -> repo
 */
export function getSyncResource(type: string): string | null {
  if (!type.includes('_')) return null;
  return type.split('_').slice(1).join('_');
}

/**
 * 获取同步来源的 Logo 图标
 */
export function getSyncSourceIcon(source: string | null): React.ComponentType<{ size?: number }> | null {
  if (!source) return null;
  
  switch (source) {
    case 'github': return GithubIcon;
    case 'notion': return NotionIcon;
    case 'airtable': return AirtableIcon;
    case 'linear': return LinearIcon;
    case 'sheets': return SheetsIcon;
    default: return null;
  }
}

