import React, { useState, useEffect, useCallback } from 'react';
import { useAllDeployedServices, useServers } from '../states/UserServersContext';
import { useDisplaySwitch } from '../hooks/useDisplaySwitch';
import { useServerOperations } from '../hooks/useServerMnagement';
import { SYSTEM_URLS } from '@/config/urls';
import ChatbotTestInterface from '../upbar/topRightToolBar/deployMenu/ChatbotTestInterface';

// 定义简化的服务类型
interface DeployedService {
  id: string;
  type: 'api' | 'chatbot';
  workspaceName: string;
  workspaceId: string;
}

// Chatbot详细信息接口
interface ChatbotDetails {
  chatbot_id: string;
  chatbot_key: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  endpoint?: string;
}

const DeployedServicesList: React.FC = () => {
  const { apis, chatbots, isLoading } = useAllDeployedServices();
  const { isServiceShowing, displayOrNot, refreshServices } = useServers();
  const { switchToServiceById } = useDisplaySwitch();
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 转换数据格式
  const services = [
    ...apis.map(api => ({
      id: api.api_id,
      type: 'api' as const,
      workspaceName: api.workspaceName,
      workspaceId: api.workspace_id || ''
    })),
    ...chatbots.map(chatbot => ({
      id: chatbot.chatbot_id,
      type: 'chatbot' as const,
      workspaceName: chatbot.workspaceName,
      workspaceId: chatbot.workspace_id || ''
    }))
  ];

  const [isExpanded, setIsExpanded] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 切换展开状态
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // 处理刷新
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshServices();
      console.log('✅ Services refreshed successfully');
    } catch (error) {
      console.error('❌ Failed to refresh services:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 处理服务点击
  const handleServiceClick = (service: DeployedService) => {
    // 使用新的 switch hook 切换到服务显示
    switchToServiceById(service.id);
    
    // 添加成功切换的日志
    console.log(`✅ Successfully switched to ${service.type} service:`, {
      serviceId: service.id,
      serviceName: service.id.length > 12 ? `${service.id.substring(0, 12)}...` : service.id,
      serviceType: service.type,
      workspaceName: service.workspaceName,
      workspaceId: service.workspaceId
    });
    
    // 对于API，复制端点到剪贴板
    if (service.type === 'api') {
      const endpoint = `${API_SERVER_URL}/execute_workflow/${service.id}`;
      navigator.clipboard.writeText(endpoint).then(() => {
        console.log('📋 API endpoint copied to clipboard:', endpoint);
      });
    }
  };

  // 如果没有服务，不显示组件
  if (services.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="w-full">
      {/* 标题栏 - 分离点击区域 */}
      <div className="text-[#5D6065] text-[11px] font-semibold pl-[16px] pr-[8px] font-plus-jakarta-sans pt-[8px]">
        <div className="mb-[16px] flex items-center gap-2">
          <span>Deployed Services</span>
          <div className="h-[1px] flex-grow bg-[#404040]"></div>
          
          {/* 刷新按钮 */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center w-[16px] h-[16px] hover:text-[#CDCDCD] transition-colors disabled:opacity-50"
            title="Refresh services"
          >
            {isRefreshing ? (
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>

          {/* 展开/收起按钮 - 独立点击区域 */}
          <button
            onClick={toggleExpanded}
            className="flex items-center justify-center w-[16px] h-[16px] hover:text-[#CDCDCD] transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isLoading && !isRefreshing ? (
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg 
                width="12" 
                height="12" 
                viewBox="0 0 12 12" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className={`transition-all duration-200 ${!isExpanded ? 'rotate-180' : ''}`}
              >
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 服务列表 */}
      {isExpanded && (
        <div className="space-y-[4px] max-h-[200px] overflow-y-auto">
          {services.map((service) => {
            // 修改选中状态的判断逻辑：只有当 displayOrNot 为 true 且选中了该服务时才显示为选中状态
            const isSelected = displayOrNot && isServiceShowing(service.id);
            
            return (
              <div 
                key={service.id}
                onClick={() => handleServiceClick(service)}
                className={`flex items-center gap-[8px] py-[8px] px-[16px] rounded-md transition-colors group cursor-pointer h-[40px] ${
                  isSelected 
                    ? 'bg-[#454545] hover:bg-[#454545]' 
                    : 'hover:bg-[#313131]'
                }`}
                title={service.type === 'chatbot' ? 'Click to open chat interface' : 'Click to copy API endpoint'}
              >
                {/* 服务类型图标 */}
                <div className={`p-1 rounded flex-shrink-0 ${
                  service.type === 'api' 
                    ? 'bg-[#3B82F6]/20' 
                    : 'bg-[#8B5CF6]/20'
                }`}>
                  {service.type === 'api' ? (
                    <svg className="w-3 h-3 text-[#60A5FA]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-[#A78BFA]" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                      <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                    </svg>
                  )}
                </div>

                {/* 服务信息 */}
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] font-medium truncate ${
                    isSelected ? 'text-white' : 'text-[#CDCDCD] group-hover:text-white'
                  }`}>
                    {service.id.length > 12 ? `${service.id.substring(0, 12)}...` : service.id}
                  </div>
                  <div className="text-[9px] text-[#808080] truncate mt-[1px]">
                    {service.workspaceName}
                  </div>
                </div>

                {/* 交互提示图标 */}
                {service.type === 'chatbot' && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-3 h-3 text-[#A78BFA]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DeployedServicesList; 