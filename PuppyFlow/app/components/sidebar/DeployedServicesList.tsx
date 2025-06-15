import React, { useState, useEffect, useCallback } from 'react';
import { useAllDeployedServices } from '../states/GlobalDeployedServicesContext';
import { useWorkspaces } from '../states/UserWorkspaceAndServicesContext';
import { SYSTEM_URLS } from '@/config/urls';
import ChatbotTestInterface from '../upbar/topRightToolBar/deployMenu/ChatbotTestInterface';

// 定义简化的服务类型
interface DeployedService {
  id: string;
  type: 'api' | 'chatbot';
  workspaceName: string;
  workspaceId: string;
}

// API和Chatbot的接口定义
interface ApiInfo {
  api_id: string;
  workspace_id?: string;
}

interface ChatbotInfo {
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
  const { clearShowing } = useWorkspaces();
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

  const [isExpanded, setIsExpanded] = useState(true); // 默认展开
  const [selectedChatbot, setSelectedChatbot] = useState<{
    id: string;
    workspaceId: string;
    input?: string;
    output?: string;
    history?: string;
    chatbotKey?: string;
    endpoint?: string;
  } | null>(null);

  // 获取单个工作区的API列表
  const fetchApiList = useCallback(async (workspaceId: string): Promise<ApiInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_apis/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": process.env.NEXT_PUBLIC_API_SERVER_KEY || ''
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`Failed to fetch API list: ${res.status}`);
      }

      const data = await res.json();
      return data.apis || [];
    } catch (error) {
      console.error(`Error fetching API list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, []);

  // 获取单个工作区的Chatbot列表
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_chatbots/${workspaceId}?include_keys=true`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": process.env.NEXT_PUBLIC_API_SERVER_KEY || ''
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`Failed to fetch chatbot list: ${res.status}`);
      }

      const data = await res.json();
      return data.chatbots || [];
    } catch (error) {
      console.error(`Error fetching chatbot list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, []);

  // 获取所有已部署的服务
  const fetchAllServices = useCallback(async () => {
    // 移除所有数据获取逻辑，直接使用从全局Context获取的数据
  }, []);

  // 初始化时获取数据
  useEffect(() => {
    if (services.length > 0) {
      fetchAllServices();
    }
  }, [services, fetchAllServices]);

  // 切换展开状态
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // 处理chatbot点击
  const handleChatbotClick = async (service: DeployedService) => {
    if (service.type !== 'chatbot') return;

    // 从已获取的服务列表中找到对应的 chatbot 信息
    const allChatbots = await fetchChatbotList(service.workspaceId);
    const chatbotDetails = allChatbots.find(chatbot => chatbot.chatbot_id === service.id);

    setSelectedChatbot({
      id: service.id,
      workspaceId: service.workspaceId,
      input: chatbotDetails?.input,
      output: chatbotDetails?.output,
      history: chatbotDetails?.history,
      chatbotKey: chatbotDetails?.chatbot_key,
      endpoint: chatbotDetails?.endpoint
    });
  };

  // 处理服务点击
  const handleServiceClick = (service: DeployedService) => {
    clearShowing();
    
    if (service.type === 'chatbot') {
      handleChatbotClick(service);
    } else if (service.type === 'api') {
      // 对于API，可以复制端点或显示其他信息
      const endpoint = `${API_SERVER_URL}/execute_workflow/${service.id}`;
      navigator.clipboard.writeText(endpoint).then(() => {
        console.log('API endpoint copied to clipboard');
      });
    }
  };

  // 关闭chatbot界面
  const closeChatbot = () => {
    setSelectedChatbot(null);
  };

  // 如果没有服务，不显示组件
  if (services.length === 0 && !isLoading) {
    return null;
  }

  return (
    <>
      <div className="w-full">
        {/* 标题栏 - 可点击区域扩展到父元素顶部 */}
        <button 
          onClick={toggleExpanded}
          className="w-full text-[#5D6065] text-[11px] font-semibold pl-[16px] pr-[8px] font-plus-jakarta-sans hover:text-[#CDCDCD] rounded transition-colors pt-[8px] group"
        >
          <div className="mb-[16px] flex items-center gap-2">
            <span>Deployed Services</span>
            <div className="h-[1px] flex-grow bg-[#404040] group-hover:bg-[#CDCDCD] transition-colors"></div>
            <div className="flex items-center justify-center w-[16px] h-[16px]">
              {isLoading ? (
                <svg className="animate-spin w-3 h-3 text-[#5D6065] group-hover:text-[#CDCDCD] transition-colors" fill="none" viewBox="0 0 24 24">
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
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="#5D6065" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-[#CDCDCD] transition-colors"/>
                </svg>
              )}
            </div>
          </div>
        </button>

        {/* 服务列表 */}
        {isExpanded && (
          <div className="space-y-[4px] max-h-[200px] overflow-y-auto pr-[4px]">
            {services.map((service) => (
              <div 
                key={service.id}
                onClick={() => handleServiceClick(service)}
                className="flex items-center gap-[8px] py-[6px] px-[16px] rounded-md hover:bg-[#313131] transition-colors group cursor-pointer h-[32px]"
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
                  <div className="text-[13px] font-medium text-[#CDCDCD] group-hover:text-white truncate">
                    {service.id.length > 12 ? `${service.id.substring(0, 12)}...` : service.id}
                  </div>
                  <div className="text-[10px] text-[#808080] truncate">
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
            ))}
          </div>
        )}
      </div>

      {/* Chatbot测试界面 */}
      {selectedChatbot && (
        <ChatbotTestInterface
          apiEndpoint={selectedChatbot.endpoint || `${API_SERVER_URL}/chat/${selectedChatbot.id}`}
          chatbotId={selectedChatbot.id}
          apiKey={selectedChatbot.chatbotKey}
          onClose={closeChatbot}
          input={selectedChatbot.input}
          output={selectedChatbot.output}
          history={selectedChatbot.history}
        />
      )}
    </>
  );
};

export default DeployedServicesList; 