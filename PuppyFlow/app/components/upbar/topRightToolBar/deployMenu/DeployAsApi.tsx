import React, { useState } from 'react';
import { useReactFlow } from '@xyflow/react';

interface DeployAsApiProps {
  selectedInputs: any[];
  selectedOutputs: any[];
  apiConfig: { id: string; key: string };
  selectedNodes: { [key: string]: string };
  nodeOptionsByType: { [key: string]: any[] };
  selectedLanguage: string;
  handleDeploy: () => Promise<void>;
  languageOptions: string[];
  handleLanguageSelect: (lang: string) => void;
  languageDropdownOpen: boolean;
  setLanguageDropdownOpen: (isOpen: boolean) => void;
  setActivePanel: (panel: string | null) => void;
  setSelectedInputs: (updateFn: (prev: any[]) => any[]) => void;
  setSelectedOutputs: (updateFn: (prev: any[]) => any[]) => void;
}

const LanguageDropdown = ({ options, onSelect, isOpen, setIsOpen }: any) => {
  const handleSelect = (item: string) => {
    onSelect(item);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        className="w-full flex items-center justify-between bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{options.find((opt: string) => opt === onSelect) || options[0]}</span>
        <svg className="w-4 h-4 ml-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] shadow-lg max-h-60 overflow-auto">
          {options.map((item: string) => (
            <div
              key={item}
              className="px-3 py-2 hover:bg-[#404040] cursor-pointer text-[14px] text-[#CDCDCD]"
              onClick={() => handleSelect(item)}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function DeployAsApi({
  selectedInputs,
  selectedOutputs,
  apiConfig,
  setSelectedInputs,
  setSelectedOutputs,
  handleDeploy,
  setActivePanel
}: DeployAsApiProps) {
  const { getNodes } = useReactFlow();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
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
        <h2 className="text-[#CDCDCD] text-[16px]">Deploy as API</h2>
      </div>

      {/* 两列布局 - 添加分隔线和背景色区分 */}
      <div className="grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]">
        {/* 左列 - Inputs */}
        <div className="p-4 bg-[#1A1A1A]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Inputs</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center gap-1">
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

                <div 
                  className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help"
                  title="Structured Block"
                >
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
            </div>
          </h3>
          
          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {/* 可用输入节点列表 - 保持原有逻辑 */}
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isInput === true)
              .map(node => {
                const isSelected = selectedInputs?.some(item => item.id === node.id);
                const nodeType = node.type || 'text'; // 默认为 text 类型
                
                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  file: {
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
                  file: (
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
                        setSelectedInputs(prev => prev.filter(el => el.id !== node.id));
                      } else {
                        setSelectedInputs(prev => {
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
            
            {/* 如果没有可用输入节点 */}
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isInput === true)
              .length === 0 && (
                <div className="text-[12px] text-[#808080] py-2 text-center">
                  No input nodes available. Create input nodes in your workflow.
                </div>
              )}
          </div>
      </div>

        {/* 右列 - Outputs */}
        <div className="p-4 bg-[#1A1A1A] border-l border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Outputs</span>
            </div>
            <div className="flex items-center mt-2 gap-2">
              <span className="text-[12px] text-[#808080]">type:</span>
              <div className="flex items-center gap-1">
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

                <div 
                  className="flex items-center bg-[#252525] px-[4px] py-[4px] rounded-md border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 transition-colors cursor-help"
                  title="Structured Block"
                >
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
            </div>
          </h3>
          
          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {/* 可用输出节点列表 */}
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isOutput === true)
              .map((node) => {
                const isSelected = selectedOutputs?.some(item => item.id === node.id);
                const nodeType = node.type || 'text';
                
                // 为不同类型的节点定义颜色
                const colorClasses = {
                  text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                  },
                  file: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#9E7E5F]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                  },
                  structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#9B7EDB]',
                    default: 'bg-[#252525] border-[#404040] text-[#CDCDCD] hover:border-[#9B7EDB]/80 hover:bg-[#9B7EDB]/5'
                  }
                };
                
                // 使用与 input 相同的图标
                const nodeIcons = {
                  text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                      <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ),
                  file: (
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
                        setSelectedOutputs(prev => prev.filter(el => el.id !== node.id));
                      } else {
                        setSelectedOutputs(prev => {
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
            
            {/* 如果没有可用输出节点 */}
            {getNodes()
              .filter((item) => (item.type === 'text' || item.type === 'structured'))
              .filter(item => item.data?.isOutput === true)
              .length === 0 && (
                <div className="text-[12px] text-[#808080] py-2 text-center">
                  No output nodes available. Create output nodes in your workflow.
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Advanced Settings Submenu */}
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
            Advanced Settings
          </span>
        </button>
        
        {/* Collapsible content */}
        <div className={`overflow-hidden transition-all duration-200 ${isAdvancedOpen ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-[#CDCDCD] text-[14px] mb-2">API ID</label>
              <input
                type="text"
                value={apiConfig?.id || ""}
                className="w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]"
                readOnly
              />
            </div>

            <div>
              <label className="block text-[#CDCDCD] text-[14px] mb-2">API Key</label>
              <input
                type="text"
                value={apiConfig?.key || ""}
                className="w-full bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] px-3 py-2 text-[14px] text-[#CDCDCD]"
                readOnly
              />
            </div>
          </div>
        </div>
      </div>

      {/* 新的部署区域设计 */}
      <div className="pt-6 border-t border-[#404040]">
        <div className="flex flex-col items-center text-center">
          <h3 className="text-[#CDCDCD] text-[16px] font-medium mb-4">Ready to Deploy?</h3>
          <div className="flex flex-col items-center gap-4">
            <button
              className={`w-[180px] h-[48px] rounded-xl transition duration-200 
                flex items-center justify-center gap-2
                ${
                  selectedInputs?.length > 0 && selectedOutputs?.length > 0
                    ? 'bg-[#FFA73D] text-black hover:bg-[#FF9B20] hover:scale-105'
                    : 'bg-[#2A2A2A] border-[1.5px] border-[#404040] text-[#808080] cursor-not-allowed opacity-50'
                }`}
              onClick={handleDeploy}
              disabled={!(selectedInputs?.length > 0 && selectedOutputs?.length > 0)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 4H4V20H20V4Z" className="stroke-current" strokeWidth="2"/>
                <path d="M4 8H20" className="stroke-current" strokeWidth="2"/>
                <path d="M8 8V20" className="stroke-current" strokeWidth="2"/>
              </svg>
              Deploy as API
            </button>
            
            {!(selectedInputs?.length > 0 && selectedOutputs?.length > 0) && (
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

export default DeployAsApi; 