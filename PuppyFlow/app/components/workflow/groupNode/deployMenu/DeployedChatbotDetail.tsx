import React, { useState } from 'react';
import { useServers } from '@/app/components/states/UserServersContext';

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
  // 使用新的 UserServersContext 替代 DeployPanelContext
  const { getChatbotServiceById } = useServers();

  // 通过 chatbotId 从 context 中获取 chatbot 配置
  const chatbotService = getChatbotServiceById(chatbotId);

  // 语言选择器状态
  const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');

  // 如果找不到 chatbot 配置，显示错误信息
  if (!chatbotService) {
    return (
      <div className='py-[16px] px-[16px]'>
        <div className='text-[#E74C3C] text-center'>
          Chatbot configuration not found for ID: {chatbotId}
        </div>
      </div>
    );
  }

  // 检查是否启用了多轮对话
  const isMultiTurnEnabled =
    chatbotService.multi_turn_enabled || chatbotService.config?.multiTurn;

  // 使用传入的 input/output，如果没有则使用 context 中的数据作为备选
  const finalInput = input || chatbotService.input;
  const finalOutput = output || chatbotService.output;

  // 语言选项
  const languages = [
    { id: 'javascript', name: 'JavaScript', icon: '🟨' },
    { id: 'react', name: 'React', icon: '⚛️' },
  ];

  // 获取SDK代码
  const getSDKCode = () => {
    if (selectedLanguage === 'react') {
      return `import { ChatBubbleDeployed } from 'puppychat';

// Add this component to your React app
<ChatBubbleDeployed
  chatbotId="${chatbotService.chatbot_id}"
  baseUrl="${chatbotService.endpoint?.replace('/api/' + chatbotService.chatbot_id, '') || API_SERVER_URL}"
  chatbotKey="${chatbotService.chatbot_key || 'your_chatbot_key'}"
  inputBlockId="${finalInput || 'input_block'}"${
    isMultiTurnEnabled && chatbotService.history
      ? `
  historyBlockId="${chatbotService.history}"`
      : ''
  }
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
/>`;
    } else {
      return `// JavaScript SDK Integration
const chatbot = new PuppyChat({
  chatbotId: "${chatbotService.chatbot_id}",
  baseUrl: "${chatbotService.endpoint?.replace('/api/' + chatbotService.chatbot_id, '') || API_SERVER_URL}",
  chatbotKey: "${chatbotService.chatbot_key || 'your_chatbot_key'}",
  inputBlockId: "${finalInput || 'input_block'}",${
    isMultiTurnEnabled && chatbotService.history
      ? `
  historyBlockId: "${chatbotService.history}",`
      : ''
  }
  config: {
    title: "AI Assistant",
    placeholder: "Ask me anything...",
    welcomeMessage: "${chatbotService.config?.welcomeMessage || chatbotService.welcome_message || 'Hello! How can I help you today?'}",
    width: '400px',
    height: '600px'
  }
});

// Initialize the chatbot
chatbot.init();`;
    }
  };

  return (
    <div className='py-[16px] px-[16px] overflow-y-auto scrollbar-hide'>
      {/* 头部导航 */}
      <div className='flex items-center mb-4'>
        <button
          className='mr-2 p-1 rounded-full hover:bg-[#2A2A2A]'
          onClick={() => setActivePanel(null)}
        >
          <svg
            className='w-5 h-5'
            fill='#CDCDCD'
            viewBox='0 0 20 20'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              fillRule='evenodd'
              d='M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z'
              clipRule='evenodd'
            />
          </svg>
        </button>
        <h2 className='text-[#CDCDCD] text-[16px]'>Chatbot Details</h2>
      </div>

      {/* 输入输出节点信息 */}
      <div className='grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]'>
        <div className='p-4 bg-[#1A1A1A]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>User Messages ({finalInput ? 1 : 0})</span>
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1 scrollbar-hide'>
            {finalInput ? (
              <div className='h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]'>
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 20 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='group mr-2'
                >
                  <path
                    d='M3 8H17'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                  <path
                    d='M3 12H15'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                  <path
                    d='M3 16H13'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
                <span className='flex-shrink-0 text-[12px]'>{finalInput}</span>
                <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      d='M5 12L10 17L19 8'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                </div>
              </div>
            ) : (
              <div className='text-[12px] text-[#808080] py-2 text-left'>
                No input node found
              </div>
            )}
          </div>
        </div>

        <div className='p-4 bg-[#1A1A1A] border-l border-[#404040]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>Bot Responses ({finalOutput ? 1 : 0})</span>
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1 scrollbar-hide'>
            {finalOutput ? (
              <div className='h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]'>
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 20 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='group mr-2'
                >
                  <path
                    d='M3 8H17'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                  <path
                    d='M3 12H15'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                  <path
                    d='M3 16H13'
                    className='stroke-current'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
                <span className='flex-shrink-0 text-[12px]'>{finalOutput}</span>
                <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      d='M5 12L10 17L19 8'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                </div>
              </div>
            ) : (
              <div className='text-[12px] text-[#808080] py-2 text-left'>
                No output node found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Memory 节点信息 */}
      {isMultiTurnEnabled && chatbotService.history && (
        <div className='mb-8 p-4 bg-[#1A1A1A] rounded-lg border border-[#404040]'>
          <h3 className='text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2'>
            <div className='flex items-center justify-between'>
              <span>Chat History (1)</span>
            </div>
          </h3>

          <div className='space-y-3 text-[14px] font-medium'>
            <div className='h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]'>
              <svg
                width='12'
                height='12'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                className='group mr-2'
              >
                <path
                  d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
                  className='fill-current'
                />
                <path
                  d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
                  className='fill-current'
                />
                <path d='M9 9H11V11H9V9Z' className='fill-current' />
                <path d='M9 13H11V15H9V13Z' className='fill-current' />
                <path d='M13 9H15V11H13V9Z' className='fill-current' />
                <path d='M13 13H15V15H13V13Z' className='fill-current' />
              </svg>
              <span className='flex-shrink-0 text-[12px]'>
                {chatbotService.history}
              </span>
              <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <path
                    d='M5 12L10 17L19 8'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chatbot 配置信息 */}
      <div className='mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]'>
        <h3 className='text-[#CDCDCD] text-[14px] mb-3'>Chatbot Settings</h3>
        <div className='space-y-3'>
          {/* 多轮对话设置 */}
          <div className='flex items-center justify-between'>
            <span className='text-[#CDCDCD] text-[14px]'>
              Enable Multi-turn Dialogue
            </span>
            <div
              className={`w-12 h-6 rounded-full ${
                isMultiTurnEnabled ? 'bg-[#3B9BFF]' : 'bg-[#404040]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transform transition-transform duration-200 ${
                  isMultiTurnEnabled ? 'translate-x-6' : 'translate-x-1'
                } mt-0.5`}
              />
            </div>
          </div>

          {/* 欢迎消息 */}
          <div>
            <label className='block text-[#CDCDCD] text-[14px] mb-2'>
              Welcome Message
            </label>
            <div className='w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]'>
              {chatbotService.config?.welcomeMessage ||
                chatbotService.welcome_message ||
                'Hello! How can I help you today?'}
            </div>
          </div>
        </div>
      </div>

      {/* SDK 代码示例 */}
      <div className='mb-6'>
        <div className='bg-[#252525] border-[1px] border-[#404040] rounded-lg p-[10px]'>
          <div className='flex items-center justify-between mb-3'>
            <div className='flex items-center gap-2'>
              <div className='relative'>
                <button
                  className='flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors'
                  onClick={() => setIsLangSelectorOpen(prev => !prev)}
                >
                  <span>
                    {languages.find(lang => lang.id === selectedLanguage)?.icon}
                  </span>
                  <span>
                    {languages.find(lang => lang.id === selectedLanguage)?.name}
                  </span>
                  <svg
                    className={`w-4 h-4 transition-transform ${isLangSelectorOpen ? 'rotate-180' : ''}`}
                    fill='currentColor'
                    viewBox='0 0 20 20'
                  >
                    <path
                      fillRule='evenodd'
                      d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'
                      clipRule='evenodd'
                    />
                  </svg>
                </button>

                {isLangSelectorOpen && (
                  <div className='absolute top-full left-0 mt-1 bg-[#2A2A2A] border border-[#404040] rounded-md shadow-lg z-10 min-w-[120px]'>
                    {languages.map(lang => (
                      <button
                        key={lang.id}
                        className='w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[#CDCDCD] hover:bg-[#333333] first:rounded-t-md last:rounded-b-md'
                        onClick={() => {
                          setSelectedLanguage(lang.id);
                          setIsLangSelectorOpen(false);
                        }}
                      >
                        <span>{lang.icon}</span>
                        <span>{lang.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              className='flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors'
              onClick={() => {
                navigator.clipboard.writeText(getSDKCode());
              }}
            >
              <svg className='w-4 h-4' fill='currentColor' viewBox='0 0 20 20'>
                <path d='M8 2a1 1 0 000 2h2a1 1 0 100-2H8z' />
                <path d='M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z' />
              </svg>
              Copy
            </button>
          </div>

          <div className='relative flex border-none rounded-[8px] cursor-pointer bg-[#1C1D1F] overflow-hidden'>
            <div className='flex-grow overflow-hidden'>
              <div
                className='overflow-y-auto overflow-x-auto scrollbar-hide'
                style={{ maxHeight: '300px', position: 'relative' }}
              >
                <pre
                  className='text-[#CDCDCD] text-[12px] p-4 whitespace-pre text-left'
                  style={{ margin: 0, background: 'transparent' }}
                >
                  {getSDKCode()}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chatbot Details */}
      <div className='space-y-4'>
        <div>
          <label className='text-[12px] text-[#808080] text-left block'>
            Chatbot ID:
          </label>
          <div className='flex items-center mt-1'>
            <code className='flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#3B9BFF] overflow-x-auto text-left scrollbar-hide'>
              {chatbotService.chatbot_id}
            </code>
            <button
              className='ml-2 p-2 rounded-md hover:bg-[#2A2A2A]'
              onClick={() => {
                navigator.clipboard.writeText(chatbotService.chatbot_id);
              }}
            >
              <svg
                className='w-4 h-4 text-[#CDCDCD]'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path d='M8 2a1 1 0 000 2h2a1 1 0 100-2H8z' />
                <path d='M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z' />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <label className='text-[12px] text-[#808080] text-left block'>
            Chatbot Endpoint:
          </label>
          <div className='flex items-center mt-1'>
            <code className='flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto text-left scrollbar-hide'>
              {chatbotService.endpoint ||
                `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}
            </code>
            <button
              className='ml-2 p-2 rounded-md hover:bg-[#2A2A2A]'
              onClick={() => {
                navigator.clipboard.writeText(
                  chatbotService.endpoint ||
                    `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`
                );
              }}
            >
              <svg
                className='w-4 h-4 text-[#CDCDCD]'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path d='M8 2a1 1 0 000 2h2a1 1 0 100-2H8z' />
                <path d='M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z' />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <label className='text-[12px] text-[#808080] text-left block'>
            Chatbot Key:
          </label>
          <div className='flex items-center mt-1'>
            <code className='flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto text-left scrollbar-hide'>
              {chatbotService.chatbot_key || 'sk_xxxxxxxxxxxx'}
            </code>
            <button
              className='ml-2 p-2 rounded-md hover:bg-[#2A2A2A]'
              onClick={() => {
                navigator.clipboard.writeText(chatbotService.chatbot_key || '');
              }}
            >
              <svg
                className='w-4 h-4 text-[#CDCDCD]'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path d='M8 2a1 1 0 000 2h2a1 1 0 100-2H8z' />
                <path d='M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z' />
              </svg>
            </button>
          </div>
        </div>

        <p className='text-[12px] text-[#808080] mt-3 text-left'>
          Use the SDK code above to integrate this chatbot into your application
        </p>
      </div>
    </div>
  );
}

export default DeployedChatbotDetail;
