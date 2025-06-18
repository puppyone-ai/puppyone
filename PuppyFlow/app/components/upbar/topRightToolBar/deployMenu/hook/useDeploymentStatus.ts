import { useCallback } from 'react';
import { useWorkspaceDeployedServices, useServers } from '@/app/components/states/UserServersContext';

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
  // 使用新的UserServersContext的工作区特定hook
  const { 
    apis, 
    chatbots, 
    isLoading, 
    error, 
    refresh 
  } = useWorkspaceDeployedServices(selectedFlowId || '');

  // 转换为原有格式
  const deployedServices = {
    apis: apis.map(api => ({
      api_id: api.api_id,
      api_key: api.api_key,
      endpoint: api.endpoint,
      created_at: api.created_at,
      workspace_id: api.workspace_id,
      inputs: api.inputs,
      outputs: api.outputs
    })),
    chatbots: chatbots.map(chatbot => ({
      chatbot_id: chatbot.chatbot_id,
      chatbot_key: chatbot.chatbot_key,
      endpoint: chatbot.endpoint,
      created_at: chatbot.created_at,
      workspace_id: chatbot.workspace_id,
      input: chatbot.input,
      output: chatbot.output,
      history: chatbot.history,
      multi_turn_enabled: chatbot.multi_turn_enabled,
      welcome_message: chatbot.welcome_message
    })),
    lastFetched: Date.now()
  };

  const fetchDeployedServices = useCallback(async () => {
    if (selectedFlowId) {
      await refresh();
    }
  }, [selectedFlowId, refresh]);

  // 使用新的UserServersContext的删除方法
  const { removeApiService, removeChatbotService } = useServers();

  const deleteApi = useCallback(async (apiId: string) => {
    removeApiService(apiId);
  }, [removeApiService]);

  const deleteChatbot = useCallback(async (chatbotId: string) => {
    removeChatbotService(chatbotId);
  }, [removeChatbotService]);

  return {
    deployedServices,
    fetchDeployedServices,
    deleteApi,
    deleteChatbot,
    isLoading,
    error
  };
}
