import React, { useState } from 'react';
import { useReactFlow } from '@xyflow/react';

interface DeployAsChatbotProps {
  selectedInputs: any[];
  selectedOutputs: any[];
  setSelectedInputs: (updateFn: (prev: any[]) => any[]) => void;
  setSelectedOutputs: (updateFn: (prev: any[]) => any[]) => void;
  handleDeploy: () => Promise<void>;
  setActivePanel: (panel: string | null) => void;
}

function DeployAsChatbot({
  selectedInputs,
  selectedOutputs,
  setSelectedInputs,
  setSelectedOutputs,
  handleDeploy,
  setActivePanel
}: DeployAsChatbotProps) {
  const { getNodes } = useReactFlow();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [chatbotInputs, setChatbotInputs] = useState<any[]>([]);
  const [chatbotOutputs, setChatbotOutputs] = useState<any[]>([]);
  const [chatbotConfig, setChatbotConfig] = useState({
    multiTurn: true,
    welcomeMessage: 'Hello! How can I help you today?',
    deployTo: '' // 'webui', 'discord', 'slack'
  });

  const deploymentOptions = [
    {
      id: 'webui',
      name: 'Deploy to OpenWebUI',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          {/* O letter */}
          <path 
            d="M6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12Z" 
            className="fill-current"
          />
          {/* I letter */}
          <rect x="20" y="6" width="3" height="12" className="fill-current" />
        </svg>
      )
    },
    {
      id: 'discord',
      name: 'Deploy to Discord',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z" className="fill-current"/>
        </svg>
      )
    },
    {
      id: 'slack',
      name: 'Deploy to Slack',
      icon: (
        <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          {/* Pink section */}
          <path d="M4.21948 12.6434C4.21948 13.8059 3.27998 14.7454 2.11755 14.7454C0.955122 14.7454 0.015625 13.8059 0.015625 12.6434C0.015625 11.481 0.955122 10.5415 2.11755 10.5415H4.21948V12.6434ZM5.27044 12.6434C5.27044 11.481 6.20994 10.5415 7.37237 10.5415C8.53479 10.5415 9.47429 11.481 9.47429 12.6434V17.8982C9.47429 19.0607 8.53479 20.0002 7.37237 20.0002C6.20994 20.0002 5.27044 19.0607 5.27044 17.8982V12.6434Z" className="fill-current"/>
          
          {/* Blue section */}
          <path d="M7.37266 4.20385C6.21024 3.26435 5.27074 2.10193 5.27074 2.10193C5.27074 0.939497 6.21024 0 7.37266 0C8.53509 0 9.47459 0.939497 9.47459 2.10193V4.20385H7.37266ZM7.37266 5.27074C8.53509 5.27074 9.47459 6.21024 9.47459 7.37267C9.47459 8.53509 8.53509 9.47459 7.37266 9.47459H2.10193C0.939497 9.47459 0 8.53509 0 7.37267C0 6.21024 0.939497 5.27074 2.10193 5.27074H7.37266Z" className="fill-current"/>
          
          {/* Green section */}
          <path d="M15.7978 7.37267C15.7978 6.21024 16.7373 5.27074 17.8997 5.27074C19.0621 5.27074 20.0016 6.21024 20.0016 7.37267C20.0016 8.53509 19.0621 9.47459 17.8997 9.47459H15.7978V7.37267ZM14.7468 7.37267C14.7468 8.53509 13.8073 9.47459 12.6449 9.47459C11.4825 9.47459 10.543 8.53509 10.543 7.37267V2.10193C10.543 0.939497 11.4825 0 12.6449 0C13.8073 0 14.7468 0.939497 14.7468 2.10193V7.37267Z" className="fill-current"/>
          
          {/* Yellow section */}
          <path d="M12.6449 15.7963C13.8073 15.7963 14.7468 16.7358 14.7468 17.8982C14.7468 19.0607 13.8073 20.0002 12.6449 20.0002C11.4825 20.0002 10.543 19.0607 10.543 17.8982V15.7963H12.6449ZM12.6449 14.7454C11.4825 14.7454 10.543 13.8059 10.543 12.6434C10.543 11.481 11.4825 10.5415 12.6449 10.5415H17.9156C19.0781 10.5415 20.0176 11.481 20.0176 12.6434C20.0176 13.8059 19.0781 14.7454 17.9156 14.7454H12.6449Z" className="fill-current"/>
        </svg>
      )
    },
    {
      id: 'bubble',
      name: 'Deploy as Q&A Bubble',
      description: 'Add a chat bubble to your website',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
          {/* 网页框架 */}
          <rect x="2" y="2" width="20" height="16" rx="2" 
            className="stroke-current" 
            strokeWidth="1.5"
            fill="none"
          />
          {/* 顶部栏 */}
          <path d="M2 6h20" 
            className="stroke-current" 
            strokeWidth="1.5"
          />
          {/* 浏览器按钮 */}
          <circle cx="4.5" cy="4" r="0.75" className="fill-current"/>
          <circle cx="7.5" cy="4" r="0.75" className="fill-current"/>
          <circle cx="10.5" cy="4" r="0.75" className="fill-current"/>
          
          {/* 右下角问答气泡 */}
          <circle cx="18" cy="18" r="4" 
            className="fill-current"
          />
          <path d="M18 16.5v0.2m0 1.8v0.2" 
            className="stroke-white" 
            strokeWidth="1.5" 
            strokeLinecap="round"
          />
        </svg>
      )
    }
  ];
  
  return (
    <div className="py-[16px] px-[16px]">
      <div className="flex items-center mb-4">
        <button 
          className="mr-2 p-1 rounded-full hover:bg-[#2A2A2A]"
          onClick={() => setActivePanel(null)}
        >
          <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-[#CDCDCD] text-[16px]">Deploy as Chatbot</h2>
      </div>
      
      <div className="grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]">
        <div className="p-4 bg-[#1A1A1A]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 flex items-center justify-between border-b border-[#333333] pb-2">
            <span className="flex items-center">User Messages</span>
          </h3>
          
          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured' || item.type === 'block'))
              .filter(item => item.data?.isInput === true)
              .map(node => {
                const isSelected = chatbotInputs?.some(item => item.id === node.id);
                const nodeType = node.type || 'text';
                
                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  block: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                  }
                };
                
                // 为不同类型的节点定义图标
                const nodeIcons = {
                  text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  block: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                      <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  structured: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                      <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                      <path d="M9 9H11V11H9V9Z" className="fill-current" />
                      <path d="M9 13H11V15H9V13Z" className="fill-current" />
                      <path d="M13 9H15V11H13V9Z" className="fill-current" />
                      <path d="M13 13H15V15H13V13Z" className="fill-current" />
                    </svg>
                  )
                };

                return (
                  <div 
                    key={node.id} 
                    className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                      isSelected 
                        ? colorClasses[nodeType as keyof typeof colorClasses]?.active || colorClasses.text.active
                        : colorClasses[nodeType as keyof typeof colorClasses]?.default || colorClasses.text.default
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        setChatbotInputs(prev => prev.filter(el => el.id !== node.id));
                      } else {
                        setChatbotInputs(prev => {
                          return prev?.length === 0 
                            ? [{ id: node.id, label: node.data.label }] 
                            : [...prev, { id: node.id, label: node.data.label }];
                        });
                      }
                    }}
                  >
                    {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                    <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                    {isSelected && (
                      <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                );
            })}
          </div>
        </div>

        <div className="p-4 bg-[#1A1A1A] border-l border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 flex items-center justify-between border-b border-[#333333] pb-2">
            <span className="flex items-center">Bot Responses</span>
          </h3>
          
          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured' || item.type === 'block'))
              .filter(item => item.data?.isOutput === true)
              .map(node => {
                const isSelected = chatbotOutputs?.some(item => item.id === node.id);
                const nodeType = node.type || 'text';
                
                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  block: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                  }
                };
                
                // 为不同类型的节点定义图标
                const nodeIcons = {
                  text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  block: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                      <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  structured: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                      <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                      <path d="M9 9H11V11H9V9Z" className="fill-current" />
                      <path d="M9 13H11V15H9V13Z" className="fill-current" />
                      <path d="M13 9H15V11H13V9Z" className="fill-current" />
                      <path d="M13 13H15V15H13V13Z" className="fill-current" />
                    </svg>
                  )
                };

                return (
                  <div 
                    key={node.id} 
                    className={`h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all cursor-pointer ${
                      isSelected 
                        ? colorClasses[nodeType as keyof typeof colorClasses]?.active || colorClasses.text.active
                        : colorClasses[nodeType as keyof typeof colorClasses]?.default || colorClasses.text.default
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        setChatbotOutputs(prev => prev.filter(el => el.id !== node.id));
                      } else {
                        setChatbotOutputs(prev => {
                          return prev?.length === 0 
                            ? [{ id: node.id, label: node.data.label }] 
                            : [...prev, { id: node.id, label: node.data.label }];
                        });
                      }
                    }}
                  >
                    {nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text}
                    <span className="flex-shrink-0 text-[12px]">{node.data.label as string || node.id}</span>
                    {isSelected && (
                      <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                );
            })}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <button
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="w-full flex items-center justify-between text-[#CDCDCD] text-[14px] mb-2 hover:text-white"
        >
          <span className="flex items-center">
            <svg 
              className={`w-4 h-4 mr-2 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`} 
              fill="currentColor" 
              viewBox="0 0 20 20"
            >
              <path 
                fillRule="evenodd" 
                d="M7.293 4.707a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L10.586 10 7.293 6.707a1 1 0 010-1.414z" 
                clipRule="evenodd" 
              />
            </svg>
            Chatbot Settings
          </span>
        </button>
        
        <div className={`overflow-hidden transition-all duration-200 ${isAdvancedOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-[#CDCDCD] text-[14px]">Enable Multi-turn Dialogue</label>
              <button
                className={`w-12 h-6 rounded-full transition-colors duration-200 ${
                  chatbotConfig.multiTurn ? 'bg-[#3B9BFF]' : 'bg-[#404040]'
                }`}
                onClick={() => setChatbotConfig(prev => ({ ...prev, multiTurn: !prev.multiTurn }))}
              >
                <div className={`w-5 h-5 rounded-full bg-white transform transition-transform duration-200 ${
                  chatbotConfig.multiTurn ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div>
              <label className="block text-[#CDCDCD] text-[14px] mb-2">Welcome Message</label>
              <input
                type="text"
                value={chatbotConfig.welcomeMessage}
                onChange={(e) => setChatbotConfig(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                className="w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]"
              />
            </div>

          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-[#404040]">
        <div className="flex flex-col items-center text-center">
          <h3 className="text-[#CDCDCD] text-[16px] font-medium mb-4">Ready to Deploy?</h3>
          <div className="flex flex-col items-center gap-4">
            <span className="text-[#808080] text-[14px]">Choose your platform</span>
            <div className="flex gap-3">
              {deploymentOptions.map((option) => (
                <button
                  key={option.id}
                  className={`w-[48px] h-[48px] rounded-xl transition duration-200 
                    flex items-center justify-center
                    ${
                      chatbotInputs?.length > 0 && chatbotOutputs?.length > 0
                        ? 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#CDCDCD] hover:bg-[#3B3B3B] hover:border-[#505050] hover:text-white hover:scale-105'
                        : 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#808080] cursor-not-allowed opacity-50'
                    }
                    ${chatbotConfig.deployTo === option.id ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]' : ''}`}
                  onClick={() => {
                    if (chatbotInputs?.length > 0 && chatbotOutputs?.length > 0) {
                      setChatbotConfig(prev => ({ ...prev, deployTo: option.id }));
                      handleDeploy();
                    }
                  }}
                  disabled={!(chatbotInputs?.length > 0 && chatbotOutputs?.length > 0)}
                  title={option.name}
                >
                  {React.cloneElement(option.icon, { 
                    className: 'w-6 h-6',
                    style: { marginRight: 0 } 
                  })}
                </button>
              ))}
            </div>
            {!(chatbotInputs?.length > 0 && chatbotOutputs?.length > 0) && (
              <span className="text-[#808080] text-[13px]">
                Please select input and output nodes first
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

export default DeployAsChatbot; 