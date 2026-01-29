'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { type SavedAgent, type AgentType, type TriggerType, type TriggerConfig, type ExternalConfig } from '@/components/AgentRail';
import { post, get, put, del } from '@/lib/apiClient';

export type SidebarMode = 'closed' | 'setting' | 'deployed';

// 节点信息类型（从后端 /api/v1/nodes/{id} 返回）
interface NodeInfo {
  id: string;
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file';
}

/**
 * 批量获取节点信息
 * 通过 node IDs 获取对应的 name 和 type
 */
async function fetchNodeInfoBatch(nodeIds: string[]): Promise<Map<string, NodeInfo>> {
  const nodeMap = new Map<string, NodeInfo>();
  if (nodeIds.length === 0) return nodeMap;

  // 去重
  const uniqueIds = [...new Set(nodeIds)];
  
  // 并行获取所有节点信息
  const results = await Promise.allSettled(
    uniqueIds.map(async (nodeId) => {
      try {
        const node = await get<{
          id: string;
          name: string;
          type: string;
        }>(`/api/v1/nodes/${nodeId}`);
        return node;
      } catch (error) {
        console.warn(`Failed to fetch node info for ${nodeId}:`, error);
        return null;
      }
    })
  );

  // 处理结果
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      const node = result.value;
      nodeMap.set(node.id, {
        id: node.id,
        name: node.name,
        type: node.type as NodeInfo['type'],
      });
    }
  });

  return nodeMap;
}

/**
 * 将后端节点类型映射到前端 AccessResource 的 nodeType
 */
function mapNodeType(backendType: string): 'folder' | 'json' | 'file' {
  if (backendType === 'folder') return 'folder';
  if (backendType === 'json') return 'json';
  return 'file'; // markdown, image, pdf, video, file 等都归类为 'file'
}

// 新的资源访问模型
export interface AccessResource {
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'json' | 'file';
  
  // 权限配置
  terminal: boolean;
  terminalReadonly: boolean;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  jsonPath?: string;
}

interface AgentContextValue {
  // Agent 状态
  savedAgents: SavedAgent[];
  currentAgentId: string | null; 
  
  // 🆕 侧边栏状态
  sidebarMode: SidebarMode;
  
  // 🆕 配置态状态 (Draft)
  draftType: AgentType;
  draftCapabilities: Set<string>;  // 保留向后兼容
  draftResources: AccessResource[];  // 新：资源访问配置
  
  // Schedule Agent 新增 draft 状态
  draftTriggerType: TriggerType;
  draftTriggerConfig: TriggerConfig | null;
  draftTaskContent: string;
  draftTaskNodeId: string | null;
  draftExternalConfig: ExternalConfig | null;
  
  // 运行时状态 (Playground or Deployed)
  selectedCapabilities: Set<string>;
  
  // Actions
  selectAgent: (agentId: string | null) => void;
  
  // Deprecated signature, but keeping for compatibility if needed elsewhere
  saveAgent: (name: string, icon: string, capabilities: string[]) => void;
  deleteAgent: (agentId: string) => void;
  updateAgentInfo: (agentId: string, name: string, icon: string) => Promise<void>;
  
  // New Actions
  openSetting: () => void;
  editAgent: (agentId: string) => void;  // 编辑已有 agent
  editingAgentId: string | null;  // 正在编辑的 agent ID
  cancelSetting: () => void;  // 取消设置，返回聊天界面
  deployAgent: (name: string, icon: string) => void;
  closeSidebar: () => void;
  setDraftType: (type: AgentType) => void;
  toggleDraftCapability: (id: string) => void;
  
  // 新：资源管理
  addDraftResource: (resource: AccessResource) => void;
  updateDraftResource: (nodeId: string, updates: Partial<AccessResource>) => void;
  removeDraftResource: (nodeId: string) => void;
  
  // Schedule Agent 新增 setters
  setDraftTriggerType: (type: TriggerType) => void;
  setDraftTriggerConfig: (config: TriggerConfig | null) => void;
  setDraftTaskContent: (content: string) => void;
  setDraftTaskNodeId: (nodeId: string | null) => void;
  setDraftExternalConfig: (config: ExternalConfig | null) => void;
  
  // Runtime Actions
  toggleCapability: (id: string) => void;
  
  // Legacy support
  isChatOpen: boolean; 
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  setSelectedCapabilities: (caps: Set<string>) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  // 初始为空，从数据库加载
  const [savedAgents, setSavedAgents] = useState<SavedAgent[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  
  // Sidebar State
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('closed');
  
  // Draft State (for Setting Mode)
  const [draftType, setDraftType] = useState<AgentType>('chat');
  const [draftCapabilities, setDraftCapabilities] = useState<Set<string>>(new Set());
  const [draftResources, setDraftResources] = useState<AccessResource[]>([]);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  
  // Schedule Agent 新增 draft 状态
  const [draftTriggerType, setDraftTriggerType] = useState<TriggerType>('manual');
  const [draftTriggerConfig, setDraftTriggerConfig] = useState<TriggerConfig | null>(null);
  const [draftTaskContent, setDraftTaskContent] = useState<string>('');
  const [draftTaskNodeId, setDraftTaskNodeId] = useState<string | null>(null);
  const [draftExternalConfig, setDraftExternalConfig] = useState<ExternalConfig | null>(null);
  
  // Runtime State (for Deployed/Playground Mode)
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<string>>(new Set());

  // Legacy isChatOpen computed from sidebarMode
  const isChatOpen = sidebarMode !== 'closed';

  // 页面加载时从数据库获取 agents
  useEffect(() => {
    const loadAgents = async () => {
      try {
        const agents = await get<Array<{
          id: string;
          name: string;
          icon: string;
          type: string;
          mcp_api_key?: string;
          // Schedule Agent 新字段
          trigger_type?: string;
          trigger_config?: TriggerConfig;
          task_content?: string;
          task_node_id?: string;
          external_config?: ExternalConfig;
          accesses: Array<{
            id: string;
            node_id: string;
            terminal: boolean;
            terminal_readonly: boolean;
            can_read: boolean;
            can_write: boolean;
            can_delete: boolean;
            json_path: string;
          }>;
        }>>('/api/v1/agent-config/');
        
        // 收集所有 node_ids 用于批量获取节点信息
        const allNodeIds = agents.flatMap(a => a.accesses.map(acc => acc.node_id));
        
        // 批量获取节点信息（name, type）
        const nodeInfoMap = await fetchNodeInfoBatch(allNodeIds);
        
        const loadedAgents: SavedAgent[] = agents.map(a => ({
          id: a.id,
          name: a.name,
          icon: a.icon,
          type: (a.type as AgentType) || 'chat',
          capabilities: a.accesses.map(acc => `resource:${acc.node_id}`),
          mcp_api_key: a.mcp_api_key,
          // Schedule Agent 新字段
          trigger_type: (a.trigger_type as TriggerType) || 'manual',
          trigger_config: a.trigger_config,
          task_content: a.task_content,
          task_node_id: a.task_node_id,
          external_config: a.external_config,
          resources: a.accesses.map(acc => {
            const nodeInfo = nodeInfoMap.get(acc.node_id);
            return {
            nodeId: acc.node_id,
              nodeName: nodeInfo?.name || acc.node_id.substring(0, 8) + '...',
              nodeType: nodeInfo ? mapNodeType(nodeInfo.type) : 'folder',
            terminal: acc.terminal,
            terminalReadonly: acc.terminal_readonly,
            canRead: acc.can_read,
            canWrite: acc.can_write,
            canDelete: acc.can_delete,
            jsonPath: acc.json_path,
            };
          }),
        }));
        
        setSavedAgents(loadedAgents);
        console.log('Loaded agents from database:', loadedAgents.length);
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    };
    
    loadAgents();
  }, []);

  // 切换 Agent (Triggers Deployed Mode)
  const selectAgent = useCallback((agentId: string | null) => {
    if (!agentId) {
      // 没有 agent，关闭 sidebar
      setCurrentAgentId(null);
      setSelectedCapabilities(new Set());
      setSidebarMode('closed');
      return;
    }
    
    setCurrentAgentId(agentId);
    const agent = savedAgents.find(a => a.id === agentId);
    if (agent) {
      setSelectedCapabilities(new Set(agent.capabilities));
      setSidebarMode('deployed');
    } else {
      setSelectedCapabilities(new Set());
      setSidebarMode('deployed');
    }
  }, [savedAgents]);

  // 打开设置模式（新建）
  const openSetting = useCallback(() => {
    setSidebarMode('setting');
    setEditingAgentId(null);
    // Reset draft state defaults
    setDraftType('chat');
    setDraftCapabilities(new Set());
    setDraftResources([]);
    // Reset Schedule Agent draft states
    setDraftTriggerType('manual');
    setDraftTriggerConfig(null);
    setDraftTaskContent('');
    setDraftTaskNodeId(null);
    setDraftExternalConfig(null);
  }, []);

  // 编辑已有 Agent
  const editAgent = useCallback(async (agentId: string) => {
    // 先从本地 state 查找
    const agent = savedAgents.find(a => a.id === agentId);
    if (agent) {
      setSidebarMode('setting');
      setEditingAgentId(agentId);
      setDraftType(agent.type || 'chat');
      setDraftCapabilities(new Set(agent.capabilities.filter(c => !c.startsWith('resource:'))));
      
      // 加载 Schedule Agent 字段
      setDraftTriggerType(agent.trigger_type || 'manual');
      setDraftTriggerConfig(agent.trigger_config || null);
      setDraftTaskContent(agent.task_content || '');
      setDraftTaskNodeId(agent.task_node_id || null);
      setDraftExternalConfig(agent.external_config || null);
      
      // 如果有 resources，直接使用（名称已在 loadAgents 时解析）
      if (agent.resources && agent.resources.length > 0) {
        setDraftResources(agent.resources);
      } else {
        // 尝试从后端加载
        try {
          const data = await get<{
            id: string;
            name: string;
            icon: string;
            type: string;
            accesses: Array<{
              id: string;
              node_id: string;
              terminal: boolean;
              terminal_readonly: boolean;
              can_read: boolean;
              can_write: boolean;
              can_delete: boolean;
              json_path: string;
            }>;
          }>(`/api/v1/agent-config/${agentId}`);
          
          // 批量获取节点信息
          const nodeIds = data.accesses.map(a => a.node_id);
          const nodeInfoMap = await fetchNodeInfoBatch(nodeIds);
          
          const resources: AccessResource[] = data.accesses.map(a => {
            const nodeInfo = nodeInfoMap.get(a.node_id);
            return {
            nodeId: a.node_id,
              nodeName: nodeInfo?.name || a.node_id.substring(0, 8) + '...',
              nodeType: nodeInfo ? mapNodeType(nodeInfo.type) : 'folder',
            terminal: a.terminal,
            terminalReadonly: a.terminal_readonly,
            canRead: a.can_read,
            canWrite: a.can_write,
            canDelete: a.can_delete,
            jsonPath: a.json_path,
            };
          });
          setDraftResources(resources);
        } catch (error) {
          console.error('Failed to load agent config:', error);
          setDraftResources([]);
        }
      }
    }
  }, [savedAgents]);

  // 部署 (保存) Agent
  const deployAgent = useCallback(async (name: string, icon: string) => {
    try {
      // 构建后端需要的 accesses 数据
      const accesses = draftResources.map(r => ({
        node_id: r.nodeId,
        terminal: r.terminal,
        terminal_readonly: r.terminalReadonly,
        can_read: r.canRead,
        can_write: r.canWrite,
        can_delete: r.canDelete,
        json_path: r.jsonPath,
      }));

      let agentId: string;

      if (editingAgentId) {
        // 编辑模式：更新已有 Agent
        await put<unknown>(`/api/v1/agent-config/${editingAgentId}`, {
          name,
          icon,
          type: draftType,
          // Schedule Agent 新字段
          trigger_type: draftTriggerType,
          trigger_config: draftTriggerConfig,
          task_content: draftTaskContent,
          task_node_id: draftTaskNodeId,
          external_config: draftExternalConfig,
        });
        // 同步访问权限
        await put<unknown>(`/api/v1/agent-config/${editingAgentId}/accesses`, accesses);
        agentId = editingAgentId;
        
        // 更新本地 state
        setSavedAgents(prev => prev.map(a => 
          a.id === editingAgentId 
            ? { 
                ...a, 
                name, 
                icon, 
                type: draftType, 
                resources: draftResources,
                trigger_type: draftTriggerType,
                trigger_config: draftTriggerConfig,
                task_content: draftTaskContent,
                task_node_id: draftTaskNodeId,
                external_config: draftExternalConfig,
              }
            : a
        ));
        console.log('Agent updated:', agentId);
      } else {
        // 新建模式：创建新 Agent
        const response = await post<{
          id: string;
          name: string;
          icon: string;
          type: string;
          mcp_api_key?: string;
          trigger_type?: string;
          trigger_config?: TriggerConfig;
          task_content?: string;
          task_node_id?: string;
          external_config?: ExternalConfig;
          accesses: Array<{ id: string; node_id: string }>;
        }>('/api/v1/agent-config/', {
          name,
          icon,
          type: draftType,
          accesses,
          // Schedule Agent 新字段
          trigger_type: draftTriggerType,
          trigger_config: draftTriggerConfig,
          task_content: draftTaskContent,
          task_node_id: draftTaskNodeId,
          external_config: draftExternalConfig,
        });
        agentId = response.id;

        // 将 draftResources 转换为 capabilities（用于兼容旧的数据结构）
        const capabilitiesFromResources = draftResources.map(r => `resource:${r.nodeId}`);
        
        const newAgent: SavedAgent = {
          id: response.id,
          name,
          icon,
          type: draftType,
          capabilities: [...Array.from(draftCapabilities), ...capabilitiesFromResources],
          resources: draftResources,
          mcp_api_key: response.mcp_api_key,
          trigger_type: draftTriggerType,
          trigger_config: draftTriggerConfig,
          task_content: draftTaskContent,
          task_node_id: draftTaskNodeId,
          external_config: draftExternalConfig,
        };
        setSavedAgents(prev => [...prev, newAgent]);
        console.log('Agent created:', agentId, 'MCP Key:', response.mcp_api_key);
      }
      
      // Switch to this agent
      setCurrentAgentId(agentId);
      setSelectedCapabilities(new Set(draftResources.map(r => `resource:${r.nodeId}`)));
      setSidebarMode('deployed');
      setEditingAgentId(null);
    } catch (error) {
      console.error('Failed to save agent:', error);
      alert('Failed to save agent. Please try again.');
    }
  }, [draftType, draftCapabilities, draftResources, editingAgentId, draftTriggerType, draftTriggerConfig, draftTaskContent, draftTaskNodeId, draftExternalConfig]);

  // Legacy saveAgent (maps to deploy with current selected capabilities if possible, or simple save)
  const saveAgent = useCallback((name: string, icon: string, capabilities: string[]) => {
    const newAgent: SavedAgent = {
      id: `agent-${Date.now()}`,
      name,
      icon,
      type: 'chat', // Default to chat for legacy calls
      capabilities,
    };
    setSavedAgents(prev => [...prev, newAgent]);
    setCurrentAgentId(newAgent.id);
    setSelectedCapabilities(new Set(capabilities));
    setSidebarMode('deployed');
  }, []);

  // 删除 Agent
  const deleteAgent = useCallback(async (agentId: string) => {
    try {
      // 调用后端 API 删除
      await del(`/api/v1/agent-config/${agentId}`);
      
      // 更新前端状态
      setSavedAgents(prev => {
        const filtered = prev.filter(a => a.id !== agentId);
        // 如果删除的是当前 agent，切换到第一个或关闭
        if (currentAgentId === agentId) {
          if (filtered.length > 0) {
            selectAgent(filtered[0].id);
          } else {
            selectAgent(null);
            setSidebarMode('closed');
          }
        }
        return filtered;
      });
      
      console.log('Agent deleted:', agentId);
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  }, [currentAgentId, selectAgent]);

  // 更新 Agent 名字和图标
  const updateAgentInfo = useCallback(async (agentId: string, name: string, icon: string) => {
    try {
      // 调用后端 API 更新
      await put(`/api/v1/agent-config/${agentId}`, { name, icon });
      
      // 更新前端状态
      setSavedAgents(prev => prev.map(a => 
        a.id === agentId ? { ...a, name, icon } : a
      ));
      
      console.log('Agent info updated:', agentId, name, icon);
    } catch (error) {
      console.error('Failed to update agent info:', error);
    }
  }, []);

  // 取消设置，返回聊天界面
  const cancelSetting = useCallback(() => {
    if (editingAgentId) {
      // 编辑模式：返回到聊天界面，保持当前 agent
      setSidebarMode('deployed');
      setEditingAgentId(null);
    } else if (currentAgentId) {
      // 新建模式但有当前 agent：返回到聊天界面
      setSidebarMode('deployed');
    } else {
      // 新建模式且没有当前 agent：关闭 sidebar
      setSidebarMode('closed');
    }
  }, [editingAgentId, currentAgentId]);

  // Close Sidebar
  const closeSidebar = useCallback(() => {
    setSidebarMode('closed');
  }, []);

  // Legacy Toggle Chat
  const toggleChat = useCallback(() => {
    setSidebarMode(prev => prev === 'closed' ? 'deployed' : 'closed');
  }, []);

  const openChat = useCallback(() => {
    if (sidebarMode === 'closed') setSidebarMode('deployed');
  }, [sidebarMode]);

  const closeChat = closeSidebar;

  // Toggle Draft Capability
  const toggleDraftCapability = useCallback((id: string) => {
    setDraftCapabilities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 新：添加资源
  const addDraftResource = useCallback((resource: AccessResource) => {
    setDraftResources(prev => {
      // 检查是否已存在
      if (prev.some(r => r.nodeId === resource.nodeId)) {
        return prev;
      }
      return [...prev, resource];
    });
  }, []);

  // 新：更新资源
  const updateDraftResource = useCallback((nodeId: string, updates: Partial<AccessResource>) => {
    setDraftResources(prev => 
      prev.map(r => r.nodeId === nodeId ? { ...r, ...updates } : r)
    );
  }, []);

  // 新：移除资源
  const removeDraftResource = useCallback((nodeId: string) => {
    setDraftResources(prev => prev.filter(r => r.nodeId !== nodeId));
  }, []);

  // Toggle Runtime Capability
  const toggleCapability = useCallback((id: string) => {
    setSelectedCapabilities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      
      return next;
    });
  }, [currentAgentId]);

  return (
    <AgentContext.Provider
      value={{
        savedAgents,
        currentAgentId,
        sidebarMode,
        draftType,
        draftCapabilities,
        draftResources,
        selectedCapabilities,
        isChatOpen,
        
        // Schedule Agent draft states
        draftTriggerType,
        draftTriggerConfig,
        draftTaskContent,
        draftTaskNodeId,
        draftExternalConfig,
        
        selectAgent,
        openSetting,
        editAgent,
        editingAgentId,
        cancelSetting,
        deployAgent,
        saveAgent,
        deleteAgent,
        updateAgentInfo,
        closeSidebar,
        
        setDraftType,
        toggleDraftCapability,
        addDraftResource,
        updateDraftResource,
        removeDraftResource,
        toggleCapability,
        
        // Schedule Agent setters
        setDraftTriggerType,
        setDraftTriggerConfig,
        setDraftTaskContent,
        setDraftTaskNodeId,
        setDraftExternalConfig,
        
        // Legacy
        toggleChat,
        openChat,
        closeChat,
        setSelectedCapabilities,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
}

// 导出类型供其他组件使用
export type { SavedAgent, AgentType, TriggerType, TriggerConfig, ExternalConfig } from '@/components/AgentRail';
export type { AccessResource };
