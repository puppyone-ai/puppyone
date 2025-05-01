import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// API 部署状态接口
interface ApiDeployState {
  apiDeployment: {
    id: string | null;
    key: string | null;
    isDeployed: boolean;
  };
  deploymentInfo: any;
  selectedInputs: any[];
  selectedOutputs: any[];
  apiConfig?: { id: string; key: string };
  isDeploying: boolean;
  showApiExample: boolean;
  selectedLang: string;
}

// Chatbot 部署状态接口
interface ChatbotDeployState {
  isDeployed: boolean;
  deploymentInfo: any;
  selectedInputs: any[];
  selectedOutputs: any[];
  chatbotConfig: {
    multiTurn: boolean;
    welcomeMessage: string;
    deployTo: string;
  };
  isDeploying: boolean;
  selectedSDK: string | null;
  showChatbotTest: boolean;
}

// Context 类型定义
interface DeployPanelContextType {
  currentFlowId: string | null;
  apiState: ApiDeployState;
  setApiState: React.Dispatch<React.SetStateAction<ApiDeployState>>;
  chatbotState: ChatbotDeployState;
  setChatbotState: React.Dispatch<React.SetStateAction<ChatbotDeployState>>;
  // 用于同步状态到 workspaces
  syncToWorkspaces: () => void;
}

// 初始 API 状态
const initialApiState: ApiDeployState = {
  apiDeployment: { id: null, key: null, isDeployed: false },
  deploymentInfo: null,
  selectedInputs: [],
  selectedOutputs: [],
  apiConfig: undefined,
  isDeploying: false,
  showApiExample: false,
  selectedLang: 'Shell',
};

// 初始 Chatbot 状态
const initialChatbotState: ChatbotDeployState = {
  isDeployed: false,
  deploymentInfo: null,
  selectedInputs: [],
  selectedOutputs: [],
  chatbotConfig: {
    multiTurn: true,
    welcomeMessage: 'Hello! How can I help you today?',
    deployTo: 'webui'
  },
  isDeploying: false,
  selectedSDK: null,
  showChatbotTest: false,
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
  // 状态定义
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(flowId);
  const [apiState, setApiState] = useState<ApiDeployState>(initialApiState);
  const [chatbotState, setChatbotState] = useState<ChatbotDeployState>(initialChatbotState);

  // 同步状态到 workspaces
  const syncToWorkspaces = () => {
    if (!currentFlowId) return;

    const updatedWorkspaces = workspaces.map(workspace => {
      if (workspace.flowId === currentFlowId) {
        return {
          ...workspace,
          deploy: {
            ...workspace.deploy,
            api: {
              apiDeployment: apiState.apiDeployment,
              deploymentInfo: apiState.deploymentInfo,
              selectedInputs: apiState.selectedInputs,
              selectedOutputs: apiState.selectedOutputs,
              apiConfig: apiState.apiConfig,
            },
            chatbot: {
              isDeployed: chatbotState.isDeployed,
              deploymentInfo: chatbotState.deploymentInfo,
              selectedInputs: chatbotState.selectedInputs,
              selectedOutputs: chatbotState.selectedOutputs,
              chatbotConfig: chatbotState.chatbotConfig,
            }
          }
        };
      }
      return workspace;
    });

    setWorkspaces(updatedWorkspaces);
  };

  // 监听 flowId 变化，同步状态
  useEffect(() => {
    if (flowId !== currentFlowId) {
      setCurrentFlowId(flowId);

      // 如果有 flowId，尝试从 workspaces 恢复状态
      if (flowId) {
        const currentWorkspace = workspaces.find(w => w.flowId === flowId);
        
        if (currentWorkspace?.deploy) {
          // 恢复 API 状态
          if (currentWorkspace.deploy.api) {
            setApiState(prev => ({
              ...prev,
              apiDeployment: currentWorkspace.deploy.api.apiDeployment || initialApiState.apiDeployment,
              deploymentInfo: currentWorkspace.deploy.api.deploymentInfo || null,
              selectedInputs: currentWorkspace.deploy.api.selectedInputs || [],
              selectedOutputs: currentWorkspace.deploy.api.selectedOutputs || [],
              apiConfig: currentWorkspace.deploy.api.apiConfig,
              isDeploying: false,
              showApiExample: !!currentWorkspace.deploy.api.apiConfig,
              selectedLang: prev.selectedLang,
            }));
          } else {
            setApiState(initialApiState);
          }

          // 恢复 Chatbot 状态
          if (currentWorkspace.deploy.chatbot) {
            setChatbotState(prev => ({
              ...prev,
              isDeployed: currentWorkspace.deploy.chatbot.isDeployed || false,
              deploymentInfo: currentWorkspace.deploy.chatbot.deploymentInfo || null,
              selectedInputs: currentWorkspace.deploy.chatbot.selectedInputs || [],
              selectedOutputs: currentWorkspace.deploy.chatbot.selectedOutputs || [],
              chatbotConfig: {
                ...initialChatbotState.chatbotConfig,
                ...currentWorkspace.deploy.chatbot.chatbotConfig,
              },
              isDeploying: false,
              selectedSDK: null,
              showChatbotTest: false,
            }));
          } else {
            setChatbotState(initialChatbotState);
          }
        } else {
          // 如果没有 deploy 状态，重置为初始状态
          setApiState(initialApiState);
          setChatbotState(initialChatbotState);
        }
      }
    }
  }, [flowId, workspaces]);

  // 当 API 或 Chatbot 状态改变时，自动同步到 workspaces
  useEffect(() => {
    if (currentFlowId) {
      syncToWorkspaces();
    }
  }, [
    currentFlowId,
    apiState.apiDeployment,
    apiState.selectedInputs,
    apiState.selectedOutputs,
    apiState.apiConfig,
    chatbotState.isDeployed,
    chatbotState.selectedInputs,
    chatbotState.selectedOutputs,
    chatbotState.chatbotConfig,
  ]);

  return (
    <DeployPanelContext.Provider 
      value={{ 
        currentFlowId,
        apiState, 
        setApiState, 
        chatbotState, 
        setChatbotState,
        syncToWorkspaces,
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
