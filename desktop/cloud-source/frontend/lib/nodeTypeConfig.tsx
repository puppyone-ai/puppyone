/**
 * Node Type Configuration — 节点级（树视图）的视觉分类。
 *
 * 这里 *不* 决定如何在编辑器中渲染文件内容 — 那是
 * `lib/fileFormats/registry.ts` 的职责（按文件后缀 + MIME → viewer）。
 *
 * 这里只回答两个问题：
 *   1. 这个节点类型在树视图里画什么图标？(`iconCategory`)
 *   2. 这个节点类型是不是文件夹？(`isFolderType()`)
 *
 * 节点类型 ⊆ {folder, json, markdown, file, github, notion, airtable,
 * linear, google_sheets, gmail, google_drive, google_calendar}。
 * 它和文件后缀正交：一个 nodeType 'file' 节点，文件可能是 .png / .pdf /
 * .py — 编辑器从文件名走 file-format registry 决定 viewer。
 */

import React from 'react';

/** 树视图图标的粗粒度分类。仅用于 `getNodeTypeConfig().iconCategory`。 */
export type IconCategory = 'folder' | 'json' | 'markdown' | 'file';

// === SaaS Logo 图标 ===
// 使用项目中的实际 Logo 图片

export const GithubIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--po-text)' }}>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

export const NotionIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/notion.svg" 
    alt="Notion" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const AirtableIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/airtable.png" 
    alt="Airtable" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain', borderRadius: 2 }}
  />
);

export const LinearIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/linear.svg" 
    alt="Linear" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const SheetsIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_sheet.svg" 
    alt="Google Sheets" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const GmailIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/gmail.svg" 
    alt="Gmail" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const GoogleDriveIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_drive.svg" 
    alt="Google Drive" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const GoogleCalendarIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_calendar.svg" 
    alt="Google Calendar" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
  />
);

export const GoogleDocsIcon = ({ size = 12 }: { size?: number }) => (
  <img 
    src="/icons/google_doc.svg" 
    alt="Google Docs" 
    width={size} 
    height={size} 
    style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
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
  /** 树视图图标的粗粒度分类。**只**用于挑图标，不参与编辑器派发。 */
  iconCategory: IconCategory;
  color: string;
  label: string;
  badgeIcon?: React.ComponentType<{ size?: number }>;
  isReadOnly: boolean;
}

export const NODE_TYPE_CONFIG: Record<string, NodeTypeConfig> = {
  // === 原生类型 ===
  'folder': {
    iconCategory: 'folder',
    color: 'var(--po-accent)',
    label: 'Folder',
    isReadOnly: false,
  },
  'json': {
    iconCategory: 'json',
    color: 'var(--po-success)',
    label: 'JSON',
    isReadOnly: false,
  },
  'markdown': {
    iconCategory: 'markdown',
    color: 'var(--po-file-accent-markdown)',
    label: 'Markdown',
    isReadOnly: false,
  },
  'file': {
    iconCategory: 'file',
    color: 'var(--po-file-accent-default)',
    label: 'File',
    isReadOnly: false,
  },

  // === 同步类型（细节在 sync_config.import_type 中） ===
  'github': {
    iconCategory: 'folder',
    color: 'var(--po-accent)',
    label: 'GitHub',
    badgeIcon: GithubIcon,
    isReadOnly: false,
  },
  'notion': {
    iconCategory: 'json',
    color: 'var(--po-text)',
    label: 'Notion',
    badgeIcon: NotionIcon,
    isReadOnly: false,
  },
  'airtable': {
    iconCategory: 'json',
    color: 'var(--po-warning)',
    label: 'Airtable',
    badgeIcon: AirtableIcon,
    isReadOnly: false,
  },
  'linear': {
    iconCategory: 'json',
    color: 'var(--po-accent)',
    label: 'Linear',
    badgeIcon: LinearIcon,
    isReadOnly: false,
  },
  'google_sheets': {
    iconCategory: 'json',
    color: 'var(--po-success)',
    label: 'Google Sheets',
    badgeIcon: SheetsIcon,
    isReadOnly: false,
  },
  'gmail': {
    iconCategory: 'json',
    color: 'var(--po-danger)',
    label: 'Gmail',
    badgeIcon: GmailIcon,
    isReadOnly: false,
  },
  'google_drive': {
    iconCategory: 'markdown',
    color: 'var(--po-accent)',
    label: 'Google Drive',
    badgeIcon: GoogleDriveIcon,
    isReadOnly: false,
  },
  'google_calendar': {
    iconCategory: 'json',
    color: 'var(--po-accent)',
    label: 'Google Calendar',
    badgeIcon: GoogleCalendarIcon,
    isReadOnly: false,
  },
};

// === 辅助函数 ===

const NATIVE_TYPES = ['folder', 'json', 'markdown', 'file'];

export function getNodeTypeConfig(type: string): NodeTypeConfig {
  if (NODE_TYPE_CONFIG[type]) {
    return NODE_TYPE_CONFIG[type];
  }
  return {
    iconCategory: 'json',
    color: 'var(--po-file-accent-default)',
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    isReadOnly: false,
  };
}

/**
 * 节点类型是否为文件夹形态。GitHub 仓库也是文件夹，所以不能简单
 * 通过 `type === 'folder'` 判断 — 走 `iconCategory === 'folder'`。
 */
export function isFolderType(type: string): boolean {
  return getNodeTypeConfig(type).iconCategory === 'folder';
}

export function isSyncedType(type: string): boolean {
  return !NATIVE_TYPES.includes(type);
}

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
