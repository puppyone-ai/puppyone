'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useFlowsPerUserContext } from '../../states/FlowsPerUserContext'
import { SYSTEM_URLS } from '@/config/urls'
import { DeployPanelProvider } from '../../states/DeployPanelContext'

import DeployAsApi from './deployMenu/DeployAsApi'
import DeployAsChatbot from './deployMenu/DeployAsChatbotNew'
import Dashboard from './deployMenu/Dashboard'

function DeployBotton() {
  const { setWorkspaces, selectedFlowId, workspaces } = useFlowsPerUserContext()
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE
  const { getNodes } = useReactFlow()

  // 仅保留顶层菜单所需的状态
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

  // 渲染选择的面板
  const renderActivePanel = () => {
    switch (activePanel) {
      case 'api':
        return (
          <DeployAsApi
            selectedFlowId={selectedFlowId}
            workspaces={workspaces}
            setWorkspaces={setWorkspaces}
            API_SERVER_URL={API_SERVER_URL}
            setActivePanel={setActivePanel}
          />
        );
      case 'chatbot':
        return (
          <DeployAsChatbot
            selectedFlowId={selectedFlowId}
            workspaces={workspaces}
            setWorkspaces={setWorkspaces}
            API_SERVER_URL={API_SERVER_URL}
            setActivePanel={setActivePanel}
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

export default function DeployBottonWrapper() {
  const { selectedFlowId, workspaces, setWorkspaces } = useFlowsPerUserContext();
  
  return (
    <DeployPanelProvider 
      flowId={selectedFlowId} 
      workspaces={workspaces}
      setWorkspaces={setWorkspaces}
    >
      <DeployBotton />
    </DeployPanelProvider>
  );
}