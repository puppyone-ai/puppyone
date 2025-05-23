import { useCallback } from 'react';

interface UseChatbotDeployProps {
  selectedInputs: any[];
  selectedOutputs: any[];
  selectedFlowId: string | null;
  API_SERVER_URL: string;
  setChatbotState: (fn: (prev: any) => any) => void;
  syncToWorkspaces: () => void;
  getNodes: () => any[];
  getEdges: () => any[];
  buildBlockNodeJson: (nodeId: string) => any;
  buildEdgeNodeJson: (nodeId: string) => any;
  chatbotConfig: {
    multiTurn: boolean;
    welcomeMessage: string;
    deployTo?: string;
  };
}

export interface ChatbotInfo {
  chatbot_id: string;
  created_at: string;
  input: string;
  output: string;
  multi_turn_enabled: boolean;
  welcome_message: string;
}

export function useChatbotDeploy({
  selectedInputs,
  selectedOutputs,
  selectedFlowId,
  API_SERVER_URL,
  setChatbotState,
  syncToWorkspaces,
  getNodes,
  getEdges,
  buildBlockNodeJson,
  buildEdgeNodeJson,
  chatbotConfig,
}: UseChatbotDeployProps) {
  // 构建工作流 JSON
  const constructWorkflowJson = useCallback(() => {
    try {
      const allNodes = getNodes();
      // const reactFlowEdges = getEdges(); // 目前没用到

      let blocks: { [key: string]: any } = {};
      let edges: { [key: string]: any } = {};

      const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

      allNodes.forEach(node => {
        const nodeId = node.id;
        const nodeLabel = node.data?.label || nodeId;

        if (blockNodeTypes.includes(node.type || '')) {
          try {
            const blockJson = buildBlockNodeJson(nodeId);
            blocks[nodeId] = {
              ...blockJson,
              label: String(nodeLabel)
            };
          } catch (e) {
            blocks[nodeId] = {
              label: String(nodeLabel),
              type: node.type || '',
              data: { ...node.data }
            };
          }
        } else {
          try {
            const edgeJson = buildEdgeNodeJson(nodeId);
            edges[nodeId] = edgeJson;
          } catch (e) {
            // ignore
          }
        }
      });

      return { blocks, edges };
    } catch (error) {
      console.error(`Error building workflow JSON: ${error}`);
      return;
    }
  }, [getNodes, buildBlockNodeJson, buildEdgeNodeJson]);

  // 创建历史节点或查找现有的文本节点作为历史存储
  const findOrCreateHistoryNode = useCallback(() => {
    const allNodes = getNodes();
    
    // 首先尝试找到一个文本节点，它没有被选为输入或输出
    const textNodes = allNodes.filter(node => 
      node.type === 'text' && 
      !selectedInputs.some(input => input.id === node.id) &&
      !selectedOutputs.some(output => output.id === node.id)
    );
    
    if (textNodes.length > 0) {
      // 使用第一个符合条件的文本节点作为历史节点
      return textNodes[0].id;
    }
    
    // 如果没有找到合适的节点，返回null，API将处理这种情况
    return null;
  }, [getNodes, selectedInputs, selectedOutputs]);

  // 部署处理
  const handleDeploy = useCallback(async () => {
    setChatbotState(prev => ({
      ...prev,
      isDeploying: true
    }));

    try {
      // 查找或创建历史节点
      const historyNodeId = findOrCreateHistoryNode();
      
      // 构建新的payload格式
      const payload = {
        workflow_json: constructWorkflowJson(),
        input: selectedInputs.length > 0 ? selectedInputs[0].id : null,
        output: selectedOutputs.length > 0 ? selectedOutputs[0].id : null,
        history_id: historyNodeId,
        workspace_id: selectedFlowId || "default",
        multi_turn_enabled: chatbotConfig.multiTurn,
        welcome_message: chatbotConfig.welcomeMessage,
        integrations: {}  // 暂时为空对象，可以根据需要添加集成配置
      };

      const res = await fetch(
        API_SERVER_URL + "/config_chatbot",  // 新的端点
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.NEXT_PUBLIC_API_SERVER_KEY
          },
          body: JSON.stringify(payload)
        }
      );

      const content = await res.json();

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }

      const { api_id, api_key, endpoint } = content;

      setChatbotState(prev => ({
        ...prev,
        isDeployed: true,
        deploymentInfo: {
          api_id,
          api_key,
          endpoint: endpoint || `${API_SERVER_URL}/api/${api_id}`,
          ...content
        },
        isDeploying: false
      }));

      syncToWorkspaces();

    } catch (error) {
      setChatbotState(prev => ({
        ...prev,
        isDeploying: false
      }));
      console.error("Failed to deploy:", error);
    }
  }, [
    API_SERVER_URL,
    selectedInputs,
    selectedOutputs,
    selectedFlowId,
    setChatbotState,
    syncToWorkspaces,
    constructWorkflowJson,
    findOrCreateHistoryNode,
    chatbotConfig
  ]);

  /**
   * 获取指定工作区的所有聊天机器人列表
   * @param workspaceId 工作区ID
   * @returns 返回聊天机器人信息数组
   */
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_chatbots/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.NEXT_PUBLIC_API_SERVER_KEY
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
      throw error;
    }
  }, [API_SERVER_URL]);

  /**
   * 删除指定的聊天机器人
   * @param chatbotId 要删除的聊天机器人ID
   * @returns 返回删除操作的结果消息
   */
  const deleteChatbot = useCallback(async (chatbotId: string): Promise<string> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/delete_chatbot/${chatbotId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.NEXT_PUBLIC_API_SERVER_KEY
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete chatbot: ${res.status}`);
      }

      const data = await res.json();
      
      // 更新状态，如果当前正在操作的chatbot被删除了
      if (selectedFlowId) {
        const currentChatbotInfo = await fetchChatbotList(selectedFlowId);
        if (!currentChatbotInfo.some(bot => bot.chatbot_id === chatbotId)) {
          setChatbotState(prev => ({
            ...prev,
            isDeployed: false,
            deploymentInfo: null
          }));
          
          // 同步到工作区状态
          syncToWorkspaces();
        }
      }
      
      return data.message || `Chatbot successfully deleted: ${chatbotId}`;
    } catch (error) {
      console.error("Error deleting chatbot:", error);
      throw error;
    }
  }, [API_SERVER_URL, selectedFlowId, fetchChatbotList, setChatbotState, syncToWorkspaces]);

  /**
   * 初始化聊天机器人部署设置
   * 在组件首次加载时调用，从数据库中查询当前工作区的聊天机器人设置
   * 如果存在设置，则加载该设置到当前状态
   * 如果不存在设置，则创建一个空的设置
   */
  const initializeChatbotDeployment = useCallback(async () => {
    if (!selectedFlowId) {
      console.log("No flow selected, skipping initialization");
      return;
    }

    try {
      // 查询当前工作区的聊天机器人列表
      const chatbots = await fetchChatbotList(selectedFlowId);
      
      // 如果存在聊天机器人配置
      if (chatbots && chatbots.length > 0) {
        // 取最新的一个配置(通常是按时间排序，最新的在前面)
        const latestChatbot = chatbots[0];
        
        console.log("Found existing chatbot configuration:", latestChatbot.chatbot_id);
        
        // 查找指定的输入输出节点
        const allNodes = getNodes();
        const inputNode = allNodes.find(node => node.id === latestChatbot.input);
        const outputNode = allNodes.find(node => node.id === latestChatbot.output);
        
        // 准备节点数据结构
        const inputSelection = inputNode 
          ? [{ id: inputNode.id, label: inputNode.data?.label || inputNode.id }]
          : [];
          
        const outputSelection = outputNode 
          ? [{ id: outputNode.id, label: outputNode.data?.label || outputNode.id }]
          : [];
        
        // 更新状态
        setChatbotState(prev => ({
          ...prev,
          isDeployed: true,
          selectedInputs: inputSelection.length > 0 ? inputSelection : prev.selectedInputs,
          selectedOutputs: outputSelection.length > 0 ? outputSelection : prev.selectedOutputs,
          chatbotConfig: {
            ...prev.chatbotConfig,
            multiTurn: latestChatbot.multi_turn_enabled,
            welcomeMessage: latestChatbot.welcome_message || "Hello! How can I help you today?"
          },
          deploymentInfo: {
            api_id: latestChatbot.chatbot_id,
            // 注意: API密钥通常不会返回，需要单独处理
            endpoint: `${API_SERVER_URL}/api/${latestChatbot.chatbot_id}`
          }
        }));
        
        // 同步到工作区
        syncToWorkspaces();
      } else {
        console.log("No existing chatbot configuration found, initializing default state");
        
        // 如果没有找到配置，那么创建一个空的默认设置
        // 这里我们不实际创建数据库记录，只是初始化UI状态
        // 预设一些默认节点或保持初始状态
        
        // 查找默认的输入输出节点
        const allNodes = getNodes();
        const defaultInputNodes = allNodes
          .filter(node => node.type === 'text' && node.data?.isInput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
          
        const defaultOutputNodes = allNodes
          .filter(node => node.type === 'text' && node.data?.isOutput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
        
        // 只有当当前状态为空时，才设置默认值
        if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
          setChatbotState(prev => ({
            ...prev,
            isDeployed: false,
            selectedInputs: defaultInputNodes,
            selectedOutputs: defaultOutputNodes,
            chatbotConfig: {
              ...prev.chatbotConfig
            },
            deploymentInfo: null
          }));
        }
      }
    } catch (error) {
      console.error("Error initializing chatbot deployment:", error);
      
      // 出错时创建默认空状态
      if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
        const allNodes = getNodes();
        const defaultInputNodes = allNodes
          .filter(node => node.type === 'text' && node.data?.isInput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
          
        const defaultOutputNodes = allNodes
          .filter(node => node.type === 'text' && node.data?.isOutput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
        
        setChatbotState(prev => ({
          ...prev,
          selectedInputs: defaultInputNodes,
          selectedOutputs: defaultOutputNodes
        }));
      }
    }
  }, [selectedFlowId, API_SERVER_URL, getNodes, fetchChatbotList, setChatbotState, syncToWorkspaces, selectedInputs, selectedOutputs]);

  return { 
    handleDeploy,
    fetchChatbotList,
    deleteChatbot,
    initializeChatbotDeployment
  };
}
