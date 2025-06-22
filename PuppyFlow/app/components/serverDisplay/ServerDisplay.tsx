import React, { useState, useEffect } from 'react';
import { useServers } from '../states/UserServersContext';
import ChatbotServiceDisplay from './ChatbotServiceDisplay';
import ApiServiceDisplay from './ApiServiceDisplay';
import axios from 'axios';

const ServerDisplay: React.FC = () => {
  const { 
    currentServiceJson, 
    currentShowingId,
    isLoading 
  } = useServers();

  // 🔍 添加调试信息 - 检查从 context 获取的 service 数据
  console.log('🔍 ServerDisplay - currentServiceJson:', currentServiceJson);

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
    console.log('🔍 ServerDisplay - 传递给 ApiServiceDisplay 的 service:', currentServiceJson);
    console.log('🔍 ServerDisplay - API service workflow_json:', currentServiceJson.workflow_json);
    return <ApiServiceDisplay service={currentServiceJson} />;
  } else if (currentServiceJson.type === 'chatbot') {
    console.log('🔍 ServerDisplay - 传递给 ChatbotServiceDisplay 的 service:', currentServiceJson);
    console.log('🔍 ServerDisplay - Chatbot service workflow_json:', currentServiceJson.workflow_json);
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

export default ServerDisplay;