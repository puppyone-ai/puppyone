import React, { useState, useEffect } from 'react';
import { useServers } from '../states/UserServersContext';
import ChatbotServiceDisplay from './ChatbotServiceDisplay';
import ApiServiceDisplay from './ApiServiceDisplay';
import axios from 'axios';

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

const ServerDisplay: React.FC = () => {
  const { 
    currentServiceJson, 
    currentShowingId,
    isLoading 
  } = useServers();

  // 聊天历史状态容器，使用 chatbot_id 作为 key
  const [chatHistories, setChatHistories] = useState<Record<string, ChatHistory>>({});

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
    // console.log('🔍 ServerDisplay - 传递给 ApiServiceDisplay 的 service:', currentServiceJson);
    // console.log('🔍 ServerDisplay - API service workflow_json:', currentServiceJson.workflow_json);
    return <ApiServiceDisplay service={currentServiceJson} />;
  } else if (currentServiceJson.type === 'chatbot') {
    // console.log('🔍 ServerDisplay - 传递给 ChatbotServiceDisplay 的 service:', currentServiceJson);
    // console.log('🔍 ServerDisplay - Chatbot service workflow_json:', currentServiceJson.workflow_json);
    
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