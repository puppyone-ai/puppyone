import { useState } from 'react';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';
import { SYSTEM_URLS } from '@/config/urls';

interface DeployPayload {
  workflow_json: {
    nodes: any[];
    edges: any[];
  };
  input: string;
  output: string;
  history_id: string | null;
  workspace_id: string;
  multi_turn_enabled: boolean;
  welcome_message: string;
  integrations: {};
}

interface UseAddNewChatbotServerReturn {
  isDeploying: boolean;
  deployError: string | null;
  deployNewChatbot: (payload: DeployPayload) => Promise<boolean>;
}

export const useAddNewChatbotServer = (): UseAddNewChatbotServerReturn => {
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  
  const {
    deployedServices,
    addChatbotService,
    removeChatbotService,
    apiServerKey
  } = useDeployPanelContext();

  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  const deployNewChatbot = async (payload: DeployPayload): Promise<boolean> => {
    if (!payload.workspace_id || !apiServerKey) {
      setDeployError("缺少必要的部署参数");
      return false;
    }

    if (!payload.input || !payload.output) {
      setDeployError("请选择输入和输出节点");
      return false;
    }

    setIsDeploying(true);
    setDeployError(null);

    try {
      const res = await fetch(`${API_SERVER_URL}/config_chatbot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": apiServerKey
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`部署失败: ${res.status}`);
      }

      const { chatbot_id, chatbot_key, endpoint } = await res.json();

      // 检查是否已有部署的聊天机器人（重新部署的情况）
      const currentChatbot = deployedServices.chatbots.find(
        chatbot => chatbot.workspace_id === payload.workspace_id
      );

      // 如果是重新部署，先移除旧的聊天机器人
      if (currentChatbot) {
        removeChatbotService(currentChatbot.chatbot_id);
      }

      // 添加新的聊天机器人服务到 context
      addChatbotService({
        chatbot_id: chatbot_id,
        chatbot_key: chatbot_key,
        endpoint: endpoint || `${API_SERVER_URL}/api/${chatbot_id}`,
        created_at: new Date().toISOString(),
        workspace_id: payload.workspace_id,
        input: payload.input,
        output: payload.output,
        history_id: payload.history_id,
        multi_turn_enabled: payload.multi_turn_enabled,
        welcome_message: payload.welcome_message,
        config: {
          multiTurn: payload.multi_turn_enabled,
          welcomeMessage: payload.welcome_message,
          deployTo: 'chatbot'
        }
      });

      console.log('Chatbot 部署成功，Chatbot Key 已存储到 context:', chatbot_key);
      return true;

    } catch (error) {
      console.error("部署失败:", error);
      setDeployError(error instanceof Error ? error.message : "部署失败");
      return false;
    } finally {
      setIsDeploying(false);
    }
  };

  return {
    isDeploying,
    deployError,
    deployNewChatbot
  };
};
