import React, { useState } from 'react';
import { SYSTEM_URLS } from '@/config/urls';
import { ChatInterfaceDeployed } from 'puppychat';

interface ChatbotServiceDisplayProps {
  service: any;
}

const ChatbotServiceDisplay: React.FC<ChatbotServiceDisplayProps> = ({ service }) => {
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
                  <ChatInterfaceDeployed
                    chatbotId={service.chatbot_id}
                    baseUrl={API_SERVER_URL}
                    chatbotKey={service.chatbot_key || ''}
                    inputBlockId={service.input || 'input_block'}
                    historyBlockId={service.history || 'history_block'}
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