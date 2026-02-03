'use client';

/**
 * Toolkit Page
 * 
 * Redesigned with flexible filtering:
 * - Single unified list of all tools
 * - Filter bar at top (Type, Context, Status)
 * - Search bar integrated into the filter row
 * - Minimalist styling
 */

import React, { use, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { 
  getToolsByProjectId, 
  deleteTool, 
  updateTool,
  createTool,
  Tool, 
  McpToolType,
  TOOL_INFO,
  getSearchIndexStatus,
  SearchIndexTask,
} from '@/lib/mcpApi';
import { listNodes, type NodeInfo } from '@/lib/contentNodesApi';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';

// ================= Types =================

type ToolFilterType = 'all' | McpToolType;
type StatusFilter = 'all' | 'active' | 'indexing' | 'error';

// ================= Tool Type Config =================

type ToolTypeConfig = {
  key: McpToolType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
};

const AVAILABLE_TOOL_TYPES: ToolTypeConfig[] = [
  {
    key: 'search',
    label: 'Search',
    description: 'AI-powered search across content',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
    color: '#3b82f6',
  },
  {
    key: 'get_all_data',
    label: 'Get Content',
    description: 'Retrieve all content',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    color: '#64748b',
  },
  {
    key: 'create',
    label: 'Add Element',
    description: 'Add new element to JSON data',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    color: '#22c55e',
  },
  {
    key: 'update',
    label: 'Edit Data',
    description: 'Edit existing content',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    color: '#f59e0b',
  },
  {
    key: 'delete',
    label: 'Remove Element',
    description: 'Remove element from JSON data',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
    color: '#ef4444',
  },
];

function getToolConfig(type: string): ToolTypeConfig | undefined {
  return AVAILABLE_TOOL_TYPES.find(t => t.key === type);
}

// ================= Helpers =================

function formatRelativeTime(isoString: string) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ================= Components =================

// Filter Chip Component
function FilterChip({ 
  label, 
  active, 
  count,
  onClick,
  icon,
  color,
}: { 
  label: string; 
  active: boolean; 
  count?: number;
  onClick: () => void;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: active ? (color ? `${color}15` : 'rgba(255, 255, 255, 0.08)') : 'transparent',
        border: '1px solid transparent', // Removing border for cleaner look
        borderRadius: 6,
        color: active ? (color || '#e4e4e7') : '#71717a',
        fontSize: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          e.currentTarget.style.color = '#a1a1aa';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#71717a';
        }
      }}
    >
      {icon && <span style={{ display: 'flex', color: active ? color : 'inherit', opacity: active ? 1 : 0.7 }}>{icon}</span>}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span style={{ 
          background: active ? (color ? `${color}30` : 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.06)', 
          color: active ? (color || '#e4e4e7') : '#71717a',
          padding: '0 5px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 500,
          minWidth: 18,
          textAlign: 'center',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// Dropdown Filter Component - Minimalist
function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#52525b' }}>{label}</span>
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            padding: '4px 18px 4px 4px',
            fontSize: 12,
            color: '#a1a1aa',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: 500,
          }}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" 
          style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#52525b' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}

function ToolRow({ 
  tool, 
  searchStatus, 
  nodeName,
  onClick, 
  active,
  onEdit,
  onDelete
}: { 
  tool: Tool; 
  searchStatus?: SearchIndexTask | null;
  nodeName?: string;
  onClick: () => void; 
  active: boolean;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const config = getToolConfig(tool.type);
  const color = config?.color || '#71717a';
  
  // Status Logic
  let statusColor = '#71717a';
  let statusText = 'Active';
  
  if (tool.type === 'search' && searchStatus) {
    if (searchStatus.status === 'ready') {
      statusColor = '#22c55e';
      statusText = 'Ready';
    } else if (searchStatus.status === 'indexing') {
      statusColor = '#eab308';
      statusText = 'Indexing';
    } else if (searchStatus.status === 'error') {
      statusColor = '#ef4444';
      statusText = 'Error';
    }
  } else {
    statusColor = '#22c55e';
  }

  return (
    <div 
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 140px 180px 100px 1fr 100px 80px', // Wider name col
        gap: 12,
        height: 40, // Slightly more compact
        padding: '0 20px',
        borderBottom: '1px solid #1f1f23',
        cursor: 'pointer',
        fontSize: 13,
        alignItems: 'center',
        background: active ? '#18181b' : 'transparent',
        color: active ? '#e4e4e7' : '#a1a1aa',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.background = '#0f0f10')}
      onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
    >
      {/* Name */}
      <div style={{ fontWeight: 500, color: '#e4e4e7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tool.name}
      </div>

      {/* Type */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: color }}>{config?.icon}</span>
        <span style={{ fontSize: 12 }}>{config?.label || tool.type}</span>
      </div>

      {/* Context */}
      <div style={{ 
        fontSize: 12, 
        color: '#71717a',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {nodeName || '-'}
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 11, color: statusColor }}>{statusText}</span>
      </div>

      {/* Description */}
      <div style={{ 
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: '#52525b',
        fontSize: 12
      }}>
        {tool.description || '-'}
      </div>

      {/* Created */}
      <div style={{ color: '#3f3f46', fontSize: 11 }}>
        {formatRelativeTime(tool.created_at)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <button
          onClick={onEdit}
          style={{ padding: 6, background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', borderRadius: 4 }}
          title="Edit"
          onMouseEnter={e => { e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#52525b'; e.currentTarget.style.background = 'none'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        </button>
        <button
          onClick={onDelete}
          style={{ padding: 6, background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', borderRadius: 4 }}
          title="Delete"
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#52525b'; e.currentTarget.style.background = 'none'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      </div>
    </div>
  );
}

// ================= Node Picker =================

interface NodePickerProps {
  projectId: string;
  selectedNodeId: string | null;
  onSelect: (node: NodeInfo | null) => void;
}

function NodePicker({ projectId, selectedNodeId, onSelect }: NodePickerProps) {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childNodes, setChildNodes] = useState<Record<string, NodeInfo[]>>({});

  useEffect(() => {
    setLoading(true);
    listNodes(projectId, null)
      .then(res => setNodes(res.nodes))
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggleFolder = async (folderId: string) => {
    if (expandedFolders.has(folderId)) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    } else {
      setExpandedFolders(prev => new Set([...prev, folderId]));
      if (!childNodes[folderId]) {
        const res = await listNodes(projectId, folderId);
        setChildNodes(prev => ({ ...prev, [folderId]: res.nodes }));
      }
    }
  };

  const renderNode = (node: NodeInfo, depth: number = 0) => {
    const isFolder = getNodeTypeConfig(node.type).renderAs === 'folder';
    const isExpanded = expandedFolders.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const children = childNodes[node.id] || [];

    return (
      <div key={node.id}>
        <div
          onClick={() => isFolder ? toggleFolder(node.id) : onSelect(node)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            paddingLeft: 12 + depth * 16,
            cursor: 'pointer',
            background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent',
            borderRadius: 6,
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => !isSelected && (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={e => !isSelected && (e.currentTarget.style.background = 'transparent')}
        >
          {isFolder && (
            <svg 
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
          {!isFolder && <div style={{ width: 12 }} />}
          
          <span style={{ 
            fontSize: 12, 
            color: isSelected ? '#3b82f6' : '#a1a1aa',
            fontWeight: isSelected ? 500 : 400,
          }}>
            {node.name}
          </span>
        </div>
        
        {isFolder && isExpanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#52525b', fontSize: 12 }}>Loading...</div>;

  return (
    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
      {nodes.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: '#52525b', fontSize: 12 }}>No content nodes found</div> : nodes.map(node => renderNode(node))}
    </div>
  );
}

// ================= Create Tool Panel =================

function CreateToolPanel({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<'type' | 'node' | 'config'>('type');
  const [selectedType, setSelectedType] = useState<McpToolType | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeInfo | null>(null);
  const [toolName, setToolName] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedTypeConfig = AVAILABLE_TOOL_TYPES.find(t => t.key === selectedType);

  const handleCreate = async () => {
    if (!selectedType || !selectedNode) return;
    setCreating(true);
    try {
      await createTool({
        node_id: selectedNode.id,
        json_path: '',
        type: selectedType,
        name: toolName || `${selectedType}_${selectedNode.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)}`,
        description: toolDescription || selectedTypeConfig?.description,
        category: 'builtin',
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to create tool');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0c0c0c', border: '1px solid #1f1f23', borderRadius: 16, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: '#f4f4f5' }}>Create Tool</h2>
        </div>
        
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {step === 'type' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {AVAILABLE_TOOL_TYPES.map(config => (
                <div key={config.key} onClick={() => { setSelectedType(config.key); setStep('node'); }}
                  style={{ padding: 12, borderRadius: 8, border: '1px solid #27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#18181b'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ color: config.color }}>{config.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{config.label}</div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>{config.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 'node' && (
            <div>
               <div style={{ marginBottom: 12, fontSize: 13, color: '#e4e4e7' }}>Select Data Source</div>
               <div style={{ border: '1px solid #27272a', borderRadius: 8, background: '#0a0a0a', overflow: 'hidden' }}>
                <NodePicker projectId={projectId} selectedNodeId={selectedNode?.id || null} onSelect={node => { setSelectedNode(node); if (node) setStep('config'); }} />
              </div>
            </div>
          )}

          {step === 'config' && selectedNode && (
             <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
               <div>
                <label style={{ display: 'block', fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>Tool Name</label>
                <input type="text" value={toolName} onChange={e => setToolName(e.target.value)} placeholder={`${selectedType}_${selectedNode.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)}`}
                  style={{ width: '100%', padding: '8px 12px', background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 6, color: '#e4e4e7', fontSize: 13 }} />
               </div>
               <div>
                <label style={{ display: 'block', fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>Description</label>
                <textarea value={toolDescription} onChange={e => setToolDescription(e.target.value)} placeholder={selectedTypeConfig?.description} rows={3}
                  style={{ width: '100%', padding: '8px 12px', background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 6, color: '#e4e4e7', fontSize: 13 }} />
               </div>
             </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #1f1f23', display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => { if (step === 'config') setStep('node'); else if (step === 'node') setStep('type'); else onClose(); }}
            style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #27272a', borderRadius: 6, color: '#a1a1aa', fontSize: 12, cursor: 'pointer' }}>
            {step === 'type' ? 'Cancel' : 'Back'}
          </button>
          {step === 'config' && (
            <button onClick={handleCreate} disabled={creating}
              style={{ padding: '6px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 500, cursor: creating ? 'wait' : 'pointer' }}>
              {creating ? 'Creating...' : 'Create Tool'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ================= Main Page =================

export default function ToolkitPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  
  // Data State
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchStatuses, setSearchStatuses] = useState<Record<string, SearchIndexTask>>({});
  
  // Filter State
  const [typeFilter, setTypeFilter] = useState<ToolFilterType>('all');
  const [contextFilter, setContextFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI State
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);

  // Deprecated tool types that should be hidden
  const DEPRECATED_TOOL_TYPES = ['query_data', 'preview', 'select', 'get_data_schema', 'custom_script'];

  // Fetch tools and nodes
  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getToolsByProjectId(projectId);
      setTools(data);
      
      // Fetch status for search tools
      const searchTools = data.filter(t => t.type === 'search');
      const statuses: Record<string, SearchIndexTask> = {};
      await Promise.all(searchTools.map(async (tool) => {
        try { statuses[tool.id] = await getSearchIndexStatus(tool.id); } catch {}
      }));
      setSearchStatuses(statuses);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  // Get unique contexts from tools
  const uniqueContexts = useMemo(() => {
    const contexts = new Map<string, string>();
    tools.forEach(tool => {
      const nodeId = tool.node_id;
      if (nodeId) {
        // Try to extract node name from tool name or description
        const nodeName = tool.description?.match(/for (.+)$/)?.[1] || nodeId.slice(0, 8);
        contexts.set(nodeId, nodeName);
      }
    });
    return Array.from(contexts.entries()).map(([id, name]) => ({ id, name }));
  }, [tools]);

  // Filtering
  const filteredTools = useMemo(() => {
    return tools.filter(tool => {
      // Hide deprecated tool types
      if (DEPRECATED_TOOL_TYPES.includes(tool.type)) return false;
      
      // Type Filter
      if (typeFilter !== 'all' && tool.type !== typeFilter) return false;
      
      // Context Filter
      if (contextFilter !== 'all' && tool.node_id !== contextFilter) return false;
      
      // Status Filter
      if (statusFilter !== 'all') {
        const status = searchStatuses[tool.id];
        if (statusFilter === 'active' && status?.status !== 'ready' && tool.type === 'search') return false;
        if (statusFilter === 'indexing' && status?.status !== 'indexing') return false;
        if (statusFilter === 'error' && status?.status !== 'error') return false;
      }
      
      // Search Query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!tool.name.toLowerCase().includes(query) && !tool.description?.toLowerCase().includes(query)) return false;
      }
      
      return true;
    });
  }, [tools, typeFilter, contextFilter, statusFilter, searchQuery, searchStatuses]);

  // Count by type (for filter chips)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    AVAILABLE_TOOL_TYPES.forEach(t => counts[t.key] = 0);
    tools.filter(t => !DEPRECATED_TOOL_TYPES.includes(t.type)).forEach(tool => {
      counts.all++;
      if (counts[tool.type] !== undefined) counts[tool.type]++;
    });
    return counts;
  }, [tools]);

  // Actions
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) return;
    try {
      await deleteTool(id);
      setTools(prev => prev.filter(t => t.id !== id));
      if (selectedToolId === id) setSelectedToolId(null);
    } catch (err) {
      console.error(err);
      alert('Failed to delete tool');
    }
  };

  const handleEdit = async (id: string, data: { name?: string; description?: string }) => {
    try {
      const updated = await updateTool(id, data);
      setTools(prev => prev.map(t => t.id === id ? updated : t));
      setEditingTool(null);
    } catch (err) {
      console.error(err);
      alert('Failed to update tool');
    }
  };

  const getNodeName = (tool: Tool) => {
    // Extract from description like "Semantic search index for reactflow"
    const match = tool.description?.match(/for (.+)$/);
    return match ? match[1] : tool.node_id?.slice(0, 8) || '-';
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      
      {/* Header */}
      <div style={{ 
        height: 48, minHeight: 48, borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', background: '#141414', flexShrink: 0 
      }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>Toolkit</h1>
        {/* Create Tool button hidden - tools are auto-created when users configure access in Context page */}
      </div>

      {/* Filter Bar - Unified */}
      <div style={{ 
        padding: '12px 20px', 
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center',
        gap: 16,
        background: '#0a0a0a',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}>
        {/* Search Input - First */}
        <div style={{ position: 'relative', minWidth: 200, maxWidth: 300 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="text" placeholder="Search tools..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', background: '#09090b', border: '1px solid #27272a', borderRadius: 6, padding: '5px 10px 5px 32px', fontSize: 12, color: '#e4e4e7', outline: 'none', height: 30, transition: 'border-color 0.15s' }}
            onFocus={(e) => e.target.style.borderColor = '#3f3f46'}
            onBlur={(e) => e.target.style.borderColor = '#27272a'}
          />
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: '#27272a' }} />

        {/* Type Filters (Chips) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterChip 
            label="All" 
            active={typeFilter === 'all'} 
            count={typeCounts.all}
            onClick={() => setTypeFilter('all')} 
          />
          {AVAILABLE_TOOL_TYPES.map(type => (
            <FilterChip 
              key={type.key}
              label={type.label}
              icon={type.icon}
              color={type.color}
              active={typeFilter === type.key}
              count={typeCounts[type.key]}
              onClick={() => setTypeFilter(type.key as ToolFilterType)}
            />
          ))}
        </div>

        {/* Context & Status Filters - Right Aligned if possible, or just flow */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Context Filter */}
          {uniqueContexts.length > 0 && (
            <FilterDropdown
              label="Context"
              value={contextFilter}
              options={[
                { value: 'all', label: 'All Contexts' },
                ...uniqueContexts.map(c => ({ value: c.id, label: c.name }))
              ]}
              onChange={setContextFilter}
            />
          )}

          {/* Status Filter */}
          <FilterDropdown
            label="Status"
            value={statusFilter}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'indexing', label: 'Indexing' },
              { value: 'error', label: 'Error' },
            ]}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />

          {/* Refresh */}
          <button onClick={fetchTools} disabled={loading}
            style={{ background: 'transparent', border: 'none', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: loading ? '#27272a' : '#52525b', cursor: loading ? 'not-allowed' : 'pointer' }}
            title="Refresh list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Table Header */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '240px 140px 180px 100px 1fr 100px 80px', 
          gap: 12, 
          padding: '10px 20px', 
          borderBottom: '1px solid #1f1f23', 
          background: '#0c0c0c', 
          fontSize: 10, 
          fontWeight: 600, 
          color: '#52525b', 
          position: 'sticky', 
          top: 0, 
          zIndex: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <div>Name</div>
          <div>Type</div>
          <div>Context</div>
          <div>Status</div>
          <div>Description</div>
          <div>Created</div>
          <div style={{ textAlign: 'right' }}>Actions</div>
        </div>

        {/* Table Body */}
        {loading && tools.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#3f3f46' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /></svg>
            <div>Loading tools...</div>
          </div>
        ) : filteredTools.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#27272a' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <div style={{ fontSize: 13 }}>No tools found</div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>Try adjusting your filters or create a new tool</div>
          </div>
        ) : (
          filteredTools.map(tool => (
            <ToolRow 
              key={tool.id} 
              tool={tool} 
              searchStatus={searchStatuses[tool.id]} 
              nodeName={getNodeName(tool)}
              onClick={() => setSelectedToolId(tool.id === selectedToolId ? null : tool.id)}
              active={selectedToolId === tool.id}
              onEdit={(e) => { e.stopPropagation(); setEditingTool(tool); }}
              onDelete={(e) => { e.stopPropagation(); handleDelete(tool.id); }}
            />
          ))
        )}
      </div>

      {/* Create Panel - disabled, tools are auto-created via Context page */}
      {/* {showCreatePanel && <CreateToolPanel projectId={projectId} onClose={() => setShowCreatePanel(false)} onCreated={fetchTools} />} */}

      {/* Edit Modal */}
      {editingTool && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }} onClick={() => setEditingTool(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0c0c0c', border: '1px solid #1f1f23', borderRadius: 12, width: 400, padding: 24 }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 500, color: '#f4f4f5' }}>Edit Tool</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#71717a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</label>
              <input type="text" defaultValue={editingTool.name} id="edit-name" style={{ width: '100%', padding: '8px 12px', background: '#09090b', border: '1px solid #1f1f23', borderRadius: 6, color: '#e4e4e7', fontSize: 13 }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#71717a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</label>
              <textarea defaultValue={editingTool.description || ''} id="edit-desc" rows={3} style={{ width: '100%', padding: '8px 12px', background: '#09090b', border: '1px solid #1f1f23', borderRadius: 6, color: '#e4e4e7', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setEditingTool(null)} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #27272a', borderRadius: 6, color: '#71717a', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                const name = (document.getElementById('edit-name') as HTMLInputElement).value;
                const desc = (document.getElementById('edit-desc') as HTMLTextAreaElement).value;
                if(name) handleEdit(editingTool.id, { name, description: desc });
              }} style={{ padding: '6px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{` @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } `}</style>
    </div>
  );
}
