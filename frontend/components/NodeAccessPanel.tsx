'use client';

import { useState, useRef, useEffect } from 'react';
import {
  createTool,
  createSearchTool,
  deleteTool,
  getSearchIndexStatus,
  type Tool,
  type SearchIndexTask,
  type McpToolType,
  TOOL_INFO,
} from '../lib/mcpApi';

/**
 * NodeAccessPanel - Node-level Tool configuration panel
 * Styling updated for better information density and visual appeal.
 */

// ============================================
// Tool Configuration
// ============================================

interface ToolTypeConfig {
  key: McpToolType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  category: 'read' | 'write' | 'ai' | 'custom';
  appliesTo: string[];  // Content types this tool applies to
}

// Content type mapping for filtering
type ContentType = 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'file';

// All available tool types with content type compatibility
const AVAILABLE_TOOLS: ToolTypeConfig[] = [
  // Search - AI-powered search (works on text content)
  {
    key: 'search',
    label: 'Search',
    description: 'Semantic search across file contents using vector embeddings.',
    icon: <SearchIcon />,
    color: '#3b82f6',
    category: 'ai',
    appliesTo: ['folder', 'json', 'markdown'],
  },
  // Read tools
  {
    key: 'get_all_data',
    label: 'Read Content',
    description: 'Read the full content of the file or folder structure.',
    icon: <DatabaseIcon />,
    color: '#64748b',
    category: 'read',
    appliesTo: ['folder', 'json', 'markdown', 'image'],
  },
  // Write tools (JSON only for now)
  {
    key: 'create',
    label: 'Add Item',
    description: 'Append new items or fields to the data.',
    icon: <PlusIcon />,
    color: '#22c55e',
    category: 'write',
    appliesTo: ['json'],
  },
  {
    key: 'update',
    label: 'Update Data',
    description: 'Modify existing values or content.',
    icon: <EditIcon />,
    color: '#f59e0b',
    category: 'write',
    appliesTo: ['json', 'markdown'],
  },
  {
    key: 'delete',
    label: 'Delete Item',
    description: 'Remove items or fields from the data.',
    icon: <TrashIcon />,
    color: '#ef4444',
    category: 'write',
    appliesTo: ['json'],
  },
];

// Get tools applicable to a specific content type
function getToolsForContentType(contentType: string): ToolTypeConfig[] {
  return AVAILABLE_TOOLS.filter(tool => tool.appliesTo.includes(contentType));
}

// ============================================
// Icons
// ============================================

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ============================================
// Main Panel Component
// ============================================

export interface NodeAccessPanelProps {
  nodeId: string;
  nodeType: 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image';
  nodeName: string;
  jsonPath?: string; // 新增
  existingTools: Tool[];
  onToolsChange?: () => void;
  onClose?: () => void;
}

export function NodeAccessPanel({
  nodeId,
  nodeType,
  nodeName,
  jsonPath = '', // 默认为空
  existingTools,
  onToolsChange,
  onClose,
}: NodeAccessPanelProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchIndexTask | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Get existing tools for this node and jsonPath
  const getExistingTool = (type: McpToolType) => 
    existingTools.find(t => t.node_id === nodeId && t.type === type && (t.json_path || '') === jsonPath);

  const searchTool = getExistingTool('search');

  // Poll Search Index Status
  useEffect(() => {
    if (searchTool) {
      fetchSearchStatus();
      pollIntervalRef.current = setInterval(fetchSearchStatus, 3000);
    } else {
      setSearchStatus(null);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [searchTool?.id]);

  const fetchSearchStatus = async () => {
    if (!searchTool) return;
    try {
      const status = await getSearchIndexStatus(searchTool.id);
      setSearchStatus(status);
      if (status.status === 'ready' || status.status === 'error') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    } catch (e) {
      console.error('Failed to fetch search index status', e);
    }
  };

  // Toggle tool
  const toggleTool = async (toolType: McpToolType) => {
    setLoading(toolType);
    try {
      const existingTool = getExistingTool(toolType);
      if (existingTool) {
        await deleteTool(existingTool.id);
        if (toolType === 'search') setSearchStatus(null);
      } else {
        const safeName = nodeName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
        // 如果有 jsonPath，添加到 tool name 中以防冲突
        const pathSuffix = jsonPath ? `_${jsonPath.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'item'}` : '';
        
        const toolRequest = {
          node_id: nodeId,
          json_path: jsonPath,
          type: toolType,
          name: `${toolType}_${safeName}${pathSuffix}`,
          description: `${TOOL_INFO[toolType]?.label || toolType} for ${nodeName}${jsonPath ? ` at ${jsonPath}` : ''}`,
          category: 'builtin' as const,
        };
        
        // Search 工具使用异步索引端点
        if (toolType === 'search') {
          await createSearchTool(toolRequest);
        } else {
          await createTool(toolRequest);
        }
      }
      onToolsChange?.();
    } catch (err) {
      console.error(`Failed to toggle ${toolType} tool:`, err);
    } finally {
      setLoading(null);
    }
  };

  const renderSearchStatus = () => {
    if (!searchStatus) return null;

    if (searchStatus.status === 'indexing' || searchStatus.status === 'pending') {
      const progress = searchStatus.total_files && searchStatus.indexed_files
        ? Math.round((searchStatus.indexed_files / searchStatus.total_files) * 100)
        : null;
      return (
        <span style={{ fontSize: 10, color: '#fb923c', display: 'flex', alignItems: 'center', gap: 4 }}>
          <LoadingIcon />
          {progress !== null ? `${progress}%` : ''}
        </span>
      );
    }

    if (searchStatus.status === 'ready') {
      // Small dot indicator for ready state
      return <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} title="Indexed" />;
    }

    if (searchStatus.status === 'error') {
      return <span style={{ fontSize: 10, color: '#f87171' }}>Error</span>;
    }

    return null;
  };

  // Filter tools by content type
  const applicableTools = getToolsForContentType(nodeType);

  const renderToolRow = (tool: ToolTypeConfig) => {
    const isEnabled = !!getExistingTool(tool.key);
    const isLoading = loading === tool.key;

    return (
      <div
        key={tool.key}
        onClick={() => !isLoading && toggleTool(tool.key)}
        style={{
          display: 'flex',
          alignItems: 'flex-start', // Top align for multi-line
          gap: 12,
          padding: '10px 12px',
          cursor: isLoading ? 'wait' : 'pointer',
          borderRadius: 8,
          transition: 'all 0.15s',
          background: isEnabled ? 'rgba(255,255,255,0.03)' : 'transparent',
          border: isEnabled ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
        }}
        onMouseEnter={e => {
          if (!isEnabled) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={e => {
          if (!isEnabled) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Checkbox */}
        <div
          style={{
            marginTop: 2, // Align with title
            width: 16,
            height: 16,
            borderRadius: 4,
            border: isEnabled ? `1px solid ${tool.color}` : '1px solid #52525b',
            background: isEnabled ? tool.color : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          {isLoading ? <LoadingIcon /> : isEnabled ? <CheckIcon /> : null}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: isEnabled ? '#e4e4e7' : '#a1a1aa' }}>
                {tool.label}
              </span>
              {/* Category Badge */}
              <span style={{ 
                fontSize: 9, 
                padding: '1px 5px', 
                borderRadius: 4, 
                background: tool.category === 'ai' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)', 
                color: tool.category === 'ai' ? '#60a5fa' : '#71717a',
                textTransform: 'uppercase',
                fontWeight: 600,
                letterSpacing: '0.05em'
              }}>
                {tool.category}
              </span>
            </div>
            
            {/* Status (e.g. for search) */}
            {tool.key === 'search' && isEnabled && renderSearchStatus()}
          </div>
          
          <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.4 }}>
            {tool.description}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      style={{
        background: '#18181b',
        border: '1px solid #27272a',
        borderRadius: 12,
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        width: 340, // Wider for descriptions
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ 
        padding: '16px 16px 12px',
        borderBottom: '1px solid #27272a',
        background: '#1f1f22'
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', margin: '0 0 2px 0' }}>
          Configure Tools
        </h3>
        <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Enable access for <span style={{ color: '#e4e4e7' }} title={nodeName}>{nodeName}</span>
          {jsonPath && <span style={{ color: '#fb923c', marginLeft: 4 }}>({jsonPath})</span>}
        </p>
      </div>

      {/* Tools List */}
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {applicableTools.length > 0 ? (
          applicableTools.map(renderToolRow)
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', color: '#52525b', fontSize: 13 }}>
            No applicable tools for this item type.
          </div>
        )}
      </div>
      
      {/* Footer hint */}
      <div style={{ 
        padding: '8px 16px 12px', 
        borderTop: '1px solid #27272a',
        background: '#1a1a1d',
        fontSize: 11,
        color: '#52525b',
        textAlign: 'center'
      }}>
        Changes apply immediately to all Agents.
      </div>
    </div>
  );
}

// ============================================
// NodeAccessButton - Quick access button
// ============================================

const BUTTON_SIZE = 26;

function PawIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="16" height="13" viewBox="0 0 33 26" fill="none">
      <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.00824" transform="rotate(26.6366 27.9463 11.0849)" fill={color} />
      <ellipse cx="21.2389" cy="5.4036" rx="3.49034" ry="4.00826" transform="rotate(9.17161 21.2389 5.4036)" fill={color} />
      <ellipse cx="12.3032" cy="5.36893" rx="3.5075" ry="4.00823" transform="rotate(-9.17161 12.3032 5.36893)" fill={color} />
      <ellipse cx="5.54689" cy="10.6915" rx="3.5075" ry="4.00823" transform="rotate(-26.1921 5.54689 10.6915)" fill={color} />
      <path d="M23.0469 15.6875C25.0899 18.8127 25.0469 22.2809 23.0469 24.1875C19.5 27.5625 13.5 27.5625 10 24.1875C8.02148 22.2246 8.04694 18.8127 10 15.6875C12.0469 12.4062 13.5 11.1875 16.5469 11.1875C19.5938 11.1875 21.0039 12.5623 23.0469 15.6875Z" fill={color} />
    </svg>
  );
}

export interface NodeAccessButtonProps {
  nodeId: string;
  nodeType: 'folder' | 'json' | 'file' | 'markdown' | 'pdf' | 'image';
  nodeName: string;
  jsonPath?: string;
  existingTools: Tool[];
  onToolsChange?: () => void;
}

export function NodeAccessButton({
  nodeId,
  nodeType,
  nodeName,
  jsonPath = '',
  existingTools,
  onToolsChange,
}: NodeAccessButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Count enabled tools
  const enabledCount = existingTools.filter(t => t.node_id === nodeId).length;
  const hasConfig = enabledCount > 0;

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
      {/* Button */}
      <div
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'all 0.15s',
          background: hasConfig
            ? isExpanded ? '#22c55e' : isHovered ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.15)'
            : isExpanded ? 'rgba(255,255,255,0.12)' : isHovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
          position: 'relative',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setIsExpanded(!isExpanded)}
        title={hasConfig ? `${enabledCount} tools enabled` : 'Create Tool'}
      >
        <PawIcon
          color={
            hasConfig
              ? isExpanded ? '#fff' : isHovered ? '#22c55e' : '#4ade80'
              : isExpanded ? '#e5e5e5' : isHovered ? '#d4d4d8' : '#6b7280'
          }
        />
        {/* Badge */}
        {hasConfig && !isExpanded && (
          <div style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#22c55e',
            color: '#fff',
            fontSize: 9,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {enabledCount}
          </div>
        )}
      </div>

      {/* Panel */}
      {isExpanded && (
        <div style={{ position: 'absolute', top: BUTTON_SIZE + 8, right: 0, zIndex: 100 }}>
          <NodeAccessPanel
            nodeId={nodeId}
            nodeType={nodeType}
            nodeName={nodeName}
            jsonPath={jsonPath}
            existingTools={existingTools}
            onToolsChange={onToolsChange}
            onClose={() => setIsExpanded(false)}
          />
        </div>
      )}
    </div>
  );
}
