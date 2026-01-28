'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAgent, AgentType } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';

interface AgentSettingViewProps {
  availableTools?: unknown[];
  currentTableId?: string;
}

// Agent Icon 组件 - 带 fallback
const AgentIcon = ({ src, fallback, alt }: { src?: string; fallback: string; alt: string }) => {
  const [useFallback, setUseFallback] = React.useState(!src);
  if (useFallback || !src) {
    return <span style={{ fontSize: 14 }}>{fallback}</span>;
  }
  return (
    <img 
      src={src} 
      alt={alt} 
      style={{ width: 14, height: 14, borderRadius: 3 }} 
      onError={() => setUseFallback(true)} 
    />
  );
};

const AGENT_TYPE_CONFIG: Record<AgentType, { label: string; desc: string; icon: React.ReactNode }> = {
  chat: { 
    label: 'Puppyone Agent', 
    desc: 'Built-in conversational agent.', 
    icon: <AgentIcon fallback="🐶" alt="Puppyone" />
  },
  devbox: { 
    label: 'Claude / Cursor', 
    desc: 'External coding agents.', 
    icon: <AgentIcon src="/icons/claude.svg" fallback="🤖" alt="Claude" />
  },
  webhook: { 
    label: 'N8N / Zapier', 
    desc: 'Workflow automation.', 
    icon: <AgentIcon src="/icons/n8n.svg" fallback="⚡" alt="N8N" />
  },
};

// 随机名字生成器
const NAME_ADJECTIVES = [
  'Swift', 'Cosmic', 'Silent', 'Crystal', 'Shadow', 'Golden', 'Iron', 'Silver',
  'Neon', 'Phantom', 'Mystic', 'Thunder', 'Frost', 'Solar', 'Lunar', 'Spark',
  'Pixel', 'Cyber', 'Atomic', 'Quantum', 'Hyper', 'Ultra', 'Mega', 'Turbo',
];
const NAME_NOUNS = [
  'Fox', 'Wolf', 'Hawk', 'Bear', 'Tiger', 'Dragon', 'Phoenix', 'Raven',
  'Node', 'Core', 'Link', 'Pulse', 'Wave', 'Bolt', 'Spark', 'Flux',
  'Agent', 'Bot', 'Mind', 'Edge', 'Flow', 'Hub', 'Nexus', 'Sync',
];
const generateRandomName = () => {
  const adj = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${adj} ${noun}`;
};

// Access Point 图标 - 动物 emoji（和 ProjectsHeader 保持一致）
const ACCESS_ICONS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦉',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌',
  '🐙', '🦑', '🦐', '🦀', '🐠', '🐬', '🦈', '🐳',
];
const getRandomIconIndex = () => Math.floor(Math.random() * ACCESS_ICONS.length);

// 从存储的 icon 解析出索引（兼容旧数据：直接 emoji 或数字索引）
const parseIconToIndex = (icon?: string): number => {
  if (!icon) return getRandomIconIndex();
  
  // 尝试解析为数字
  const idx = parseInt(icon);
  if (!isNaN(idx)) return idx % ACCESS_ICONS.length;
  
  // 如果是直接存的 emoji，找到它的索引
  const emojiIndex = ACCESS_ICONS.indexOf(icon);
  if (emojiIndex !== -1) return emojiIndex;
  
  // 都匹配不上，返回随机
  return getRandomIconIndex();
};

// Icons - 和左侧视图一致
const FolderIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
      fill='currentColor'
      fillOpacity='0.15'
      stroke='currentColor'
      strokeWidth='1.5'
    />
  </svg>
);

const JsonIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' fill='currentColor' fillOpacity='0.08' />
    <path d='M3 9H21' stroke='currentColor' strokeWidth='1.5' />
    <path d='M9 3V21' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

const MarkdownIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.08'
    />
    <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
    <path d='M8 13H16' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    <path d='M8 17H12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
  </svg>
);

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const ChevronDownIcon = ({ open }: { open?: boolean }) => (
  <svg 
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
  >
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ChevronUpIcon = ({ open }: { open?: boolean }) => (
  <svg 
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
  >
    <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// 根据 nodeType 返回对应图标和颜色（和左侧一致）
const getNodeIcon = (nodeType: string) => {
  switch (nodeType) {
    case 'folder': return { icon: <FolderIcon />, color: '#a1a1aa' };
    case 'json': return { icon: <JsonIcon />, color: '#34d399' };
    default: return { icon: <MarkdownIcon />, color: '#60a5fa' };
  }
};

export function AgentSettingView({ currentTableId }: AgentSettingViewProps) {
  const { 
    draftType, 
    setDraftType, 
    deployAgent,
    draftResources,
    addDraftResource,
    updateDraftResource,
    removeDraftResource,
    cancelSetting,
    editingAgentId,
    savedAgents,
  } = useAgent();

  // 获取正在编辑的 agent 信息
  const editingAgent = editingAgentId ? savedAgents.find(a => a.id === editingAgentId) : null;
  const isEditMode = !!editingAgentId;

  // Draft name and icon
  const [draftName, setDraftName] = useState('');
  const [draftIconIndex, setDraftIconIndex] = useState(() => getRandomIconIndex());
  const [isEditingName, setIsEditingName] = useState(false);
  
  // 编辑模式时初始化 name 和 icon
  useEffect(() => {
    if (editingAgent) {
      setDraftName(editingAgent.name);
      // 兼容旧数据：可能是数字索引或直接的 emoji
      setDraftIconIndex(parseIconToIndex(editingAgent.icon));
    } else {
      setDraftName('');
      setDraftIconIndex(getRandomIconIndex());
    }
  }, [editingAgent]);

  // UI States
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Terminal Access 资源
  const terminalResources = useMemo(() => 
    draftResources.filter(r => r.terminal), 
    [draftResources]
  );

  // 自动生成随机名字（只在首次 mount 或编辑模式切换时生成）
  const [autoGeneratedName, setAutoGeneratedName] = useState(() => generateRandomName());
  
  // 切换编辑/新建模式时重新生成随机名字
  useEffect(() => {
    if (!editingAgentId) {
      setAutoGeneratedName(generateRandomName());
    }
  }, [editingAgentId]);

  // 显示的名字：用户输入 > 自动生成
  const displayName = draftName.trim() || autoGeneratedName;

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(event.target as Node)) {
        setIsTypeOpen(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeploy = () => {
    // 用 displayName（用户输入或自动生成）
    // 直接存 emoji 而不是索引，更直观
    const icon = ACCESS_ICONS[draftIconIndex];
    deployAgent(displayName, icon);
  };

  const currentTypeConfig = AGENT_TYPE_CONFIG[draftType];

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (data) {
      try {
        const node = JSON.parse(data);
        
        if (draftResources.some(r => r.nodeId === node.id)) {
          return;
        }

        const isFolder = node.type === 'folder';
        const isJson = node.type === 'json';
        
        const newResource: AccessResource = {
          nodeId: node.id,
          nodeName: node.name,
          nodeType: isFolder ? 'folder' : (isJson ? 'json' : 'file'),
          terminal: true,
          terminalReadonly: false, // 默认 Write 模式
          canRead: false,
          canWrite: false,
          canDelete: false,
          jsonPath: '',
        };
        
        addDraftResource(newResource);
      } catch (err) {
        console.error('Drop failed', err);
      }
    }
  };

  const toggleReadonly = (nodeId: string) => {
    const resource = draftResources.find(r => r.nodeId === nodeId);
    if (!resource) return;
    updateDraftResource(nodeId, { terminalReadonly: !resource.terminalReadonly });
  };

  const handleAddTool = (toolType: string) => {
    setIsToolsOpen(false);
    alert(`Adding ${toolType} tool - coming soon`);
  };

  const hasAnyContent = terminalResources.length > 0;

  // 统一的下拉按钮样式
  const dropdownButtonStyle: React.CSSProperties = {
    width: '100%',
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#161616',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '0 10px',
    color: '#e5e5e5',
    cursor: 'pointer',
    transition: 'all 0.1s',
    textAlign: 'left',
    fontSize: 14,
  };

  const labelStyle = {
    fontSize: 13,
    fontWeight: 500,
    color: '#666',
    marginBottom: 8,
    display: 'block',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header - Fixed Height 48px */}
      <div style={{ 
        height: 48, 
        padding: '0 16px', 
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#141414'
      }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
          {isEditMode ? `Editing ${editingAgent?.name || 'Agent'}` : 'Creating new access'}
        </span>
        <button
          onClick={cancelSetting}
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: '#525252',
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#a3a3a3'; e.currentTarget.style.background = '#1f1f1f'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#525252'; e.currentTarget.style.background = 'transparent'; }}
          title={isEditMode ? "Back to chat" : "Close"}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Content - Scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Context is used by - 必填 */}
      <div style={{ position: 'relative', zIndex: 30 }} ref={typeRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Context is used by</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>
        <button
          onClick={() => setIsTypeOpen(!isTypeOpen)}
          style={{
            ...dropdownButtonStyle,
            borderColor: isTypeOpen ? '#4ade80' : '#2a2a2a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center' }}>{currentTypeConfig.icon}</span>
            <span style={{ fontWeight: 500 }}>{currentTypeConfig.label}</span>
          </div>
          <ChevronDownIcon open={isTypeOpen} />
        </button>

        {isTypeOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100,
          }}>
            {(Object.keys(AGENT_TYPE_CONFIG) as AgentType[]).map((type) => (
              <button
                key={type}
                onClick={() => { setDraftType(type); setIsTypeOpen(false); }}
                style={{
                  width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
                  background: type === draftType ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
                  border: 'none', borderBottom: '1px solid #1f1f1f',
                  color: type === draftType ? '#4ade80' : '#a3a3a3', cursor: 'pointer', textAlign: 'left',
                  fontSize: 14,
                }}
                onMouseEnter={e => { if (type !== draftType) e.currentTarget.style.background = '#1f1f1f'; }}
                onMouseLeave={e => { if (type !== draftType) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'flex', alignItems: 'center' }}>{AGENT_TYPE_CONFIG[type].icon}</span>
                <span style={{ fontWeight: 500 }}>{AGENT_TYPE_CONFIG[type].label}</span>
              </button>
            ))}
          </div>
        )}
      </div>


      {/* Agent's bash access - 必填 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Agent's bash access</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>
        
        <div 
          style={{ 
            minHeight: 88, // 始终保持最小高度，暗示可以拖多个
            background: isDragging ? 'rgba(74, 222, 128, 0.04)' : 'transparent',
            border: isDragging ? '1px dashed #4ade80' : '1px dashed #2a2a2a',
            borderRadius: 6, 
            transition: 'all 0.15s',
            position: 'relative',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 文件列表 */}
          <div style={{ padding: terminalResources.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {terminalResources.map((resource) => {
              const { icon, color } = getNodeIcon(resource.nodeType);
              const pathDisplay = resource.nodePath || resource.nodeName;
              return (
                <div 
                  key={resource.nodeId}
                  style={{ 
                    height: 32,
                    display: 'flex', 
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    borderRadius: 4,
                    background: '#1a1a1a',
                    border: '1px solid #252525',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                >
                    {/* 左侧：图标 + 路径 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                      <span style={{ fontSize: 14, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pathDisplay}
                      </span>
                    </div>
                    
                    {/* 右侧：权限切换 + 删除 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {/* Segmented Control: View | Edit */}
                      <div style={{
                        display: 'flex',
                        background: '#0f0f0f',
                        border: '1px solid #2a2a2a',
                        borderRadius: 4,
                        padding: 2,
                        gap: 1,
                      }}>
                        <button 
                          onClick={() => { if (!resource.terminalReadonly) toggleReadonly(resource.nodeId); }}
                          style={{
                            background: resource.terminalReadonly ? '#333' : 'transparent',
                            border: 'none',
                            borderRadius: 3,
                            color: resource.terminalReadonly ? '#e5e5e5' : '#505050',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '3px 10px',
                            fontWeight: 500,
                            transition: 'all 0.1s',
                          }}
                        >
                          View
                        </button>
                        <button 
                          onClick={() => { if (resource.terminalReadonly) toggleReadonly(resource.nodeId); }}
                          style={{
                            background: !resource.terminalReadonly ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
                            border: 'none',
                            borderRadius: 3,
                            color: !resource.terminalReadonly ? '#fb923c' : '#505050',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '3px 10px',
                            fontWeight: 500,
                            transition: 'all 0.1s',
                          }}
                        >
                          Edit
                        </button>
                      </div>
                      
                      <button
                        onClick={() => removeDraftResource(resource.nodeId)}
                        style={{ 
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 20, height: 20, borderRadius: 4,
                          background: 'transparent', 
                          border: 'none', 
                          color: '#505050', 
                          cursor: 'pointer',
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
          
          {/* 拖拽提示 - 始终显示在底部 */}
          <div style={{ 
            minHeight: terminalResources.length > 0 ? 32 : 88,
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: 8,
            color: isDragging ? '#4ade80' : '#525252',
          }}>
            {/* 空状态时显示三个类型图标 */}
            {terminalResources.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: isDragging ? '#4ade80' : '#a1a1aa' }}><FolderIcon /></div>
                <div style={{ color: isDragging ? '#4ade80' : '#34d399' }}><JsonIcon /></div>
                <div style={{ color: isDragging ? '#4ade80' : '#60a5fa' }}><MarkdownIcon /></div>
              </div>
            )}
            <span style={{ fontSize: 12 }}>
              {isDragging ? 'Drop here' : (terminalResources.length > 0 ? 'Drag more' : 'Drag items into this')}
            </span>
          </div>
        </div>
      </div>

      {/* Agent's tools */}
      <div style={{ position: 'relative', zIndex: isToolsOpen ? 50 : 20 }} ref={toolsRef}>
        <label style={labelStyle}>Agent's tools</label>
        <button
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          style={{
            ...dropdownButtonStyle,
            borderColor: isToolsOpen ? '#4ade80' : '#2a2a2a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlusIcon />
            <span style={{ color: '#737373' }}>Add a tool...</span>
          </div>
          <ChevronDownIcon open={isToolsOpen} />
        </button>

        {isToolsOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0, right: 0,
            background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100,
          }}>
            {[
              { id: 'query', label: 'Query Data', desc: 'Read from tables' },
              { id: 'create', label: 'Create Record', desc: 'Add new data' },
              { id: 'update', label: 'Update Record', desc: 'Modify existing data' },
              { id: 'delete', label: 'Delete Record', desc: 'Remove data' },
              { id: 'custom', label: 'Custom Script', desc: 'Python or JS' },
            ].map((tool) => (
              <button
                key={tool.id}
                onClick={() => handleAddTool(tool.id)}
                style={{
                  width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px',
                  background: 'transparent',
                  border: 'none', borderBottom: '1px solid #1f1f1f',
                  color: '#a3a3a3', cursor: 'pointer', textAlign: 'left',
                  fontSize: 14,
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1f1f1f'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontWeight: 500, color: '#e5e5e5' }}>{tool.label}</span>
                <span style={{ fontSize: 11, color: '#525252' }}>{tool.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部：名字 + 保存 */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 名字行 - 轻量显示 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10,
          padding: '8px 0',
          borderTop: '1px solid #1a1a1a',
        }}>
          {/* 图标 - emoji 圆形 */}
          <button
            onClick={() => setDraftIconIndex((draftIconIndex + 1) % ACCESS_ICONS.length)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#252525'; e.currentTarget.style.borderColor = '#3a3a3a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
            title="Click to change icon"
          >
            {ACCESS_ICONS[draftIconIndex]}
          </button>
          
          {/* 名字 - 可点击编辑 */}
          {isEditingName ? (
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingName(false); }}
              placeholder={autoGeneratedName}
              autoFocus
              style={{
                flex: 1,
                height: 24,
                background: '#161616',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
                padding: '0 8px',
                color: '#e5e5e5',
                fontSize: 14,
                outline: 'none',
              }}
            />
          ) : (
            <button
              onClick={() => setIsEditingName(true)}
              style={{
                flex: 1,
                height: 24,
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                padding: '0 4px',
                color: draftName ? '#e5e5e5' : '#737373',
                fontSize: 14,
                cursor: 'text',
                textAlign: 'left',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              title="Click to rename"
            >
              {displayName}
            </button>
          )}
        </div>

        {/* Save 按钮 */}
        <button
          onClick={handleDeploy}
          disabled={!hasAnyContent}
          style={{
            height: 32,
            background: hasAnyContent ? '#4ade80' : '#262626',
            color: hasAnyContent ? '#000' : '#525252',
            border: 'none', 
            borderRadius: 6, 
            cursor: hasAnyContent ? 'pointer' : 'not-allowed',
            fontSize: 14, 
            fontWeight: 600, 
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (hasAnyContent) e.currentTarget.style.background = '#22c55e'; }}
          onMouseLeave={e => { if (hasAnyContent) e.currentTarget.style.background = '#4ade80'; }}
        >
          Save
        </button>
      </div>
      </div>
    </div>
  );
}
