import { useCallback, useState } from 'react';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';
import { SYSTEM_URLS } from '@/config/urls';

interface ApiInfo {
  api_id: string;
  api_key: string;
  created_at?: string;
  workspace_id?: string;
}

interface ChatbotInfo {
  chatbot_id: string;
  chatbot_key: string;
  created_at?: string;
  workspace_id?: string;
}

interface UseDeploymentStatusProps {
  selectedFlowId: string | null;
}

export function useDeploymentStatus({ selectedFlowId }: UseDeploymentStatusProps) {
  const { 
    apiState, 
    setApiState, 
    chatbotState, 
    setChatbotState, 
    apiServerKey,
    syncToWorkspaces 
  } = useDeployPanelContext();

  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 存储已部署的服务列表
  const [deployedServices, setDeployedServices] = useState<{
    apis: ApiInfo[];
    chatbots: ChatbotInfo[];
  }>({
    apis: [],
    chatbots: []
  });

  // 获取API列表
  const fetchApiList = useCallback(async (workspaceId: string): Promise<ApiInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_apis/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch API list: ${res.status}`);
      }

      const data = await res.json();
      return data.apis || [];
    } catch (error) {
      console.error("Error fetching API list:", error);
      return [];
    }
  }, [API_SERVER_URL, apiServerKey]);

  // 获取Chatbot列表
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_chatbots/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch chatbot list: ${res.status}`);
      }

      const data = await res.json();
      return data.chatbots || [];
    } catch (error) {
      console.error("Error fetching chatbot list:", error);
      return [];
    }
  }, [API_SERVER_URL, apiServerKey]);

  // 删除API
  const deleteApi = useCallback(async (apiId: string): Promise<void> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/delete_api/${apiId}`,
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

      // 重新获取服务列表
      if (selectedFlowId) {
        await fetchDeployedServices();
      }
    } catch (error) {
      console.error("Error deleting API:", error);
      throw error;
    }
  }, [API_SERVER_URL, apiServerKey, selectedFlowId]);

  // 删除Chatbot
  const deleteChatbot = useCallback(async (chatbotId: string): Promise<void> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/delete_chatbot/${chatbotId}`,
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

      // 重新获取服务列表
      if (selectedFlowId) {
        await fetchDeployedServices();
      }
    } catch (error) {
      console.error("Error deleting chatbot:", error);
      throw error;
    }
  }, [API_SERVER_URL, apiServerKey, selectedFlowId]);

  // 获取已部署的服务列表
  const fetchDeployedServices = useCallback(async () => {
    if (!selectedFlowId || !apiServerKey) {
      console.log("No flow selected or API key missing, skipping fetch");
      setDeployedServices({ apis: [], chatbots: [] });
      return;
    }

    try {
      // 并行获取API和Chatbot列表
      const [apis, chatbots] = await Promise.all([
        fetchApiList(selectedFlowId),
        fetchChatbotList(selectedFlowId)
      ]);

      setDeployedServices({ apis, chatbots });

      // 更新context状态以保持兼容性
      if (apis && apis.length > 0) {
        const latestApi = apis[0];
        setApiState(prev => ({
          ...prev,
          apiDeployment: {
            id: latestApi.api_id,
            key: latestApi.api_key,
            isDeployed: true
          },
          deploymentInfo: {
            api_id: latestApi.api_id,
            api_key: latestApi.api_key,
            endpoint: `${API_SERVER_URL}/execute_workflow/${latestApi.api_id}`
          },
          showApiExample: true,
          apiConfig: { id: latestApi.api_id, key: latestApi.api_key }
        }));
      } else {
        setApiState(prev => ({
          ...prev,
          apiDeployment: { id: null, key: null, isDeployed: false },
          deploymentInfo: null,
          showApiExample: false,
          apiConfig: undefined
        }));
      }

      if (chatbots && chatbots.length > 0) {
        const latestChatbot = chatbots[0];
        setChatbotState(prev => ({
          ...prev,
          isDeployed: true,
          deploymentInfo: {
            chatbot_id: latestChatbot.chatbot_id,
            chatbot_key: latestChatbot.chatbot_key,
            endpoint: `${API_SERVER_URL}/chat/${latestChatbot.chatbot_id}`
          }
        }));
      } else {
        setChatbotState(prev => ({
          ...prev,
          isDeployed: false,
          deploymentInfo: null
        }));
      }

      syncToWorkspaces();

    } catch (error) {
      console.error("Error fetching deployed services:", error);
      setDeployedServices({ apis: [], chatbots: [] });
    }
  }, [selectedFlowId, apiServerKey, fetchApiList, fetchChatbotList, setApiState, setChatbotState, syncToWorkspaces, API_SERVER_URL]);

  return {
    deployedServices,
    fetchDeployedServices,
    deleteApi,
    deleteChatbot
  };
}
