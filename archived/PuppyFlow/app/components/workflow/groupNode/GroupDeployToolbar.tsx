'use client';
import React, { useState } from 'react';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import { useServers } from '../../states/UserServersContext';
import { useServerOperations } from '../../hooks/useServerManagement';
import { SYSTEM_URLS } from '@/config/urls';

// Import deployment menu components
import DeployAsApi from './deployMenu/AddApiServer';
import DeployAsChatbot from './deployMenu/AddChatbotServer';
import DeployedApiDetail from './deployMenu/DeployedApiDetail';
import DeployedChatbotDetail from './deployMenu/DeployedChatbotDetail';

interface GroupDeployToolbarProps {
  groupNodeId: string;
  onClose?: () => void;
}

export function GroupDeployToolbar({
  groupNodeId,
  onClose,
}: GroupDeployToolbarProps) {
  const [activePanel, setActivePanel] = useState<string | null>('default');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get workspace context
  const { showingItem } = useWorkspaces();
  const selectedFlowId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // Get deployment services and management hooks
  const { getServicesByWorkspace, globalServices, fetchWorkspaceServices } =
    useServers();

  const { deleteApiService, deleteChatbotService } = useServerOperations();
  const { removeApiService, removeChatbotService } = useServers();
  const API_SERVER_URL = '/api/server';

  // Get workspace services
  const workspaceServices = selectedFlowId
    ? getServicesByWorkspace(selectedFlowId)
    : { apis: [], chatbots: [] };
  const { apis, chatbots } = workspaceServices;

  // Transform to match original format
  const deployedServices = {
    apis: apis.map(api => ({
      api_id: api.api_id,
      api_key: api.api_key,
      endpoint: api.endpoint,
      created_at: api.created_at,
      workspace_id: api.workspace_id,
      inputs: api.inputs,
      outputs: api.outputs,
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
      welcome_message: chatbot.welcome_message,
    })),
  };

  // List of deployment options - 移除canva选项
  const deploymentOptions = [
    {
      id: 'api',
      label: 'Deploy as API',
      description: 'Create an API endpoint from your workflow',
      icon: (
        <svg
          className='w-5 h-5'
          fill='#CDCDCD'
          viewBox='0 0 20 20'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            fillRule='evenodd'
            d='M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
            clipRule='evenodd'
          />
        </svg>
      ),
    },
    {
      id: 'chatbot',
      label: 'Deploy as Chatbot',
      description: 'Create a conversational interface',
      icon: (
        <svg
          className='w-5 h-5'
          fill='#CDCDCD'
          viewBox='0 0 20 20'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path d='M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z' />
          <path d='M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z' />
        </svg>
      ),
    },
  ];

  // Handle delete API
  const handleDeleteApi = async (apiId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await deleteApiService(apiId);
      removeApiService(apiId);
      console.log(
        `✅ API ${apiId} deleted successfully from both server and local state`
      );
    } catch (error) {
      console.error('Failed to delete API:', error);
    }
  };

  // Handle delete Chatbot
  const handleDeleteChatbot = async (
    chatbotId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    try {
      await deleteChatbotService(chatbotId);
      removeChatbotService(chatbotId);
      console.log(
        `✅ Chatbot ${chatbotId} deleted successfully from both server and local state`
      );
    } catch (error) {
      console.error('Failed to delete chatbot:', error);
    }
  };

  // Handle deployed service click
  const handleDeployedServiceClick = (
    serviceType: 'api' | 'chatbot',
    serviceId: string
  ) => {
    setActivePanel(`${serviceType}-detail-${serviceId}`);
  };

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (selectedFlowId) {
        await fetchWorkspaceServices(selectedFlowId);
      }
    } catch (error) {
      console.error('Failed to refresh deployed services:', error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

  // Render active panel
  const renderActivePanel = () => {
    // 检查是否是详情页面
    if (activePanel?.startsWith('api-detail-')) {
      const apiId = activePanel.replace('api-detail-', '');
      const apiService = deployedServices.apis.find(
        api => api.api_id === apiId
      );

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
      const chatbotService = deployedServices.chatbots.find(
        chatbot => chatbot.chatbot_id === chatbotId
      );

      if (chatbotService) {
        return (
          <DeployedChatbotDetail
            chatbotId={chatbotId}
            API_SERVER_URL={API_SERVER_URL}
            setActivePanel={setActivePanel}
            onDelete={() =>
              handleDeleteChatbot(chatbotId, {} as React.MouseEvent)
            }
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
            groupNodeId={groupNodeId}
            setActivePanel={setActivePanel}
          />
        );
      case 'chatbot':
        return (
          <DeployAsChatbot
            selectedFlowId={selectedFlowId}
            groupNodeId={groupNodeId}
            setActivePanel={setActivePanel}
          />
        );
      default:
        return (
          <div className='py-1 px-1'>
            {/* 无部署服务时的提示 */}
            {deployedServices.apis.length === 0 &&
              deployedServices.chatbots.length === 0 && (
                <div className='mb-3'>
                  <div className='text-center py-4'>
                    <div className='text-[#808080] text-[12px]'>
                      No deployed services yet
                    </div>
                    <div className='text-[#606060] text-[11px] mt-1'>
                      Create your first deployment below
                    </div>
                  </div>
                </div>
              )}

            {/* 已部署的服务列表 */}
            {(deployedServices.apis.length > 0 ||
              deployedServices.chatbots.length > 0) && (
              <div className='mb-3'>
                <div className='flex items-center justify-between mb-2 px-3'>
                  <h3 className='text-[#808080] text-[12px] font-normal'>
                    Deployed Services
                  </h3>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={`p-1.5 rounded transition-all duration-200 ${
                      isRefreshing
                        ? 'bg-[#2A2A2A] text-[#CDCDCD] cursor-not-allowed'
                        : 'hover:bg-[#2A2A2A] text-[#808080] hover:text-[#CDCDCD] active:scale-95'
                    }`}
                    title={
                      isRefreshing
                        ? 'Refreshing...'
                        : 'Refresh deployed services'
                    }
                  >
                    <svg
                      className={`w-4 h-4 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                      xmlns='http://www.w3.org/2000/svg'
                      style={
                        isRefreshing ? { animationDirection: 'reverse' } : {}
                      }
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                      />
                    </svg>
                  </button>
                </div>
                <div className='space-y-1 max-h-[200px] overflow-y-auto px-1'>
                  {/* API 服务列表 */}
                  {deployedServices.apis.map(api => (
                    <div
                      key={api.api_id}
                      className='flex items-center gap-2 px-3 py-2 rounded-md border border-[#404040] transition-colors group cursor-pointer hover:bg-[#2A2A2A]'
                      onClick={() =>
                        handleDeployedServiceClick('api', api.api_id)
                      }
                    >
                      {/* 服务类型图标 */}
                      <div className='w-5 h-5 rounded-md border border-[#60A5FA] flex items-center justify-center flex-shrink-0'>
                        <svg
                          className='w-3 h-3 text-[#60A5FA]'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </div>

                      {/* 服务信息 */}
                      <div className='flex-1 min-w-0 text-left'>
                        <div className='text-[#CDCDCD] text-[12px] font-medium group-hover:text-white text-left'>
                          {api.api_id.length > 12
                            ? `${api.api_id.substring(0, 12)}...`
                            : api.api_id}
                        </div>
                        <div className='text-[10px] text-[#808080] mt-[1px] text-left'>
                          API Service
                        </div>
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={e => handleDeleteApi(api.api_id, e)}
                        className='flex items-center justify-center w-[24px] h-[24px] text-[#E74C3C] rounded-[4px] hover:bg-[#E74C3C]/20 transition-colors duration-200'
                        title='Delete API'
                      >
                        <svg
                          className='w-3 h-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {/* Chatbot 服务列表 */}
                  {deployedServices.chatbots.map(chatbot => (
                    <div
                      key={chatbot.chatbot_id}
                      className='flex items-center gap-2 px-3 py-2 rounded-md border border-[#404040] transition-colors group cursor-pointer hover:bg-[#2A2A2A]'
                      onClick={() =>
                        handleDeployedServiceClick(
                          'chatbot',
                          chatbot.chatbot_id
                        )
                      }
                    >
                      {/* 服务类型图标 */}
                      <div className='w-5 h-5 rounded-md border border-[#A78BFA] flex items-center justify-center flex-shrink-0'>
                        <svg
                          className='w-3 h-3 text-[#A78BFA]'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path d='M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z' />
                          <path d='M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z' />
                        </svg>
                      </div>

                      {/* 服务信息 */}
                      <div className='flex-1 min-w-0 text-left'>
                        <div className='text-[#CDCDCD] text-[12px] font-medium group-hover:text-white text-left'>
                          {chatbot.chatbot_id.length > 12
                            ? `${chatbot.chatbot_id.substring(0, 12)}...`
                            : chatbot.chatbot_id}
                        </div>
                        <div className='text-[10px] text-[#808080] mt-[1px] text-left'>
                          Chatbot Service
                        </div>
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={e =>
                          handleDeleteChatbot(chatbot.chatbot_id, e)
                        }
                        className='flex items-center justify-center w-[24px] h-[24px] text-[#E74C3C] rounded-[4px] hover:bg-[#E74C3C]/20 transition-colors duration-200'
                        title='Delete Chatbot'
                      >
                        <svg
                          className='w-3 h-3'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z'
                            clipRule='evenodd'
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 新建部署选项 */}
            <div
              className={`${deployedServices.apis.length > 0 || deployedServices.chatbots.length > 0 ? 'border-t border-[#404040] pt-2' : ''}`}
            >
              <h3 className='text-[#808080] text-[12px] font-normal mb-2 text-left px-3'>
                Create New Deployment
              </h3>
              <div className='space-y-1 px-1'>
                {deploymentOptions.map(option => (
                  <div
                    key={option.id}
                    className='flex items-center gap-2 px-3 py-2 rounded-md border border-[#404040] transition-colors group cursor-pointer hover:bg-[#2A2A2A]'
                    onClick={() => setActivePanel(option.id)}
                  >
                    {/* 服务类型图标 */}
                    <div className='w-5 h-5 rounded-md border border-[#606060] flex items-center justify-center flex-shrink-0'>
                      {option.id === 'api' ? (
                        <svg
                          className='w-3 h-3 text-[#606060]'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            fillRule='evenodd'
                            d='M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
                            clipRule='evenodd'
                          />
                        </svg>
                      ) : (
                        <svg
                          className='w-3 h-3 text-[#606060]'
                          fill='currentColor'
                          viewBox='0 0 20 20'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path d='M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z' />
                          <path d='M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z' />
                        </svg>
                      )}
                    </div>

                    {/* 服务信息 */}
                    <div className='flex-1 min-w-0 text-left'>
                      <div className='text-[#CDCDCD] text-[12px] font-medium group-hover:text-white text-left'>
                        {option.label}
                      </div>
                      <div className='text-[10px] text-[#808080] mt-[1px] text-left'>
                        {option.description}
                      </div>
                    </div>

                    {/* 右侧加号图标 */}
                    <div className='flex items-center justify-center w-[24px] h-[24px] text-[#606060] group-hover:text-[#CDCDCD] transition-colors duration-200'>
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2.5}
                          d='M12 4v16m8-8H4'
                        />
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
    <div className='w-[380px] rounded-[8px] bg-[#232323] shadow-none border border-[#404040] overflow-hidden p-1'>
      {renderActivePanel()}
    </div>
  );
}
