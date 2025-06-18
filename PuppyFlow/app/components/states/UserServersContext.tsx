/**
 * ServersContext - User Server Management Context
 * 
 * This context manages server/service state with centralized management for:
 * 
 * 1. Global deployed services (APIs and Chatbots) from all workspaces
 * 2. Current showing server/service tracking
 * 3. Service management operations
 * 4. Server configuration and status
 */

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useWorkspaces } from './UserWorkspacesContext';
import { useServerOperations } from '../hooks/useServerMnagement';

// 统一的服务接口定义
export interface ApiService {
  api_id: string;
  api_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  inputs?: string[];
  outputs?: string[];
}

export interface ChatbotService {
  chatbot_id: string;
  chatbot_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history?: string | null;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  config?: {
    multiTurn: boolean;
    welcomeMessage: string;
    deployTo: string;
  };
}

// 服务类型枚举
export type ServiceType = 'api' | 'chatbot';

// 扩展的服务类型，包含工作区信息和服务类型
export interface EnhancedApiService extends ApiService {
  workspaceName: string;
  type: 'api';
}

export interface EnhancedChatbotService extends ChatbotService {
  workspaceName: string;
  type: 'chatbot';
}

// 统一的增强服务类型
export type EnhancedService = EnhancedApiService | EnhancedChatbotService;

// 全局部署服务状态
interface GlobalDeployedServices {
  apis: EnhancedApiService[];
  chatbots: EnhancedChatbotService[];
  lastFetched: Record<string, number>; // 按工作区ID记录最后获取时间
  isLoading: boolean;
  error: string | null;
}

// Context 类型定义
interface ServersContextType {
  // 基础状态
  globalServices: GlobalDeployedServices;
  currentShowingId: string | null;
  currentServiceJson: EnhancedApiService | EnhancedChatbotService | null;
  displayOrNot: boolean;
  
  // 初始化状态
  isInitialized: boolean;
  isLoading: boolean;
  initializationError: string | null;
  
  // 显示状态操作
  setShowingId: (id: string | null) => void;
  setCurrentServiceJson: (service: EnhancedApiService | EnhancedChatbotService | null) => void;
  setDisplayOrNot: (display: boolean) => void;
  clearShowing: () => void;
  
  // 数据获取方法
  fetchAllServices: () => Promise<void>;
  fetchWorkspaceServices: (workspaceId: string) => Promise<void>;
  refreshServices: () => Promise<void>;
  
  // 服务管理方法 - 只保留本地状态更新
  addApiService: (service: ApiService, workspaceName: string) => void;
  removeApiService: (apiId: string) => void;
  updateApiService: (apiId: string, updates: Partial<ApiService>) => void;
  
  addChatbotService: (service: ChatbotService, workspaceName: string) => void;
  removeChatbotService: (chatbotId: string) => void;
  updateChatbotService: (chatbotId: string, updates: Partial<ChatbotService>) => void;
  
  // 查询方法
  getServicesByWorkspace: (workspaceId: string) => {
    apis: EnhancedApiService[];
    chatbots: EnhancedChatbotService[];
  };
  getChatbotApiKey: (workspaceId: string) => string | null;
  getAllServices: () => {
    apis: EnhancedApiService[];
    chatbots: EnhancedChatbotService[];
  };
  getApiServiceById: (apiId: string) => EnhancedApiService | undefined;
  getChatbotServiceById: (chatbotId: string) => EnhancedChatbotService | undefined;
  getCurrentShowingService: () => EnhancedApiService | EnhancedChatbotService | undefined;
  
  // 状态判断方法
  isServiceShowing: (serviceId: string) => boolean;
  isWorkspaceDataFresh: (workspaceId: string, maxAge?: number) => boolean;
  
  // 初始化方法
  reinitialize: () => Promise<void>;
}

// 初始状态
const initialGlobalServices: GlobalDeployedServices = {
  apis: [],
  chatbots: [],
  lastFetched: {},
  isLoading: false,
  error: null
};

// 创建 Context
const ServersContext = createContext<ServersContextType | undefined>(undefined);

// Provider 组件
interface ServersProviderProps {
  children: ReactNode;
}

export const ServersProvider = ({ children }: ServersProviderProps) => {
  const { workspaces } = useWorkspaces();
  const serverOperations = useServerOperations();
  const [globalServices, setGlobalServices] = useState<GlobalDeployedServices>(initialGlobalServices);
  const [currentShowingId, setCurrentShowingId] = useState<string | null>(null);
  const [currentServiceJson, setCurrentServiceJson] = useState<EnhancedApiService | EnhancedChatbotService | null>(null);
  const [displayOrNot, setDisplayOrNot] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 获取单个工作区的服务
  const fetchWorkspaceServices = useCallback(async (workspaceId: string) => {
    if (!serverOperations.apiServerKey) return;

    const workspace = workspaces.find(w => w.workspace_id === workspaceId);
    if (!workspace) return;

    try {
      const [apis, chatbots] = await Promise.all([
        serverOperations.fetchApiList(workspaceId),
        serverOperations.fetchChatbotList(workspaceId)
      ]);

      setGlobalServices(prev => {
        // 移除该工作区的旧数据
        const filteredApis = prev.apis.filter(api => api.workspace_id !== workspaceId);
        const filteredChatbots = prev.chatbots.filter(chatbot => chatbot.workspace_id !== workspaceId);

        // 添加新数据，包含 type 字段
        const enhancedApis: EnhancedApiService[] = apis.map(api => ({
          ...api,
          workspaceName: workspace.workspace_name,
          workspace_id: workspaceId,
          type: 'api' as const
        }));

        const enhancedChatbots: EnhancedChatbotService[] = chatbots.map(chatbot => ({
          ...chatbot,
          workspaceName: workspace.workspace_name,
          workspace_id: workspaceId,
          type: 'chatbot' as const
        }));

        return {
          ...prev,
          apis: [...filteredApis, ...enhancedApis],
          chatbots: [...filteredChatbots, ...enhancedChatbots],
          lastFetched: {
            ...prev.lastFetched,
            [workspaceId]: Date.now()
          }
        };
      });

    } catch (error) {
      console.error(`Error fetching services for workspace ${workspaceId}:`, error);
      setGlobalServices(prev => ({
        ...prev,
        error: `Failed to fetch services for workspace ${workspace.workspace_name}`
      }));
    }
  }, [workspaces, serverOperations]);

  // 获取所有工作区的服务 - 移除 useCallback 以避免依赖问题
  const fetchAllServices = async () => {
    if (!workspaces.length || !serverOperations.apiServerKey) {
      setGlobalServices(prev => ({ ...prev, apis: [], chatbots: [] }));
      return;
    }

    setGlobalServices(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const allPromises = workspaces.map(async (workspace) => {
        const [apis, chatbots] = await Promise.all([
          serverOperations.fetchApiList(workspace.workspace_id),
          serverOperations.fetchChatbotList(workspace.workspace_id)
        ]);

        return {
          workspaceId: workspace.workspace_id,
          workspaceName: workspace.workspace_name,
          apis,
          chatbots
        };
      });

      const results = await Promise.all(allPromises);

      // 合并所有结果，添加 type 字段
      const allApis: EnhancedApiService[] = [];
      const allChatbots: EnhancedChatbotService[] = [];
      const lastFetched: Record<string, number> = {};

      results.forEach(({ workspaceId, workspaceName, apis, chatbots }) => {
        apis.forEach(api => {
          allApis.push({ 
            ...api, 
            workspaceName,
            workspace_id: workspaceId,
            type: 'api' as const
          });
        });
        
        chatbots.forEach(chatbot => {
          allChatbots.push({ 
            ...chatbot, 
            workspaceName,
            workspace_id: workspaceId,
            type: 'chatbot' as const
          });
        });

        lastFetched[workspaceId] = Date.now();
      });

      setGlobalServices(prev => ({
        ...prev,
        apis: allApis,
        chatbots: allChatbots,
        lastFetched,
        isLoading: false,
        error: null
      }));

      console.log(`✅ Fetched deployed services from ${workspaces.length} workspaces:`, {
        totalApis: allApis.length,
        totalChatbots: allChatbots.length
      });

    } catch (error) {
      console.error("Error fetching all deployed services:", error);
      setGlobalServices(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to fetch deployed services'
      }));
    }
  };

  // 刷新服务
  const refreshServices = useCallback(async () => {
    await fetchAllServices();
  }, []);

  // 重新初始化方法
  const reinitialize = useCallback(async () => {
    setIsInitialized(false);
    setCurrentShowingId(null);
    setCurrentServiceJson(null);
    setGlobalServices(initialGlobalServices);
    await fetchAllServices();
    setIsInitialized(true);
  }, [fetchAllServices]);

  // 根据ID获取API服务
  const getApiServiceById = useCallback((apiId: string): EnhancedApiService | undefined => {
    return globalServices.apis.find(api => api.api_id === apiId);
  }, [globalServices.apis]);

  // 根据ID获取Chatbot服务
  const getChatbotServiceById = useCallback((chatbotId: string): EnhancedChatbotService | undefined => {
    return globalServices.chatbots.find(chatbot => chatbot.chatbot_id === chatbotId);
  }, [globalServices.chatbots]);

  // 获取当前显示的服务
  const getCurrentShowingService = useCallback((): EnhancedApiService | EnhancedChatbotService | undefined => {
    if (!currentShowingId) return undefined;
    
    // 先尝试在API服务中查找
    const apiService = getApiServiceById(currentShowingId);
    if (apiService) return apiService;
    
    // 再尝试在Chatbot服务中查找
    const chatbotService = getChatbotServiceById(currentShowingId);
    if (chatbotService) return chatbotService;
    
    return undefined;
  }, [currentShowingId, getApiServiceById, getChatbotServiceById]);

  // 设置显示的服务ID
  const setShowingId = useCallback((id: string | null) => {
    setCurrentShowingId(id);
    
    // 同步更新当前服务JSON
    if (id) {
      const apiService = getApiServiceById(id);
      if (apiService) {
        setCurrentServiceJson(apiService);
        return;
      }
      
      const chatbotService = getChatbotServiceById(id);
      if (chatbotService) {
        setCurrentServiceJson(chatbotService);
        return;
      }
    }
    
    setCurrentServiceJson(null);
  }, [getApiServiceById, getChatbotServiceById]);

  // 清空显示状态
  const clearShowing = useCallback(() => {
    setCurrentShowingId(null);
    setCurrentServiceJson(null);
  }, []);

  // 判断服务是否正在显示
  const isServiceShowing = useCallback((serviceId: string): boolean => {
    return currentShowingId === serviceId;
  }, [currentShowingId]);

  // 本地状态管理方法 - 添加 type 字段
  const addApiService = useCallback((service: ApiService, workspaceName: string) => {
    const enhancedService: EnhancedApiService = {
      ...service,
      workspaceName,
      type: 'api' as const
    };

    setGlobalServices(prev => ({
      ...prev,
      apis: [...prev.apis, enhancedService]
    }));
  }, []);

  const removeApiService = useCallback((apiId: string) => {
    setGlobalServices(prev => ({
      ...prev,
      apis: prev.apis.filter(api => api.api_id !== apiId)
    }));

    // 如果删除的是当前显示的服务，清空显示状态
    if (isServiceShowing(apiId)) {
      clearShowing();
    }
  }, [isServiceShowing, clearShowing]);

  const updateApiService = useCallback((apiId: string, updates: Partial<ApiService>) => {
    setGlobalServices(prev => ({
      ...prev,
      apis: prev.apis.map(api => 
        api.api_id === apiId ? { ...api, ...updates } : api
      )
    }));

    // 如果更新的是当前显示的服务，同步更新当前JSON
    if (isServiceShowing(apiId)) {
      const updatedService = getApiServiceById(apiId);
      if (updatedService) {
        setCurrentServiceJson(updatedService);
      }
    }
  }, [isServiceShowing, getApiServiceById]);

  const addChatbotService = useCallback((service: ChatbotService, workspaceName: string) => {
    const enhancedService: EnhancedChatbotService = {
      ...service,
      workspaceName,
      type: 'chatbot' as const
    };

    setGlobalServices(prev => ({
      ...prev,
      chatbots: [...prev.chatbots, enhancedService]
    }));
  }, []);

  const removeChatbotService = useCallback((chatbotId: string) => {
    setGlobalServices(prev => ({
      ...prev,
      chatbots: prev.chatbots.filter(chatbot => chatbot.chatbot_id !== chatbotId)
    }));

    // 如果删除的是当前显示的服务，清空显示状态
    if (isServiceShowing(chatbotId)) {
      clearShowing();
    }
  }, [isServiceShowing, clearShowing]);

  const updateChatbotService = useCallback((chatbotId: string, updates: Partial<ChatbotService>) => {
    setGlobalServices(prev => ({
      ...prev,
      chatbots: prev.chatbots.map(chatbot => 
        chatbot.chatbot_id === chatbotId ? { ...chatbot, ...updates } : chatbot
      )
    }));

    // 如果更新的是当前显示的服务，同步更新当前JSON
    if (isServiceShowing(chatbotId)) {
      const updatedService = getChatbotServiceById(chatbotId);
      if (updatedService) {
        setCurrentServiceJson(updatedService);
      }
    }
  }, [isServiceShowing, getChatbotServiceById]);

  // 根据工作区获取服务
  const getServicesByWorkspace = useCallback((workspaceId: string) => {
    return {
      apis: globalServices.apis.filter(api => api.workspace_id === workspaceId),
      chatbots: globalServices.chatbots.filter(chatbot => chatbot.workspace_id === workspaceId)
    };
  }, [globalServices]);

  // 获取Chatbot API Key
  const getChatbotApiKey = useCallback((workspaceId: string): string | null => {
    const chatbot = globalServices.chatbots.find(
      chatbot => chatbot.workspace_id === workspaceId
    );
    return chatbot?.chatbot_key || null;
  }, [globalServices.chatbots]);

  // 获取所有服务
  const getAllServices = useCallback(() => {
    return {
      apis: globalServices.apis,
      chatbots: globalServices.chatbots
    };
  }, [globalServices]);

  // 检查工作区数据是否新鲜
  const isWorkspaceDataFresh = useCallback((workspaceId: string, maxAge: number = 5 * 60 * 1000) => {
    const lastFetch = globalServices.lastFetched[workspaceId];
    if (!lastFetch) return false;
    return Date.now() - lastFetch < maxAge;
  }, [globalServices.lastFetched]);

  // 修复初始化逻辑 - 移除 fetchAllServices 从依赖数组
  useEffect(() => {
    let isMounted = true;
    
    const initializeServices = async () => {
      if (workspaces.length > 0 && serverOperations.apiServerKey && !isInitialized) {
        await fetchAllServices();
        if (isMounted) {
          setIsInitialized(true);
        }
      }
    };

    initializeServices();

    return () => {
      isMounted = false;
    };
  }, [workspaces.length, serverOperations.apiServerKey, isInitialized]);

  const contextValue: ServersContextType = {
    // 基础状态
    globalServices,
    currentShowingId,
    currentServiceJson,
    displayOrNot,
    
    // 初始化状态
    isInitialized,
    isLoading: globalServices.isLoading,
    initializationError: globalServices.error,
    
    // 显示状态操作
    setShowingId,
    setCurrentServiceJson,
    setDisplayOrNot,
    clearShowing,
    
    // 数据获取方法
    fetchAllServices,
    fetchWorkspaceServices,
    refreshServices,
    
    // 服务管理方法 - 只保留本地状态更新
    addApiService,
    removeApiService,
    updateApiService,
    addChatbotService,
    removeChatbotService,
    updateChatbotService,
    
    // 查询方法
    getServicesByWorkspace,
    getChatbotApiKey,
    getAllServices,
    getApiServiceById,
    getChatbotServiceById,
    getCurrentShowingService,
    
    // 状态判断方法
    isServiceShowing,
    isWorkspaceDataFresh,
    
    // 初始化方法
    reinitialize
  };

  return (
    <ServersContext.Provider value={contextValue}>
      {children}
    </ServersContext.Provider>
  );
};

// Hook 用于在组件中使用 Context
export const useServers = () => {
  const context = useContext(ServersContext);
  if (!context) {
    throw new Error('useServers must be used within ServersProvider');
  }
  return context;
};

// 简化的 hooks
export const useAllDeployedServices = () => {
  const { getAllServices, globalServices } = useServers();
  const { apis, chatbots } = getAllServices();
  
  return {
    apis,
    chatbots,
    isLoading: globalServices.isLoading,
    error: globalServices.error
  };
};

export const useWorkspaceDeployedServices = (workspaceId: string) => {
  const { 
    getServicesByWorkspace, 
    fetchWorkspaceServices, 
    isWorkspaceDataFresh,
    globalServices 
  } = useServers();
  
  const services = getServicesByWorkspace(workspaceId);
  
  // 如果数据不新鲜，自动刷新
  useEffect(() => {
    if (workspaceId && !isWorkspaceDataFresh(workspaceId)) {
      fetchWorkspaceServices(workspaceId);
    }
  }, [workspaceId, fetchWorkspaceServices, isWorkspaceDataFresh]);
  
  return {
    ...services,
    isLoading: globalServices.isLoading,
    error: globalServices.error,
    refresh: () => fetchWorkspaceServices(workspaceId)
  };
}; 