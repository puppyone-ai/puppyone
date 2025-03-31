'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect, useRef } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'
import { Button } from 'antd'
import { useReactFlow } from '@xyflow/react'
import { set } from 'lodash'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { useFlowsPerUserContext } from '../../states/FlowsPerUserContext'
import { SYSTEM_URLS } from '@/config/urls'

import dynamic from 'next/dynamic';
import type { EditorProps, OnMount, OnChange, } from "@monaco-editor/react";
import DeployAsApi from './deployMenu/DeployAsApi';
import DeployAsChatbot from './deployMenu/DeployAsChatbot';
import Dashboard from './deployMenu/Dashboard';

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false
});

const CustomDropdown = ({ options, onSelect, selectedValue, isOpen, setIsOpen }: any) => {

  const handleSelect = (nodeId: string, label: string) => {
    onSelect({ id: nodeId, label: label });
    setIsOpen(false); // Close dropdown after selection
  };

  // Inline styles
  const dropdownContainerStyle: React.CSSProperties = {
    position: 'relative',
    cursor: 'pointer',
  };

  const dropdownHeaderStyle = {
    padding: '8px',
    backgroundColor: '#333', // Background color
    color: 'white', // Text color
    border: '1px solid #6D7177', // Border color
    borderRadius: '4px', // Rounded corners
  };

  const dropdownListStyle: React.CSSProperties = {
    position: 'absolute',
    top: '150%',
    left: 0,
    right: 0,
    backgroundColor: 'black', // Background color for dropdown items
    border: '1px solid #6D7177', // Border color
    borderRadius: '4px', // Rounded corners
    zIndex: 1000, // Ensure dropdown is above other elements
    height: 'auto', // Max height for dropdown
    width: '100px',
    overflowY: 'auto', // Scroll if too many items
    overflowX: 'hidden',
    color: 'white'
  };

  const dropdownItemStyle = {
    padding: '8px',
    color: 'white', // Text color for items
    cursor: 'pointer',
  };

  return (
    <div className="relative">
      {isOpen ? (
        <ul className='absolute top-full right-0 w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col items-start justify-start z-50'>
          {options.map((node: any, index: number) => (
            <>
              <li
                key={node.id}
                className='w-full'
              >
                <button
                  className='px-[8px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'
                  onClick={() => handleSelect(node.id, node.data.label)}
                >
                  <span className="px-[4px]  bg-[#6D7177] rounded-[4px] font-semibold text-[12px] text-black">
                    {node.data.label || node.id}
                  </span>
                </button>
              </li>
            </>
          ))}
        </ul>
      ) : <></>}
    </div>
  );
};

const LanguageDropdown = ({ options, onSelect, isOpen, setIsOpen }: any) => {

  const handleSelect = (item: string) => {
    onSelect(item)
    setIsOpen(false); // Close dropdown after selection
  };

  return (
    <div className="relative">
      {isOpen ? (
        <ul className='absolute top-[5px] right-[140px] w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col items-start justify-start z-50'>
          {options.map((item: string) => (
            <>
              <li
                key={item}
                className='w-full'
              >
                <button
                  className='px-[8px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'
                  onClick={() => handleSelect(item)}
                >
                  <span className="px-[4px]  bg-[#6D7177] rounded-[4px] font-semibold text-[12px] text-black">
                    {item}
                  </span>
                </button>
              </li>
            </>
          ))}
        </ul>
      ) : <></>}
    </div>
  );
};

function DeployBotton() {

  const { setWorkspaces, selectedFlowId, workspaces } = useFlowsPerUserContext()

  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE
  const { constructWholeWorkflowJsonData } = useWholeWorkflowJsonConstructUtils()


  const [selectedInputs, setSelectedInputs] = useState<any[]>([])
  const [selectedOutputs, setSelectedOutputs] = useState<any[]>([])
  const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility
  const [isOutputOpen, setIsOutputOpen] = useState(false); // State to manage dropdown visibility

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

  // const [apiConfig, setApiConfig] = useState<ApiConfig>({id:"hello",key:"world"})   //uncomment this to test 
  const [apiConfig, setApiConfig] = useState<ApiConfig | undefined>(undefined)

  const { getNodes, getNode } = useReactFlow(); // Destructure getNodes from useReactFlow

  const lastSelectedFlowIdRef = useRef<string | null>(null); // Ref to track last selected flowId
  const initializedRef = useRef<boolean>(false); // Ref to track if we've initialized selections

  // 新增这些状态来解决未定义的问题
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
      lastSelectedFlowIdRef.current = selectedFlowId // Update the ref with the current flowId
      
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
      // 确保只执行一次初始化
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

      const { api_id: api_id, api_key: api_key } = content

      setApiConfig({ id: api_id, key: api_key })

      console.log(api_id, api_key)

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }
      // ...
    } catch (error) {
      console.error(error);
    }



  }

  const PYTHON = "python"
  const SHELL = "shell"
  const JAVASCRIPT = "javascript"

  const input_text_gen = (inputs: string[], lang: string) => {
    if (lang == JAVASCRIPT) {
      const inputData = inputs.map((input, index) => (
        `        "${input}": "${getNode(input)?.data.content}", //${getNode(input)?.data.label}`
      ));
      return inputData.join('\n')
    } else {
      const inputData = inputs.map(
        (input, index) => (
          `     #${getNode(input)?.data.label} \n` + `     "${input}":` + ((getNode(input)?.data.content as string)?.trim() || "\"\"") + `,`
        )
      );
      return inputData.join('\n')
    }
  }

  const populatetext = (api_id: string, api_key: string, language: string) => {

    const py =
      `import requests

api_url = "<${API_SERVER_URL}/execute_workflow/${api_id}>"

api_key = "${api_key}"

headers = {
    "Authorization": f"Bearer ${api_key}",
    "Content-Type": "application/json"
}

data = {
    "inputs": {
${input_text_gen(selectedInputs.map(item => item.id), PYTHON)}
    },
    "outputs": {
${input_text_gen(selectedOutputs.map(item => item.id), PYTHON)}
    }
}

response = requests.post(api_url, headers=headers, json=data)

if response.status_code == 200:
    print("Results:", response.json())
else:
    print("Error:", response.status_code, response.json())
`
    if (language === PYTHON) {
      return py
    }

    const sh =
      `curl -X POST "<${API_SERVER_URL}/execute_workflow/${api_id}>" \\
-H "Authorization: Bearer ${api_key}" \\
-H "Content-Type: application/json" \\
-d '{
    "inputs": {
${input_text_gen(selectedInputs.map(item => item.id), SHELL)}
    },
    "outputs"{
${input_text_gen(selectedOutputs.map(item => item.id), SHELL)}   
    }
}'
`

    if (language === SHELL) {
      return sh
    }

    const js = `const axios = require('axios');

const apiUrl = "<${API_SERVER_URL}/execute_workflow/${api_id}>";

const data = {
    "inputs": {
${input_text_gen(selectedInputs.map(item => item.id), JAVASCRIPT)}
    },
    "outputs"{
${input_text_gen(selectedOutputs.map(item => item.id), JAVASCRIPT)}   
    }
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
});
`
    if (language === JAVASCRIPT) {
      return js
    }


  }

  const [selectedLang, setSelectedLang] = useState(SHELL)

  const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false)

  // 添加语言选项常量
  const languageOptions = [PYTHON, SHELL, JAVASCRIPT];

  // 为API部署保留的状态
  const [apiInputs, setApiInputs] = useState<any[]>([]);
  const [apiOutputs, setApiOutputs] = useState<any[]>([]);

  // 渲染选择的面板
  const renderActivePanel = () => {
    switch (activePanel) {
      case 'api':
        return (
          <DeployAsApi
            selectedInputs={apiInputs}
            selectedOutputs={apiOutputs}
            setSelectedInputs={setApiInputs}
            setSelectedOutputs={setApiOutputs}
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
            selectedInputs={[]}  // 不再传递共享状态
            selectedOutputs={[]}
            setSelectedInputs={() => {}}  // 传递空函数
            setSelectedOutputs={() => {}}
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
                  className="p-3 bg-[#1E1E1E] border-[1px] border-[#404040] rounded-[8px] cursor-pointer hover:bg-[#2A2A2A] transition duration-200"
                  onClick={() => setActivePanel(option.id)}
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

            {/* Deploy as Chatbot Button */}
            <div className="flex justify-center mt-4">
              <button 
                className={`h-[36px] px-[16px] text-[14px] rounded-[8px] transition duration-200 flex items-center justify-center ${
                  selectedInputs?.length === 1 && selectedOutputs?.length === 1
                    ? 'bg-[#FFA73D] text-black hover:bg-[#FF9B20]'
                    : 'bg-[#2A2A2A] border-[1px] border-[#404040] text-[#808080] cursor-not-allowed'
                }`}
                disabled={!(selectedInputs?.length === 1 && selectedOutputs?.length === 1)}
                onClick={() => setActivePanel('chatbot')}
              >
                Deploy Chatbot
              </button>
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
          <path className="transition-[fill]" fill-rule="evenodd" clip-rule="evenodd" d="M12.0049 5.19231C11.0095 2.30769 9.01893 0 9.01893 0C9.01893 0 7.02834 2.30769 6.03314 5.19231C4.79777 8.77308 5.03785 15 5.03785 15H13.0002C13.0002 15 13.2405 8.77298 12.0049 5.19231ZM9 6C7.89543 6 7 6.89543 7 8C7 9.10457 7.89543 10 9 10C10.1046 10 11 9.10457 11 8C11 6.89543 10.1046 6 9 6Z" fill={hovered === true ? "#000" : "#FFA73D"} />
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