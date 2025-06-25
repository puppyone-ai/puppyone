'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useWorkspaces } from '../../states/UserWorkspacesContext'
import { SYSTEM_URLS } from '@/config/urls'
import { useServers } from '../../states/UserServersContext'
import { useServerOperations } from '../../hooks/useServerManagement'

import DeployAsApi from './deployMenu/AddApiServer'
import DeployAsChatbot from './deployMenu/AddChatbotServer'
import Canva from './deployMenu/Canva'
import DeployedApiDetail from './deployMenu/DeployedApiDetail'
import DeployedChatbotDetail from './deployMenu/DeployedChatbotDetail'


function DeployBotton() {
  const { setWorkspaces, showingItem, workspaces } = useWorkspaces()
  const selectedFlowId = showingItem?.type === 'workspace' ? showingItem.id : null
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE

  // 仅保留顶层菜单所需的状态
  const [hovered, setHovered] = useState(false)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  
  // 🔄 修改：直接从 UserServersContext 同步获取服务数据
  const { 
    getServicesByWorkspace, 
    globalServices,
    fetchWorkspaceServices,
  } = useServers();

  // 🔄 修改：同步获取当前工作区的服务
  const workspaceServices = selectedFlowId ? getServicesByWorkspace(selectedFlowId) : { apis: [], chatbots: [] };
  const { apis, chatbots } = workspaceServices;

  // 使用ServerOperations获取实际的删除API方法
  const { deleteApiService, deleteChatbotService } = useServerOperations();
  
  // 使用UserServersContext的本地状态管理方法
  const { removeApiService, removeChatbotService } = useServers();

  // 转换为原有格式以保持兼容性
  const deployedServices = {
    apis: apis.map(api => ({
      api_id: api.api_id,
      api_key: api.api_key,
      endpoint: api.endpoint,
      created_at: api.created_at,
      workspace_id: api.workspace_id,
      inputs: api.inputs,
      outputs: api.outputs
    })),
    chatbots: chatbots.map(chatbot => ({
      chatbot_id: chatbot.chatbot_id,
      chatbot_key: chatbot.chatbot_key,
      endpoint: chatbot.endpoint,
      created_at: chatbot.created_at,
      workspace_id: chatbot.workspace_id,
      input: chatbot.input,
      output: chatbot.output,
      history: chatbot.history,
      multi_turn_enabled: chatbot.multi_turn_enabled,
      welcome_message: chatbot.welcome_message
    })),
  };

  // 添加刷新状态
  const [isRefreshing, setIsRefreshing] = useState(false);

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
      id: 'canva', 
      label: 'Deploy as Canva', 
      description: 'Create a visual canva', 
      disabled: true,
      icon: (
        <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
          <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
        </svg>
      )
    },
  ];

  // 处理删除API - 修复：先调用实际的API删除，再更新本地状态
  const handleDeleteApi = async (apiId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // 防止触发父元素的点击事件
    try {
      // 1. 先调用实际的API删除服务器端的服务
      await deleteApiService(apiId);
      
      // 2. 删除成功后，更新本地状态
      removeApiService(apiId);
      
      console.log(`✅ API ${apiId} deleted successfully from both server and local state`);
    } catch (error) {
      console.error("Failed to delete API:", error);
      // 如果服务器删除失败，不更新本地状态，保持数据一致性
    }
  };

  // 处理删除Chatbot - 修复：先调用实际的API删除，再更新本地状态
  const handleDeleteChatbot = async (chatbotId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // 防止触发父元素的点击事件
    try {
      // 1. 先调用实际的API删除服务器端的服务
      await deleteChatbotService(chatbotId);
      
      // 2. 删除成功后，更新本地状态
      removeChatbotService(chatbotId);
      
      console.log(`✅ Chatbot ${chatbotId} deleted successfully from both server and local state`);
    } catch (error) {
      console.error("Failed to delete chatbot:", error);
      // 如果服务器删除失败，不更新本地状态，保持数据一致性
    }
  };

  // 处理点击已部署服务的函数
  const handleDeployedServiceClick = (serviceType: 'api' | 'chatbot', serviceId: string) => {
    setActivePanel(`${serviceType}-detail-${serviceId}`);
  };

  // 处理刷新操作
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (selectedFlowId) {
        await fetchWorkspaceServices(selectedFlowId);  // 🔄 修改为调用工作区级别的刷新
      }
    } catch (error) {
      console.error("Failed to refresh deployed services:", error);
    } finally {
      // 确保至少显示500ms的加载状态，让用户看到反馈
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

  // 渲染选择的面板
  const renderActivePanel = () => {
    // 检查是否是详情页面
    if (activePanel?.startsWith('api-detail-')) {
      const apiId = activePanel.replace('api-detail-', '');
      const apiService = deployedServices.apis.find(api => api.api_id === apiId);
      
      if (apiService) {
        return (
          <DeployedApiDetail
            apiService={apiService}
            API_SERVER_URL={API_SERVER_URL}
            setActivePanel={setActivePanel}
            onDelete={() => handleDeleteApi(apiId, {} as React.MouseEvent)}
            selectedFlowId={selectedFlowId}
          />
        );
      }
    }
    
    if (activePanel?.startsWith('chatbot-detail-')) {
      const chatbotId = activePanel.replace('chatbot-detail-', '');
      const chatbotService = deployedServices.chatbots.find(chatbot => chatbot.chatbot_id === chatbotId);
      
      if (chatbotService) {
        return (
          <DeployedChatbotDetail
            chatbotId={chatbotId}
            API_SERVER_URL={API_SERVER_URL}
            setActivePanel={setActivePanel}
            onDelete={() => handleDeleteChatbot(chatbotId, {} as React.MouseEvent)}
            selectedFlowId={selectedFlowId}
          />
        );
      }
    }

    switch (activePanel) {
      case 'api':
        return (
          <DeployAsApi
            selectedFlowId={selectedFlowId}
            setActivePanel={setActivePanel}
          />
        );
      case 'chatbot':
        return (
          <DeployAsChatbot
            selectedFlowId={selectedFlowId}
            setActivePanel={setActivePanel}
          />
        );
      case 'canva':
        return (
          <Canva
            setActivePanel={setActivePanel}
          />
        );
      default:
        return (
          <div className="py-[16px] px-[16px]">
            
            {/* 无部署服务时的提示 - 移动到顶部 */}
            {deployedServices.apis.length === 0 && deployedServices.chatbots.length === 0 && (
              <div className="mb-6">
                <div className="text-center py-4">
                  <div className="text-[#808080] text-[12px]">
                    No deployed services yet
                  </div>
                  <div className="text-[#606060] text-[11px] mt-1">
                    Create your first deployment below
                  </div>
                </div>
              </div>
            )}

            {/* 已部署的服务列表 - 移动到顶部 */}
            {(deployedServices.apis.length > 0 || deployedServices.chatbots.length > 0) && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[#808080] text-[14px] font-normal">Deployed Services</h2>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={`p-1.5 rounded transition-all duration-200 ${
                      isRefreshing 
                        ? 'bg-[#2A2A2A] text-[#CDCDCD] cursor-not-allowed' 
                        : 'hover:bg-[#2A2A2A] text-[#808080] hover:text-[#CDCDCD] active:scale-95'
                    }`}
                    title={isRefreshing ? "Refreshing..." : "Refresh deployed services"}
                  >
                    <svg 
                      className={`w-4 h-4 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24" 
                      xmlns="http://www.w3.org/2000/svg"
                      style={isRefreshing ? { animationDirection: 'reverse' } : {}}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  
                  {/* API 服务列表 */}
                  {deployedServices.apis.map((api) => (
                    <div
                      key={api.api_id}
                      className="flex items-center gap-[12px] py-[12px] pl-[12px] pr-[8px] rounded-md border border-[#404040] transition-colors group cursor-pointer hover:bg-[#2A2A2A]"
                      onClick={() => handleDeployedServiceClick('api', api.api_id)}
                    >
                      {/* 服务类型图标 */}
                      <div className="w-6 h-6 rounded-md border border-[#60A5FA] flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-[#60A5FA]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </div>

                      {/* 服务信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[#CDCDCD] text-[11px] font-medium truncate group-hover:text-white">
                          {api.api_id.length > 12 ? `${api.api_id.substring(0, 12)}...` : api.api_id}
                        </div>
                        <div className="text-[9px] text-[#808080] truncate mt-[1px]">
                          API Service
                        </div>
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleDeleteApi(api.api_id, e)}
                        className="flex items-center justify-center w-[24px] h-[24px] text-[#E74C3C] rounded-[4px] hover:bg-[#E74C3C]/20 transition-colors duration-200 mr-[8px]"
                        title="Delete API"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {/* Chatbot 服务列表 */}
                  {deployedServices.chatbots.map((chatbot) => (
                    <div
                      key={chatbot.chatbot_id}
                      className="flex items-center gap-[12px] py-[12px] pl-[12px] pr-[8px] rounded-md border border-[#404040] transition-colors group cursor-pointer  hover:bg-[#2A2A2A]"
                      onClick={() => handleDeployedServiceClick('chatbot', chatbot.chatbot_id)}
                    >
                      {/* 服务类型图标 */}
                      <div className="w-6 h-6 rounded-md border border-[#A78BFA] flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-[#A78BFA]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                        </svg>
                      </div>

                      {/* 服务信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[#CDCDCD] text-[11px] font-medium truncate group-hover:text-white">
                          {chatbot.chatbot_id.length > 12 ? `${chatbot.chatbot_id.substring(0, 12)}...` : chatbot.chatbot_id}
                        </div>
                        <div className="text-[9px] text-[#808080] truncate mt-[1px]">
                          Chatbot Service
                        </div>
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleDeleteChatbot(chatbot.chatbot_id, e)}
                        className="flex items-center justify-center w-[24px] h-[24px] text-[#E74C3C] rounded-[4px] hover:bg-[#E74C3C]/20 transition-colors duration-200 mr-[8px]"
                        title="Delete Chatbot"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 新建部署选项 */}
            <div className={`${(deployedServices.apis.length > 0 || deployedServices.chatbots.length > 0) ? 'border-t border-[#404040] pt-4' : ''}`}>
              <h2 className="text-[#808080] text-[14px] font-normal mb-4">Create New Deployment</h2>
              <div className="space-y-2">
                {deploymentOptions.map((option) => (
                  <div
                    key={option.id}
                    className={`flex items-center gap-[12px] py-[12px] pl-[12px] pr-[8px] rounded-md border border-[#404040] transition-colors group cursor-pointer hover:bg-[#2A2A2A] ${option.disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
                    onClick={() => !option.disabled && setActivePanel(option.id)}
                  >
                    {/* 服务类型图标 */}
                    <div className={`w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 ${
                      option.id === 'api' 
                        ? 'border-[#606060]' 
                        : option.id === 'chatbot'
                        ? 'border-[#606060]'
                        : 'border-[#606060]'
                    }`}>
                      {option.id === 'api' ? (
                        <svg className="w-3 h-3 text-[#606060]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      ) : option.id === 'chatbot' ? (
                        <svg className="w-3 h-3 text-[#606060]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-[#606060]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                          <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
                        </svg>
                      )}
                    </div>

                    {/* 服务信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[#CDCDCD] text-[11px] font-medium truncate group-hover:text-white">
                        {option.label}
                      </div>
                      <div className="text-[9px] text-[#808080] truncate mt-[1px]">
                        {option.description}
                      </div>
                    </div>

                    {/* 右侧加号图标 */}
                    <div className="flex items-center justify-center w-[24px] h-[24px] text-[#606060] group-hover:text-[#CDCDCD] transition-colors duration-200 mr-[8px]">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
    }
  };


  return (
    <Menu as="div" className="relative">
      {({ open }) => {
        // 监听菜单打开状态
        if (open !== isMenuOpen) {
          setIsMenuOpen(open);
        }
        
        return (
          <>
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
          </>
        );
      }}
    </Menu>
  )
}

export default function DeployBottonWrapper() {
  const { showingItem, workspaces, setWorkspaces } = useWorkspaces();
  const selectedFlowId = showingItem?.type === 'workspace' ? showingItem.id : null;
  
  // 不再需要 DeployPanelProvider，直接返回组件
  return <DeployBotton />;
}