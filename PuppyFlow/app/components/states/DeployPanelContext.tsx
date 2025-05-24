import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// 单个 API 服务信息
interface ApiService {
  api_id: string;
  api_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  inputs?: string[];
  outputs?: string[];
}

// 单个 Chatbot 服务信息
interface ChatbotService {
  chatbot_id: string;
  chatbot_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history_id?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  config?: {
    multiTurn: boolean;
    welcomeMessage: string;
    deployTo: string;
  };
}

// 已部署服务的状态
interface DeployedServices {
  apis: ApiService[];
  chatbots: ChatbotService[];
  lastFetched?: number;
}

// Context 类型定义 - 只保留核心的跨组件共享状态
interface DeployPanelContextType {
  // 当前工作流ID - 用于状态隔离
  currentFlowId: string | null;
  
  // 已部署的服务列表 - 跨组件共享
  deployedServices: DeployedServices;
  setDeployedServices: React.Dispatch<React.SetStateAction<DeployedServices>>;
  
  // API Server Key - 集中管理
  apiServerKey: string;
  
  // 服务管理方法
  addApiService: (service: ApiService) => void;
  removeApiService: (apiId: string) => void;
  updateApiService: (apiId: string, updates: Partial<ApiService>) => void;
  
  addChatbotService: (service: ChatbotService) => void;
  removeChatbotService: (chatbotId: string) => void;
  updateChatbotService: (chatbotId: string, updates: Partial<ChatbotService>) => void;
  
  // 重置当前工作流的部署状态
  resetDeploymentState: () => void;
}

// 初始已部署服务状态
const initialDeployedServices: DeployedServices = {
  apis: [],
  chatbots: [],
  lastFetched: undefined
};

// 创建 Context
const DeployPanelContext = createContext<DeployPanelContextType | undefined>(undefined);

// Provider 组件
interface DeployPanelProviderProps {
  children: ReactNode;
  flowId: string | null;
  workspaces: any[];
  setWorkspaces: (workspaces: any[]) => void;
}

export const DeployPanelProvider = ({ 
  children, 
  flowId, 
  workspaces,
  setWorkspaces 
}: DeployPanelProviderProps) => {
  // 核心状态
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(flowId);
  const [deployedServices, setDeployedServices] = useState<DeployedServices>(initialDeployedServices);

  // 添加 API Server Key 管理
  const apiServerKey = process.env.NEXT_PUBLIC_API_SERVER_KEY || '';

  // 服务管理方法
  const addApiService = (service: ApiService) => {
    setDeployedServices(prev => ({
      ...prev,
      apis: [...prev.apis, service]
    }));
  };

  const removeApiService = (apiId: string) => {
    setDeployedServices(prev => ({
      ...prev,
      apis: prev.apis.filter(api => api.api_id !== apiId)
    }));
  };

  const updateApiService = (apiId: string, updates: Partial<ApiService>) => {
    setDeployedServices(prev => ({
      ...prev,
      apis: prev.apis.map(api => 
        api.api_id === apiId ? { ...api, ...updates } : api
      )
    }));
  };

  const addChatbotService = (service: ChatbotService) => {
    setDeployedServices(prev => ({
      ...prev,
      chatbots: [...prev.chatbots, service]
    }));
  };

  const removeChatbotService = (chatbotId: string) => {
    setDeployedServices(prev => ({
      ...prev,
      chatbots: prev.chatbots.filter(chatbot => chatbot.chatbot_id !== chatbotId)
    }));
  };

  const updateChatbotService = (chatbotId: string, updates: Partial<ChatbotService>) => {
    setDeployedServices(prev => ({
      ...prev,
      chatbots: prev.chatbots.map(chatbot => 
        chatbot.chatbot_id === chatbotId ? { ...chatbot, ...updates } : chatbot
      )
    }));
  };

  // 重置部署状态
  const resetDeploymentState = () => {
    setDeployedServices(initialDeployedServices);
  };

  // 同步状态到 workspaces
  const syncToWorkspaces = () => {
    if (!currentFlowId) return;

    const updatedWorkspaces = workspaces.map(workspace => {
      if (workspace.flowId === currentFlowId) {
        return {
          ...workspace,
          deploy: {
            ...workspace.deploy,
            deployedServices: {
              apis: deployedServices.apis,
              chatbots: deployedServices.chatbots,
              lastFetched: deployedServices.lastFetched
            }
          }
        };
      }
      return workspace;
    });

    setWorkspaces(updatedWorkspaces);
  };

  // 监听 flowId 变化，恢复对应工作流的部署状态
  useEffect(() => {
    if (flowId !== currentFlowId) {
      setCurrentFlowId(flowId);

      if (flowId) {
        const currentWorkspace = workspaces.find(w => w.flowId === flowId);
        
        if (currentWorkspace?.deploy?.deployedServices) {
          // 恢复该工作流的已部署服务
          setDeployedServices({
            apis: currentWorkspace.deploy.deployedServices.apis || [],
            chatbots: currentWorkspace.deploy.deployedServices.chatbots || [],
            lastFetched: currentWorkspace.deploy.deployedServices.lastFetched
          });
        } else {
          // 如果没有部署状态，重置为初始状态
          setDeployedServices(initialDeployedServices);
        }
      } else {
        // 如果没有选中的 flowId，重置状态
        setDeployedServices(initialDeployedServices);
      }
    }
  }, [flowId, workspaces]);

  // 当部署服务状态改变时，自动同步到 workspaces
  useEffect(() => {
    if (currentFlowId) {
      syncToWorkspaces();
    }
  }, [currentFlowId, deployedServices]);

  return (
    <DeployPanelContext.Provider 
      value={{ 
        currentFlowId,
        deployedServices,
        setDeployedServices,
        apiServerKey,
        addApiService,
        removeApiService,
        updateApiService,
        addChatbotService,
        removeChatbotService,
        updateChatbotService,
        resetDeploymentState
      }}
    >
      {children}
    </DeployPanelContext.Provider>
  );
};

// Hook 用于在组件中使用 Context
export const useDeployPanelContext = () => {
  const context = useContext(DeployPanelContext);
  if (!context) {
    throw new Error('useDeployPanelContext must be used within DeployPanelProvider');
  }
  return context;
};

// 简化的 hooks - 只提供已部署服务的访问
export const useDeployedServices = () => {
  const { deployedServices, addApiService, removeApiService, addChatbotService, removeChatbotService } = useDeployPanelContext();
  
  return {
    apis: deployedServices.apis,
    chatbots: deployedServices.chatbots,
    addApiService,
    removeApiService,
    addChatbotService,
    removeChatbotService
  };
};
