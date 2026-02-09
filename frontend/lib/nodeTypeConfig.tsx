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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
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
  <img 
    src="/icons/linear.svg" 
    alt="Linear" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const SheetsIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_sheet.svg" 
    alt="Google Sheets" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const GmailIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/gmail.svg" 
    alt="Gmail" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const GoogleDriveIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_drive.svg" 
    alt="Google Drive" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const GoogleCalendarIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_calendar.svg" 
    alt="Google Calendar" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
  />
);

export const GoogleDocsIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_doc.svg" 
    alt="Google Docs" 
    width={size} 
    height={size} 
    style={{ display: 'block' }}
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
  // === 原生类型 ===
  'folder': {
    renderAs: 'folder',
    color: '#3b82f6',  // 蓝色
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
    color: '#a1a1aa',  // 灰色
    label: 'Markdown',
    isReadOnly: false,
  },
  'file': {
    renderAs: 'file',
    color: '#71717a',
    label: 'File',
    isReadOnly: false,
  },

  // === 同步类型（简化版，细节在 sync_config.import_type 中）===
  'github': {
    renderAs: 'folder',  // GitHub repo 是文件夹结构
    color: '#6366f1',  // GitHub 紫色
    label: 'GitHub',
    badgeIcon: GithubIcon,
    isReadOnly: false,
  },
  'notion': {
    renderAs: 'json',  // 具体是 json 还是 markdown 根据 preview_json/preview_md 决定
    color: '#000000',  // Notion 黑色
    label: 'Notion',
    badgeIcon: NotionIcon,
    isReadOnly: false,
  },
  'airtable': {
    renderAs: 'json',
    color: '#FFBF00',  // Airtable 黄色
    label: 'Airtable',
    badgeIcon: AirtableIcon,
    isReadOnly: false,
  },
  'linear': {
    renderAs: 'json',
    color: '#5E6AD2',  // Linear 紫色
    label: 'Linear',
    badgeIcon: LinearIcon,
    isReadOnly: false,
  },
  'google_sheets': {
    renderAs: 'json',
    color: '#0F9D58',  // Google Sheets 绿色
    label: 'Google Sheets',
    badgeIcon: SheetsIcon,
    isReadOnly: false,
  },
  'gmail': {
    renderAs: 'json',
    color: '#EA4335',  // Gmail 红色
    label: 'Gmail',
    badgeIcon: GmailIcon,
    isReadOnly: false,
  },
  'google_drive': {
    renderAs: 'markdown',  // Google Drive 文件通常是 markdown
    color: '#4285F4',  // Google 蓝色
    label: 'Google Drive',
    badgeIcon: GoogleDriveIcon,
    isReadOnly: false,
  },
  'google_calendar': {
    renderAs: 'json',
    color: '#4285F4',  // Google 蓝色
    label: 'Google Calendar',
    badgeIcon: GoogleCalendarIcon,
    isReadOnly: false,
  },
};

// === 辅助函数 ===

// 原生类型列表
const NATIVE_TYPES = ['folder', 'json', 'markdown', 'file'];

// 同步类型列表
const SYNC_TYPES = ['github', 'notion', 'airtable', 'linear', 'google_sheets', 'gmail', 'google_drive', 'google_calendar'];

/**
 * 获取节点类型配置
 * 
 * type 直接决定渲染方式:
 * - 原生类型: folder, json, markdown, file
 * - 同步类型: github, notion, airtable, linear, gmail, google_sheets, google_calendar, google_drive
 */
export function getNodeTypeConfig(type: string): NodeTypeConfig {
  // 已知类型直接返回配置
  if (NODE_TYPE_CONFIG[type]) {
    return NODE_TYPE_CONFIG[type];
  }
  
  // 未知类型的默认配置
  return {
    renderAs: 'json',
    color: '#71717a',
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    isReadOnly: false,
  };
}

/**
 * 判断节点类型是否为同步类型
 */
export function isSyncedType(type: string): boolean {
  return !NATIVE_TYPES.includes(type);
}

/**
 * 获取同步来源（对于简化后的架构，type 就是来源）
 */
export function getSyncSource(type: string): string | null {
  if (NATIVE_TYPES.includes(type)) return null;
  return type;
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
    case 'google_sheets': return SheetsIcon;
    case 'gmail': return GmailIcon;
    case 'google_drive':
    case 'google':
    case 'drive': return GoogleDriveIcon;
    
    // Google Calendar
    case 'google_calendar':
    case 'calendar': return GoogleCalendarIcon;
    
    // Google Docs
    case 'google_docs':
    case 'docs': return GoogleDocsIcon;
    
    default: return null;
  }
}

