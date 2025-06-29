import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Layout } from 'react-grid-layout';

// 定义聊天消息的类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// 定义聊天历史的类型
export interface ChatHistory {
  messages: ChatMessage[];
}

// API服务状态接口
export interface ApiServiceState {
  layouts: { [key: string]: Layout[] };
  inputValues: Record<string, any>;
  output: any;
  isExecuting: boolean;
  error: string | null;
  executionTime: number | null;
  isConfigExpanded: boolean;
  isResizing: boolean;
  isDragging: boolean;
}

// Context类型定义
interface ServerDisplayContextType {
  // 聊天历史状态
  chatHistories: Record<string, ChatHistory>;
  updateChatHistory: (chatbotId: string, newMessage: ChatMessage) => void;
  clearChatHistory: (chatbotId: string) => void;
  
  // API服务状态
  apiServiceStates: Record<string, ApiServiceState>;
  updateApiServiceState: (apiId: string, updates: Partial<ApiServiceState>) => void;
  getCurrentApiServiceState: (apiId: string) => ApiServiceState;
}

// 创建Context
const ServerDisplayContext = createContext<ServerDisplayContextType | undefined>(undefined);

// Provider组件
interface ServerDisplayProviderProps {
  children: ReactNode;
}

export const ServerDisplayProvider: React.FC<ServerDisplayProviderProps> = ({ children }) => {
  // 聊天历史状态容器，使用 chatbot_id 作为 key
  const [chatHistories, setChatHistories] = useState<Record<string, ChatHistory>>({});

  // API服务状态容器，使用 api_id 作为 key
  const [apiServiceStates, setApiServiceStates] = useState<Record<string, ApiServiceState>>({});

  // 获取当前API服务的状态
  const getCurrentApiServiceState = useCallback((apiId: string): ApiServiceState => {
    const existingState = apiServiceStates[apiId];
    if (existingState) {
      return existingState;
    }

    // 如果没有现有状态，创建默认状态
    const defaultState: ApiServiceState = {
      layouts: {},
      inputValues: {},
      output: null,
      isExecuting: false,
      error: null,
      executionTime: null,
      isConfigExpanded: false,
      isResizing: false,
      isDragging: false
    };

    return defaultState;
  }, [apiServiceStates]);

  // 更新API服务状态
  const updateApiServiceState = useCallback((apiId: string, updates: Partial<ApiServiceState>) => {
    setApiServiceStates(prev => ({
      ...prev,
      [apiId]: {
        ...getCurrentApiServiceState(apiId),
        ...updates
      }
    }));
  }, [getCurrentApiServiceState]);

  // 更新聊天历史的函数
  const updateChatHistory = useCallback((chatbotId: string, newMessage: ChatMessage) => {
    setChatHistories(prev => {
      const currentHistory = prev[chatbotId];
      let messages = [];
      
      if (currentHistory && currentHistory.messages.length > 0) {
        // 如果已有聊天历史，直接添加新消息
        messages = [...currentHistory.messages, newMessage];
      } else {
        // 如果没有聊天历史，先添加问候语，再添加新消息
        const welcomeMessage: ChatMessage = {
          id: 'welcome-message',
          role: 'assistant',
          content: 'Hello, how can I assist you today?',
          timestamp: new Date()
        };
        messages = [welcomeMessage, newMessage];
      }
      
      const updatedHistory = {
        ...prev,
        [chatbotId]: {
          messages: messages
        }
      };
      return updatedHistory;
    });
  }, []);

  // 清空聊天历史的函数
  const clearChatHistory = useCallback((chatbotId: string) => {
    setChatHistories(prev => {
      const updatedHistories = {
        ...prev,
        [chatbotId]: { messages: [] }
      };
      return updatedHistories;
    });
  }, []);

  const contextValue: ServerDisplayContextType = {
    chatHistories,
    updateChatHistory,
    clearChatHistory,
    apiServiceStates,
    updateApiServiceState,
    getCurrentApiServiceState
  };

  return (
    <ServerDisplayContext.Provider value={contextValue}>
      {children}
    </ServerDisplayContext.Provider>
  );
};

// 自定义Hook来使用Context
export const useServerDisplayContext = () => {
  const context = useContext(ServerDisplayContext);
  if (context === undefined) {
    throw new Error('useServerDisplayContext must be used within a ServerDisplayProvider');
  }
  return context;
}; 