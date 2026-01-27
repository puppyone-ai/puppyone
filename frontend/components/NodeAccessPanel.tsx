'use client';

import { useState, useRef, useEffect } from 'react';
import { createTool, deleteTool, type Tool } from '../lib/mcpApi';

/**
 * NodeAccessPanel - 节点级别的 Agent 访问配置面板
 * 
 * 样式和交互与 JSON Editor 中的 RightAccessSidebar 一致
 */

// 常量
const BUTTON_SIZE = 26;

// Icons
const PawIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="16" height="13" viewBox="0 0 33 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.00824" transform="rotate(26.6366 27.9463 11.0849)" fill={color} />
    <ellipse cx="21.2389" cy="5.4036" rx="3.49034" ry="4.00826" transform="rotate(9.17161 21.2389 5.4036)" fill={color} />
    <ellipse cx="12.3032" cy="5.36893" rx="3.5075" ry="4.00823" transform="rotate(-9.17161 12.3032 5.36893)" fill={color} />
    <ellipse cx="5.54689" cy="10.6915" rx="3.5075" ry="4.00823" transform="rotate(-26.1921 5.54689 10.6915)" fill={color} />
    <path d="M23.0469 15.6875C25.0899 18.8127 25.0469 22.2809 23.0469 24.1875C19.5 27.5625 13.5 27.5625 10 24.1875C8.02148 22.2246 8.04694 18.8127 10 15.6875C12.0469 12.4062 13.5 11.1875 16.5469 11.1875C19.5938 11.1875 21.0039 12.5623 23.0469 15.6875Z" fill={color} />
  </svg>
);

const BashIcon = ({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LoadingIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
  </svg>
);

// Node type icons
const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// ============================================
// NodeAccessPanel - 配置面板
// ============================================

export interface NodeAccessPanelProps {
  nodeId: string;
  nodeType: 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image';
  nodeName: string;
  existingTools: Tool[];
  onToolsChange?: () => void;
  onClose?: () => void;
}

export function NodeAccessPanel({
  nodeId,
  nodeType,
  nodeName,
  existingTools,
  onToolsChange,
  onClose,
}: NodeAccessPanelProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Find existing bash tools
  const shellTool = existingTools.find(t => t.node_id === nodeId && t.type === 'shell_access');
  const shellReadonlyTool = existingTools.find(t => t.node_id === nodeId && t.type === 'shell_access_readonly');
  const hasFullAccess = !!shellTool;
  const hasReadonlyAccess = !!shellReadonlyTool;

  // Toggle tool
  const toggleTool = async (toolType: 'shell_access' | 'shell_access_readonly') => {
    setLoading(toolType);
    try {
      const existingTool = toolType === 'shell_access' ? shellTool : shellReadonlyTool;
      const otherTool = toolType === 'shell_access' ? shellReadonlyTool : shellTool;

      if (existingTool) {
        await deleteTool(existingTool.id);
      } else {
        if (otherTool) await deleteTool(otherTool.id);
        await createTool({
          node_id: nodeId,
          json_path: '',
          type: toolType,
          name: `${toolType}_${nodeName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)}`,
          description: `${toolType === 'shell_access' ? 'Full' : 'Read-only'} sandbox access to ${nodeName}`,
        });
      }
      onToolsChange?.();
    } catch (err) {
      console.error('Failed to toggle tool:', err);
    } finally {
      setLoading(null);
    }
  };

  const NodeIcon = nodeType === 'folder' ? FolderIcon : FileIcon;

  const getDescription = () => {
    switch (nodeType) {
      case 'folder': return 'All files in this folder will be available in the sandbox workspace.';
      case 'json': return 'JSON data will be loaded into /workspace/data.json';
      case 'markdown': return 'Markdown content will be available as a text file.';
      case 'pdf': return 'PDF file will be available for analysis.';
      case 'image': return 'Image file will be available for processing.';
      default: return 'File will be available in the sandbox workspace.';
    }
  };

  // Tool row renderer (same as JSON Editor)
  const renderToolRow = (
    tool: { id: string; label: React.ReactNode },
    icon: React.ReactNode,
  ) => {
    const isEnabled = tool.id === 'shell_access' ? hasFullAccess : hasReadonlyAccess;
    const isLoading = loading === tool.id;

    return (
      <div
        key={tool.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 6,
          cursor: isLoading ? 'wait' : 'pointer',
          background: isEnabled ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onClick={() => !isLoading && toggleTool(tool.id as 'shell_access' | 'shell_access_readonly')}
        onMouseEnter={e => {
          if (!isEnabled) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
        }}
        onMouseLeave={e => {
          if (!isEnabled) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Checkbox */}
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: isEnabled ? '2px solid #f97316' : '2px solid #404040',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isEnabled ? '#f97316' : 'transparent',
            marginRight: 10,
            transition: 'all 0.15s',
            color: '#fff',
          }}
        >
          {isLoading ? <LoadingIcon /> : isEnabled ? <CheckIcon /> : null}
        </div>

        {/* Icon */}
        <div style={{ marginRight: 8, color: isEnabled ? '#f97316' : '#737373' }}>
          {icon}
        </div>

        {/* Label */}
        <div style={{ flex: 1, color: isEnabled ? '#e5e5e5' : '#a3a3a3', fontSize: 12 }}>
          {tool.label}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      style={{
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '8px 4px',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        width: 300,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: '8px 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ color: nodeType === 'folder' ? '#f59e0b' : '#60a5fa' }}>
            <NodeIcon />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#737373' }}>Agent Access</div>
            <div style={{ fontSize: 11, color: '#525252', marginTop: 2 }}>{nodeName}</div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '0 12px 12px', fontSize: 11, color: '#525252', lineHeight: 1.5 }}>
        {getDescription()}
      </div>

      {/* BASH Section */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, color: '#737373', letterSpacing: '0.5px' }}>
          BASH
        </div>
        <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Read-only Bash */}
          {renderToolRow(
            {
              id: 'shell_access_readonly',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Bash</span>
                  <div style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid #525252', color: '#737373', lineHeight: '1' }}>
                    Read-only
                  </div>
                </div>
              ),
            },
            <BashIcon size={14} />
          )}
          {/* Full Access Bash */}
          {renderToolRow(
            {
              id: 'shell_access',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Bash</span>
                  <div style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(249, 115, 22, 0.15)', color: '#fb923c', lineHeight: '1' }}>
                    Full Access
                  </div>
                </div>
              ),
            },
            <BashIcon size={14} />
          )}
        </div>
      </div>

      {/* Remove Button (if configured) */}
      {(hasFullAccess || hasReadonlyAccess) && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={async () => {
              setLoading('remove');
              try {
                if (shellTool) await deleteTool(shellTool.id);
                if (shellReadonlyTool) await deleteTool(shellReadonlyTool.id);
                onToolsChange?.();
              } finally {
                setLoading(null);
              }
            }}
            disabled={loading !== null}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(248,113,113,0.05)',
              border: '1px solid rgba(248,113,113,0.15)',
              borderRadius: 6,
              color: '#f87171',
              fontSize: 11,
              cursor: loading ? 'wait' : 'pointer',
              width: '100%',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 7v4M8.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Remove Access
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// NodeAccessButton - 小爪子按钮（和 JSON Editor 样式一致）
// ============================================

export interface NodeAccessButtonProps {
  nodeId: string;
  nodeType: 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image';
  nodeName: string;
  existingTools: Tool[];
  onToolsChange?: () => void;
}

export function NodeAccessButton({
  nodeId,
  nodeType,
  nodeName,
  existingTools,
  onToolsChange,
}: NodeAccessButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if any tool is configured
  const hasShell = existingTools.some(
    t => t.node_id === nodeId && (t.type === 'shell_access' || t.type === 'shell_access_readonly')
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Paw Button - 和 JSON Editor 一致的样式 */}
      <div
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'background 0.15s',
          background: hasShell
            ? isExpanded
              ? '#f97316' // 已配置 + 展开：实心橙
              : isHovered
                ? 'rgba(255, 167, 61, 0.25)' // 已配置 + hover：更深
                : 'rgba(255, 167, 61, 0.15)' // 已配置：橙色背景
            : isExpanded
              ? 'rgba(255, 255, 255, 0.12)' // 未配置 + 展开：明显灰色
              : isHovered
                ? 'rgba(255, 255, 255, 0.08)' // 未配置 + hover：淡灰色
                : 'rgba(255, 255, 255, 0.04)', // 未配置：几乎透明
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setIsExpanded(!isExpanded)}
        title="Configure Agent Access"
      >
        <PawIcon
          color={
            hasShell
              ? isExpanded ? '#fff' : isHovered ? '#f97316' : '#ffa73d'
              : isExpanded ? '#e5e5e5' : isHovered ? '#d4d4d8' : '#6b7280'
          }
        />
      </div>

      {/* Panel - 弹出在按钮下方 */}
      {isExpanded && (
        <div
          style={{
            position: 'absolute',
            top: BUTTON_SIZE + 8,
            right: 0,
            zIndex: 100,
          }}
        >
          <NodeAccessPanel
            nodeId={nodeId}
            nodeType={nodeType}
            nodeName={nodeName}
            existingTools={existingTools}
            onToolsChange={() => {
              onToolsChange?.();
            }}
            onClose={() => setIsExpanded(false)}
          />
        </div>
      )}
    </div>
  );
}
