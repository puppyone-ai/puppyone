import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useServers } from '../states/UserServersContext';
import ChatbotServiceDisplay from './ChatbotServiceDisplay';
import ApiServiceDisplay from './ApiServiceDisplay';
import axios from 'axios';
import { Layout } from 'react-grid-layout';

// 定义聊天消息的类型
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// 定义聊天历史的类型
interface ChatHistory {
  messages: ChatMessage[];
}

// API服务状态接口
interface ApiServiceState {
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

const ServerDisplay: React.FC = () => {
  const { 
    currentServiceJson, 
    currentShowingId,
    isLoading 
  } = useServers();

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

  // 生成布局的函数
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
          minH: 2
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
        minH: 2
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
          minH: 2
        });
      });

      return layout;
    };

    return {
      lg: generateLayoutForBreakpoint(12),
      md: generateLayoutForBreakpoint(10),
      sm: generateLayoutForBreakpoint(6),
      xs: generateLayoutForBreakpoint(4),
      xxs: generateLayoutForBreakpoint(2)
    };
  }, []);

  // 计算当前API服务的布局
  const currentApiLayouts = useMemo(() => {
    if (currentServiceJson?.type === 'api' && currentServiceJson.api_id) {
      const apiId = currentServiceJson.api_id;
      const currentApiState = getCurrentApiServiceState(apiId);
      
      // 如果布局为空，生成初始布局
      if (Object.keys(currentApiState.layouts).length === 0) {
        return generateLayout(currentServiceJson);
      }
      return currentApiState.layouts;
    }
    return {};
  }, [currentServiceJson, getCurrentApiServiceState, generateLayout]);

  // 获取当前聊天机器人的聊天历史
  const getCurrentChatHistory = (): ChatHistory => {
    if (currentServiceJson?.type === 'chatbot' && currentServiceJson.chatbot_id) {
      const history = chatHistories[currentServiceJson.chatbot_id];
      if (history && history.messages.length > 0) {
        return history;
      } else {
        // 如果没有聊天历史或消息为空，返回包含问候语的初始历史
        return {
          messages: [{
            id: 'welcome-message',
            role: 'assistant',
            content: 'Hello, how can I assist you today?',
            timestamp: new Date()
          }]
        };
      }
    }
    return { messages: [] };
  };

  // 更新聊天历史的函数
  const updateChatHistory = (chatbotId: string, newMessage: ChatMessage) => {
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
  };

  // 清空聊天历史的函数
  const clearChatHistory = (chatbotId: string) => {
    setChatHistories(prev => {
      const updatedHistories = {
        ...prev,
        [chatbotId]: { messages: [] }
      };
      return updatedHistories;
    });
  };

  // 测试函数 - 添加测试消息到指定聊天机器人
  const addTestMessage = (chatbotId: string, role: 'user' | 'assistant') => {
    const testMessage: ChatMessage = {
      id: Date.now().toString(),
      role: role,
      content: `测试${role === 'user' ? '用户' : '助手'}消息 - ${new Date().toLocaleTimeString()}`,
      timestamp: new Date()
    };
    updateChatHistory(chatbotId, testMessage);
  };

  // 如果正在加载
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#131313]">
        <div className="flex flex-col items-center space-y-4">
          <svg className="animate-spin w-8 h-8 text-[#4599DF]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-[#CDCDCD] text-sm">Loading service...</span>
        </div>
      </div>
    );
  }

  // 如果没有选中的服务
  if (!currentServiceJson || !currentShowingId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#131313]">
        <div className="text-center">
          <div className="text-[#666666] text-lg mb-2">No Service Selected</div>
          <div className="text-[#888888] text-sm">Please select a service from the sidebar</div>
          
          {/* 测试区域 - 显示所有聊天历史状态 */}
          {Object.keys(chatHistories).length > 0 && (
            <div className="mt-8 p-4 bg-[#1A1A1A] rounded-lg border border-[#333] max-w-md mx-auto">
              <h3 className="text-[#CDCDCD] text-sm font-medium mb-3">聊天历史状态测试</h3>
              {Object.entries(chatHistories).map(([chatbotId, history]) => (
                <div key={chatbotId} className="mb-3 p-2 bg-[#252525] rounded border border-[#444]">
                  <div className="text-[#4599DF] text-xs font-medium mb-1">
                    Chatbot ID: {chatbotId}
                  </div>
                  <div className="text-[#888888] text-xs mb-2">
                    消息数量: {history.messages.length}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => addTestMessage(chatbotId, 'user')}
                      className="px-2 py-1 text-[10px] bg-[#4599DF] text-white rounded hover:bg-[#3A7BC8]"
                    >
                      添加用户消息
                    </button>
                    <button
                      onClick={() => addTestMessage(chatbotId, 'assistant')}
                      className="px-2 py-1 text-[10px] bg-[#9B7EDB] text-white rounded hover:bg-[#8A6FD1]"
                    >
                      添加助手消息
                    </button>
                    <button
                      onClick={() => clearChatHistory(chatbotId)}
                      className="px-2 py-1 text-[10px] bg-[#FF6B6B] text-white rounded hover:bg-[#E55A5A]"
                    >
                      清空
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 根据服务类型渲染不同的内容
  if (currentServiceJson.type === 'api') {
    const apiId = currentServiceJson.api_id;
    const currentApiState = getCurrentApiServiceState(apiId);
    
    // API服务状态更新回调函数
    const onLayoutChange = (newLayouts: { [key: string]: Layout[] }) => {
      updateApiServiceState(apiId, { layouts: newLayouts });
    };

    const onInputChange = (key: string, value: any, type: string) => {
      const newValue = type === 'number' ? (value === '' ? '' : Number(value)) : value;
      updateApiServiceState(apiId, {
        inputValues: {
          ...currentApiState.inputValues,
          [key]: newValue
        }
      });
    };

    const onOutputChange = (newOutput: any) => {
      updateApiServiceState(apiId, { output: newOutput });
    };

    const onExecutingChange = (isExecuting: boolean) => {
      updateApiServiceState(apiId, { isExecuting });
    };

    const onErrorChange = (error: string | null) => {
      updateApiServiceState(apiId, { error });
    };

    const onExecutionTimeChange = (executionTime: number | null) => {
      updateApiServiceState(apiId, { executionTime });
    };

    const onConfigExpandedChange = (isConfigExpanded: boolean) => {
      updateApiServiceState(apiId, { isConfigExpanded });
    };

    const onResizingChange = (isResizing: boolean) => {
      updateApiServiceState(apiId, { isResizing });
    };

    const onDraggingChange = (isDragging: boolean) => {
      updateApiServiceState(apiId, { isDragging });
    };

    return (
      <ApiServiceDisplay 
        service={currentServiceJson}
        layouts={currentApiLayouts}
        inputValues={currentApiState.inputValues}
        output={currentApiState.output}
        isExecuting={currentApiState.isExecuting}
        error={currentApiState.error}
        executionTime={currentApiState.executionTime}
        isConfigExpanded={currentApiState.isConfigExpanded}
        isResizing={currentApiState.isResizing}
        isDragging={currentApiState.isDragging}
        onLayoutChange={onLayoutChange}
        onInputChange={onInputChange}
        onOutputChange={onOutputChange}
        onExecutingChange={onExecutingChange}
        onErrorChange={onErrorChange}
        onExecutionTimeChange={onExecutionTimeChange}
        onConfigExpandedChange={onConfigExpandedChange}
        onResizingChange={onResizingChange}
        onDraggingChange={onDraggingChange}
      />
    );
  } else if (currentServiceJson.type === 'chatbot') {
    // 获取当前聊天机器人的聊天历史
    const currentChatHistory = getCurrentChatHistory();
    
    return (
      <ChatbotServiceDisplay 
        key={currentServiceJson.chatbot_id}
        service={currentServiceJson} 
        chatHistory={currentChatHistory}
        onUpdateChatHistory={updateChatHistory}
        onClearChatHistory={clearChatHistory}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#131313]">
      <div className="text-center">
        <div className="text-[#666666] text-lg mb-2">Unknown Service Type</div>
        <div className="text-[#888888] text-sm">Service type not supported</div>
      </div>
    </div>
  );
};

export default ServerDisplay;