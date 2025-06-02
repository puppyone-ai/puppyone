import React, { useEffect, useState, useCallback } from 'react';
import { useDashboardContext } from './states/DashBoardContext';
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext';
import { SYSTEM_URLS } from '@/config/urls';

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
  history_id?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
}

const DeployedServers: React.FC = () => {
  // 直接从 FlowsPerUserContext 获取所有工作区信息
  const { workspaces } = useFlowsPerUserContext();
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
  const apiServerKey = process.env.NEXT_PUBLIC_API_SERVER_KEY || '';

  // 本地状态管理
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [allDeployedServices, setAllDeployedServices] = useState<{
    apis: (ApiInfo & { workspaceName: string })[];
    chatbots: (ChatbotInfo & { workspaceName: string })[];
  }>({
    apis: [],
    chatbots: []
  });

  // 获取单个工作区的API列表
  const fetchApiList = useCallback(async (workspaceId: string): Promise<ApiInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_apis/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) {
          return [];
        }
        throw new Error(`Failed to fetch API list: ${res.status}`);
      }

      const data = await res.json();
      return data.apis || [];
    } catch (error) {
      console.error(`Error fetching API list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, [API_SERVER_URL, apiServerKey]);

  // 获取单个工作区的Chatbot列表
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotInfo[]> => {
    try {
      const res = await fetch(
        `${API_SERVER_URL}/list_chatbots/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        if (res.status === 404) {
          return [];
        }
        throw new Error(`Failed to fetch chatbot list: ${res.status}`);
      }

      const data = await res.json();
      return data.chatbots || [];
    } catch (error) {
      console.error(`Error fetching chatbot list for workspace ${workspaceId}:`, error);
      return [];
    }
  }, [API_SERVER_URL, apiServerKey]);

  // 获取所有工作区的部署服务
  const fetchAllDeployedServices = useCallback(async () => {
    if (!workspaces.length || !apiServerKey) {
      console.log("No workspaces or API key missing, skipping fetch");
      setAllDeployedServices({ apis: [], chatbots: [] });
      return;
    }

    try {
      // 并行获取所有工作区的API和Chatbot列表
      const allPromises = workspaces.map(async (workspace) => {
        const [apis, chatbots] = await Promise.all([
          fetchApiList(workspace.flowId),
          fetchChatbotList(workspace.flowId)
        ]);

        return {
          workspaceId: workspace.flowId,
          workspaceName: workspace.flowTitle,
          apis,
          chatbots
        };
      });

      const results = await Promise.all(allPromises);

      // 合并所有结果
      const allApis: (ApiInfo & { workspaceName: string })[] = [];
      const allChatbots: (ChatbotInfo & { workspaceName: string })[] = [];

      results.forEach(({ workspaceName, apis, chatbots }) => {
        apis.forEach(api => {
          allApis.push({ ...api, workspaceName });
        });
        
        chatbots.forEach(chatbot => {
          allChatbots.push({ ...chatbot, workspaceName });
        });
      });

      setAllDeployedServices({
        apis: allApis,
        chatbots: allChatbots
      });

      console.log(`✅ Fetched deployed services from ${workspaces.length} workspaces:`, {
        totalApis: allApis.length,
        totalChatbots: allChatbots.length
      });

    } catch (error) {
      console.error("Error fetching all deployed services:", error);
      setAllDeployedServices({ apis: [], chatbots: [] });
    }
  }, [workspaces, apiServerKey, fetchApiList, fetchChatbotList]);

  // 转换数据格式以匹配组件需要的结构
  const servers: DeployedService[] = [
    // 转换API服务
    ...allDeployedServices.apis.map(api => ({
      id: api.api_id,
      type: 'api' as const,
      workspace: api.workspace_id || 'Unknown',
      workspaceName: api.workspaceName,
      endpoint: `${API_SERVER_URL}/execute_workflow/${api.api_id}`,
      created_at: api.created_at
    })),
    // 转换Chatbot服务
    ...allDeployedServices.chatbots.map(chatbot => ({
      id: chatbot.chatbot_id,
      type: 'chatbot' as const,
      workspace: chatbot.workspace_id || 'Unknown',
      workspaceName: chatbot.workspaceName,
      endpoint: `${API_SERVER_URL}/chat/${chatbot.chatbot_id}`,
      created_at: chatbot.created_at
    }))
  ];

  // 初始化时获取数据
  useEffect(() => {
    if (workspaces.length > 0) {
      setIsLoading(true);
      fetchAllDeployedServices()
        .then(() => {
          console.log('✅ All deployed services loaded for dashboard');
        })
        .catch((error) => {
          console.error('❌ Failed to load deployed services:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [workspaces, fetchAllDeployedServices]);

  // 处理刷新操作
  const handleRefresh = async () => {
    if (!workspaces.length) return;
    
    setIsRefreshing(true);
    try {
      await fetchAllDeployedServices();
      console.log('🔄 All deployed services refreshed');
    } catch (error) {
      console.error('❌ Failed to refresh deployed services:', error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

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
        minute: '2-digit'
      });
    } catch {
      return 'Invalid Date';
    }
  };

  return (
    <div className="space-y-6 max-h-[500px] pr-2">
      {/* 标题栏 */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-[#2A2A2A] pb-2">
        <h3 className="text-[16px] font-medium text-white">Deployed Servers</h3>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className={`p-2 rounded transition-all duration-200 ${
            isRefreshing || isLoading
              ? 'bg-[#2A2A2A] text-[#CDCDCD] cursor-not-allowed' 
              : 'hover:bg-[#404040] text-[#808080] hover:text-[#CDCDCD] active:scale-95'
          }`}
          title={isRefreshing ? "Refreshing..." : "Refresh deployed services"}
        >
          <svg 
            className={`w-4 h-4 transition-transform duration-500 ${
              isRefreshing ? 'animate-spin' : ''
            }`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
            />
          </svg>
        </button>
      </div>
      
      <div className="py-[8px] overflow-y-auto">
        {/* 加载状态 */}
        {isLoading ? (
          <div className="bg-[#333333] rounded-lg p-4 text-center">
            <div className="flex items-center justify-center space-x-2">
              <svg className="animate-spin w-3.5 h-3.5 text-[#888888]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-[12px] text-[#888888]">Loading deployed services...</span>
            </div>
          </div>
        ) : servers.length > 0 ? (
          <div className="bg-[#333333] rounded-lg p-3">
            <table className="w-full table-fixed">
              <thead>
                <tr className="text-left border-b border-[#404040]">
                  <th className="pb-3 pr-4 text-[14px] font-medium text-[#AAAAAA] w-[90px]">Type</th>
                  <th className="pb-3 px-4 text-[14px] font-medium text-[#AAAAAA] w-[120px]">Workspace</th>
                  <th className="pb-3 pl-4 text-[14px] font-medium text-[#AAAAAA] w-[150px]">Service ID</th>
                </tr>
              </thead>
              <tbody>
                {servers.map(server => (
                  <tr key={server.id} className="border-b border-[#404040] last:border-0">
                    {/* 服务类型 */}
                    <td className="py-3 pr-4 w-[90px]">
                      <div className="flex items-center">
                        <div className={`mr-1.5 p-1 rounded flex-shrink-0 ${
                          server.type === 'api' 
                            ? 'bg-[#3B82F6]/20' 
                            : 'bg-[#8B5CF6]/20'
                        }`}>
                          {server.type === 'api' ? (
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
                        <span className={`text-[12px] font-medium ${
                          server.type === 'api' 
                            ? 'text-[#60A5FA]' 
                            : 'text-[#A78BFA]'
                        }`}>
                          {server.type.toUpperCase()}
                        </span>
                      </div>
                    </td>

                    {/* 工作区名称 */}
                    <td className="py-3 px-4 w-[120px]">
                      <div className="min-w-0">
                        <div 
                          className="text-[13px] text-[#CDCDCD] truncate"
                          title={server.workspaceName}
                        >
                          {server.workspaceName}
                        </div>
                        
                      </div>
                    </td>

                    {/* 服务 ID */}
                    <td className="py-3 pl-4 w-[150px]">
                      <div className="min-w-0 flex items-center justify-between">
                        <div 
                          className="text-[13px] text-white font-medium truncate flex-1 mr-2"
                          title={server.id}
                        >
                          {server.id.length > 15 ? `${server.id.substring(0, 15)}...` : server.id}
                        </div>
                        <button
                          onClick={() => copyToClipboard(server.id)}
                          className="flex-shrink-0 p-1 rounded hover:bg-[#404040] text-[#808080] hover:text-[#CDCDCD] transition-all duration-200 active:scale-95"
                          title="Copy Service ID"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" 
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
          <div className="bg-[#333333] rounded-lg p-4 text-center">
            <div className="text-[12px] text-[#888888] mb-1">No deployed servers found</div>
            {workspaces.length === 0 ? (
              <div className="text-[#666666] text-[10px]">
                No workspaces available
              </div>
            ) : (
              <div className="text-[#666666] text-[10px]">
                No services deployed across {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeployedServers;
