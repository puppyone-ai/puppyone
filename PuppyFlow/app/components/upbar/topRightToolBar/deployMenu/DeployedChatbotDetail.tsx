import React, { useState } from 'react';
import ChatbotTestInterface from './ChatbotTestInterface';
import { useDeployPanelContext } from '@/app/components/states/DeployPanelContext';

interface DeployedChatbotDetailProps {
  chatbotId: string;
  API_SERVER_URL: string;
  setActivePanel: (panel: string | null) => void;
  onDelete: () => void;
  selectedFlowId: string | null;
  input?: string;
  output?: string;
}

function DeployedChatbotDetail({
  chatbotId,
  API_SERVER_URL,
  setActivePanel,
  input,
  output,
}: DeployedChatbotDetailProps) {
  const { deployedServices } = useDeployPanelContext();
  
  // 通过 chatbotId 从 context 中获取 chatbot 配置
  const chatbotService = deployedServices.chatbots.find(service => service.chatbot_id === chatbotId);
  
  // 修改：将 selectedSDK 改为 activeTab，用于管理 tab 切换
  const [activeTab, setActiveTab] = useState<'details' | 'bubble' | null>(null);
  const [showChatbotTest, setShowChatbotTest] = useState(false);

  // 如果找不到 chatbot 配置，显示错误信息
  if (!chatbotService) {
    return (
      <div className="py-[16px] px-[16px]">
        <div className="text-[#E74C3C] text-center">
          Chatbot configuration not found for ID: {chatbotId}
        </div>
      </div>
    );
  }

  // 检查是否启用了多轮对话
  const isMultiTurnEnabled = chatbotService.multi_turn_enabled || chatbotService.config?.multiTurn;
  
  // 使用传入的 input/output，如果没有则使用 context 中的数据作为备选
  const finalInput = input || chatbotService.input;
  const finalOutput = output || chatbotService.output;

  // 修改：处理 tab 切换
  const handleTabSwitch = (tab: 'details' | 'bubble' | null) => {
    setActiveTab(tab);
  };

  // 切换聊天机器人测试界面
  const toggleChatbotTest = (show: boolean) => {
    setShowChatbotTest(show);
  };

  return (
    <div className="py-[16px] px-[16px] max-h-[80vh] overflow-y-auto">
      {/* 头部导航 */}
      <div className="flex items-center mb-4">
        <button
          className="mr-2 p-1 rounded-full hover:bg-[#2A2A2A]"
          onClick={() => setActivePanel(null)}
        >
          <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-[#CDCDCD] text-[16px]">Chatbot Details</h2>
      </div>

      {/* 输入输出节点信息 - 使用传入的 props */}
      <div className="grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]">
        <div className="p-4 bg-[#1A1A1A]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>User Messages</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#404040]">
                <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                  className="text-[#3B9BFF]"
                >
                  <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {finalInput ? (
              <div className="h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]">
                <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                  <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="flex-shrink-0 text-[12px]">{finalInput}</span>
                <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-[#808080] py-2 text-center">
                No input node found
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-[#1A1A1A] border-l border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Bot Responses</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div
                className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#3B9BFF]/30 hover:border-[#3B9BFF]/50 transition-colors cursor-help"
                title="Text Block"
              >
                <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                  className="text-[#3B9BFF]"
                >
                  <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {finalOutput ? (
              <div className="h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]">
                <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                  <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="flex-shrink-0 text-[12px]">{finalOutput}</span>
                <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-[#808080] py-2 text-center">
                No output node found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Memory 节点信息 - 修改显示条件 */}
      {isMultiTurnEnabled && chatbotService.history && (
        <div className="mb-8 p-4 bg-[#1A1A1A] rounded-lg border border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Chat History</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#404040]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                  className="text-[#9B7EDB]"
                >
                  <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                  <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                  <path d="M9 9H11V11H9V9Z" className="fill-current" />
                  <path d="M9 13H11V15H9V13Z" className="fill-current" />
                  <path d="M13 9H15V11H13V9Z" className="fill-current" />
                  <path d="M13 13H15V15H13V13Z" className="fill-current" />
                </svg>
              </div>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium">
            <div className="h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                <path d="M9 9H11V11H9V9Z" className="fill-current" />
                <path d="M9 13H11V15H9V13Z" className="fill-current" />
                <path d="M13 9H15V11H13V9Z" className="fill-current" />
                <path d="M13 13H15V15H13V13Z" className="fill-current" />
              </svg>
              <span className="flex-shrink-0 text-[12px]">{chatbotService.history}</span>
              <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chatbot 配置信息 */}
      <div className="mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
        <h3 className="text-[#CDCDCD] text-[14px] mb-3">Chatbot Settings</h3>
        <div className="space-y-3">
          {/* 多轮对话设置 */}
          <div className="flex items-center justify-between">
            <span className="text-[#CDCDCD] text-[14px]">Enable Multi-turn Dialogue</span>
            <div className={`w-12 h-6 rounded-full ${
              isMultiTurnEnabled ? 'bg-[#3B9BFF]' : 'bg-[#404040]'
            }`}>
              <div className={`w-5 h-5 rounded-full bg-white transform transition-transform duration-200 ${
                isMultiTurnEnabled ? 'translate-x-6' : 'translate-x-1'
              } mt-0.5`} />
            </div>
          </div>

          {/* 欢迎消息 */}
          <div>
            <label className="block text-[#CDCDCD] text-[14px] mb-2">Welcome Message</label>
            <div className="w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]">
              {chatbotService.config?.welcomeMessage || chatbotService.welcome_message || 'Hello! How can I help you today?'}
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="mb-6">
        <div className="flex gap-3 mb-4">
          <button
            className="flex-1 h-[48px] rounded-[8px] transition duration-200 
              flex items-center justify-center gap-2
              bg-[#3B9BFF] text-white hover:bg-[#2980B9] hover:scale-105"
            onClick={() => toggleChatbotTest(true)}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" />
              <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Test Chatbot
          </button>
        </div>
      </div>

      {/* Tab 选择器和内容区域 */}
      <div className="mt-4 w-full">
        {/* Tab 选择器 */}
        <div className="flex gap-4 justify-center mb-4">
          <div
            className={`flex flex-col items-center cursor-pointer transition duration-200 hover:scale-105`}
            style={{ width: '80px' }}
            onClick={() => handleTabSwitch('details')}
          >
            <div
              className={`w-[48px] h-[48px] rounded-[8px] transition duration-200 
                flex items-center justify-center
                hover:bg-[#252525] hover:shadow-md
                bg-[#1A1A1A] border border-[#404040]
                ${activeTab === 'details'
                  ? 'border-[#3B9BFF] text-[#3B9BFF] bg-[#3B9BFF]/10'
                  : 'text-[#CDCDCD] hover:border-[#505050]'
                }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" className="fill-current" />
                <path d="M8.5 10C9.33 10 10 9.33 10 8.5C10 7.67 9.33 7 8.5 7C7.67 7 7 7.67 7 8.5C7 9.33 7.67 10 8.5 10Z" className="fill-current" />
                <path d="M15.5 10C16.33 10 17 9.33 17 8.5C17 7.67 16.33 7 15.5 7C14.67 7 14 7.67 14 8.5C14 9.33 14.67 10 15.5 10Z" className="fill-current" />
                <path d="M12 17.5C14.33 17.5 16.31 16.04 17 14H7C7.69 16.04 9.67 17.5 12 17.5Z" className="fill-current" />
              </svg>
            </div>
            <span className="text-[10px] leading-tight text-center mt-1 text-[#CDCDCD]">
              Chatbot Details
            </span>
          </div>

          <div
            className={`flex flex-col items-center cursor-pointer transition duration-200 hover:scale-105`}
            style={{ width: '80px' }}
            onClick={() => handleTabSwitch('bubble')}
          >
            <div
              className={`w-[48px] h-[48px] rounded-[8px] transition duration-200 
                flex items-center justify-center
                hover:bg-[#252525] hover:shadow-md
                bg-[#1A1A1A] border border-[#404040]
                ${activeTab === 'bubble'
                  ? 'border-[#3B9BFF] text-[#3B9BFF] bg-[#3B9BFF]/10'
                  : 'text-[#CDCDCD] hover:border-[#505050]'
                }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="16" rx="2"
                  className="stroke-current"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path d="M2 6h20"
                  className="stroke-current"
                  strokeWidth="1.5"
                />
                <circle cx="4.5" cy="4" r="0.75" className="fill-current" />
                <circle cx="7.5" cy="4" r="0.75" className="fill-current" />
                <circle cx="10.5" cy="4" r="0.75" className="fill-current" />
                <circle cx="19.5" cy="18" r="4.5"
                  className="fill-current"
                />
              </svg>
            </div>
            <span className="text-[10px] leading-tight text-center mt-1 text-[#CDCDCD]">
              Website Bubble
            </span>
          </div>
        </div>

        {/* Tab 内容区域 */}
        {activeTab && (
          <div className="py-3 px-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
            <div className="flex justify-between items-start">
              <span className="text-[14px] text-[#CDCDCD] font-medium">
                {activeTab === 'bubble' ? 'Website Bubble Integration' : 'Chatbot Details'}
              </span>
              <button
                className="text-[12px] text-[#3B9BFF] hover:underline flex items-center"
                onClick={() => handleTabSwitch(null)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 18L18 6M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="ml-1">Close</span>
              </button>
            </div>

            {activeTab === 'bubble' ? (
              <div className="mt-3">
                <code className="block p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto max-h-[200px] overflow-y-auto">
                  {`import { ChatBubbleDeployed } from 'puppychat';

// Add this component to your React app
<ChatBubbleDeployed
  chatbotId="${chatbotService.chatbot_id}"
  baseUrl="${chatbotService.endpoint?.replace('/api/' + chatbotService.chatbot_id, '') || API_SERVER_URL}"
  chatbotKey="${chatbotService.chatbot_key || 'your_chatbot_key'}"
  inputBlockId="${finalInput || 'input_block'}"${isMultiTurnEnabled && chatbotService.history ? `
  historyBlockId="${chatbotService.history}"` : ''}
  chatProps={{
    title: "AI Assistant",
    placeholder: "Ask me anything...",
    welcomeMessage: "${chatbotService.config?.welcomeMessage || chatbotService.welcome_message || 'Hello! How can I help you today?'}",
    width: '400px',
    height: '600px',
    recommendedQuestions: [
      "Introduce your product",
      "Introduce your company",
      "Introduce your team",
    ]
  }}
  bubbleProps={{
    size: 64,
    pulseAnimation: true
  }}
  position="bottom-right"
  enableOverlay={true}
  overlayOpacity={0.3}
  animationDuration={300}
  enableFallback={true}
  
/>`}
                </code>
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                <div>
                  <label className="text-[12px] text-[#808080] ">Chatbot Endpoint:</label>
                  <code className="block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                    {chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}
                  </code>
                </div>

                <div>
                  <label className="text-[12px] text-[#808080]">Chatbot ID:</label>
                  <code className="block p-2 mt-1 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                    {chatbotService.chatbot_id}
                  </code>
                </div>

                <div>
                  <label className="text-[12px] text-[#808080]">Chatbot Key:</label>
                  <div className="flex items-start">
                    <div className="px-3 py-2 flex-grow bg-[#252525] rounded-md text-[12px] text-[#CDCDCD] font-mono overflow-x-auto">
                      {chatbotService.chatbot_key || 'sk_xxxxxxxxxxxx'}
                    </div>
                    <button
                      className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                      onClick={() => {
                        navigator.clipboard.writeText(chatbotService.chatbot_key || '');
                      }}
                    >
                      <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                        <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <p className="text-[12px] text-[#808080] mt-3">
                  Reference the example above to make API calls to your endpoint
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 聊天机器人测试界面 - 现在可以传入 input、output 和 history */}
      {showChatbotTest && (
        <ChatbotTestInterface
          apiEndpoint={chatbotService.endpoint || API_SERVER_URL}
          chatbotId={chatbotService.chatbot_id}
          apiKey={chatbotService.chatbot_key || ''}
          onClose={() => toggleChatbotTest(false)}
          input={finalInput}
          output={finalOutput}
          history={chatbotService.history || undefined}
        />
      )}
    </div>
  );
}

export default DeployedChatbotDetail;
