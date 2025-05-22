import React, { useState } from 'react';
import { WarnMessage } from '../states/AppSettingsContext';

type WarningToastProps = {
  warns: WarnMessage[];
  clearWarns: () => void;
  removeWarn: (index: number) => void;
  toggleWarnExpand: (index: number) => void;
};

const WarningToast: React.FC<WarningToastProps> = ({
  warns,
  clearWarns,
  removeWarn,
  toggleWarnExpand,
}) => {
  if (warns.length === 0) return null;
  
  // 跟踪每个警告的复制状态
  const [copiedStates, setCopiedStates] = useState<{[key: number]: boolean}>({});

  // 复制错误信息到剪贴板
  const copyToClipboard = (text: string, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text)
      .then(() => {
        // 复制成功，更新状态
        setCopiedStates(prev => ({...prev, [index]: true}));
        
        // 1秒后恢复图标
        setTimeout(() => {
          setCopiedStates(prev => ({...prev, [index]: false}));
        }, 1500);
      })
      .catch(err => console.error('复制失败:', err));
  };

  return (
    <div className="fixed bottom-[32px] right-[16px] max-w-[400px] min-w-[200px] flex flex-col gap-2 z-50">
      {warns.length > 1 && (
        <button 
          onClick={clearWarns}
          className="self-end flex items-center gap-1 mb-1.5 text-xs bg-red-500/90 hover:bg-red-600 text-white py-1.5 px-3 rounded-full shadow-md transition-all duration-200 border border-red-400/30 hover:shadow-lg"
          title="清除所有警告"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Clear All
        </button>
      )}
      
      {warns.map((message, index) => {
        const isCopied = copiedStates[index] || false;
        const errorText = message.text;
        
        return (
          <div 
            key={index} 
            className="bg-red-500 rounded-lg shadow-lg overflow-hidden transition-all duration-300 ease-in-out flex flex-col"
            style={{ 
              maxHeight: message.expanded ? '300px' : '80px',
              opacity: 0.95,
              width: 'auto',
            }}
          >
            {/* 头部始终固定在顶部 */}
            <div 
              className="flex items-start justify-between px-4 py-3 cursor-pointer w-full"
              onClick={() => toggleWarnExpand(index)}
            >
              <div className="flex items-start w-full min-w-0">
                <div className="text-white mr-2.5 flex-shrink-0 mt-1">
                  {/* 警告图标 */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path 
                      d="M12 3L21 18H3L12 3Z" 
                      fill="white" 
                      stroke="white" 
                      strokeWidth="0.5" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <path 
                      d="M12 12V8" 
                      stroke="#FF3A3A" 
                      strokeWidth="2.5" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <circle 
                      cx="12" 
                      cy="15.5" 
                      r="1.25" 
                      fill="#FF3A3A" 
                    />
                  </svg>
                </div>
                <div className="flex flex-col min-w-0 overflow-hidden pr-2">
                  {/* 错误消息行 */}
                  <span className="text-white text-[12px] opacity-90 overflow-hidden text-ellipsis whitespace-nowrap">
                    {errorText.length > 60 ? errorText.substring(0, 60) + '...' : errorText}
                  </span>
                </div>
              </div>
              <div className="flex items-center ml-1 flex-shrink-0">
                {/* 复制按钮 */}
                <button 
                  onClick={(e) => copyToClipboard(errorText, index, e)} 
                  className={`text-white mr-1.5 focus:outline-none hover:bg-red-400 rounded-full p-0.5 flex-shrink-0 transition-all duration-200 ${isCopied ? 'bg-red-400' : ''}`}
                  title={isCopied ? "已复制" : "复制错误信息"}
                >
                  {isCopied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                
                {/* 展开/折叠按钮 */}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWarnExpand(index);
                  }} 
                  className="text-white mr-1.5 focus:outline-none hover:bg-red-400 rounded-full p-0.5 flex-shrink-0"
                  title={message.expanded ? "折叠" : "展开"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {message.expanded 
                      ? <path d="M6 9l6 6 6-6"/>
                      : <path d="M18 15l-6-6-6 6"/>}
                  </svg>
                </button>
                
                {/* 关闭按钮 */}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    removeWarn(index);
                  }} 
                  className="text-white focus:outline-none hover:bg-red-400 rounded-full p-0.5 flex-shrink-0"
                  title="关闭"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                    <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                </button>
              </div>
            </div>
            
            {/* 展开后显示的内容部分 */}
            {message.expanded && (
              <div className="px-4 pb-3 text-white text-xs border-t border-red-400 pt-2 overflow-y-auto w-full">
                <div className="text-red-200 mb-1 text-[11px]">
                  {new Date(message.time * 1000).toLocaleString()}
                </div>
                <pre className="whitespace-pre-wrap break-words text-white overflow-x-hidden text-[11px]">
                  {errorText}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default WarningToast;
