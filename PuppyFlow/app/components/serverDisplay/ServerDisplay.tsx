import React, { useState, useEffect } from 'react';
import { useServers } from '../states/UserServersContext';
import { SYSTEM_URLS } from '@/config/urls';
import { ChatInterfaceDeployed } from 'puppychat';
import axios from 'axios';

const ServerDisplay: React.FC = () => {
  const { 
    currentServiceJson, 
    currentShowingId,
    isLoading 
  } = useServers();

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
        </div>
      </div>
    );
  }

  // 根据服务类型渲染不同的内容
  if (currentServiceJson.type === 'api') {
    return <ApiServiceDisplay service={currentServiceJson} />;
  } else if (currentServiceJson.type === 'chatbot') {
    return <ChatbotServiceDisplay service={currentServiceJson} />;
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

// API 服务显示组件
const ApiServiceDisplay: React.FC<{ service: any }> = ({ service }) => {
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
  const endpoint = `${API_SERVER_URL}/execute_workflow/${service.api_id}`;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('📋 Endpoint copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <div className="w-full h-full bg-[#131313] p-8">
      <div className="max-w-4xl mx-auto">
        {/* 标题区域 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#3B82F6]/20 rounded-lg">
              <svg className="w-6 h-6 text-[#60A5FA]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">API Service</h1>
              <p className="text-[#888888]">Workspace: {service.workspaceName}</p>
            </div>
          </div>
        </div>

        {/* 服务信息卡片 */}
        <div className="bg-[#1F1F1F] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Service Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#AAAAAA] mb-1">Service ID</label>
              <div className="flex items-center gap-2">
                <code className="bg-[#2A2A2A] px-3 py-2 rounded text-[#CDCDCD] font-mono text-sm flex-1">
                  {service.api_id}
                </code>
                <button
                  onClick={() => copyToClipboard(service.api_id)}
                  className="p-2 hover:bg-[#404040] rounded text-[#888888] hover:text-[#CDCDCD] transition-colors"
                  title="Copy Service ID"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#AAAAAA] mb-1">API Key</label>
              <div className="flex items-center gap-2">
                <code className="bg-[#2A2A2A] px-3 py-2 rounded text-[#CDCDCD] font-mono text-sm flex-1">
                  {service.api_key ? `${service.api_key.substring(0, 8)}...` : 'Not available'}
                </code>
                {service.api_key && (
                  <button
                    onClick={() => copyToClipboard(service.api_key)}
                    className="p-2 hover:bg-[#404040] rounded text-[#888888] hover:text-[#CDCDCD] transition-colors"
                    title="Copy API Key"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* API 端点信息 */}
        <div className="bg-[#1F1F1F] rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">API Endpoint</h2>
          <div className="flex items-center gap-2 mb-4">
            <code className="bg-[#2A2A2A] px-3 py-2 rounded text-[#CDCDCD] font-mono text-sm flex-1">
              {endpoint}
            </code>
            <button
              onClick={() => copyToClipboard(endpoint)}
              className="px-4 py-2 bg-[#4599DF] hover:bg-[#3A8BD1] text-white rounded transition-colors"
            >
              Copy Endpoint
            </button>
          </div>
          <p className="text-[#888888] text-sm">
            Use this endpoint to make API calls to your deployed service.
          </p>
        </div>

        {/* 输入输出信息 */}
        {(service.inputs || service.outputs) && (
          <div className="bg-[#1F1F1F] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Input/Output Schema</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {service.inputs && (
                <div>
                  <h3 className="text-md font-medium text-[#AAAAAA] mb-2">Inputs</h3>
                  <pre className="bg-[#2A2A2A] p-3 rounded text-[#CDCDCD] text-sm overflow-auto">
                    {JSON.stringify(service.inputs, null, 2)}
                  </pre>
                </div>
              )}
              {service.outputs && (
                <div>
                  <h3 className="text-md font-medium text-[#AAAAAA] mb-2">Outputs</h3>
                  <pre className="bg-[#2A2A2A] p-3 rounded text-[#CDCDCD] text-sm overflow-auto">
                    {JSON.stringify(service.outputs, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Chatbot 服务显示组件
const ChatbotServiceDisplay: React.FC<{ service: any }> = ({ service }) => {
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
        {/* 聊天界面 - 使用新的 ChatInterfaceDeployed 组件 */}
        <div className="w-full h-full p-[8px] flex items-center justify-center relative">
          <div className="w-full max-w-[1200px] h-full [&>*]:!shadow-none">
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
              showHeader={true}
              backgroundColor="transparent"
              borderWidth={0}
              showAvatar={false}
              enableFallback={true}
              errorMessage="Oops! I'm having trouble connecting right now. Please try again in a moment."
            />
          </div>

          {/* 右侧可折叠的配置信息区域 - 现在在聊天界面内部 */}
          <div className="absolute top-16 right-4 z-20">
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
                <div className="absolute top-full mt-2 right-0 w-80 bg-[#1A1A1A] rounded-lg border border-[#333] shadow-lg">
                  {/* 配置状态信息 */}
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
  );
};

export default ServerDisplay;