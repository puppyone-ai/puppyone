import { useCallback, useMemo } from 'react';
import { Layout } from 'react-grid-layout';
import {
  useServerDisplayContext,
  ChatMessage,
  ChatHistory,
} from './ServerDisplayContext';
import { SYSTEM_URLS } from '@/config/urls';
import axios from 'axios';

// 聊天历史相关 Hook
export const useChatHistory = (chatbotId: string) => {
  const { chatHistories, updateChatHistory, clearChatHistory } =
    useServerDisplayContext();

  const getCurrentChatHistory = useCallback((): ChatHistory => {
    if (chatbotId) {
      const history = chatHistories[chatbotId];
      if (history && history.messages.length > 0) {
        return history;
      } else {
        // 如果没有聊天历史或消息为空，返回包含问候语的初始历史
        return {
          messages: [
            {
              id: 'welcome-message',
              role: 'assistant',
              content: 'Hello, how can I assist you today?',
              timestamp: new Date(),
            },
          ],
        };
      }
    }
    return { messages: [] };
  }, [chatbotId, chatHistories]);

  // 测试函数 - 添加测试消息到指定聊天机器人
  const addTestMessage = useCallback(
    (role: 'user' | 'assistant') => {
      const testMessage: ChatMessage = {
        id: Date.now().toString(),
        role: role,
        content: `测试${role === 'user' ? '用户' : '助手'}消息 - ${new Date().toLocaleTimeString()}`,
        timestamp: new Date(),
      };
      updateChatHistory(chatbotId, testMessage);
    },
    [chatbotId, updateChatHistory]
  );

  return {
    chatHistory: getCurrentChatHistory(),
    updateChatHistory,
    clearChatHistory,
    addTestMessage,
  };
};

// API服务状态相关 Hook
export const useApiServiceState = (apiId: string) => {
  const { apiServiceStates, updateApiServiceState, getCurrentApiServiceState } =
    useServerDisplayContext();

  const currentState = useMemo(
    () => getCurrentApiServiceState(apiId),
    [apiId, apiServiceStates]
  );

  return {
    state: currentState,
    updateState: updateApiServiceState.bind(null, apiId),
  };
};

// 布局生成 Hook
export const useLayoutGeneration = () => {
  const generateLayout = useCallback((service: any) => {
    const inputParams = service.inputs ? Object.keys(service.inputs) : [];
    const outputParams = service.outputs ? Object.keys(service.outputs) : [];

    // 为不同断点生成布局
    const generateLayoutForBreakpoint = (cols: number) => {
      const layout: Layout[] = [];

      // 输入参数 - 第一列，所有元素都是3x2
      inputParams.forEach((paramKey: string, index: number) => {
        layout.push({
          i: `input-${paramKey}`,
          x: 0,
          y: index * 3,
          w: 3,
          h: 2,
          minW: 3,
          minH: 2,
        });
      });

      // Execute 按钮 - 第二列，3x2
      layout.push({
        i: 'execute',
        x: 4,
        y: 0,
        w: 2,
        h: 2,
        minW: 2,
        minH: 2,
      });

      // 输出参数 - 第三列，所有元素都是3x2
      outputParams.forEach((paramKey: string, index: number) => {
        layout.push({
          i: `output-${paramKey}`,
          x: 8,
          y: index * 3,
          w: 3,
          h: 2,
          minW: 3,
          minH: 2,
        });
      });

      return layout;
    };

    return {
      lg: generateLayoutForBreakpoint(12),
      md: generateLayoutForBreakpoint(10),
      sm: generateLayoutForBreakpoint(6),
      xs: generateLayoutForBreakpoint(4),
      xxs: generateLayoutForBreakpoint(2),
    };
  }, []);

  const generateLayoutForService = useCallback(
    (service: any) => {
      if (service?.type === 'api' && service.api_id) {
        return generateLayout(service);
      }
      return {};
    },
    [generateLayout]
  );

  return { generateLayout, generateLayoutForService };
};

// API执行 Hook
export const useApiExecution = (service: any) => {
  const { state, updateState } = useApiServiceState(service?.api_id || '');
  const API_SERVER_URL = '/api/server';

  const executeWorkflow = useCallback(async () => {
    if (!service?.api_id) return;

    updateState({ isExecuting: true, error: null, output: null });

    const startTime = Date.now();

    try {
      // 将 inputValues 转换为按照 parameter ID 作为键的格式
      const requestData: Record<string, any> = {};
      Object.entries(state.inputValues || {}).forEach(([key, value]) => {
        const parameterId = service.inputs[key];
        if (parameterId) {
          requestData[parameterId] = value;
        }
      });

      // 通过代理调用，认证由服务端处理
      const endpoint = `${API_SERVER_URL}/api/${service.api_id}`;
      const response = await axios.post(endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          // API密钥现在由服务端代理注入，客户端不再直接处理
        },
        withCredentials: true, // 确保cookie被发送
        timeout: 30000,
      });

      const endTime = Date.now();
      updateState({
        executionTime: endTime - startTime,
        output: response.data,
        isExecuting: false,
      });
    } catch (err: any) {
      const endTime = Date.now();

      let errorMessage = 'Unknown error';
      if (err.response) {
        errorMessage = `API Error (${err.response.status}): ${err.response.data?.message || err.response.data || 'Unknown error'}`;
      } else if (err.request) {
        errorMessage = 'Network Error: Unable to reach the API server';
      } else {
        errorMessage = `Error: ${err.message}`;
      }

      updateState({
        executionTime: endTime - startTime,
        error: errorMessage,
        isExecuting: false,
      });
    }
  }, [service, updateState, API_SERVER_URL, state.inputValues]);

  return { executeWorkflow };
};

// 聊天机器人通信 Hook
export const useChatbotCommunication = (service: any) => {
  const { chatHistory, updateChatHistory } = useChatHistory(
    service?.chatbot_id || ''
  );
  const API_SERVER_URL = '/api/server';

  const handleSendMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!service?.chatbot_id) {
        throw new Error('Chatbot ID not found');
      }

      try {
        // 准备请求头 - 认证现在由服务端代理处理
        const headers = {
          'Content-Type': 'application/json',
          // chatbot_key 现在由服务端代理注入，客户端不再直接处理
        };

        // 准备请求体
        const requestBody: any = {
          input: {
            [service.input || 'input_block']: message,
          },
        };

        // 添加聊天历史（如果可用）
        if (chatHistory.messages.length > 0) {
          // 将聊天历史转换为 API 期望的格式
          const apiChatHistory = chatHistory.messages.map(
            (msg: ChatMessage) => ({
              role: msg.role,
              content: msg.content,
            })
          );

          requestBody.chat_history = {
            [service.history || 'history_block']: apiChatHistory,
          };
        }

        // 构造端点 URL
        const endpoint = `${API_SERVER_URL}/chat/${service.chatbot_id}`;
        console.log(`🔍 发送消息到端点: ${endpoint}`);
        console.log('🔍 请求体:', requestBody);

        // 添加用户消息到聊天历史
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: message,
          timestamp: new Date(),
        };
        updateChatHistory(service.chatbot_id, userMessage);

        // 发送 API 请求
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          credentials: 'include', // 确保cookie被发送
        });

        if (response.ok) {
          const data = await response.json();

          // 从输出对象中提取响应
          const outputKeys = Object.keys(data.output || {});
          const botResponse =
            outputKeys.length > 0
              ? data.output[outputKeys[0]]
              : 'No response received';

          // 添加助手消息到聊天历史
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: botResponse,
            timestamp: new Date(),
          };
          updateChatHistory(service.chatbot_id, assistantMessage);

          return botResponse;
        } else {
          throw new Error(`API 调用失败，状态码: ${response.status}`);
        }
      } catch (error) {
        console.error(
          `🔍 与聊天机器人 ${service.chatbot_id} 通信时出错:`,
          error
        );

        // 添加错误消息到聊天历史
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '抱歉，我暂时无法处理您的请求。请稍后再试。',
          timestamp: new Date(),
        };
        updateChatHistory(service.chatbot_id, errorMessage);

        return '抱歉，我暂时无法处理您的请求。请稍后再试。';
      }
    },
    [service, updateChatHistory, API_SERVER_URL, chatHistory.messages]
  );

  return { handleSendMessage };
};

// 服务验证 Hook
export const useServiceValidation = (service: any) => {
  const isValidApiService = useMemo(() => {
    // API密钥验证现在由服务端处理，客户端只需要检查基本信息
    return service?.type === 'api' && service?.api_id;
  }, [service]);

  const isValidChatbotService = useMemo(() => {
    // Chatbot密钥验证现在由服务端处理，客户端只需要检查基本信息
    return service?.type === 'chatbot' && service?.chatbot_id;
  }, [service]);

  const isServiceConfigured = useMemo(() => {
    if (service?.type === 'api') {
      return service.inputs && Object.keys(service.inputs).length > 0;
    } else if (service?.type === 'chatbot') {
      return service.input && service.output;
    }
    return false;
  }, [service]);

  return {
    isValidApiService,
    isValidChatbotService,
    isServiceConfigured,
  };
};

// 工具函数 Hook
export const useUtils = () => {
  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('📋 Endpoint copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, []);

  return { copyToClipboard };
};
