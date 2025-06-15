import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useWorkspaces } from './UserWorkspaceAndServicesContext';
import { SYSTEM_URLS } from '@/config/urls';

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

// 扩展的服务类型，包含工作区信息
export interface EnhancedApiService extends ApiService {
  workspaceName: string;
}

export interface EnhancedChatbotService extends ChatbotService {
  workspaceName: string;
}

// 全局部署服务状态
interface GlobalDeployedServices {
  apis: EnhancedApiService[];
  chatbots: EnhancedChatbotService[];
  lastFetched: Record<string, number>; // 按工作区ID记录最后获取时间
  isLoading: boolean;
  error: string | null;
}

// Context 类型定义
interface GlobalDeployedServicesContextType {
  // 全局状态
  globalServices: GlobalDeployedServices;
  
  // API Server配置
  apiServerKey: string;
  apiServerUrl: string;
  
  // 数据获取方法
  fetchAllServices: () => Promise<void>;
  fetchWorkspaceServices: (workspaceId: string) => Promise<void>;
  refreshServices: () => Promise<void>;
  
  // 服务管理方法
  addApiService: (service: ApiService, workspaceName: string) => void;
  removeApiService: (apiId: string) => Promise<void>;
  updateApiService: (apiId: string, updates: Partial<ApiService>) => void;
  
  addChatbotService: (service: ChatbotService, workspaceName: string) => void;
  removeChatbotService: (chatbotId: string) => Promise<void>;
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
  
  // 工具方法
  isWorkspaceDataFresh: (workspaceId: string, maxAge?: number) => boolean;
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
const GlobalDeployedServicesContext = createContext<GlobalDeployedServicesContextType | undefined>(undefined);

// Provider 组件
interface GlobalDeployedServicesProviderProps {
  children: ReactNode;
}

export const GlobalDeployedServicesProvider = ({ children }: GlobalDeployedServicesProviderProps) => {
  const { workspaces } = useWorkspaces();
  const [globalServices, setGlobalServices] = useState<GlobalDeployedServices>(initialGlobalServices);
  
  // API配置
  const apiServerKey = process.env.NEXT_PUBLIC_API_SERVER_KEY || '';
  const apiServerUrl = SYSTEM_URLS.API_SERVER.BASE;

  // 获取单个工作区的API列表
  const fetchApiList = useCallback(async (workspaceId: string): Promise<ApiService[]> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/list_apis/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`Failed to fetch API list: ${res.status}`);
      }

      const data = await res.json();
      return data.apis || [];
    } catch (error) {
      console.error(`Error fetching API list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, [apiServerUrl, apiServerKey]);

  // 获取单个工作区的Chatbot列表
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotService[]> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/list_chatbots/${workspaceId}?include_keys=true`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`Failed to fetch chatbot list: ${res.status}`);
      }

      const data = await res.json();
      return data.chatbots || [];
    } catch (error) {
      console.error(`Error fetching chatbot list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, [apiServerUrl, apiServerKey]);

  // 获取单个工作区的服务
  const fetchWorkspaceServices = useCallback(async (workspaceId: string) => {
    if (!apiServerKey) return;

    const workspace = workspaces.find(w => w.workspace_id === workspaceId);
    if (!workspace) return;

    try {
      const [apis, chatbots] = await Promise.all([
        fetchApiList(workspaceId),
        fetchChatbotList(workspaceId)
      ]);

      setGlobalServices(prev => {
        // 移除该工作区的旧数据
        const filteredApis = prev.apis.filter(api => api.workspace_id !== workspaceId);
        const filteredChatbots = prev.chatbots.filter(chatbot => chatbot.workspace_id !== workspaceId);

        // 添加新数据
        const enhancedApis: EnhancedApiService[] = apis.map(api => ({
          ...api,
          workspaceName: workspace.workspace_name,
          workspace_id: workspaceId
        }));

        const enhancedChatbots: EnhancedChatbotService[] = chatbots.map(chatbot => ({
          ...chatbot,
          workspaceName: workspace.workspace_name,
          workspace_id: workspaceId
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
  }, [workspaces, apiServerKey, fetchApiList, fetchChatbotList]);

  // 获取所有工作区的服务
  const fetchAllServices = useCallback(async () => {
    if (!workspaces.length || !apiServerKey) {
      setGlobalServices(prev => ({ ...prev, apis: [], chatbots: [] }));
      return;
    }

    setGlobalServices(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const allPromises = workspaces.map(async (workspace) => {
        const [apis, chatbots] = await Promise.all([
          fetchApiList(workspace.workspace_id),
          fetchChatbotList(workspace.workspace_id)
        ]);

        return {
          workspaceId: workspace.workspace_id,
          workspaceName: workspace.workspace_name,
          apis,
          chatbots
        };
      });

      const results = await Promise.all(allPromises);

      // 合并所有结果
      const allApis: EnhancedApiService[] = [];
      const allChatbots: EnhancedChatbotService[] = [];
      const lastFetched: Record<string, number> = {};

      results.forEach(({ workspaceId, workspaceName, apis, chatbots }) => {
        apis.forEach(api => {
          allApis.push({ 
            ...api, 
            workspaceName,
            workspace_id: workspaceId
          });
        });
        
        chatbots.forEach(chatbot => {
          allChatbots.push({ 
            ...chatbot, 
            workspaceName,
            workspace_id: workspaceId
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
  }, [workspaces, apiServerKey, fetchApiList, fetchChatbotList]);

  // 刷新服务
  const refreshServices = useCallback(async () => {
    await fetchAllServices();
  }, [fetchAllServices]);

  // 删除API服务
  const removeApiService = useCallback(async (apiId: string) => {
    try {
      const res = await fetch(
        `${apiServerUrl}/delete_api/${apiId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete API: ${res.status}`);
      }

      // 从本地状态中移除
      setGlobalServices(prev => ({
        ...prev,
        apis: prev.apis.filter(api => api.api_id !== apiId)
      }));

      console.log(`✅ API ${apiId} deleted successfully`);
    } catch (error) {
      console.error(`Error deleting API ${apiId}:`, error);
      throw error;
    }
  }, [apiServerUrl, apiServerKey]);

  // 删除Chatbot服务
  const removeChatbotService = useCallback(async (chatbotId: string) => {
    try {
      const res = await fetch(
        `${apiServerUrl}/delete_chatbot/${chatbotId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete chatbot: ${res.status}`);
      }

      // 从本地状态中移除
      setGlobalServices(prev => ({
        ...prev,
        chatbots: prev.chatbots.filter(chatbot => chatbot.chatbot_id !== chatbotId)
      }));

      console.log(`✅ Chatbot ${chatbotId} deleted successfully`);
    } catch (error) {
      console.error(`Error deleting chatbot ${chatbotId}:`, error);
      throw error;
    }
  }, [apiServerUrl, apiServerKey]);

  // 添加API服务
  const addApiService = useCallback((service: ApiService, workspaceName: string) => {
    const enhancedService: EnhancedApiService = {
      ...service,
      workspaceName
    };

    setGlobalServices(prev => ({
      ...prev,
      apis: [...prev.apis, enhancedService]
    }));
  }, []);

  // 更新API服务
  const updateApiService = useCallback((apiId: string, updates: Partial<ApiService>) => {
    setGlobalServices(prev => ({
      ...prev,
      apis: prev.apis.map(api => 
        api.api_id === apiId ? { ...api, ...updates } : api
      )
    }));
  }, []);

  // 添加Chatbot服务
  const addChatbotService = useCallback((service: ChatbotService, workspaceName: string) => {
    const enhancedService: EnhancedChatbotService = {
      ...service,
      workspaceName
    };

    setGlobalServices(prev => ({
      ...prev,
      chatbots: [...prev.chatbots, enhancedService]
    }));
  }, []);

  // 更新Chatbot服务
  const updateChatbotService = useCallback((chatbotId: string, updates: Partial<ChatbotService>) => {
    setGlobalServices(prev => ({
      ...prev,
      chatbots: prev.chatbots.map(chatbot => 
        chatbot.chatbot_id === chatbotId ? { ...chatbot, ...updates } : chatbot
      )
    }));
  }, []);

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

  // 初始化时获取所有服务
  useEffect(() => {
    if (workspaces.length > 0 && apiServerKey) {
      fetchAllServices();
    }
  }, [workspaces.length, apiServerKey]); // 只在工作区数量或API key变化时重新获取

  return (
    <GlobalDeployedServicesContext.Provider 
      value={{
        globalServices,
        apiServerKey,
        apiServerUrl,
        fetchAllServices,
        fetchWorkspaceServices,
        refreshServices,
        addApiService,
        removeApiService,
        updateApiService,
        addChatbotService,
        removeChatbotService,
        updateChatbotService,
        getServicesByWorkspace,
        getChatbotApiKey,
        getAllServices,
        isWorkspaceDataFresh
      }}
    >
      {children}
    </GlobalDeployedServicesContext.Provider>
  );
};

// Hook 用于在组件中使用 Context
export const useGlobalDeployedServices = () => {
  const context = useContext(GlobalDeployedServicesContext);
  if (!context) {
    throw new Error('useGlobalDeployedServices must be used within GlobalDeployedServicesProvider');
  }
  return context;
};

// 简化的 hooks
export const useAllDeployedServices = () => {
  const { getAllServices, globalServices } = useGlobalDeployedServices();
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
  } = useGlobalDeployedServices();
  
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