import React, { useEffect, useState, useCallback } from 'react';
import { useDashboardContext } from './states/DashBoardContext';
import { SYSTEM_URLS } from '@/config/urls';
import { useAllDeployedServices } from '../states/UserServersContext';

// 定义服务类型
interface DeployedService {
  id: string;
  type: 'api' | 'chatbot';
  workspace: string;
  workspaceName: string;
  endpoint: string;
  created_at?: string;
}

// 定义API和Chatbot的接口
interface ApiInfo {
  api_id: string;
  api_key: string;
  created_at?: string;
  workspace_id?: string;
  inputs?: string[];
  outputs?: string[];
}

interface ChatbotInfo {
  chatbot_id: string;
  chatbot_key: string;
  created_at?: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
}

const DeployedServers: React.FC = () => {
  const { apis, chatbots, isLoading } = useAllDeployedServices();
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;

  // 转换数据格式
  const servers = [
    ...apis.map(api => ({
      id: api.api_id,
      type: 'api' as const,
      workspace: api.workspace_id || 'Unknown',
      workspaceName: api.workspaceName,
      endpoint: `${API_SERVER_URL}/execute_workflow/${api.api_id}`,
      created_at: api.created_at,
    })),
    ...chatbots.map(chatbot => ({
      id: chatbot.chatbot_id,
      type: 'chatbot' as const,
      workspace: chatbot.workspace_id || 'Unknown',
      workspaceName: chatbot.workspaceName,
      endpoint: `${API_SERVER_URL}/chat/${chatbot.chatbot_id}`,
      created_at: chatbot.created_at,
    })),
  ];

  // 初始化时获取数据
  useEffect(() => {
    if (apis.length > 0 || chatbots.length > 0) {
      console.log('✅ All deployed services loaded for dashboard');
    }
  }, [apis, chatbots]);

  // 复制端点到剪贴板
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('📋 Endpoint copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  // 格式化创建时间
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Invalid Date';
    }
  };

  return (
    <div className='space-y-4 max-h-[500px] pr-2'>
      {/* 标题栏 */}
      <div className='flex items-center justify-between sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        <h3 className='text-[16px] font-semibold text-[#E5E5E5]'>Deployed Servers</h3>
      </div>

      <div className='py-[8px] overflow-y-auto'>
        {/* 加载状态 */}
        {isLoading ? (
          <div className='ui-card text-center'>
            <div className='flex items-center justify-center space-x-2'>
              <svg
                className='animate-spin w-3.5 h-3.5 text-[#888888]'
                fill='none'
                viewBox='0 0 24 24'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                ></circle>
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                ></path>
              </svg>
              <span className='text-[12px] text-[#888888]'>
                Loading deployed services...
              </span>
            </div>
          </div>
        ) : servers.length > 0 ? (
          <div className='ui-card p-3'>
            <table className='w-full table-fixed'>
              <thead>
                <tr className='text-left border-b border-[#343434]'>
                  <th className='pb-3 pr-4 text-[13px] font-medium text-[#AAAAAA] w-[90px]'>
                    Type
                  </th>
                  <th className='pb-3 px-4 text-[13px] font-medium text-[#AAAAAA] w-[120px]'>
                    Workspace
                  </th>
                  <th className='pb-3 pl-4 text-[13px] font-medium text-[#AAAAAA] w-[150px]'>
                    Service ID
                  </th>
                </tr>
              </thead>
              <tbody>
                {servers.map(server => (
                  <tr
                    key={server.id}
                    className='border-b border-[#343434] last:border-0'
                  >
                    {/* 服务类型 */}
                    <td className='py-3 pr-4 w-[90px]'>
                      <div className='flex items-center'>
                        <div
                          className={`mr-1.5 p-1 rounded flex-shrink-0 ${
                            server.type === 'api'
                              ? 'bg-[#3B82F6]/20'
                              : 'bg-[#8B5CF6]/20'
                          }`}
                        >
                          {server.type === 'api' ? (
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
                        <span
                          className={`text-[12px] font-medium ${
                            server.type === 'api'
                              ? 'text-[#60A5FA]'
                              : 'text-[#A78BFA]'
                          }`}
                        >
                          {server.type.toUpperCase()}
                        </span>
                      </div>
                    </td>

                    {/* 工作区名称 */}
                    <td className='py-3 px-4 w-[120px]'>
                      <div className='min-w-0'>
                        <div
                          className='text-[13px] text-[#E5E5E5] truncate'
                          title={server.workspaceName}
                        >
                          {server.workspaceName}
                        </div>
                      </div>
                    </td>

                    {/* 服务 ID */}
                    <td className='py-3 pl-4 w-[150px]'>
                      <div className='min-w-0 flex items-center justify-between'>
                        <div
                          className='text-[13px] text-[#E5E5E5] font-medium truncate flex-1 mr-2'
                          title={server.id}
                        >
                          {server.id.length > 15
                            ? `${server.id.substring(0, 15)}...`
                            : server.id}
                        </div>
                        <button
                          onClick={() => copyToClipboard(server.id)}
                          className='icon-btn active:scale-95'
                          title='Copy Service ID'
                        >
                          <svg
                            className='w-3 h-3'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className='ui-card text-center'>
            <div className='text-[12px] text-[#888888] mb-1'>
              No deployed servers found
            </div>
            {apis.length === 0 && chatbots.length === 0 ? (
              <div className='text-[#666666] text-[10px]'>
                No services deployed across any workspace
              </div>
            ) : (
              <div className='text-[#666666] text-[10px]'>
                No services deployed across {apis.length + chatbots.length}{' '}
                services
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeployedServers;
