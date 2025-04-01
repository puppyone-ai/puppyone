'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect, useRef } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'
import { useReactFlow } from '@xyflow/react'
import { useFlowsPerUserContext } from '../../states/FlowsPerUserContext'
import { SYSTEM_URLS } from '@/config/urls'

import DeployAsApi from './deployMenu/DeployAsApi'
import DeployAsChatbot from './deployMenu/DeployAsChatbot'
import Dashboard from './deployMenu/Dashboard'

function DeployBotton() {
  const { setWorkspaces, selectedFlowId, workspaces } = useFlowsPerUserContext()
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE
  const { constructWholeWorkflowJsonData } = useWholeWorkflowJsonConstructUtils()
  const { getNodes } = useReactFlow()

  const [selectedInputs, setSelectedInputs] = useState<any[]>([])
  const [selectedOutputs, setSelectedOutputs] = useState<any[]>([])
  const [hovered, setHovered] = useState(false)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  
  // List of deployment options
  const deploymentOptions = [
    { 
      id: 'api', 
      label: 'Deploy as API', 
      description: 'Create an API endpoint from your workflow',
      icon: (
        <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )
    },
    { 
      id: 'chatbot', 
      label: 'Deploy as Chatbot', 
      description: 'Create a conversational interface',
      icon: (
        <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
        </svg>
      )
    },
    { 
      id: 'dashboard', 
      label: 'Deploy as Dashboard', 
      description: 'Create a visual dashboard', 
      disabled: true,
      icon: (
        <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
          <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
        </svg>
      )
    },
  ];

  interface ApiConfig {
    id: string;
    key: string;
  }

  const [apiConfig, setApiConfig] = useState<ApiConfig | undefined>(undefined)

  const lastSelectedFlowIdRef = useRef<string | null>(null);
  const initializedRef = useRef<boolean>(false);

  // 状态管理
  const [selectedNodes, setSelectedNodes] = useState<{ [key: string]: string }>({
    input: '',
    output: ''
  });

  const [nodeOptionsByType, setNodeOptionsByType] = useState<{ [key: string]: any[] }>({
    input: [],
    output: []
  });

  // 初始化选择所有节点
  const initializeNodeSelections = () => {
    // 获取所有输入节点并设置为选中
    const allInputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isInput === true)
      .map(node => ({ id: node.id, label: node.data.label }))
    
    // 获取所有输出节点并设置为选中  
    const allOutputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isOutput === true)
      .map(node => ({ id: node.id, label: node.data.label }))
    
    // 设置选中的输入和输出节点
    setSelectedInputs(allInputNodes)
    setSelectedOutputs(allOutputNodes)
  }

  useEffect(() => {
    if (lastSelectedFlowIdRef.current !== selectedFlowId) {
      console.log("Workflow has changed")
      lastSelectedFlowIdRef.current = selectedFlowId
      
      // 检查当前工作流是否已有保存的选择
      const currentWorkspace = workspaces.find(w => w.flowId === selectedFlowId)
      
      if (currentWorkspace?.deploy?.selectedInputs && currentWorkspace?.deploy?.selectedOutputs) {
        // 有保存的选择，使用保存的选择
        setSelectedInputs(currentWorkspace.deploy.selectedInputs)
        setSelectedOutputs(currentWorkspace.deploy.selectedOutputs)
        setApiConfig(currentWorkspace.deploy.apiConfig)
      } else {
        // 没有保存的选择，初始化所有节点为选中
        initializeNodeSelections()
      }
    }
  }, [selectedFlowId, getNodes])

  // 组件加载后自动选择所有节点
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      
      // 如果当前工作流没有保存的选择，初始化所有节点为选中
      const currentWorkspace = workspaces.find(w => w.flowId === selectedFlowId)
      if (!currentWorkspace?.deploy?.selectedInputs || !currentWorkspace?.deploy?.selectedOutputs) {
        initializeNodeSelections()
      }
    }
  }, [])

  // 更新节点选项
  useEffect(() => {
    // 获取输入节点选项
    const inputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isInput === true)
      .map(node => ({ id: node.id, data: { label: node.data.label } }));
    
    // 获取输出节点选项
    const outputNodes = getNodes()
      .filter((item) => (item.type === 'text' || item.type === 'structured'))
      .filter(item => item.data?.isOutput === true)
      .map(node => ({ id: node.id, data: { label: node.data.label } }));
    
    // 更新节点选项状态
    setNodeOptionsByType({
      input: inputNodes,
      output: outputNodes
    });
  }, [getNodes, selectedFlowId]);

  // 保存部署配置到工作区
  useEffect(() => {
    if (selectedFlowId && (selectedInputs.length > 0 || selectedOutputs.length > 0 || apiConfig)) {
      const updatedWorkspaces = workspaces.map(workspace => {
        if (workspace.flowId === selectedFlowId) {
          return {
            ...workspace,
            deploy: {
              selectedInputs,
              selectedOutputs,
              apiConfig
            }
          };
        }
        return workspace;
      });
      
      setWorkspaces(updatedWorkspaces);
    }
  }, [selectedInputs, selectedOutputs, apiConfig, selectedFlowId]);

  // 部署API的核心函数
  const handleDeploy = async () => {
    try {
      const res = await fetch(
        API_SERVER_URL + "/config_api",
        {
          method: "POST",
          body: JSON.stringify({
            workflow_json: constructWholeWorkflowJsonData(),
            inputs: selectedInputs.map(item => item.id),
            outputs: selectedOutputs.map(item => item.id),
          })
        }
      )

      const content = await res.json();

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }

      const { api_id, api_key } = content
      setApiConfig({ id: api_id, key: api_key })
      console.log(api_id, api_key)
    } catch (error) {
      console.error(error);
    }
  }

  // 语言选项常量
  const PYTHON = "python"
  const SHELL = "shell"
  const JAVASCRIPT = "javascript"
  const languageOptions = [PYTHON, SHELL, JAVASCRIPT];
  const [selectedLang, setSelectedLang] = useState(SHELL)
  const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false)

  // API部署专用状态
  const [apiInputs, setApiInputs] = useState<any[]>([]);
  const [apiOutputs, setApiOutputs] = useState<any[]>([]);

  // 渲染选择的面板
  const renderActivePanel = () => {
    switch (activePanel) {
      case 'api':
        return (
          <DeployAsApi
            selectedInputs={selectedInputs}
            selectedOutputs={selectedOutputs}
            setSelectedInputs={setSelectedInputs}
            setSelectedOutputs={setSelectedOutputs}
            apiConfig={apiConfig || { id: "", key: "" }}
            setActivePanel={setActivePanel}
            selectedNodes={selectedNodes}
            nodeOptionsByType={nodeOptionsByType}
            selectedLanguage={selectedLang}
            handleLanguageSelect={setSelectedLang}
            languageOptions={languageOptions}
            languageDropdownOpen={isLangSelectorOpen}
            setLanguageDropdownOpen={setIsLangSelectorOpen}
            handleDeploy={handleDeploy}
          />
        );
      case 'chatbot':
        return (
          <DeployAsChatbot
            selectedInputs={selectedInputs}
            selectedOutputs={selectedOutputs}
            setSelectedInputs={setSelectedInputs}
            setSelectedOutputs={setSelectedOutputs}
            setActivePanel={setActivePanel}
            handleDeploy={handleDeploy}
          />
        );
      case 'dashboard':
        return (
          <Dashboard
            setActivePanel={setActivePanel}
          />
        );
      default:
        return (
          <div className="py-[16px] px-[16px]">
            <h2 className="text-[#CDCDCD] text-[16px] mb-4">Deployment Options</h2>
            <div className="space-y-3">
              {deploymentOptions.map((option) => (
                <div
                  key={option.id}
                  className={`p-3 bg-[#1E1E1E] border-[1px] border-[#404040] rounded-[8px] ${option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#2A2A2A]'} transition duration-200`}
                  onClick={() => !option.disabled && setActivePanel(option.id)}
                >
                  <div className="flex items-center">
                    <div className="mr-3 bg-[#2A2A2A] p-2 rounded-full">
                      {option.icon}
                    </div>
                    <div>
                      <h3 className="text-[#CDCDCD] text-[14px]">{option.label}</h3>
                      <p className="text-[#808080] text-[12px]">{option.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        );
    }
  };

  return (
    <Menu as="div" className="relative">
      <Menu.Button className={`flex flex-row items-center justify-center gap-[8px] px-[10px] h-[36px] rounded-[8px] bg-[#252525] border-[1px] hover:bg-[#FFA73D] transition-colors border-[#3E3E41] group`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}>
        <svg width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="transition-[stroke]">
          <path className="transition-[fill]" d="M14.5 11L17.5 15H14.5V11Z" fill={hovered === true ? "#000" : "#FFA73D"} />
          <path className="transition-[fill]" d="M3.5 11V15H0.5L3.5 11Z" fill={hovered === true ? "#000" : "#FFA73D"} />
          <path className="transition-[fill]" fillRule="evenodd" clipRule="evenodd" d="M12.0049 5.19231C11.0095 2.30769 9.01893 0 9.01893 0C9.01893 0 7.02834 2.30769 6.03314 5.19231C4.79777 8.77308 5.03785 15 5.03785 15H13.0002C13.0002 15 13.2405 8.77298 12.0049 5.19231ZM9 6C7.89543 6 7 6.89543 7 8C7 9.10457 7.89543 10 9 10C10.1046 10 11 9.10457 11 8C11 6.89543 10.1046 6 9 6Z" fill={hovered === true ? "#000" : "#FFA73D"} />
        </svg>
        <div className={`text-[14px] font-normal leading-normal transition-colors ${hovered === true ? "text-[#000]" : "text-[#FFA73D]"}`}>Deploy</div>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 translate-y-[-10px]"
        enterTo="transform opacity-100 translate-y-0"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 translate-y-0"
        leaveTo="transform opacity-0 translate-y-[-10px]"
      >
        <Menu.Items className="absolute right-0 mt-[16px] w-[360px] origin-top-right rounded-2xl bg-[#1E1E1E] shadow-lg border border-[#404040] focus:outline-none">
          {renderActivePanel()}
        </Menu.Items>
      </Transition>
    </Menu>
  )
}

export default DeployBotton