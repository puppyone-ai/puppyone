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
   * 初始化 API 部署设置
   * 在组件首次加载时调用，从数据库中查询当前工作区的 API 设置
   * 如果存在设置，则加载该设置到当前状态
   * 如果不存在设置，则创建一个空的设置
   */
  
  return { 
    handleDeploy,
  };
}
