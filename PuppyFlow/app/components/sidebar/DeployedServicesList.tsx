import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  useAllDeployedServices,
  useServers,
} from '../states/UserServersContext';
import { useDisplaySwitch } from '../hooks/useDisplayWorkspcaeSwitching';
import { useServerOperations } from '../hooks/useServerManagement';
import { SYSTEM_URLS } from '@/config/urls';
import DeployedServiceOperationMenu from './DeployedServiceOperationMenu';

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
  const API_SERVER_URL = '/api/server';

  // 转换数据格式
  const services = [
    ...apis.map(api => ({
      id: api.api_id,
      type: 'api' as const,
      workspaceName: api.workspaceName,
      workspaceId: api.workspace_id || '',
    })),
    ...chatbots.map(chatbot => ({
      id: chatbot.chatbot_id,
      type: 'chatbot' as const,
      workspaceName: chatbot.workspaceName,
      workspaceId: chatbot.workspace_id || '',
    })),
  ];

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serviceIdShowOperationMenu, setServiceIdShowOperationMenu] = useState<
    string | null
  >(null);
  const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);

  // 使用 refs 来存储每个服务的按钮引用
  const buttonRefs = useRef<{
    [key: string]: React.RefObject<HTMLButtonElement>;
  }>({});

  // 为每个服务创建或获取 button ref
  const getButtonRef = (serviceId: string) => {
    if (!buttonRefs.current[serviceId]) {
      buttonRefs.current[serviceId] = React.createRef<HTMLButtonElement>();
    }
    return buttonRefs.current[serviceId];
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
      // 确保至少显示500ms的加载状态，让用户看到反馈
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

  // 处理操作菜单显示/隐藏
  const handleOperationMenuShow = (serviceId: string | null) => {
    setServiceIdShowOperationMenu(serviceId);
  };

  // 处理服务点击
  const handleServiceClick = (service: DeployedService) => {
    // 使用新的 switch hook 切换到服务显示
    switchToServiceById(service.id);

    // 对于API，复制端点到剪贴板
    if (service.type === 'api') {
      const endpoint = `${API_SERVER_URL}/execute_workflow/${service.id}`;
      navigator.clipboard.writeText(endpoint).then(() => {
        console.log('📋 API endpoint copied to clipboard:', endpoint);
      });
    }
  };

  return (
    <div className='w-full'>
      {/* 标题栏 */}
      <div className='text-[#5D6065] text-[11px] font-semibold pl-[16px] pr-[8px] font-plus-jakarta-sans pt-[8px]'>
        <div className='mb-[16px] flex items-center gap-2'>
          <span>Deployed Services</span>

          {/* 刷新按钮 */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`flex items-center justify-center w-[32px] h-[32px] rounded-md transition-all duration-200 group ${
              isRefreshing
                ? 'bg-[#313131] text-[#CDCDCD] cursor-not-allowed'
                : 'hover:bg-[#313131] text-[#5D6065] hover:text-[#FFFFFF]'
            }`}
            title={isRefreshing ? 'Refreshing...' : 'Refresh services'}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`}
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
              style={isRefreshing ? { animationDirection: 'reverse' } : {}}
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
              />
            </svg>
          </button>
          <div className='h-[1px] flex-grow bg-[#404040]'></div>
        </div>
      </div>

      {/* 服务列表 */}
      <div className='space-y-[4px] max-h-[50vh] overflow-y-auto'>
        {services.map(service => {
          // 修改选中状态的判断逻辑：只有当 displayOrNot 为 true 且选中了该服务时才显示为选中状态
          const isSelected = displayOrNot && isServiceShowing(service.id);
          const isHover = hoveredServiceId === service.id;
          const buttonRef = getButtonRef(service.id);

          return (
            <div
              key={service.id}
              onClick={() => handleServiceClick(service)}
              onMouseEnter={() => setHoveredServiceId(service.id)}
              onMouseLeave={() => setHoveredServiceId(null)}
              className={`flex items-center gap-[12px] py-[8px] pl-[16px] pr-[4px] rounded-md transition-colors group cursor-pointer h-[40px] ${
                isSelected
                  ? 'bg-[#454545] hover:bg-[#454545]'
                  : 'hover:bg-[#313131]'
              }`}
              title={
                service.type === 'chatbot'
                  ? 'Click to open chat interface'
                  : 'Click to copy API endpoint'
              }
            >
              {/* 服务类型图标 */}
              <div
                className={`w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 ${
                  service.type === 'api'
                    ? 'border-[#60A5FA]'
                    : 'border-[#A78BFA]'
                }`}
              >
                {service.type === 'api' ? (
                  <svg
                    className='w-3 h-3 text-[#60A5FA]'
                    fill='currentColor'
                    viewBox='0 0 20 20'
                  >
                    <path
                      fillRule='evenodd'
                      d='M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
                      clipRule='evenodd'
                    />
                  </svg>
                ) : (
                  <svg
                    className='w-3 h-3 text-[#A78BFA]'
                    fill='currentColor'
                    viewBox='0 0 20 20'
                  >
                    <path d='M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z' />
                    <path d='M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z' />
                  </svg>
                )}
              </div>

              {/* 服务信息 */}
              <div className='flex-1 min-w-0'>
                <div
                  className={`text-[11px] font-medium truncate ${
                    isSelected
                      ? 'text-white'
                      : 'text-[#CDCDCD] group-hover:text-white'
                  }`}
                >
                  {service.id.length > 12
                    ? `${service.id.substring(0, 12)}...`
                    : service.id}
                </div>
                <div className='text-[9px] text-[#808080] truncate mt-[1px]'>
                  {service.workspaceName}
                </div>
              </div>

              {/* 操作菜单按钮 */}
              <div
                className={`w-[24px] h-[24px] ${serviceIdShowOperationMenu === service.id || isHover ? 'flex' : 'hidden'}`}
              >
                <button
                  ref={buttonRef}
                  className='flex items-center justify-center w-[24px] h-[24px] text-[#CDCDCD] rounded-[4px] hover:bg-[#5C5D5E] transition-colors duration-200'
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOperationMenuShow(
                      serviceIdShowOperationMenu === service.id
                        ? null
                        : service.id
                    );
                  }}
                >
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    width='24'
                    height='24'
                    viewBox='0 0 24 24'
                    fill='none'
                    className='group transition-colors duration-200'
                  >
                    <path
                      d='M7 11H9V13H7V11Z'
                      className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
                    />
                    <path
                      d='M16 11H18V13H16V11Z'
                      className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
                    />
                    <path
                      d='M11.5 11H13.5V13H11.5V11Z'
                      className='fill-[#5D6065] group-hover:fill-white transition-colors duration-200'
                    />
                  </svg>
                </button>
                <DeployedServiceOperationMenu
                  serviceId={service.id}
                  serviceType={service.type}
                  workspaceName={service.workspaceName}
                  show={serviceIdShowOperationMenu === service.id}
                  handleOperationMenuHide={() => handleOperationMenuShow(null)}
                  buttonRef={buttonRef}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DeployedServicesList;
