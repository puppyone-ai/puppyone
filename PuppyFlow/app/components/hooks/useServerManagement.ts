/**
 * Server Operations Hooks
 *
 * This file contains all the API operations for server/service management,
 * separated from the context to keep concerns separated.
 */

import { useCallback } from 'react';
import { SYSTEM_URLS } from '@/config/urls';
import {
  ApiService,
  ChatbotService,
  EnhancedApiService,
  EnhancedChatbotService,
} from '../states/UserServersContext';
import { useAppSettings } from '../states/AppSettingsContext';

// 添加 chatbot 配置参数接口
interface ConfigChatbotParams {
  workflow_json: {
    blocks: { [key: string]: any };
    edges: { [key: string]: any };
  };
  input: string;
  output: string;
  history?: string | null;
  workspace_id?: string;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  integrations?: object;
}

// 更新部署项接口以匹配新的API响应
interface DeploymentItem {
  // API服务字段
  api_id?: string;
  inputs?: string[];
  outputs?: string[];
  api_key?: string;

  // Chatbot服务字段
  chatbot_id?: string;
  input?: string;
  output?: string;
  history?: string | null;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  integrations?: object;
  chatbot_key?: string;

  // 通用字段
  workspace_id: string;
  deployment_type: 'api' | 'chatbot';
  created_at: number;
  updated_at: number;
  workflow_json?: object;
}

// 更新响应接口
interface UserDeploymentsResponse {
  user_id: string;
  deployment_type: string;
  include_details: boolean;
  include_keys: boolean;
  deployments: DeploymentItem[];
  total_count: number;
}

interface FetchUserDeploymentsParams {
  deploymentType?: 'api' | 'chatbot';
  includeDetails?: boolean;
  includeKeys?: boolean;
  isLocal?: boolean;
}

// Hook for API operations
export const useServerOperations = () => {
  // Route via same-origin API proxy - 所有请求现在通过我们的新代理处理
  const apiServerUrl = `/api/server`;
  const { } = useAppSettings();
  
  // 注意：不再需要 getUserToken 和 getCustomAuthHeaders，
  // 认证现在完全由服务端代理处理

  // 获取用户的所有部署服务 - 基础 API 调用
  const fetchUserDeployments = useCallback(
    async (
      params: FetchUserDeploymentsParams = {}
    ): Promise<UserDeploymentsResponse> => {
      try {
        const useLocal = false;

        const queryParams = new URLSearchParams();
        if (params.deploymentType) {
          queryParams.append('deployment_type', params.deploymentType);
        }
        if (params.includeDetails !== undefined) {
          queryParams.append(
            'include_details',
            params.includeDetails.toString()
          );
        }
        if (params.includeKeys !== undefined) {
          queryParams.append('include_keys', params.includeKeys.toString());
        }

        const url = `${apiServerUrl}/deployments${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

        // 认证现在完全由服务端代理处理，从HttpOnly cookie中自动注入
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const res = await fetch(url, {
          method: 'GET',
          headers,
          credentials: 'include', // 确保cookie被发送给服务端
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(
            `Failed to fetch user deployments: ${res.status} - ${errorText}`
          );
        }

        const data = await res.json();
        console.log(`✅ Fetched ${data.total_count} deployments for user`);
        return data;
      } catch (error) {
        console.error(`Error fetching user deployments:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 获取所有增强服务 - 统一的数据转换逻辑
  const fetchAllEnhancedServices = useCallback(
    async (
      workspaces: Array<{ workspace_id: string; workspace_name: string }>
    ): Promise<{
      apis: EnhancedApiService[];
      chatbots: EnhancedChatbotService[];
      totalCount: number;
    }> => {
      if (!workspaces.length) {
        return {
          apis: [],
          chatbots: [],
          totalCount: 0,
        };
      }

      try {
        const deploymentsResponse = await fetchUserDeployments({
          includeDetails: true,
          includeKeys: true,
        });

        const workspaceMap = new Map(
          workspaces.map(w => [w.workspace_id, w.workspace_name])
        );
        const allApis: EnhancedApiService[] = [];
        const allChatbots: EnhancedChatbotService[] = [];

        deploymentsResponse.deployments.forEach(deployment => {
          const workspaceName =
            workspaceMap.get(deployment.workspace_id) || 'Unknown Workspace';

          if (deployment.deployment_type === 'api' && deployment.api_id) {
            allApis.push({
              api_id: deployment.api_id,
              api_key: deployment.api_key || '',
              inputs: deployment.inputs || [],
              outputs: deployment.outputs || [],
              workspace_id: deployment.workspace_id,
              created_at: deployment.created_at
                ? new Date(deployment.created_at * 1000).toISOString()
                : undefined,
              workflow_json: deployment.workflow_json || undefined,
              workspaceName,
              type: 'api' as const,
            });
          } else if (
            deployment.deployment_type === 'chatbot' &&
            deployment.chatbot_id
          ) {
            allChatbots.push({
              chatbot_id: deployment.chatbot_id,
              chatbot_key: deployment.chatbot_key || '',
              input: deployment.input || '',
              output: deployment.output || '',
              history: deployment.history || null,
              multi_turn_enabled: deployment.multi_turn_enabled || false,
              welcome_message: deployment.welcome_message || '',
              workspace_id: deployment.workspace_id,
              created_at: deployment.created_at
                ? new Date(deployment.created_at * 1000).toISOString()
                : undefined,
              workflow_json: deployment.workflow_json || undefined,
              workspaceName,
              type: 'chatbot' as const,
            });
          }
        });

        return {
          apis: allApis,
          chatbots: allChatbots,
          totalCount: deploymentsResponse.total_count,
        };
      } catch (error) {
        console.error('Error fetching all enhanced services:', error);
        throw error;
      }
    },
    [fetchUserDeployments]
  );

  // 获取单个工作区的增强服务 - 使用统一的 API
  const fetchWorkspaceEnhancedServices = useCallback(
    async (
      workspaceId: string,
      workspaceName: string
    ): Promise<{
      apis: EnhancedApiService[];
      chatbots: EnhancedChatbotService[];
    }> => {
      try {
        // 使用统一的 API 获取所有部署，然后过滤特定工作区
        const deploymentsResponse = await fetchUserDeployments({
          includeDetails: true,
          includeKeys: true,
        });

        const apis: EnhancedApiService[] = [];
        const chatbots: EnhancedChatbotService[] = [];

        deploymentsResponse.deployments
          .filter(deployment => deployment.workspace_id === workspaceId)
          .forEach(deployment => {
            if (deployment.deployment_type === 'api' && deployment.api_id) {
              apis.push({
                api_id: deployment.api_id,
                api_key: deployment.api_key || '',
                inputs: deployment.inputs || [],
                outputs: deployment.outputs || [],
                workspace_id: deployment.workspace_id,
                created_at: deployment.created_at
                  ? new Date(deployment.created_at * 1000).toISOString()
                  : undefined,
                workflow_json: deployment.workflow_json || undefined,
                workspaceName,
                type: 'api' as const,
              });
            } else if (
              deployment.deployment_type === 'chatbot' &&
              deployment.chatbot_id
            ) {
              chatbots.push({
                chatbot_id: deployment.chatbot_id,
                chatbot_key: deployment.chatbot_key || '',
                input: deployment.input || '',
                output: deployment.output || '',
                history: deployment.history || null,
                multi_turn_enabled: deployment.multi_turn_enabled || false,
                welcome_message: deployment.welcome_message || '',
                workspace_id: deployment.workspace_id,
                created_at: deployment.created_at
                  ? new Date(deployment.created_at * 1000).toISOString()
                  : undefined,
                workflow_json: deployment.workflow_json || undefined,
                workspaceName,
                type: 'chatbot' as const,
              });
            }
          });

        return { apis, chatbots };
      } catch (error) {
        console.error(
          `Error fetching enhanced services for workspace ${workspaceId}:`,
          error
        );
        throw error;
      }
    },
    [fetchUserDeployments]
  );

  // 删除API服务
  const deleteApiService = useCallback(
    async (apiId: string): Promise<void> => {
      try {
        const res = await fetch(`${apiServerUrl}/delete_api/${apiId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // 确保cookie被发送
        });

        if (!res.ok) {
          throw new Error(`Failed to delete API: ${res.status}`);
        }

        console.log(`✅ API ${apiId} deleted successfully`);
      } catch (error) {
        console.error(`Error deleting API ${apiId}:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 删除Chatbot服务
  const deleteChatbotService = useCallback(
    async (chatbotId: string): Promise<void> => {
      try {
        const res = await fetch(`${apiServerUrl}/delete_chatbot/${chatbotId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error(`Failed to delete chatbot: ${res.status}`);
        }

        console.log(`✅ Chatbot ${chatbotId} deleted successfully`);
      } catch (error) {
        console.error(`Error deleting chatbot ${chatbotId}:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 创建API服务
  const createApiService = useCallback(
    async (
      workspaceId: string,
      apiData: Partial<ApiService>
    ): Promise<ApiService> => {
      try {
        const res = await fetch(`${apiServerUrl}/create_api`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            workspace_id: workspaceId,
            ...apiData,
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed to create API: ${res.status}`);
        }

        const data = await res.json();
        console.log(`✅ API created successfully`);
        return data.api;
      } catch (error) {
        console.error(`Error creating API:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 创建Chatbot服务
  const createChatbotService = useCallback(
    async (
      workspaceId: string,
      chatbotData: Partial<ChatbotService>
    ): Promise<ChatbotService> => {
      try {
        const res = await fetch(`${apiServerUrl}/create_chatbot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            workspace_id: workspaceId,
            ...chatbotData,
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed to create chatbot: ${res.status}`);
        }

        const data = await res.json();
        console.log(`✅ Chatbot created successfully`);
        return data.chatbot;
      } catch (error) {
        console.error(`Error creating chatbot:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 配置 Chatbot 服务
  const configChatbotService = useCallback(
    async (
      params: ConfigChatbotParams
    ): Promise<{
      chatbot_id: string;
      chatbot_key: string;
      endpoint?: string;
    }> => {
      try {
        // 认证现在由服务端代理处理
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const res = await fetch(`${apiServerUrl}/config_chatbot`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(params),
        });

        if (!res.ok) {
          throw new Error(`Failed to config chatbot: ${res.status}`);
        }

        const data = await res.json();
        console.log(`✅ Chatbot configured successfully`);
        return data;
      } catch (error) {
        console.error(`Error configuring chatbot:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 更新API服务
  const updateApiService = useCallback(
    async (
      apiId: string,
      updates: Partial<ApiService>
    ): Promise<ApiService> => {
      try {
        const res = await fetch(`${apiServerUrl}/update_api/${apiId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          throw new Error(`Failed to update API: ${res.status}`);
        }

        const data = await res.json();
        console.log(`✅ API ${apiId} updated successfully`);
        return data.api;
      } catch (error) {
        console.error(`Error updating API ${apiId}:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  // 更新Chatbot服务
  const updateChatbotService = useCallback(
    async (
      chatbotId: string,
      updates: Partial<ChatbotService>
    ): Promise<ChatbotService> => {
      try {
        const res = await fetch(`${apiServerUrl}/update_chatbot/${chatbotId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          throw new Error(`Failed to update chatbot: ${res.status}`);
        }

        const data = await res.json();
        console.log(`✅ Chatbot ${chatbotId} updated successfully`);
        return data.chatbot;
      } catch (error) {
        console.error(`Error updating chatbot ${chatbotId}:`, error);
        throw error;
      }
    },
    [apiServerUrl]
  );

  return {
    // 核心数据获取 - 只保留增强版本
    fetchAllEnhancedServices,
    fetchWorkspaceEnhancedServices,

    // 基础 API 调用（供内部使用）
    fetchUserDeployments,

    // CRUD 操作
    deleteApiService,
    deleteChatbotService,
    createApiService,
    createChatbotService,
    configChatbotService,
    updateApiService,
    updateChatbotService,

    // 配置信息
    apiServerUrl,
    // 注意：getUserToken 已移除，认证现在完全由服务端处理
  };
};

// 简化的组合 hooks
export const useServerManagement = () => {
  const operations = useServerOperations();

  // 删除任意类型的服务
  const deleteService = useCallback(
    async (serviceId: string, serviceType: 'api' | 'chatbot') => {
      if (serviceType === 'api') {
        return operations.deleteApiService(serviceId);
      } else {
        return operations.deleteChatbotService(serviceId);
      }
    },
    [operations]
  );

  return {
    ...operations,
    deleteService,
  };
};
