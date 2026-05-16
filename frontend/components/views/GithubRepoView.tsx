'use client';

import React, { useMemo, useState } from 'react';
import { PageLoading } from '@/components/loading';

interface FileInfo {
  path: string;
  name: string;
  size: number;
  s3_key: string;
}

interface RepoMetadata {
  owner: string;
  repo: string;
  full_name: string;
  description?: string;
  default_branch: string;
  html_url: string;
  file_count: number;
  total_size_bytes: number;
  s3_prefix: string;
  files: FileInfo[];
  synced_at: string;
}

interface GithubRepoViewProps {
  nodeId: string;
  nodeName: string;
  content: RepoMetadata | null;
  syncUrl?: string;
}

// 树节点类型
interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  children?: TreeNode[];
}

// 构建真正的树形结构
function buildFileTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode[] = [];

  // 用于快速查找已存在的文件夹
  const folderMap = new Map<string, TreeNode>();

  // 确保文件夹存在
  const ensureFolder = (pathParts: string[], currentLevel: TreeNode[]): TreeNode[] => {
    if (pathParts.length === 0) return currentLevel;

    const folderName = pathParts[0];
    const folderPath = pathParts.slice(0, 1).join('/');
    const fullPath = pathParts.join('/');

    let folder = currentLevel.find(n => n.type === 'folder' && n.name === folderName);

    if (!folder) {
      folder = {
        name: folderName,
        path: folderPath,
        type: 'folder',
        children: [],
      };
      currentLevel.push(folder);
    }

    if (pathParts.length > 1) {
      return ensureFolder(pathParts.slice(1), folder.children!);
    }

    return folder.children!;
  };

  // 处理每个文件
  files.forEach(file => {
    const pathParts = file.path.split('/');
    const fileName = pathParts.pop()!;

    // 获取或创建父文件夹
    const parentFolder = pathParts.length > 0
      ? ensureFolder(pathParts, root)
      : root;

    // 添加文件
    parentFolder.push({
      name: fileName,
      path: file.path,
      type: 'file',
      size: file.size,
    });
  });

  // 递归排序：文件夹在前，文件在后，各自按名称排序
  const sortTree = (nodes: TreeNode[]): TreeNode[] => {
    const folders = nodes.filter(n => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name));
    const files = nodes.filter(n => n.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach(f => {
      if (f.children) {
        f.children = sortTree(f.children);
      }
    });

    return [...folders, ...files];
  };

  return sortTree(root);
}

// File extension to icon mapping
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const icons: Record<string, string> = {
    'js': '📜', 'jsx': '⚛️', 'ts': '📘', 'tsx': '⚛️',
    'py': '🐍', 'md': '📝', 'json': '📋',
    'yaml': '⚙️', 'yml': '⚙️', 'toml': '⚙️',
    'env': '🔐', 'sh': '🖥️', 'bash': '🖥️',
    'css': '🎨', 'scss': '🎨', 'html': '🌐',
    'go': '🐹', 'rs': '🦀', 'sql': '🗃️',
    'lock': '🔒',
  };

  return icons[ext] || '📄';
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 极简风格的 Stat Item
const StatItem = ({ label, value, icon }: { label: string; value: string | number | React.ReactNode; icon: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
    <div style={{ color: 'var(--po-text-disabled)', display: 'flex' }}>{icon}</div>
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ color: 'var(--po-text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>{value}</span>
    </div>
  </div>
);

// 递归渲染树节点
function TreeNodeItem({
  node,
  depth = 0,
  expandedPaths,
  onToggle,
}: {
  node: TreeNode;
  depth?: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedPaths.has(node.path);
  const indent = depth * 20;

  const fileCount = isFolder
    ? (node.children?.filter(c => c.type === 'file').length || 0) +
      (node.children?.filter(c => c.type === 'folder').reduce((acc, f) => acc + countFiles(f), 0) || 0)
    : 0;

  return (
    <>
      <div
        onClick={isFolder ? () => onToggle(node.path) : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          paddingLeft: 12 + indent,
          cursor: isFolder ? 'pointer' : 'default',
          background: 'transparent',
          transition: 'background 0.1s',
          borderBottom: '1px solid var(--po-border-subtle)',
        }}
        onMouseEnter={e => { if (isFolder) e.currentTarget.style.background = 'var(--po-hover)'; }}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Expand/Collapse Arrow (only for folders) */}
        {isFolder ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--po-text-disabled)"
            strokeWidth="2"
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : (
          <div style={{ width: 12 }} /> // Spacer for alignment
        )}

        {/* Icon */}
        {isFolder ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isExpanded ? 'var(--po-warning)' : 'var(--po-text-disabled)'} style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <span style={{ fontSize: 14, flexShrink: 0 }}>{getFileIcon(node.name)}</span>
        )}

        {/* Name */}
        <span style={{
          color: isFolder ? 'var(--po-text)' : 'var(--po-text-muted)',
          fontSize: 13,
          fontFamily: 'var(--po-font-sans)',
          fontWeight: isFolder ? 500 : 400,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.name}
        </span>

        {/* Size / Count */}
        <span style={{
          color: 'var(--po-text-disabled)',
          fontSize: 11,
          fontFamily: 'var(--po-font-sans)',
          flexShrink: 0,
        }}>
          {isFolder ? `${fileCount} files` : formatBytes(node.size || 0)}
        </span>
      </div>

      {/* Children (if expanded) */}
      {isFolder && isExpanded && node.children && (
        <>
          {node.children.map(child => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </>
  );
}

// 递归计算文件数
function countFiles(node: TreeNode): number {
  if (node.type === 'file') return 1;
  return node.children?.reduce((acc, child) => acc + countFiles(child), 0) || 0;
}

export function GithubRepoView({ nodeId, nodeName, content, syncUrl }: GithubRepoViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const fileTree = useMemo(() => {
    if (!content?.files) return [];
    return buildFileTree(content.files);
  }, [content?.files]);

  const togglePath = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allFolderPaths = new Set<string>();
    const collectFolders = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
        if (n.type === 'folder') {
          allFolderPaths.add(n.path);
          if (n.children) collectFolders(n.children);
        }
      });
    };
    collectFolders(fileTree);
    setExpandedPaths(allFolderPaths);
  };

  const collapseAll = () => {
    setExpandedPaths(new Set());
  };

  if (!content) {
    return (
      <div style={{ height: 140, display: 'flex' }}>
        <PageLoading variant="fill" label="Loading repository data" />
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--po-canvas)',
      color: 'var(--po-text)',
    }}>
      {/* Header Area */}
      <div style={{
        padding: '32px 48px',
        borderBottom: '1px solid var(--po-filetree-rail)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          {/* Title & Desc */}
          <div style={{ maxWidth: 600 }}>
            <h1 style={{
              margin: '0 0 8px 0',
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--po-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--po-text)">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              {content.full_name || nodeName}
            </h1>
            <p style={{ margin: 0, color: 'var(--po-text-muted)', fontSize: 14, lineHeight: '1.5' }}>
              {content.description || 'No description provided.'}
            </p>
          </div>

          {/* Action / Link */}
          {syncUrl && (
            <a
              href={syncUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                background: 'var(--po-filetree-rail)',
                color: 'var(--po-text)',
                fontSize: 13,
                textDecoration: 'none',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--po-text-disabled)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--po-filetree-rail)'}
            >
              <span>View on GitHub</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>

        {/* Stats Row */}
        <div style={{ display: 'flex', gap: 32 }}>
          <StatItem
            label="Branch"
            value={content.default_branch}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>}
          />
          <StatItem
            label="Files"
            value={content.file_count}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>}
          />
          <StatItem
            label="Size"
            value={formatBytes(content.total_size_bytes)}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>}
          />
          <StatItem
            label="Synced"
            value={formatDate(content.synced_at)}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
          />
        </div>
      </div>

      {/* Info Context */}
      <div style={{ padding: '24px 48px 0' }}>
         <div style={{
          padding: '12px 16px',
          background: 'var(--po-control)',
          border: '1px solid var(--po-border-subtle)',
          borderRadius: 8,
          fontSize: 13,
          color: 'var(--po-text-muted)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--po-text-subtle)" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span>
            This repository is available as a <strong>Sandbox Context</strong>. Drag it into an Agent chat to access all {content.file_count} files.
          </span>
        </div>
      </div>

      {/* File Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 48px 48px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--po-text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Files
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={expandAll}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--po-text-subtle)',
                fontSize: 12,
                cursor: 'pointer',
                height: 30,
                padding: '0 8px',
                borderRadius: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--po-filetree-rail)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--po-text-subtle)',
                fontSize: 12,
                cursor: 'pointer',
                height: 30,
                padding: '0 8px',
                borderRadius: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--po-filetree-rail)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Tree Container */}
        <div style={{
          border: '1px solid var(--po-filetree-rail)',
          borderRadius: 8,
          background: 'var(--po-panel)',
          overflow: 'hidden',
        }}>
          {fileTree.map(node => (
            <TreeNodeItem
              key={node.path}
              node={node}
              expandedPaths={expandedPaths}
              onToggle={togglePath}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
