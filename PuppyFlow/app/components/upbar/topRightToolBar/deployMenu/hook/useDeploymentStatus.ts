import { useCallback } from 'react';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';
import { SYSTEM_URLS } from '@/config/urls';

interface ApiInfo {
  api_id: string;
  api_key: string;
  created_at?: string;
  workspace_id?: string;
  inputs?: string[];
  outputs?: string[];
}

interface ChatbotInfo {
  chatbot_id: string;
  chatbot_key: string;
  created_at?: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
}

interface UseDeploymentStatusProps {
  selectedFlowId: string | null;
}

export function useDeploymentStatus({ selectedFlowId }: UseDeploymentStatusProps) {
  const { 
    deployedServices,
    setDeployedServices,
    apiServerKey
  } = useDeployPanelContext();

  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

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
        `${API_SERVER_URL}/list_chatbots/${workspaceId}?include_keys=true`,
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

      // 从本地状态中移除
      setDeployedServices(prev => ({
        ...prev,
        apis: prev.apis.filter(api => api.api_id !== apiId)
      }));

    } catch (error) {
      console.error("Error deleting API:", error);
      throw error;
    }
  }, [API_SERVER_URL, apiServerKey, setDeployedServices]);

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

      // 从本地状态中移除
      setDeployedServices(prev => ({
        ...prev,
        chatbots: prev.chatbots.filter(chatbot => chatbot.chatbot_id !== chatbotId)
      }));

    } catch (error) {
      console.error("Error deleting chatbot:", error);
      throw error;
    }
  }, [API_SERVER_URL, apiServerKey, setDeployedServices]);

  // 获取已部署的服务列表
  const fetchDeployedServices = useCallback(async () => {
    if (!selectedFlowId || !apiServerKey) {
      console.log("No flow selected or API key missing, skipping fetch");
      setDeployedServices({ apis: [], chatbots: [], lastFetched: undefined });
      return;
    }

    try {
      // 并行获取API和Chatbot列表
      const [apis, chatbots] = await Promise.all([
        fetchApiList(selectedFlowId),
        fetchChatbotList(selectedFlowId)
      ]);

      // 转换为新的格式
      const apiServices = apis.map(api => ({
        api_id: api.api_id,
        api_key: api.api_key,
        endpoint: `${API_SERVER_URL}/execute_workflow/${api.api_id}`,
        created_at: api.created_at,
        workspace_id: api.workspace_id,
        inputs: api.inputs || [],
        outputs: api.outputs || []
      }));

      const chatbotServices = chatbots.map(chatbot => ({
        chatbot_id: chatbot.chatbot_id,
        chatbot_key: chatbot.chatbot_key,
        endpoint: `${API_SERVER_URL}/chat/${chatbot.chatbot_id}`,
        created_at: chatbot.created_at,
        workspace_id: chatbot.workspace_id,
        input: chatbot.input,
        output: chatbot.output,
        history: chatbot.history,
        multi_turn_enabled: chatbot.multi_turn_enabled,
        welcome_message: chatbot.welcome_message
      }));

      setDeployedServices({
        apis: apiServices,
        chatbots: chatbotServices,
        lastFetched: Date.now()
      });

    } catch (error) {
      console.error("Error fetching deployed services:", error);
      setDeployedServices({ apis: [], chatbots: [], lastFetched: undefined });
    }
  }, [selectedFlowId, apiServerKey, fetchApiList, fetchChatbotList, setDeployedServices, API_SERVER_URL]);

  return {
    deployedServices,
    fetchDeployedServices,
    deleteApi,
    deleteChatbot
  };
}
