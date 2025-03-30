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
    { id: 'api', label: 'Deploy as API', description: 'Create an API endpoint from your workflow' },
    { id: 'chatbot', label: 'Deploy as Chatbot', description: 'Create a conversational interface', disabled: true },
    { id: 'dashboard', label: 'Deploy as Dashboard', description: 'Create a visual dashboard', disabled: true },
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
          {activePanel === null ? (
            // Show deployment options when no panel is active
            <div className="py-[16px] px-[16px]">
              <h2 className="text-[#CDCDCD] text-[16px] font-medium mb-2">
                Deploy Your Project
              </h2>
              <p className="text-[#808080] text-[12px] mb-4">
                Choose how you want to deploy your workflow
              </p>
              
              <div className="space-y-2">
                {deploymentOptions.map((option) => (
                  <button
                    key={option.id}
                    className={`w-full p-3 text-left rounded-lg border border-[#404040] ${
                      option.disabled 
                        ? 'opacity-60 cursor-not-allowed' 
                        : 'hover:bg-[#2A2A2A] cursor-pointer'
                    }`}
                    onClick={() => !option.disabled && setActivePanel(option.id)}
                    disabled={option.disabled}
                  >
                    <div className="flex items-center">
                      {option.id === 'api' && (
                        <svg className="w-5 h-5 mr-2" fill="#FFA73D" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      )}
                      {option.id === 'chatbot' && (
                        <svg className="w-5 h-5 mr-2" fill="#FFA73D" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                        </svg>
                      )}
                      {option.id === 'dashboard' && (
                        <svg className="w-5 h-5 mr-2" fill="#FFA73D" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm9 4a1 1 0 10-2 0v6a1 1 0 102 0V7zm-3 2a1 1 0 10-2 0v4a1 1 0 102 0V9zm-3 3a1 1 0 10-2 0v1a1 1 0 102 0v-1z" clipRule="evenodd" />
                        </svg>
                      )}
                      <div>
                        <h3 className="text-[14px] text-[#CDCDCD] font-medium">{option.label}</h3>
                        <p className="text-[12px] text-[#808080]">{option.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : activePanel === 'api' ? (
            <div className="py-[16px] px-[16px]">
              <div className="flex items-center mb-[8px]">
                <button 
                  className="mr-2 p-[1px] rounded-full hover:bg-[#2A2A2A]"
                  onClick={() => setActivePanel(null)}
                >
                  <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <h2 className="text-[#CDCDCD] text-[16px] mb-0">
                  Deploy as API
                </h2>
              </div>
              <p className="text-[#808080] text-[12px] mb-8">
                Host this project by PuppyAgent
              </p>
              
              {/* 两列布局 */}
              <div className="grid grid-cols-2 gap-8 mb-8 relative">
                {/* Left column */}
                <div className="px-[8px]">
                  <h3 className="text-[#CDCDCD] text-[14px] mb-4 flex items-center justify-between">
                    <span>Inputs</span>
                    <span className="text-[12px] text-[#808080]">{selectedInputs?.length || 0} selected</span>
                  </h3>
                  
                  <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
                    {/* 可用输入节点列表 */}
                    {getNodes()
                      .filter((item) => (item.type === 'text' || item.type === 'structured'))
                      .filter(item => item.data?.isInput === true)
                      .map(node => {
                        const isSelected = selectedInputs?.some(item => item.id === node.id);
                        const nodeType = node.type || 'text'; // 默认为 text 类型
                        
                        // 为不同类型的节点定义颜色
                        const colorClasses = {
                          text: {
                            active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                          },
                          file: {
                            active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                          },
                          structured: {
                            active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                          }
                        };
                        
                        // 为不同类型的节点定义图标
                        const nodeIcons = {
                          text: (
                            <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                              <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                              <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                              <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          ),
                          file: (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                              <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                              <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
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
                            onClick={() => {
                              if (isSelected) {
                                setSelectedInputs(prev => prev.filter(el => el.id !== node.id));
                              } else {
                                setSelectedInputs(prev => {
                                  return prev?.length === 0 
                                    ? [{ id: node.id, label: node.data.label }] 
                                    : [...prev, { id: node.id, label: node.data.label }];
                                });
                              }
                            }}
                          >
                            {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                            <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                            
                            {isSelected && (
                              <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    
                    {/* 如果没有可用输入节点 */}
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

                {/* Divider */}
                <div className="absolute left-1/2 transform -translate-x-1/2 h-full flex items-center">
                  <div className="h-[85%] w-[1px] bg-[#404040]"></div>
                </div>

                {/* Right column */}
                <div className="px-[8px]">
                  <h3 className="text-[#CDCDCD] text-[14px] mb-4 flex items-center justify-between">
                    <span>Outputs</span>
                    <span className="text-[12px] text-[#808080]">{selectedOutputs?.length || 0} selected</span>
                  </h3>
                  
                  <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
                    {/* 可用输出节点列表 */}
                    {getNodes()
                      .filter((item) => (item.type === 'text' || item.type === 'structured'))
                      .filter(item => item.data?.isOutput === true)
                      .map(node => {
                        const isSelected = selectedOutputs?.some(item => item.id === node.id);
                        const nodeType = node.type || 'text'; // 默认为 text 类型
                        
                        // 为不同类型的节点定义颜色
                        const colorClasses = {
                          text: {
                            active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                          },
                          file: {
                            active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                          },
                          structured: {
                            active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                            default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                          }
                        };
                        
                        // 为不同类型的节点定义图标
                        const nodeIcons = {
                          text: (
                            <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                              <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                              <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                              <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          ),
                          file: (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                              <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                              <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
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
                            onClick={() => {
                              if (isSelected) {
                                setSelectedOutputs(prev => prev.filter(el => el.id !== node.id));
                              } else {
                                setSelectedOutputs(prev => {
                                  return prev?.length === 0 
                                    ? [{ id: node.id, label: node.data.label }] 
                                    : [...prev, { id: node.id, label: node.data.label }];
                                });
                              }
                            }}
                          >
                            {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                            <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                            
                            {isSelected && (
                              <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    
                    {/* 如果没有可用输出节点 */}
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

              {
                workspaces.filter((w) => w.flowId === selectedFlowId)[0].deploy?.apiConfig?.id ?
                  <>
                    {/* new codeblock */}
                    <div
                      className='bg-[#252525] border-[1px] border-[#404040] rounded-lg p-[10px] mb-[10px]'
                    >
                      <div
                        className='border-[1px] border-[#6D7177] text-[#6D7177] rounded-[4px] w-fit fit-content text-[12px] pr-[3px] pl-[3px] cursor-pointer'
                        onClick={() => {
                          setIsLangSelectorOpen(
                            prev => !prev
                          )
                        }}
                      >{selectedLang}</div>
                      <LanguageDropdown
                        isOpen={isLangSelectorOpen}
                        setIsOpen={setIsLangSelectorOpen}
                        options={[SHELL, PYTHON, JAVASCRIPT]}
                        onSelect={setSelectedLang}
                      />

                      <div className={`relative flex flex-col border-none rounded-[8px] cursor-pointer pl-[2px] pt-[8px] mt-[8px] bg-[#1C1D1F]`}>
                        <Editor
                          className='json-form hideLineNumbers rounded-[200px]'
                          defaultLanguage="json"
                          language={selectedLang}
                          value={populatetext(workspaces.filter((w) => w.flowId === selectedFlowId)[0].deploy.apiConfig.id, workspaces.filter((w) => w.flowId === selectedFlowId)[0].deploy.apiConfig.key, selectedLang)}
                          width={260}
                          height={200}
                          options={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontLigatures: true,
                            minimap: { enabled: false },
                            scrollbar: {
                              useShadows: false,
                              horizontal: 'hidden',
                              horizontalScrollbarSize: 0
                            },
                            fontSize: 10,
                            fontWeight: 'normal',
                            lineHeight: 15,
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            fixedOverflowWidgets: true,
                            acceptSuggestionOnEnter: "on",
                            overviewRulerLanes: 0,
                            lineNumbersMinChars: 3,
                            glyphMargin: false,
                            lineDecorationsWidth: 0,
                            readOnly: true
                          }}
                        />
                      </div>
                    </div>
                  </> : <></>
              }

              {/* Export API 按钮 */}
              <div className="flex justify-center">
                <button className="h-[36px] w-[100px] text-[14px] bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] text-[#CDCDCD] hover:bg-[#363636] transition duration-200 flex items-center justify-center"
                  onClick={handleDeploy}
                >
                  Export API
                </button>
              </div>
            </div>
          ) : (
            <div className="py-[16px] px-[16px]">
              <div className="flex items-center mb-4">
                <button 
                  className="mr-2 p-1 rounded-full hover:bg-[#2A2A2A]"
                  onClick={() => setActivePanel(null)}
                >
                  <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <h2 className="text-[#CDCDCD] text-[16px]">
                  {deploymentOptions.find(opt => opt.id === activePanel)?.label}
                </h2>
              </div>
              <div className="flex flex-col items-center justify-center py-8">
                <svg className="w-12 h-12 mb-4" fill="#808080" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                <p className="text-[#808080] text-center">This feature is coming soon!</p>
              </div>
            </div>
          )}
        </Menu.Items>
      </Transition>
    </Menu>
  )
}

export default DeployBotton