import { useCallback } from 'react';

interface UseApiDeployProps {
  selectedInputs: any[];
  selectedOutputs: any[];
  selectedFlowId: string | null;
  API_SERVER_URL: string;
  setApiState: (fn: (prev: any) => any) => void;
  syncToWorkspaces: () => void;
  getNodes: () => any[];
  getEdges: () => any[];
  buildBlockNodeJson: (nodeId: string) => any;
  buildEdgeNodeJson: (nodeId: string) => any;
  apiServerKey: string;
}

export interface ApiInfo {
  api_id: string;
  api_key: string;
  created_at?: string;
  workspace_id?: string;
}

export function useApiDeploy({
  selectedInputs,
  selectedOutputs,
  selectedFlowId,
  API_SERVER_URL,
  setApiState,
  syncToWorkspaces,
  getNodes,
  getEdges,
  buildBlockNodeJson,
  buildEdgeNodeJson,
  apiServerKey,
}: UseApiDeployProps) {
  
  // 构建工作流 JSON
  const constructWorkflowJson = useCallback(() => {
    try {
      const allNodes = getNodes();
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

  // 部署处理
  const handleDeploy = useCallback(async () => {
    setApiState(prev => ({
      ...prev,
      isDeploying: true
    }));

    try {
      const payload = {
        workflow_json: constructWorkflowJson(),
        inputs: selectedInputs.map(item => item.id),
        outputs: selectedOutputs.map(item => item.id),
        workspace_id: selectedFlowId || "default"
      };

      const res = await fetch(
        API_SERVER_URL + "/config_api",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          },
          body: JSON.stringify(payload)
        }
      );

      const content = await res.json();

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }

      const { api_id, api_key } = content;

      setApiState(prev => ({
        ...prev,
        apiDeployment: {
          id: api_id,
          key: api_key,
          isDeployed: true
        },
        deploymentInfo: {
          api_id,
          api_key,
          endpoint: `${API_SERVER_URL}/execute_workflow/${api_id}`,
          ...content
        },
        showApiExample: true,
        apiConfig: { id: api_id, key: api_key },
        isDeploying: false
      }));

      syncToWorkspaces();

    } catch (error) {
      setApiState(prev => ({
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
    setApiState,
    syncToWorkspaces,
    constructWorkflowJson,
    apiServerKey
  ]);

  /**
   * 获取指定工作区的所有 API 列表
   * @param workspaceId 工作区ID
   * @returns 返回 API 信息数组
   */
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
      throw error;
    }
  }, [API_SERVER_URL, apiServerKey]);

  /**
   * 删除指定的 API
   * @param apiId 要删除的 API ID
   * @returns 返回删除操作的结果消息
   */
  const deleteApi = useCallback(async (apiId: string): Promise<string> => {
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

      const data = await res.json();
      
      // 更新状态，如果当前正在操作的 API 被删除了
      if (selectedFlowId) {
        const currentApiInfo = await fetchApiList(selectedFlowId);
        if (!currentApiInfo.some(api => api.api_id === apiId)) {
          setApiState(prev => ({
            ...prev,
            apiDeployment: { id: null, key: null, isDeployed: false },
            deploymentInfo: null,
            showApiExample: false,
            apiConfig: undefined
          }));
          
          // 同步到工作区状态
          syncToWorkspaces();
        }
      }
      
      return data.message || `API successfully deleted: ${apiId}`;
    } catch (error) {
      console.error("Error deleting API:", error);
      throw error;
    }
  }, [API_SERVER_URL, selectedFlowId, fetchApiList, setApiState, syncToWorkspaces, apiServerKey]);

  /**
   * 初始化 API 部署设置
   * 在组件首次加载时调用，从数据库中查询当前工作区的 API 设置
   * 如果存在设置，则加载该设置到当前状态
   * 如果不存在设置，则创建一个空的设置
   */
  const initializeApiDeployment = useCallback(async () => {
    if (!selectedFlowId) {
      console.log("No flow selected, skipping initialization");
      return;
    }

    try {
      // 查询当前工作区的 API 列表
      const apis = await fetchApiList(selectedFlowId);
      
      // 如果存在 API 配置
      if (apis && apis.length > 0) {
        // 取最新的一个配置
        const latestApi = apis[0];
        
        console.log("Found existing API configuration:", latestApi.api_id);
        
        // 更新状态
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
        
        // 同步到工作区
        syncToWorkspaces();
      } else {
        console.log("No existing API configuration found, initializing default state");
        
        // 查找默认的输入输出节点
        const allNodes = getNodes();
        const defaultInputNodes = allNodes
          .filter(node => (node.type === 'text' || node.type === 'structured') && node.data?.isInput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
          
        const defaultOutputNodes = allNodes
          .filter(node => (node.type === 'text' || node.type === 'structured') && node.data?.isOutput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
        
        // 只有当当前状态为空时，才设置默认值
        if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
          setApiState(prev => ({
            ...prev,
            apiDeployment: { id: null, key: null, isDeployed: false },
            selectedInputs: defaultInputNodes,
            selectedOutputs: defaultOutputNodes,
            deploymentInfo: null,
            showApiExample: false,
            apiConfig: undefined
          }));
        }
      }
    } catch (error) {
      console.error("Error initializing API deployment:", error);
      
      // 出错时创建默认空状态
      if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
        const allNodes = getNodes();
        const defaultInputNodes = allNodes
          .filter(node => (node.type === 'text' || node.type === 'structured') && node.data?.isInput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
          
        const defaultOutputNodes = allNodes
          .filter(node => (node.type === 'text' || node.type === 'structured') && node.data?.isOutput === true)
          .map(node => ({ id: node.id, label: node.data?.label || node.id }));
        
        setApiState(prev => ({
          ...prev,
          selectedInputs: defaultInputNodes,
          selectedOutputs: defaultOutputNodes
        }));
      }
    }
  }, [selectedFlowId, API_SERVER_URL, getNodes, fetchApiList, setApiState, syncToWorkspaces, selectedInputs, selectedOutputs]);

  return { 
    handleDeploy,
    fetchApiList,
    deleteApi,
    initializeApiDeployment
  };
}
