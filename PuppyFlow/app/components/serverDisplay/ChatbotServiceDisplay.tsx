import React, { useState, useEffect } from 'react';
import { SYSTEM_URLS } from '@/config/urls';
import { ChatInterface } from 'puppychat';

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

interface ChatbotServiceDisplayProps {
  service: any;
  chatHistory?: ChatHistory;
  onUpdateChatHistory?: (chatbotId: string, newMessage: ChatMessage) => void;
  onClearChatHistory?: (chatbotId: string) => void;
}

// 自定义的 ChatInterfaceDeployed 组件，使用外部传入的聊天历史
const CustomChatInterfaceDeployed: React.FC<{
  chatbotId: string;
  baseUrl: string;
  chatbotKey: string;
  inputBlockId: string;
  historyBlockId: string;
  chatHistory: ChatHistory;
  onUpdateChatHistory?: (chatbotId: string, newMessage: ChatMessage) => void;
  onClearChatHistory?: (chatbotId: string) => void;
  [key: string]: any;
}> = ({ 
  chatbotId, 
  baseUrl, 
  chatbotKey, 
  inputBlockId, 
  historyBlockId, 
  chatHistory, 
  onUpdateChatHistory, 
  onClearChatHistory,
  ...otherProps 
}) => {
  
  // 自定义的消息处理函数
  const handleSendMessage = async (message: string): Promise<string> => {
    try {
      // 准备请求头
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${chatbotKey}`
      };

      // 准备请求体
      const requestBody: any = {
        input: {
          [inputBlockId]: message
        }
      };

      // 添加聊天历史（如果可用）
      if (chatHistory.messages.length > 0) {
        // 将聊天历史转换为 API 期望的格式
        const apiChatHistory = chatHistory.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
        
        requestBody.chat_history = {
          [historyBlockId]: apiChatHistory
        };
      }

      // 构造端点 URL
      const endpoint = `${baseUrl}/chat/${chatbotId}`;
      console.log(`🔍 发送消息到端点: ${endpoint}`);
      console.log('🔍 请求体:', requestBody);

      // 添加用户消息到聊天历史
      if (onUpdateChatHistory) {
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: message,
          timestamp: new Date()
        };
        onUpdateChatHistory(chatbotId, userMessage);
      }

      // 发送 API 请求
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const data = await response.json();
        
        // 从输出对象中提取响应
        const outputKeys = Object.keys(data.output || {});
        const botResponse = outputKeys.length > 0 ? data.output[outputKeys[0]] : 'No response received';
        
        // 添加助手消息到聊天历史
        if (onUpdateChatHistory) {
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: botResponse,
            timestamp: new Date()
          };
          onUpdateChatHistory(chatbotId, assistantMessage);
        }
        
        return botResponse;
      } else {
        throw new Error(`API 调用失败，状态码: ${response.status}`);
      }
    } catch (error) {
      console.error(`🔍 与聊天机器人 ${chatbotId} 通信时出错:`, error);
      
      // 添加错误消息到聊天历史
      if (onUpdateChatHistory) {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '抱歉，我暂时无法处理您的请求。请稍后再试。',
          timestamp: new Date()
        };
        onUpdateChatHistory(chatbotId, errorMessage);
      }
      
      return '抱歉，我暂时无法处理您的请求。请稍后再试。';
    }
  };

  // 将聊天历史转换为 puppychat 期望的格式
  const initialMessages = chatHistory.messages.map(msg => ({
    id: msg.id,
    sender: msg.role === 'assistant' ? 'bot' as const : 'user' as const,
    content: msg.content,
    timestamp: msg.timestamp
  }));


  // 自定义清空聊天历史的函数
  const handleClearChat = () => {
    if (onClearChatHistory) {
      onClearChatHistory(chatbotId);
    }
  };

  return (
    <ChatInterface
      onSendMessage={handleSendMessage}
      initialMessages={initialMessages}
      {...otherProps}
    />
  );
};

const ChatbotServiceDisplay: React.FC<ChatbotServiceDisplayProps> = ({ 
  service, 
  chatHistory = { messages: [] }, 
  onUpdateChatHistory, 
  onClearChatHistory 
}) => {
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('📋 Endpoint copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  // 状态信息区域组件
  const StatusSection = () => (
    <>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Chatbot ID: <span className="text-[#606060] break-all">{service.chatbot_id}</span></span>
      </div>

      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Endpoint: <span className="text-[#606060] break-all">
          /chat/{service.chatbot_id}
        </span></span>
      </div>

      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Chatbot Key: <span className={`break-all ${service.chatbot_key ? "text-[#606060]" : "text-[#FF6B6B]"}`}>
          {service.chatbot_key || 'Not configured'}
        </span></span>
      </div>

      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Input Node: <span className={`break-all ${service.input ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}`}>
          {service.input || 'Not configured'}
        </span></span>
      </div>

      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Output Node: <span className={`break-all ${service.output ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}`}>
          {service.output || 'Not configured'}
        </span></span>
      </div>

      <div className="text-[11px] text-[#505050] break-words">
        <span>History Node: <span className={`break-all ${service.history ? "text-[#2DFF7C]" : "text-[#606060]"}`}>
          {service.history || 'Not configured (optional)'}
        </span></span>
      </div>

      {/* 聊天历史信息 */}
      <div className="text-[11px] text-[#505050] mt-4 pt-4 border-t border-[#333] break-words">
        <span>Chat History: <span className="text-[#4599DF] break-all">
          {chatHistory.messages.length} messages stored
        </span></span>
      </div>
      
      {chatHistory.messages.length > 0 && (
        <div className="text-[10px] text-[#666666] mt-2 max-h-20 overflow-y-auto">
          {chatHistory.messages.slice(-3).map((msg, index) => (
            <div key={msg.id} className="mb-1">
              <span className={`${msg.role === 'user' ? 'text-[#4599DF]' : 'text-[#9B7EDB]'}`}>
                {msg.role === 'user' ? 'User' : 'Assistant'}:
              </span>
              <span className="text-[#888888] ml-1 truncate block">
                {msg.content.substring(0, 50)}{msg.content.length > 50 ? '...' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 测试按钮 */}
      <div className="mt-4 pt-4 border-t border-[#333]">
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (onUpdateChatHistory) {
                const testMessage: ChatMessage = {
                  id: Date.now().toString(),
                  role: 'user',
                  content: `测试消息 ${new Date().toLocaleTimeString()}`,
                  timestamp: new Date()
                };
                onUpdateChatHistory(service.chatbot_id, testMessage);
                console.log('🔍 添加测试用户消息:', testMessage);
              }
            }}
            className="px-2 py-1 text-[10px] bg-[#4599DF] text-white rounded hover:bg-[#3A7BC8] transition-colors"
          >
            添加用户消息
          </button>
          <button
            onClick={() => {
              if (onUpdateChatHistory) {
                const testMessage: ChatMessage = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: `测试回复 ${new Date().toLocaleTimeString()}`,
                  timestamp: new Date()
                };
                onUpdateChatHistory(service.chatbot_id, testMessage);
                console.log('🔍 添加测试助手消息:', testMessage);
              }
            }}
            className="px-2 py-1 text-[10px] bg-[#9B7EDB] text-white rounded hover:bg-[#8A6FD1] transition-colors"
          >
            添加助手消息
          </button>
          <button
            onClick={() => {
              if (onClearChatHistory) {
                onClearChatHistory(service.chatbot_id);
                console.log('🔍 清空聊天历史');
              }
            }}
            className="px-2 py-1 text-[10px] bg-[#FF6B6B] text-white rounded hover:bg-[#E55A5A] transition-colors"
          >
            清空历史
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] bg-[#252525]">
      <div className="w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px] relative">
        <div className="w-full h-full overflow-auto">
          <div className="w-full max-w-[1200px] mx-auto h-full">
            {/* Header - 统一结构 */}
            <div className="bg-transparent">
              <div className="mb-[16px] pb-[16px] border-b border-[#303030] flex items-center px-[16px] pt-[32px]">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 border border-[#A78BFA] bg-[#2A2A2A] rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#A78BFA]" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                        <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-[16px] font-medium text-[#CDCDCD]">Chatbot Service</h1>
                      <span className="text-[12px] text-[#888888]">{service.workspaceName}</span>
                    </div>
                  </div>
                  
                  {/* 配置信息折叠按钮 */}
                  <div className="relative">
                    <div className="bg-[#1A1A1A] rounded-full border border-[#333] flex-shrink-0">
                      <button
                        onClick={() => setIsConfigExpanded(!isConfigExpanded)}
                        className="w-10 h-10 flex items-center justify-center text-left hover:bg-[#222] transition-colors rounded-full"
                      >
                        <svg 
                          className={`w-4 h-4 text-[#888888] transition-transform ${isConfigExpanded ? 'rotate-180' : ''}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isConfigExpanded && (
                        <div className="absolute top-full mt-2 right-0 w-80 bg-[#1A1A1A] rounded-lg border border-[#333] shadow-lg z-30">
                          <div className="bg-transparent rounded-lg p-4">
                            <StatusSection />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 聊天界面容器 */}
            <div className="px-[32px] pb-[16px]">
              <div className="w-full h-[calc(100vh-220px)] flex items-center justify-center relative">
                <div className="w-full h-full [&>*]:!shadow-none">
                  <CustomChatInterfaceDeployed
                    chatbotId={service.chatbot_id}
                    baseUrl={API_SERVER_URL}
                    chatbotKey={service.chatbot_key || ''}
                    inputBlockId={service.input || 'input_block'}
                    historyBlockId={service.history || 'history_block'}
                    chatHistory={chatHistory}
                    onUpdateChatHistory={onUpdateChatHistory}
                    onClearChatHistory={onClearChatHistory}
                    title="Deployed Chatbot"
                    placeholder={service.input ? "Type your message here..." : "Configure input node first..."}
                    welcomeMessage={service.welcome_message || "Welcome to your deployed chatbot! Start chatting to interact with your bot."}
                    width="100%"
                    height="100%"
                    recommendedQuestions={[]}
                    showHeader={false}
                    backgroundColor="transparent"
                    borderWidth={0}
                    showAvatar={false}
                    enableFallback={true}
                    errorMessage="Oops! I'm having trouble connecting right now. Please try again in a moment."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatbotServiceDisplay; 