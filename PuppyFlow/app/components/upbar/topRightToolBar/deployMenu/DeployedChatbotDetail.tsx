import React, { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import ChatbotTestInterface from './ChatbotTestInterface';

interface ChatbotService {
  chatbot_id: string;
  api_key?: string;
  endpoint?: string;
  created_at?: string;
  config?: {
    multiTurn?: boolean;
    welcomeMessage?: string;
    selectedInputs?: Array<{ id: string; label: string }>;
    selectedOutputs?: Array<{ id: string; label: string }>;
    selectedChatHistory?: Array<{ id: string; label: string }>;
  };
}

interface DeployedChatbotDetailProps {
  chatbotService: ChatbotService;
  API_SERVER_URL: string;
  setActivePanel: (panel: string | null) => void;
  onDelete: () => void;
  selectedFlowId: string | null;
}

function DeployedChatbotDetail({
  chatbotService,
  API_SERVER_URL,
  setActivePanel,
  onDelete,
  selectedFlowId
}: DeployedChatbotDetailProps) {
  const { getNodes } = useReactFlow();
  const [selectedSDK, setSelectedSDK] = useState<string | null>(null);
  const [showChatbotTest, setShowChatbotTest] = useState(false);
  const [inputNodes, setInputNodes] = useState<any[]>([]);
  const [outputNodes, setOutputNodes] = useState<any[]>([]);
  const [chatHistoryNodes, setChatHistoryNodes] = useState<any[]>([]);

  // 获取当前工作流的节点信息
  useEffect(() => {
    const allInputNodes = getNodes()
      .filter((item) => item.type === 'text')
      .filter(item => item.data?.isInput === true);

    const allOutputNodes = getNodes()
      .filter((item) => item.type === 'text')
      .filter(item => item.data?.isOutput === true);

    const allChatHistoryNodes = getNodes()
      .filter((item) => item.type === 'structured')
      .filter(item => item.data?.isInput === true);

    setInputNodes(allInputNodes);
    setOutputNodes(allOutputNodes);
    setChatHistoryNodes(allChatHistoryNodes);
  }, [getNodes]);

  // 部署选项
  const deploymentOptions = [
    {
      id: 'webui',
      name: 'OpenWebUI',
      description: 'Chat interface for web browsers',
      icon: (
        <svg
          fill="currentColor"
          fillRule="evenodd"
          height="1em"
          width="1em"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          className="mr-2"
        >
          <title>OpenWebUI</title>
          <path clipRule="evenodd" d="M17.697 12c0 4.97-3.962 9-8.849 9C3.962 21 0 16.97 0 12s3.962-9 8.848-9c4.887 0 8.849 4.03 8.849 9zm-3.636 0c0 2.928-2.334 5.301-5.213 5.301-2.878 0-5.212-2.373-5.212-5.301S5.97 6.699 8.848 6.699c2.88 0 5.213 2.373 5.213 5.301z"></path>
          <path d="M24 3h-3.394v18H24V3z"></path>
        </svg>
      )
    },
    {
      id: 'discord',
      name: 'Deploy to Discord',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z" className="fill-current" />
        </svg>
      )
    },
    {
      id: 'slack',
      name: 'Deploy to Slack',
      icon: (
        <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          <path d="M4.21948 12.6434C4.21948 13.8059 3.27998 14.7454 2.11755 14.7454C0.955122 14.7454 0.015625 13.8059 0.015625 12.6434C0.015625 11.481 0.955122 10.5415 2.11755 10.5415H4.21948V12.6434ZM5.27044 12.6434C5.27044 11.481 6.20994 10.5415 7.37237 10.5415C8.53479 10.5415 9.47429 11.481 9.47429 12.6434V17.8982C9.47429 19.0607 8.53479 20.0002 7.37237 20.0002C6.20994 20.0002 5.27044 19.0607 5.27044 17.8982V12.6434Z" className="fill-current" />
          <path d="M7.37266 4.20385C6.21024 3.26435 5.27074 2.10193 5.27074 2.10193C5.27074 0.939497 6.21024 0 7.37266 0C8.53509 0 9.47459 0.939497 9.47459 2.10193V4.20385H7.37266ZM7.37266 5.27074C8.53509 5.27074 9.47459 6.21024 9.47459 7.37267C9.47459 8.53509 8.53509 9.47459 7.37266 9.47459H2.10193C0.939497 9.47459 0 8.53509 0 7.37267C0 6.21024 0.939497 5.27074 2.10193 5.27074H7.37266Z" className="fill-current" />
          <path d="M15.7978 7.37267C15.7978 6.21024 16.7373 5.27074 17.8997 5.27074C19.0621 5.27074 20.0016 6.21024 20.0016 7.37267C20.0016 8.53509 19.0621 9.47459 17.8997 9.47459H15.7978V7.37267ZM14.7468 7.37267C14.7468 8.53509 13.8073 9.47459 12.6449 9.47459C11.4825 9.47459 10.543 8.53509 10.543 7.37267V2.10193C10.543 0.939497 11.4825 0 12.6449 0C13.8073 0 14.7468 0.939497 14.7468 2.10193V7.37267Z" className="fill-current" />
          <path d="M12.6449 15.7963C13.8073 15.7963 14.7468 16.7358 14.7468 17.8982C14.7468 19.0607 13.8073 20.0002 12.6449 20.0002C11.4825 20.0002 10.543 19.0607 10.543 17.8982V15.7963H12.6449ZM12.6449 14.7454C11.4825 14.7454 10.543 13.8059 10.543 12.6434C10.543 11.481 11.4825 10.5415 12.6449 10.5415H17.9156C19.0781 10.5415 20.0176 11.481 20.0176 12.6434C20.0176 13.8059 19.0781 14.7454 17.9156 14.7454H12.6449Z" className="fill-current" />
        </svg>
      )
    },
    {
      id: 'bubble',
      name: 'Deploy as Q&A Bubble',
      description: 'Add a chat bubble to your website',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
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
      )
    }
  ];

  // 处理 SDK 选择
  const handleViewSDK = (platform: string | null) => {
    setSelectedSDK(platform);
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
        <div className="flex items-center gap-2">
          <div className="bg-[#9B7EDB]/20 p-1.5 rounded">
            <svg className="w-4 h-4 text-[#9B7EDB]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
              <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
            </svg>
          </div>
          <h2 className="text-[#CDCDCD] text-[16px]">Chatbot Details</h2>
        </div>
      </div>

      {/* Chatbot 基本信息 */}
      <div className="mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
        <h3 className="text-[#CDCDCD] text-[14px] mb-3">Service Information</h3>
        
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[#808080]">Chatbot ID:</label>
            <div className="flex items-center mt-1">
              <code className="flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#9B7EDB] overflow-x-auto">
                {chatbotService.chatbot_id}
              </code>
              <button
                className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                onClick={() => navigator.clipboard.writeText(chatbotService.chatbot_id)}
              >
                <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                  <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="text-[12px] text-[#808080]">API Endpoint:</label>
            <div className="flex items-center mt-1">
              <code className="flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                {chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}
              </code>
              <button
                className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                onClick={() => navigator.clipboard.writeText(chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`)}
              >
                <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                  <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                </svg>
              </button>
            </div>
          </div>

          {chatbotService.api_key && (
            <div>
              <label className="text-[12px] text-[#808080]">API Key:</label>
              <div className="flex items-center mt-1">
                <code className="flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                  {chatbotService.api_key}
                </code>
                <button
                  className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                  onClick={() => navigator.clipboard.writeText(chatbotService.api_key || '')}
                >
                  <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                    <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 输入输出节点信息 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-3 border-b border-[#333333] pb-2">
            User Messages ({inputNodes.length})
          </h3>
          <div className="space-y-2 max-h-[120px] overflow-y-auto">
            {inputNodes.map((node) => (
              <div key={node.id} className="flex items-center p-2 bg-[#252525] rounded">
                <div className="mr-2 bg-[#3B9BFF]/20 p-1 rounded">
                  <svg className="w-3 h-3 text-[#3B9BFF]" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[#CDCDCD] text-[12px]">{node.data.label || node.id}</span>
              </div>
            ))}
            {inputNodes.length === 0 && (
              <div className="text-[#808080] text-[12px] text-center py-2">
                No input nodes found
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-3 border-b border-[#333333] pb-2">
            Bot Responses ({outputNodes.length})
          </h3>
          <div className="space-y-2 max-h-[120px] overflow-y-auto">
            {outputNodes.map((node) => (
              <div key={node.id} className="flex items-center p-2 bg-[#252525] rounded">
                <div className="mr-2 bg-[#3B9BFF]/20 p-1 rounded">
                  <svg className="w-3 h-3 text-[#3B9BFF]" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[#CDCDCD] text-[12px]">{node.data.label || node.id}</span>
              </div>
            ))}
            {outputNodes.length === 0 && (
              <div className="text-[#808080] text-[12px] text-center py-2">
                No output nodes found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 聊天历史节点信息（如果启用了多轮对话） */}
      {chatbotService.config?.multiTurn && chatHistoryNodes.length > 0 && (
        <div className="mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-3 border-b border-[#333333] pb-2">
            Chat History Storage ({chatHistoryNodes.length})
          </h3>
          <div className="space-y-2 max-h-[120px] overflow-y-auto">
            {chatHistoryNodes.map((node) => (
              <div key={node.id} className="flex items-center p-2 bg-[#252525] rounded">
                <div className="mr-2 bg-[#9B7EDB]/20 p-1 rounded">
                  <svg className="w-3 h-3 text-[#9B7EDB]" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" />
                    <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" />
                    <path d="M9 9H11V11H9V9Z" />
                    <path d="M9 13H11V15H9V13Z" />
                    <path d="M13 9H15V11H13V9Z" />
                    <path d="M13 13H15V15H13V13Z" />
                  </svg>
                </div>
                <span className="text-[#CDCDCD] text-[12px]">{node.data.label || node.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chatbot 配置信息 */}
      {chatbotService.config && (
        <div className="mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-3">Chatbot Configuration</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[#CDCDCD] text-[12px]">Multi-turn Dialogue:</span>
              <span className={`text-[12px] px-2 py-1 rounded ${
                chatbotService.config.multiTurn 
                  ? 'bg-[#27AE60]/20 text-[#27AE60]' 
                  : 'bg-[#808080]/20 text-[#808080]'
              }`}>
                {chatbotService.config.multiTurn ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {chatbotService.config.welcomeMessage && (
              <div>
                <label className="text-[12px] text-[#808080]">Welcome Message:</label>
                <div className="mt-1 p-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD]">
                  {chatbotService.config.welcomeMessage}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

          <button
            className="flex-1 h-[48px] rounded-[8px] transition duration-200 
              flex items-center justify-center gap-2
              bg-[#E74C3C] text-white hover:bg-[#C0392B] hover:scale-105"
            onClick={onDelete}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Delete Chatbot
          </button>
        </div>
      </div>

      {/* SDK 部署选项 */}
      <div className="mb-6">
        <h3 className="text-[#CDCDCD] text-[14px] mb-3">Deployment Options</h3>
        <div className="flex flex-wrap gap-4 justify-center">
          {deploymentOptions.map((option) => (
            <div key={option.id} className="flex flex-col items-center" style={{ width: '50px' }}>
              <div
                className={`w-[48px] h-[48px] rounded-[8px] transition duration-200 
                  flex items-center justify-center cursor-pointer hover:bg-[#252525] hover:scale-105 hover:shadow-md text-[#CDCDCD]
                  bg-[#1A1A1A] border border-[#404040] hover:border-[#505050]
                  ${selectedSDK === option.id
                    ? 'border-[#3B9BFF] text-[#3B9BFF] bg-[#3B9BFF]/10'
                    : ''
                  }`}
                onClick={() => handleViewSDK(option.id)}
              >
                {React.cloneElement(option.icon, {
                  className: 'w-6 h-6',
                  style: { marginRight: 0 }
                })}
              </div>
              <span className="text-[10px] leading-tight text-center mt-1 text-[#CDCDCD]">
                {option.name.replace('Deploy to ', '').replace('Deploy as ', '')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* SDK 详细信息 */}
      {selectedSDK && (
        <div className="mb-6 py-3 px-4 bg-[#1A1A1A] rounded-md border border-[#404040]">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              {React.cloneElement(deploymentOptions.find(opt => opt.id === selectedSDK)?.icon || <></>, {
                className: 'w-5 h-5 mr-2'
              })}
              <span className="text-[14px] text-[#CDCDCD] font-medium">
                {deploymentOptions.find(opt => opt.id === selectedSDK)?.name} SDK
              </span>
            </div>
            <button
              className="text-[12px] text-[#3B9BFF] hover:underline flex items-center"
              onClick={() => handleViewSDK(null)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 18L18 6M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="ml-1">Close</span>
            </button>
          </div>

          {selectedSDK === 'webui' && (
            <div className="mt-3">
              <p className="text-[13px] text-[#CDCDCD] mb-2">
                Add this chatbot to your OpenWebUI installation:
              </p>
              <code className="block p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                <pre>
                  {`// OpenWebUI Configuration
{
  "name": "Custom Chatbot",
  "endpoint": "${chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}",
  "type": "puppyflow"
}`}
                </pre>
              </code>
            </div>
          )}

          {selectedSDK === 'discord' && (
            <div className="mt-3">
              <p className="text-[13px] text-[#CDCDCD] mb-2">
                Add this chatbot to your Discord server:
              </p>
              <div className="p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD]">
                <ol className="list-decimal ml-4 space-y-2">
                  <li>Create a new Discord Bot in the <a href="https://discord.com/developers/applications" target="_blank" className="text-[#3B9BFF] hover:underline">Discord Developer Portal</a></li>
                  <li>Enable Message Content Intent in Bot settings</li>
                  <li>Set the API endpoint in your bot configuration:</li>
                </ol>
                <code className="block p-2 mt-2 bg-[#1A1A1A] rounded overflow-x-auto">
                  {`// Discord Bot Configuration
const puppyflowEndpoint = "${chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}";`}
                </code>
              </div>
            </div>
          )}

          {selectedSDK === 'slack' && (
            <div className="mt-3">
              <p className="text-[13px] text-[#CDCDCD] mb-2">
                Connect this chatbot to your Slack workspace:
              </p>
              <div className="p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD]">
                <ol className="list-decimal ml-4 space-y-2">
                  <li>Create a new Slack App in the <a href="https://api.slack.com/apps" target="_blank" className="text-[#3B9BFF] hover:underline">Slack API Portal</a></li>
                  <li>Add Bot User OAuth scopes: <code>chat:write</code>, <code>app_mentions:read</code></li>
                  <li>Set the API endpoint in your Slack app configuration:</li>
                </ol>
                <code className="block p-2 mt-2 bg-[#1A1A1A] rounded overflow-x-auto">
                  {`// Slack App Configuration
PUPPYFLOW_ENDPOINT="${chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}"
BOT_NAME="PuppyFlow Bot"`}
                </code>
              </div>
            </div>
          )}

          {selectedSDK === 'bubble' && (
            <div className="mt-3">
              <p className="text-[13px] text-[#CDCDCD] mb-2">
                Add this chatbot as a bubble on your website:
              </p>
              <code className="block p-2 mt-2 bg-[#252525] rounded text-[12px] text-[#CDCDCD] overflow-x-auto">
                <pre>
                  {`<script>
  window.puppyflowConfig = {
    chatbotEndpoint: "${chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}",
    bubbleText: "Ask me!",
    position: "bottom-right",
    welcomeMessage: "${chatbotService.config?.welcomeMessage || 'Hello! How can I help you?'}"
  };
</script>
<script src="https://cdn.puppyflow.ai/bubble.min.js"></script>`}
                </pre>
              </code>
            </div>
          )}
        </div>
      )}

      {/* 聊天机器人测试界面 */}
      {showChatbotTest && (
        <ChatbotTestInterface
          apiEndpoint={chatbotService.endpoint || `${API_SERVER_URL}/api/${chatbotService.chatbot_id}`}
          inputNodeId={inputNodes[0]?.id || ''}
          outputNodeId={outputNodes[0]?.id || ''}
          apiKey={chatbotService.api_key || ''}
          apiId={chatbotService.chatbot_id}
          isModal={true}
          onClose={() => toggleChatbotTest(false)}
        />
      )}
    </div>
  );
}

export default DeployedChatbotDetail;
