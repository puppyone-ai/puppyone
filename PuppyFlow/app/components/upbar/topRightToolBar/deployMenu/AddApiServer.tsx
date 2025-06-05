import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';
import { useEdgeNodeBackEndJsonBuilder } from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/useBlockNodeBackEndJsonBuilder';
import { SYSTEM_URLS } from '@/config/urls';

interface DeployAsApiProps {
  selectedFlowId: string | null;
  setActivePanel: (panel: string | null) => void;
}

function DeployAsApi({
  selectedFlowId,
  setActivePanel
}: DeployAsApiProps) {
  const { getNodes, getNode, getEdges } = useReactFlow();
  
  // 从简化的 context 获取必要信息
  const { 
    deployedServices, 
    addApiService, 
    removeApiService, 
    apiServerKey 
  } = useDeployPanelContext();
  
  // 简化的本地状态管理
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>("Python");
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [showApiExample, setShowApiExample] = useState<boolean>(false);
  const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false);

  // 获取当前已部署的 API
  const currentApi = deployedServices.apis.find(api => api.workspace_id === selectedFlowId);
  const isDeployed = currentApi !== null;

  // 使用构建器
  const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
  const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

  // 统一管理 API Server URL
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 语言选项常量
  const PYTHON = "Python";
  const SHELL = "Shell";
  const JAVASCRIPT = "Javascript";

  // 初始化引用
  const initializedRef = useRef<boolean>(false);

  // 构建工作流 JSON
  const constructWorkflowJson = () => {
    const nodes = getNodes();
    const edges = getEdges();
    
    const blockNodes = nodes.filter(node => node.type === 'block');
    const edgeNodes = nodes.filter(node => node.type === 'edge');
    
    const blockNodesJson = blockNodes.map(node => buildBlockNodeJson(node.id));
    const edgeNodesJson = edgeNodes.map(node => buildEdgeNodeJson(node.id));
    
    return {
      nodes: [...blockNodesJson, ...edgeNodesJson],
      edges: edges
    };
  };

  // 直接处理部署逻辑
  const handleDeploy = async () => {
    if (!selectedFlowId || !apiServerKey) {
      console.error("缺少必要的部署参数");
      return;
    }

    setIsDeploying(true);
    
    try {
      const payload = {
        workflow_json: constructWorkflowJson(),
        inputs: selectedInputs,
        outputs: selectedOutputs,
        workspace_id: selectedFlowId
      };

      const res = await fetch(`${API_SERVER_URL}/config_api`, {
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

      const { api_id, api_key } = await res.json();
      
      // 如果是重新部署，先移除旧的 API
      if (currentApi) {
        removeApiService(currentApi.api_id);
      }
      
      // 添加新的 API 服务到 context
      addApiService({
        api_id,
        api_key,
        endpoint: `${API_SERVER_URL}/execute_workflow/${api_id}`,
        created_at: new Date().toISOString(),
        workspace_id: selectedFlowId
      });
      
      setShowApiExample(true);
      
    } catch (error) {
      console.error("部署失败:", error);
    } finally {
      setIsDeploying(false);
    }
  };

  // 删除 API
  const handleDeleteApi = async () => {
    if (!currentApi || !apiServerKey) return;

    try {
      const res = await fetch(`${API_SERVER_URL}/delete_api/${currentApi.api_id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": apiServerKey
        }
      });

      if (!res.ok) {
        throw new Error(`删除失败: ${res.status}`);
      }

      // 从 context 中移除
      removeApiService(currentApi.api_id);
      setShowApiExample(false);
      
    } catch (error) {
      console.error("删除 API 失败:", error);
    }
  };

  // 初始化节点选择
  const initializeNodeSelections = () => {
    const allInputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isInput === true)
      .map(node => node.id);

    const allOutputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isOutput === true)
      .map(node => node.id);

    setSelectedInputs(allInputNodes);
    setSelectedOutputs(allOutputNodes);
  };

  // 组件初始化
  useEffect(() => {
    if (!initializedRef.current && selectedFlowId) {
      initializedRef.current = true;
      
      // 如果已经部署，显示 API 示例
      if (currentApi) {
        setShowApiExample(true);
      }
      
      // 如果状态为空，初始化所有节点
      if (selectedInputs.length === 0 && selectedOutputs.length === 0) {
        initializeNodeSelections();
      }
    }
  }, [selectedFlowId, currentApi]);

  // 重置初始化状态当 flowId 改变时
  useEffect(() => {
    initializedRef.current = false;
    setShowApiExample(false);
  }, [selectedFlowId]);

  // 处理输入节点点击
  const handleInputClick = (node: any) => {
    const isSelected = selectedInputs.includes(node.id);
    if (isSelected) {
      setSelectedInputs(selectedInputs.filter(id => id !== node.id));
    } else {
      setSelectedInputs([...selectedInputs, node.id]);
    }
  };

  // 处理输出节点点击
  const handleOutputClick = (node: any) => {
    const isSelected = selectedOutputs.includes(node.id);
    if (isSelected) {
      setSelectedOutputs(selectedOutputs.filter(id => id !== node.id));
    } else {
      setSelectedOutputs([...selectedOutputs, node.id]);
    }
  };

  // 生成输入文本
  const input_text_gen = (inputs: string[], lang: string) => {
    if (lang === JAVASCRIPT) {
      const inputData = inputs.map((input, index) => {
        const isLast = index === inputs.length - 1;
        return `        "${input}": "${getNode(input)?.data.content || ''}"${isLast ? '' : ','} `;
      });
      return inputData.join('\n');
    } else {
      const inputData = inputs.map((input, index) => {
        const isLast = index === inputs.length - 1;
        return `     "${input}": "${(getNode(input)?.data.content as string)?.trim() || ''}"${isLast ? '' : ','}`;
      });
      return inputData.join('\n');
    }
  };

  // 生成示例代码
  const populatetext = (api_id: string, api_key: string, language: string): string => {
    const py = `import requests

api_url = "${API_SERVER_URL}/execute_workflow/${api_id}"
api_key = "${api_key}"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
${input_text_gen(selectedInputs, PYTHON)}
}

response = requests.post(api_url, headers=headers, json=data)

if response.status_code == 200:
    print("Results:", response.json())
else:
    print("Error:", response.status_code, response.json())`;

    const sh = `curl -X POST "${API_SERVER_URL}/execute_workflow/${api_id}" \\
-H "Authorization: Bearer ${api_key}" \\
-H "Content-Type: application/json" \\
-d '{
${input_text_gen(selectedInputs, SHELL)}
}'`;

    const js = `const axios = require('axios');

const apiUrl = "${API_SERVER_URL}/execute_workflow/${api_id}";

const data = {
${input_text_gen(selectedInputs, JAVASCRIPT)}
};

axios.post(apiUrl, data, {
    headers: {
        "Authorization": "Bearer ${api_key}",
        "Content-Type": "application/json"
    }
})
.then(response => {
    console.log("Results:", response.data);
})
.catch(error => {
    if (error.response) {
        console.error("Error:", error.response.status, error.response.data);
    } else {
        console.error("Error:", error.message);
    }
});`;

    if (language === PYTHON) return py;
    if (language === SHELL) return sh;
    return js;
  };

  // 复制到剪贴板
  const copyToClipboard = () => {
    const codeToCopy = populatetext(
      currentApi?.api_id || "",
      currentApi?.api_key || "",
      selectedLang
    );
    navigator.clipboard.writeText(codeToCopy)
      .then(() => {
        const copyButton = document.getElementById('copy-button');
        if (copyButton) {
          copyButton.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Copied!</span>
          `;
          setTimeout(() => {
            copyButton.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5H6C4.89543 5 4 5.89543 4 7V19C4 20.1046 4.89543 21 6 21H16C17.1046 21 18 20.1046 18 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <rect x="8" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        }
      })
      .catch(err => {
        console.error('复制失败: ', err);
      });
  };

  return (
    <div className="py-[16px] px-[16px] max-h-[80vh] overflow-y-auto">
      {/* 头部导航 */}
      <div className="flex items-center mb-4">
        <button
          className="mr-2 p-1 rounded-full hover:bg-[#2A2A2A]"
          onClick={() => setActivePanel(null)}
        >
          <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-[#CDCDCD] text-[16px]">Deploy as API</h2>
      </div>

      {/* 输入输出节点选择区域 */}
      <div className="grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]">
        {/* 输入节点区域 */}
        <div className="p-4 bg-[#1A1A1A]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Inputs</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center gap-1">
                <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#3B9BFF]/30 hover:border-[#3B9BFF]/50 transition-colors cursor-help" title="Text Block">
                  <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#3B9BFF]">
                    <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help" title="Structured Block">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#9B7EDB]">
                    <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                    <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                    <path d="M9 9H11V11H9V9Z" className="fill-current" />
                    <path d="M9 13H11V15H9V13Z" className="fill-current" />
                    <path d="M13 9H15V11H13V9Z" className="fill-current" />
                    <path d="M13 13H15V15H13V13Z" className="fill-current" />
                  </svg>
                </div>
              </div>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isInput === true)
              .map(node => {
                const isSelected = selectedInputs.includes(node.id);
                const nodeType = node.type || 'text';

                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                  }
                };

                const nodeIcons = {
                  text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  structured: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                      <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                      <path d="M9 9H11V11H9V9Z" className="fill-current" />
                      <path d="M9 13H11V15H9V13Z" className="fill-current" />
                      <path d="M13 9H15V11H13V9Z" className="fill-current" />
                      <path d="M13 13H15V15H13V13Z" className="fill-current" />
                    </svg>
                  )
                };

                return (
                  <div
                    key={node.id}
                    className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                      isSelected
                        ? colorClasses[nodeType as keyof typeof colorClasses]?.active || colorClasses.text.active
                        : colorClasses[nodeType as keyof typeof colorClasses]?.default || colorClasses.text.default
                    }`}
                    onClick={() => handleInputClick(node)}
                  >
                    {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                    <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                    {isSelected && (
                      <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}

            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isInput === true)
              .length === 0 && (
                <div className="text-[12px] text-[#808080] py-2 text-center">
                  No input nodes available. Create input nodes in your workflow.
                </div>
              )}
          </div>
        </div>

        {/* 输出节点区域 */}
        <div className="p-4 bg-[#1A1A1A] border-l border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Outputs</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center gap-1">
                <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#3B9BFF]/30 hover:border-[#3B9BFF]/50 transition-colors cursor-help" title="Text Block">
                  <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#3B9BFF]">
                    <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help" title="Structured Block">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#9B7EDB]">
                    <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                    <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                    <path d="M9 9H11V11H9V9Z" className="fill-current" />
                    <path d="M9 13H11V15H9V13Z" className="fill-current" />
                    <path d="M13 9H15V11H13V9Z" className="fill-current" />
                    <path d="M13 13H15V15H13V13Z" className="fill-current" />
                  </svg>
                </div>
              </div>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isOutput === true)
              .map((node) => {
                const isSelected = selectedOutputs.includes(node.id);
                const nodeType = node.type || 'text';

                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                  }
                };

                const nodeIcons = {
                  text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  structured: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                      <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                      <path d="M9 9H11V11H9V9Z" className="fill-current" />
                      <path d="M9 13H11V15H9V13Z" className="fill-current" />
                      <path d="M13 9H15V11H13V9Z" className="fill-current" />
                      <path d="M13 13H15V15H13V13Z" className="fill-current" />
                    </svg>
                  )
                };

                return (
                  <div
                    key={node.id}
                    className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                      isSelected
                        ? colorClasses[nodeType as keyof typeof colorClasses]?.active || colorClasses.text.active
                        : colorClasses[nodeType as keyof typeof colorClasses]?.default || colorClasses.text.default
                    }`}
                    onClick={() => handleOutputClick(node)}
                  >
                    {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                    <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                    {isSelected && (
                      <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}

            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isOutput === true)
              .length === 0 && (
                <div className="text-[12px] text-[#808080] py-2 text-center">
                  No output nodes available. Create output nodes in your workflow.
                </div>
              )}
          </div>
        </div>
      </div>

      {/* API 代码示例部分 - 仅在已部署时显示 */}
      {(isDeployed || showApiExample) && currentApi && (
        <div className="mt-6">
          <div className="bg-[#252525] border-[1px] border-[#404040] rounded-lg p-[10px] mb-[10px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    className="flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors"
                    onClick={() => setIsLangSelectorOpen(prev => !prev)}
                  >
                    {selectedLang === PYTHON && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 1c-3.1 0-2.9 1.35-2.9 1.35l.01 1.4h2.96v.42H2.65s-1.65.17-1.65 3.02c0 3.13 1.53 3.02 1.53 3.02h.9v-1.45s-.05-1.73 1.7-1.73h2.93s1.65.03 1.65-1.6V2.67S10.2 1 7 1zm-1.63.94c.29 0 .53.24.53.53 0 .3-.24.53-.53.53-.3 0-.53-.24-.53-.53 0-.29.24-.53.53-.53z" fill="#387EB8" />
                        <path d="M7 13c3.1 0 2.9-1.35 2.9-1.35l-.01-1.4H6.93v-.42h4.43s1.65.17 1.65-3.02c0-3.13-1.53-3.02-1.53-3.02h-.9v1.45s.05 1.73-1.7 1.73H5.95s-1.65-.03-1.65 1.6v2.67S3.8 13 7 13zm1.63-.94c-.29 0-.53-.24-.53-.53 0-.3.24-.53.53-.53.3 0 .53.24.53.53 0 .29-.24.53-.53.53z" fill="#FFE052" />
                      </svg>
                    )}
                    {selectedLang === JAVASCRIPT && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#F7DF1E]">
                        <path d="M0 0h24v24H0V0z" fill="#F7DF1E" />
                        <path d="M6.667 19.333l1.88-1.133c.363.64.693 1.183 1.486 1.183.76 0 1.24-.297 1.24-1.453v-7.863h2.307v7.893c0 2.387-1.4 3.477-3.447 3.477-1.847 0-2.917-.957-3.467-2.107M15.16 19.073l1.88-1.09c.493.807 1.14 1.403 2.28 1.403 1.057 0 1.6-.467 1.6-1.113 0-.774-.613-1.047-1.65-1.494l-.566-.243c-1.633-.693-2.717-1.563-2.717-3.403 0-1.693 1.29-2.983 3.307-2.983 1.433 0 2.463.5 3.207 1.807l-1.757 1.127c-.387-.693-.803-.967-1.45-.967-.66 0-1.08.42-1.08.967 0 .677.42.95 1.387 1.367l.566.243c1.923.823 3.007 1.66 3.007 3.547 0 2.033-1.597 3.15-3.743 3.15-2.1 0-3.457-.997-4.12-2.317" fill="#0D0D0D" />
                      </svg>
                    )}
                    {selectedLang === SHELL && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#4EAA25]">
                        <path d="M21.5 4.5H2.5V19.5H21.5V4.5Z" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M5 8L8 11L5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 16H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                    <span>{selectedLang}</span>
                    <svg className="w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>

                  {isLangSelectorOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-[#2A2A2A] border border-[#404040] rounded-md shadow-lg overflow-hidden">
                      {[PYTHON, JAVASCRIPT, SHELL].map((lang) => (
                        <div
                          key={lang}
                          className={`px-3 py-2 text-[13px] cursor-pointer transition-colors flex items-center gap-2 ${
                            selectedLang === lang
                              ? 'bg-[#3B9BFF]/20 text-[#3B9BFF]'
                              : 'text-[#CDCDCD] hover:bg-[#333333]'
                          }`}
                          onClick={() => {
                            setSelectedLang(lang);
                            setIsLangSelectorOpen(false);
                          }}
                        >
                          {lang === PYTHON && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M7 1c-3.1 0-2.9 1.35-2.9 1.35l.01 1.4h2.96v.42H2.65s-1.65.17-1.65 3.02c0 3.13 1.53 3.02 1.53 3.02h.9v-1.45s-.05-1.73 1.7-1.73h2.93s1.65.03 1.65-1.6V2.67S10.2 1 7 1zm-1.63.94c.29 0 .53.24.53.53 0 .3-.24.53-.53.53-.3 0-.53-.24-.53-.53 0-.29.24-.53.53-.53z" fill="#387EB8" />
                              <path d="M7 13c3.1 0 2.9-1.35 2.9-1.35l-.01-1.4H6.93v-.42h4.43s1.65.17 1.65-3.02c0-3.13-1.53-3.02-1.53-3.02h-.9v1.45s.05 1.73-1.7 1.73H5.95s-1.65-.03-1.65 1.6v2.67S3.8 13 7 13zm1.63-.94c-.29 0-.53-.24-.53-.53 0-.3.24-.53.53-.53.3 0 .53.24.53.53 0 .29-.24.53-.53.53z" fill="#FFE052" />
                            </svg>
                          )}
                          {lang === JAVASCRIPT && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#F7DF1E]">
                              <path d="M0 0h24v24H0V0z" fill="#F7DF1E" />
                              <path d="M6.667 19.333l1.88-1.133c.363.64.693 1.183 1.486 1.183.76 0 1.24-.297 1.24-1.453v-7.863h2.307v7.893c0 2.387-1.4 3.477-3.447 3.477-1.847 0-2.917-.957-3.467-2.107M15.16 19.073l1.88-1.09c.493.807 1.14 1.403 2.28 1.403 1.057 0 1.6-.467 1.6-1.113 0-.774-.613-1.047-1.65-1.494l-.566-.243c-1.633-.693-2.717-1.563-2.717-3.403 0-1.693 1.29-2.983 3.307-2.983 1.433 0 2.463.5 3.207 1.807l-1.757 1.127c-.387-.693-.803-.967-1.45-.967-.66 0-1.08.42-1.08.967 0 .677.42.95 1.387 1.367l.566.243c1.923.823 3.007 1.66 3.007 3.547 0 2.033-1.597 3.15-3.743 3.15-2.1 0-3.457-.997-4.12-2.317" fill="#0D0D0D" />
                            </svg>
                          )}
                          {lang === SHELL && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#4EAA25]">
                              <path d="M21.5 4.5H2.5V19.5H21.5V4.5Z" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M5 8L8 11L5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M10 16H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {lang}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                id="copy-button"
                onClick={copyToClipboard}
                className="flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5H6C4.89543 5 4 5.89543 4 7V19C4 20.1046 4.89543 21 6 21H16C17.1046 21 18 20.1046 18 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <rect x="8" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span>Copy</span>
              </button>
            </div>

            <div className="relative flex border-none rounded-[8px] cursor-pointer bg-[#1C1D1F] overflow-hidden">
              <div className="flex-grow overflow-hidden">
                <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: '300px', position: 'relative' }}>
                  <pre
                    className="text-[#CDCDCD] text-[12px] p-4 whitespace-pre"
                    style={{
                      minWidth: '100%',
                      tabSize: 2,
                      fontFamily: '"JetBrains Mono", Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
                      letterSpacing: '-0.03em',
                      lineHeight: '1.4'
                    }}
                  >
                    {populatetext(
                      currentApi?.api_id || "",
                      currentApi?.api_key || "",
                      selectedLang
                    )}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* API 详情部分 */}
          <div className="mt-4 py-3 px-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
            <div className="flex justify-between items-start">
              <span className="text-[14px] text-[#CDCDCD] font-medium">API Details</span>
            </div>

            <div className="mt-2 space-y-3">
              <div>
                <label className="text-[12px] text-[#808080]">API Endpoint:</label>
                <code className="block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                  {currentApi?.endpoint || `${API_SERVER_URL}/execute_workflow/${currentApi?.api_id || 'example'}`}
                </code>
              </div>

              <div>
                <label className="text-[12px] text-[#808080]">API ID:</label>
                <code className="block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                  {currentApi?.api_id || 'api_xxxxxxxxxxxx'}
                </code>
              </div>

              <div>
                <label className="text-[12px] text-[#808080]">API Key:</label>
                <div className="flex items-start">
                  <div className="px-3 py-2 flex-grow bg-[#252525] rounded-md text-[12px] text-[#CDCDCD] font-mono overflow-x-auto">
                    {currentApi?.api_key || 'sk_xxxxxxxxxxxx'}
                  </div>
                  <button
                    className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                    onClick={() => {
                      navigator.clipboard.writeText(currentApi?.api_key || '');
                    }}
                  >
                    <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                      <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[12px] text-[#808080] mt-3">
              Reference the example above to make API calls to your endpoint
            </p>
          </div>
        </div>
      )}

      {/* 部署按钮区域 */}
      <div className="pt-6 border-t border-[#404040]">
        <div className="flex flex-col items-center text-center">
          <div className="flex flex-col w-full items-center gap-4">
            {!isDeployed && (
              <>
                {!(selectedInputs?.length > 0 && selectedOutputs?.length > 0) ? (
                  <span className="text-[#808080] text-[13px]">
                    Please select input and output nodes first
                  </span>
                ) : (
                  <span className="text-[#808080] text-[13px]">
                    Congrats! Your API is ready to be deployed.
                  </span>
                )}
              </>
            )}

            {!isDeployed ? (
              <button
                className={`w-[210px] h-[48px] rounded-[8px] transition duration-200 
                  flex items-center justify-center gap-2
                  ${selectedInputs?.length > 0 && selectedOutputs?.length > 0
                    ? 'bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                    : 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#808080] cursor-not-allowed opacity-50'
                  }`}
                onClick={handleDeploy}
                disabled={!(selectedInputs?.length > 0 && selectedOutputs?.length > 0) || isDeploying}
              >
                {isDeploying ? (
                  <svg className="animate-spin h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
                {isDeploying ? "Deploying..." : "Deploy as API"}
              </button>
            ) : (
              <>

                <div className="w-full flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button
                      className="flex-1 h-[48px] rounded-[8px] transition duration-200 
                        flex items-center justify-center gap-2
                        bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105"
                      onClick={handleDeploy}
                      disabled={!(selectedInputs?.length > 0 && selectedOutputs?.length > 0) || isDeploying}
                    >
                      {isDeploying ? (
                        <svg className="animate-spin h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                        </svg>
                      )}
                      {isDeploying ? "Updating..." : "Deploy"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeployAsApi; 