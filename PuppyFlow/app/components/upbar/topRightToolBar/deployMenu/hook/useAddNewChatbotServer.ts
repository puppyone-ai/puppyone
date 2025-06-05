import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';
import { useEdgeNodeBackEndJsonBuilder } from '../../../../workflow/edgesNode/edgeNodesNew/hook/useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from '../../../../workflow/edgesNode/edgeNodesNew/hook/useBlockNodeBackEndJsonBuilder';
import { SYSTEM_URLS } from '@/config/urls';

// 简化的部署参数接口，不再需要预构建的 workflow_json
interface DeployParams {
  input: string;
  output: string;
  history: string | null;
  workspace_id: string;
  multi_turn_enabled: boolean;
  welcome_message: string;
  integrations: {};
}

// 内部使用的完整载荷接口
interface DeployPayload {
  workflow_json: {
    blocks: { [key: string]: any };
    edges: { [key: string]: any };
  };
  input: string;
  output: string;
  history: string | null;
  workspace_id: string;
  multi_turn_enabled: boolean;
  welcome_message: string;
  integrations: {};
}

interface UseAddNewChatbotServerReturn {
  isDeploying: boolean;
  deployError: string | null;
  deployNewChatbot: (params: DeployParams) => Promise<boolean>;
}

export const useAddNewChatbotServer = (): UseAddNewChatbotServerReturn => {
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  
  // React Flow hooks
  const { getNodes, getEdges } = useReactFlow();
  
  // 构建器 hooks
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();
  
  const {
    deployedServices,
    addChatbotService,
    removeChatbotService,
    apiServerKey
  } = useDeployPanelContext();

  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 构建工作流 JSON 的内部函数
  const constructWorkflowJson = () => {
    const allNodes = getNodes();
    const reactFlowEdges = getEdges();
    
    // 创建blocks对象
    let blocks: { [key: string]: any } = {};
    let edges: { [key: string]: any } = {};
    
    // 定义哪些节点类型属于 block 节点
    const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];
    
    // 处理所有节点
    allNodes.forEach(node => {
      const nodeId = node.id;
      // 确保 nodeLabel 是字符串类型
      const nodeLabel = node.data?.label || nodeId;
      
      // 根据节点类型决定如何构建JSON
      if (blockNodeTypes.includes(node.type || '')) {
        try {
          // 使用区块节点构建函数
          const blockJson = buildBlockNodeJson(nodeId);
          
          // 确保节点标签正确
          blocks[nodeId] = {
            ...blockJson,
            label: String(nodeLabel) // 确保 label 是字符串
          };
        } catch (e) {
          console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);
          
          // 回退到默认行为
          blocks[nodeId] = {
            label: String(nodeLabel), // 确保 label 是字符串
            type: node.type || '',
            data: {...node.data} // 确保复制数据而不是引用
          };
        }
      } else {
        // 非 block 节点 (edge节点)
        try {
          // 构建边的JSON并添加到edges对象中
          const edgeJson = buildEdgeNodeJson(nodeId);
          edges[nodeId] = edgeJson;
        } catch (e) {
          console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
        }
      }
    });
    
    return {
      blocks,
      edges
    };
  };

  const deployNewChatbot = async (params: DeployParams): Promise<boolean> => {
    if (!params.workspace_id || !apiServerKey) {
      setDeployError("缺少必要的部署参数");
      return false;
    }

    if (!params.input || !params.output) {
      setDeployError("请选择输入和输出节点");
      return false;
    }

    setIsDeploying(true);
    setDeployError(null);

    try {
      // 在这里构建工作流 JSON
      const workflow_json = constructWorkflowJson();
      
      // 构建完整的部署载荷
      const payload: DeployPayload = {
        workflow_json,
        ...params
      };

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
        chatbot => chatbot.workspace_id === params.workspace_id
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
        workspace_id: params.workspace_id,
        input: params.input,
        output: params.output,
        history: params.history,
        multi_turn_enabled: params.multi_turn_enabled,
        welcome_message: params.welcome_message,
        config: {
          multiTurn: params.multi_turn_enabled,
          welcomeMessage: params.welcome_message,
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
