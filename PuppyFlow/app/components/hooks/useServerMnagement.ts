/**
 * Server Operations Hooks
 * 
 * This file contains all the API operations for server/service management,
 * separated from the context to keep concerns separated.
 */

import { useCallback } from 'react';
import { SYSTEM_URLS } from '@/config/urls';
import { ApiService, ChatbotService, EnhancedApiService, EnhancedChatbotService } from '../states/UserServersContext';

// Hook for API operations
export const useServerOperations = () => {
  const apiServerKey = process.env.NEXT_PUBLIC_API_SERVER_KEY || '';
  const apiServerUrl = SYSTEM_URLS.API_SERVER.BASE;

  // 获取单个工作区的API列表
  const fetchApiList = useCallback(async (workspaceId: string): Promise<ApiService[]> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/list_apis/${workspaceId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
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
  }, [apiServerUrl, apiServerKey]);

  // 获取单个工作区的Chatbot列表
  const fetchChatbotList = useCallback(async (workspaceId: string): Promise<ChatbotService[]> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/list_chatbots/${workspaceId}?include_keys=true`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
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
  }, [apiServerUrl, apiServerKey]);

  // 删除API服务
  const deleteApiService = useCallback(async (apiId: string): Promise<void> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/delete_api/${apiId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete API: ${res.status}`);
      }

      console.log(`✅ API ${apiId} deleted successfully`);
    } catch (error) {
      console.error(`Error deleting API ${apiId}:`, error);
      throw error;
    }
  }, [apiServerUrl, apiServerKey]);

  // 删除Chatbot服务
  const deleteChatbotService = useCallback(async (chatbotId: string): Promise<void> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/delete_chatbot/${chatbotId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          }
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete chatbot: ${res.status}`);
      }

      console.log(`✅ Chatbot ${chatbotId} deleted successfully`);
    } catch (error) {
      console.error(`Error deleting chatbot ${chatbotId}:`, error);
      throw error;
    }
  }, [apiServerUrl, apiServerKey]);

  // 创建API服务
  const createApiService = useCallback(async (workspaceId: string, apiData: Partial<ApiService>): Promise<ApiService> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/create_api`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          },
          body: JSON.stringify({
            workspace_id: workspaceId,
            ...apiData
          })
        }
      );

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
  }, [apiServerUrl, apiServerKey]);

  // 创建Chatbot服务
  const createChatbotService = useCallback(async (workspaceId: string, chatbotData: Partial<ChatbotService>): Promise<ChatbotService> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/create_chatbot`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          },
          body: JSON.stringify({
            workspace_id: workspaceId,
            ...chatbotData
          })
        }
      );

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
  }, [apiServerUrl, apiServerKey]);

  // 更新API服务
  const updateApiService = useCallback(async (apiId: string, updates: Partial<ApiService>): Promise<ApiService> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/update_api/${apiId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          },
          body: JSON.stringify(updates)
        }
      );

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
  }, [apiServerUrl, apiServerKey]);

  // 更新Chatbot服务
  const updateChatbotService = useCallback(async (chatbotId: string, updates: Partial<ChatbotService>): Promise<ChatbotService> => {
    try {
      const res = await fetch(
        `${apiServerUrl}/update_chatbot/${chatbotId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": apiServerKey
          },
          body: JSON.stringify(updates)
        }
      );

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
  }, [apiServerUrl, apiServerKey]);

  return {
    // 获取操作
    fetchApiList,
    fetchChatbotList,
    
    // 删除操作
    deleteApiService,
    deleteChatbotService,
    
    // 创建操作
    createApiService,
    createChatbotService,
    
    // 更新操作
    updateApiService,
    updateChatbotService,
    
    // 配置信息
    apiServerKey,
    apiServerUrl
  };
};

// 简化的组合 hooks
export const useServerManagement = () => {
  const operations = useServerOperations();

  // 获取工作区的所有服务
  const fetchWorkspaceAllServices = useCallback(async (workspaceId: string) => {
    const [apis, chatbots] = await Promise.all([
      operations.fetchApiList(workspaceId),
      operations.fetchChatbotList(workspaceId)
    ]);

    return { apis, chatbots };
  }, [operations]);

  // 删除任意类型的服务
  const deleteService = useCallback(async (serviceId: string, serviceType: 'api' | 'chatbot') => {
    if (serviceType === 'api') {
      return operations.deleteApiService(serviceId);
    } else {
      return operations.deleteChatbotService(serviceId);
    }
  }, [operations]);

  return {
    ...operations,
    fetchWorkspaceAllServices,
    deleteService
  };
}; 