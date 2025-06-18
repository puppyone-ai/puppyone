import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useServers } from './UserServersContext';
import { useServerOperations } from '../hooks/useServerMnagement';

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
  chatbot_key: string; // 这个就是部署后返回的 API key
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

// 已部署服务的状态
interface DeployedServices {
  apis: ApiService[];
  chatbots: ChatbotService[];
  lastFetched?: number;
}

// 简化的 Context 类型定义 - 只保留UI状态
interface DeployPanelContextType {
  // 当前工作流ID
  currentFlowId: string | null;
  
  // 保持向后兼容 - 从全局Context获取当前工作区的服务
  deployedServices: DeployedServices;
  setDeployedServices: React.Dispatch<React.SetStateAction<DeployedServices>>;
  
  // API Server Key - 从全局Context获取
  apiServerKey: string;
  
  // 委托给全局Context的方法
  addApiService: (service: ApiService) => void;
  removeApiService: (apiId: string) => void;
  updateApiService: (apiId: string, updates: Partial<ApiService>) => void;
  
  addChatbotService: (service: ChatbotService) => void;
  removeChatbotService: (chatbotId: string) => void;
  updateChatbotService: (chatbotId: string, updates: Partial<ChatbotService>) => void;
  
  getChatbotApiKey: (workspaceId: string) => string | null;
  resetDeploymentState: () => void;
}

const DeployPanelContext = createContext<DeployPanelContextType | undefined>(undefined);

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
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(flowId);
  
  // 使用新的UserServersContext
  const {
    addApiService: globalAddApiService,
    removeApiService: globalRemoveApiService,
    updateApiService: globalUpdateApiService,
    addChatbotService: globalAddChatbotService,
    removeChatbotService: globalRemoveChatbotService,
    updateChatbotService: globalUpdateChatbotService,
    getChatbotApiKey: globalGetChatbotApiKey,
    getServicesByWorkspace,
    fetchWorkspaceServices
  } = useServers();

  // 从 useServerOperations 获取 apiServerKey
  const { apiServerKey } = useServerOperations();

  // 获取当前工作区的服务，转换为原有格式
  const getCurrentWorkspaceServices = (): DeployedServices => {
    if (!currentFlowId) return { apis: [], chatbots: [], lastFetched: undefined };
    
    const services = getServicesByWorkspace(currentFlowId);
    return {
      apis: services.apis.map(api => ({
        api_id: api.api_id,
        api_key: api.api_key,
        endpoint: api.endpoint,
        created_at: api.created_at,
        workspace_id: api.workspace_id,
        inputs: api.inputs,
        outputs: api.outputs
      })),
      chatbots: services.chatbots.map(chatbot => ({
        chatbot_id: chatbot.chatbot_id,
        chatbot_key: chatbot.chatbot_key,
        endpoint: chatbot.endpoint,
        created_at: chatbot.created_at,
        workspace_id: chatbot.workspace_id,
        input: chatbot.input,
        output: chatbot.output,
        history: chatbot.history,
        multi_turn_enabled: chatbot.multi_turn_enabled,
        welcome_message: chatbot.welcome_message,
        config: chatbot.config
      })),
      lastFetched: Date.now()
    };
  };

  // 包装方法，添加工作区名称
  const addApiService = (service: ApiService) => {
    const workspace = workspaces.find(w => w.flowId === currentFlowId);
    const workspaceName = workspace?.flowTitle || 'Unknown';
    globalAddApiService(service, workspaceName);
  };

  const addChatbotService = (service: ChatbotService) => {
    const workspace = workspaces.find(w => w.flowId === currentFlowId);
    const workspaceName = workspace?.flowTitle || 'Unknown';
    globalAddChatbotService(service, workspaceName);
  };

  // 空的setter，因为数据现在由全局Context管理
  const setDeployedServices = () => {
    // 这个方法现在是空的，因为状态由全局Context管理
    console.warn('setDeployedServices is deprecated, use global context methods instead');
  };

  const resetDeploymentState = () => {
    // 可以实现为清除当前工作区的服务
    console.warn('resetDeploymentState is deprecated');
  };

  // 监听 flowId 变化
  useEffect(() => {
    if (flowId !== currentFlowId) {
      setCurrentFlowId(flowId);
      
      // 如果需要，可以触发数据刷新
      if (flowId) {
        fetchWorkspaceServices(flowId);
      }
    }
  }, [flowId, currentFlowId, fetchWorkspaceServices]);

  return (
    <DeployPanelContext.Provider 
      value={{ 
        currentFlowId,
        deployedServices: getCurrentWorkspaceServices(),
        setDeployedServices,
        apiServerKey,
        addApiService,
        removeApiService: globalRemoveApiService,
        updateApiService: globalUpdateApiService,
        addChatbotService,
        removeChatbotService: globalRemoveChatbotService,
        updateChatbotService: globalUpdateChatbotService,
        getChatbotApiKey: globalGetChatbotApiKey,
        resetDeploymentState
      }}
    >
      {children}
    </DeployPanelContext.Provider>
  );
};

export const useDeployPanelContext = () => {
  const context = useContext(DeployPanelContext);
  if (!context) {
    throw new Error('useDeployPanelContext must be used within DeployPanelProvider');
  }
  return context;
};

// 保持原有的hook
export const useDeployedServices = () => {
  const { 
    deployedServices, 
    addApiService, 
    removeApiService, 
    updateApiService,
    addChatbotService,
    removeChatbotService,
    updateChatbotService,
    getChatbotApiKey
  } = useDeployPanelContext();
  
  return {
    apis: deployedServices.apis,
    chatbots: deployedServices.chatbots,
    addApiService,
    removeApiService,
    updateApiService,
    addChatbotService,
    removeChatbotService,
    updateChatbotService,
    getChatbotApiKey
  };
};
