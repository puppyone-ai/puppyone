import React, { useState } from 'react';
import { useServers } from '@/app/components/states/UserServersContext';

interface ApiService {
  api_id: string;
  api_key: string;
  endpoint?: string;
  created_at?: string;
  inputs?: string[];
  outputs?: string[];
}

interface DeployedApiDetailProps {
  apiService: ApiService;
  API_SERVER_URL: string;
  setActivePanel: (panel: string | null) => void;
  onDelete: () => void;
  selectedFlowId: string | null;
}

function DeployedApiDetail({
  apiService,
  API_SERVER_URL,
  setActivePanel,
  onDelete,
  selectedFlowId
}: DeployedApiDetailProps) {
  const { getApiServiceById } = useServers();
  const [selectedLang, setSelectedLang] = useState("Python");
  const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false);

  // 从新的 context 中获取 API 服务信息
  const currentApiService = getApiServiceById(apiService.api_id) || apiService;

  // 语言选项常量
  const PYTHON = "Python";
  const SHELL = "Shell";
  const JAVASCRIPT = "Javascript";

  // 生成输入文本
  const input_text_gen = (inputs: string[], lang: string) => {
    if (lang === JAVASCRIPT) {
      const inputData = inputs.map((input, index) => {
        const isLast = index === inputs.length - 1;
        return `        "${input}": "your_input_value_here"${isLast ? '' : ','} `;
      });
      return inputData.join('\n');
    } else {
      const inputData = inputs.map((input, index) => {
        const isLast = index === inputs.length - 1;
        return `     "${input}": "your_input_value_here"${isLast ? '' : ','}`;
      });
      return inputData.join('\n');
    }
  };

  // 生成示例代码
  const populatetext = (api_id: string, api_key: string, language: string): string => {
    // 使用存储的输入配置
    const inputIds = currentApiService.inputs || [];
    
    const py = `import requests

api_url = "${API_SERVER_URL}/execute_workflow/${api_id}"

api_key = "${api_key}"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
${input_text_gen(inputIds, PYTHON)}
}

response = requests.post(api_url, headers=headers, json=data)

if response.status_code == 200:
    print("Results:", response.json())
else:
    print("Error:", response.status_code, response.json())
`;
    if (language === PYTHON) {
      return py;
    }

    const sh = `curl -X POST "${API_SERVER_URL}/execute_workflow/${api_id}" \\
-H "Authorization: Bearer ${api_key}" \\
-H "Content-Type: application/json" \\
-d '{
${input_text_gen(inputIds, SHELL)}
}'
`;
    if (language === SHELL) {
      return sh;
    }

    const js = `const axios = require('axios');

const apiUrl = "${API_SERVER_URL}/execute_workflow/${api_id}";

const data = {
${input_text_gen(inputIds, JAVASCRIPT)}
};

axios.post(apiUrl, data, {
    headers: {
        "Authorization": "Bearer ${api_key}",
        "Content-Type": "application/json"
    }
})
.then(response => {
    console.log("Results:", response.data);
})
.catch(error => {
    if (error.response) {
        console.error("Error:", error.response.status, error.response.data);
    } else {
        console.error("Error:", error.message);
    }
});
`;
    return js;
  };

  // 复制到剪贴板
  const copyToClipboard = () => {
    const codeToCopy = populatetext(
      currentApiService.api_id,
      currentApiService.api_key,
      selectedLang
    );
    navigator.clipboard.writeText(codeToCopy)
      .then(() => {
        const copyButton = document.getElementById('copy-button');
        if (copyButton) {
          copyButton.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Copied!</span>
          `;

          setTimeout(() => {
            copyButton.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5H6C4.89543 5 4 5.89543 4 7V19C4 20.1046 4.89543 21 6 21H16C17.1046 21 18 20.1046 18 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <rect x="8" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        }
      })
      .catch(err => {
        console.error('Failed to copy: ', err);
      });
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
        <h2 className="text-[#CDCDCD] text-[16px]">API Details</h2>
      </div>

      {/* 输入输出节点信息 - 使用与 DeployAsApi 相同的网格布局 */}
      <div className="grid grid-cols-2 gap-0 mb-8 rounded-lg overflow-hidden border border-[#404040]">
        <div className="p-4 bg-[#1A1A1A]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Inputs ({currentApiService.inputs?.length || 0})</span>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {currentApiService.inputs?.map(inputId => {
              return (
                <div
                  key={inputId}
                  className="h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]"
                >
                  <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                    <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="flex-shrink-0 text-[12px]">{inputId}</span>
                  <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              );
            }) || []}

            {(!currentApiService.inputs || currentApiService.inputs.length === 0) && (
              <div className="text-[12px] text-[#808080] py-2 text-center">
                No input nodes found
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-[#1A1A1A] border-l border-[#404040]">
          <h3 className="text-[#CDCDCD] text-[14px] mb-4 border-b border-[#333333] pb-2">
            <div className="flex items-center justify-between">
              <span>Outputs ({currentApiService.outputs?.length || 0})</span>
            </div>
          </h3>

          <div className="space-y-3 text-[14px] font-medium max-h-[160px] overflow-y-auto pr-1">
            {currentApiService.outputs?.map((outputId) => {
              return (
                <div
                  key={outputId}
                  className="h-[26px] border-[1.5px] pl-[8px] pr-[8px] rounded-lg flex items-center transition-all bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#3B9BFF]"
                >
                  <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group mr-2">
                    <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="flex-shrink-0 text-[12px]">{outputId}</span>
                  <div className='flex ml-auto h-[20px] w-[20px] justify-center items-center'>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              );
            }) || []}

            {(!currentApiService.outputs || currentApiService.outputs.length === 0) && (
              <div className="text-[12px] text-[#808080] py-2 text-center">
                No output nodes found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* API 代码示例 - 使用与 DeployAsApi 相同的样式 */}
      <div className="mb-6">
        <div className="bg-[#252525] border-[1px] border-[#404040] rounded-lg p-[10px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  className="flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors"
                  onClick={() => setIsLangSelectorOpen(prev => !prev)}
                >
                  {selectedLang === PYTHON && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 1c-3.1 0-2.9 1.35-2.9 1.35l.01 1.4h2.96v.42H2.65s-1.65.17-1.65 3.02c0 3.13 1.53 3.02 1.53 3.02h.9v-1.45s-.05-1.73 1.7-1.73h2.93s1.65.03 1.65-1.6V2.67S10.2 1 7 1zm-1.63.94c.29 0 .53.24.53.53 0 .3-.24.53-.53.53-.3 0-.53-.24-.53-.53 0-.29.24-.53.53-.53z" fill="#387EB8" />
                      <path d="M7 13c3.1 0 2.9-1.35 2.9-1.35l-.01-1.4H6.93v-.42h4.43s1.65.17 1.65-3.02c0-3.13-1.53-3.02-1.53-3.02h-.9v1.45s.05 1.73-1.7 1.73H5.95s-1.65-.03-1.65 1.6v2.67S3.8 13 7 13zm1.63-.94c-.29 0-.53-.24-.53-.53 0-.3.24-.53.53-.53.3 0 .53.24.53.53 0 .29-.24.53-.53.53z" fill="#FFE052" />
                    </svg>
                  )}
                  {selectedLang === JAVASCRIPT && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#F7DF1E]">
                      <path d="M0 0h24v24H0V0z" fill="#F7DF1E" />
                      <path d="M6.667 19.333l1.88-1.133c.363.64.693 1.183 1.486 1.183.76 0 1.24-.297 1.24-1.453v-7.863h2.307v7.893c0 2.387-1.4 3.477-3.447 3.477-1.847 0-2.917-.957-3.467-2.107M15.16 19.073l1.88-1.09c.493.807 1.14 1.403 2.28 1.403 1.057 0 1.6-.467 1.6-1.113 0-.774-.613-1.047-1.65-1.494l-.566-.243c-1.633-.693-2.717-1.563-2.717-3.403 0-1.693 1.29-2.983 3.307-2.983 1.433 0 2.463.5 3.207 1.807l-1.757 1.127c-.387-.693-.803-.967-1.45-.967-.66 0-1.08.42-1.08.967 0 .677.42.95 1.387 1.367l.566.243c1.923.823 3.007 1.66 3.007 3.547 0 2.033-1.597 3.15-3.743 3.15-2.1 0-3.457-.997-4.12-2.317" fill="#0D0D0D" />
                    </svg>
                  )}
                  {selectedLang === SHELL && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#4EAA25]">
                      <path d="M21.5 4.5H2.5V19.5H21.5V4.5Z" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M5 8L8 11L5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 16H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                  <span>{selectedLang}</span>
                  <svg className="w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>

                {isLangSelectorOpen && (
                  <div className="absolute z-20 w-full mt-1 bg-[#2A2A2A] border border-[#404040] rounded-md shadow-lg overflow-hidden">
                    {[PYTHON, JAVASCRIPT, SHELL].map((lang) => (
                      <div
                        key={lang}
                        className={`px-3 py-2 text-[13px] cursor-pointer transition-colors flex items-center gap-2 ${selectedLang === lang
                          ? 'bg-[#3B9BFF]/20 text-[#3B9BFF]'
                          : 'text-[#CDCDCD] hover:bg-[#333333]'
                          }`}
                        onClick={() => {
                          setSelectedLang(lang);
                          setIsLangSelectorOpen(false);
                        }}
                      >
                        {lang === PYTHON && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 1c-3.1 0-2.9 1.35-2.9 1.35l.01 1.4h2.96v.42H2.65s-1.65.17-1.65 3.02c0 3.13 1.53 3.02 1.53 3.02h.9v-1.45s-.05-1.73 1.7-1.73h2.93s1.65.03 1.65-1.6V2.67S10.2 1 7 1zm-1.63.94c.29 0 .53.24.53.53 0 .3-.24.53-.53.53-.3 0-.53-.24-.53-.53 0-.29.24-.53.53-.53z" fill="#387EB8" />
                            <path d="M7 13c3.1 0 2.9-1.35 2.9-1.35l-.01-1.4H6.93v-.42h4.43s1.65.17 1.65-3.02c0-3.13-1.53-3.02-1.53-3.02h-.9v1.45s.05 1.73-1.7 1.73H5.95s-1.65-.03-1.65 1.6v2.67S3.8 13 7 13zm1.63-.94c-.29 0-.53-.24-.53-.53 0-.3.24-.53.53-.53.3 0 .53.24.53.53 0 .29-.24.53-.53.53z" fill="#FFE052" />
                          </svg>
                        )}
                        {lang === JAVASCRIPT && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#F7DF1E]">
                            <path d="M0 0h24v24H0V0z" fill="#F7DF1E" />
                            <path d="M6.667 19.333l1.88-1.133c.363.64.693 1.183 1.486 1.183.76 0 1.24-.297 1.24-1.453v-7.863h2.307v7.893c0 2.387-1.4 3.477-3.447 3.477-1.847 0-2.917-.957-3.467-2.107M15.16 19.073l1.88-1.09c.493.807 1.14 1.403 2.28 1.403 1.057 0 1.6-.467 1.6-1.113 0-.774-.613-1.047-1.65-1.494l-.566-.243c-1.633-.693-2.717-1.563-2.717-3.403 0-1.693 1.29-2.983 3.307-2.983 1.433 0 2.463.5 3.207 1.807l-1.757 1.127c-.387-.693-.803-.967-1.45-.967-.66 0-1.08.42-1.08.967 0 .677.42.95 1.387 1.367l.566.243c1.923.823 3.007 1.66 3.007 3.547 0 2.033-1.597 3.15-3.743 3.15-2.1 0-3.457-.997-4.12-2.317" fill="#0D0D0D" />
                          </svg>
                        )}
                        {lang === SHELL && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#4EAA25]">
                            <path d="M21.5 4.5H2.5V19.5H21.5V4.5Z" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M5 8L8 11L5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M10 16H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        )}
                        {lang}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                id="copy-button"
                onClick={copyToClipboard}
                className="flex items-center gap-1.5 bg-[#2A2A2A] hover:bg-[#333333] border border-[#404040] rounded-md px-3 py-1.5 text-[13px] text-[#CDCDCD] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5H6C4.89543 5 4 5.89543 4 7V19C4 20.1046 4.89543 21 6 21H16C17.1046 21 18 20.1046 18 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <rect x="8" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span>Copy</span>
              </button>
            </div>
          </div>

          <div className="relative flex border-none rounded-[8px] cursor-pointer bg-[#1C1D1F] overflow-hidden">
            <div className="flex-grow overflow-hidden">
              <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: '300px', position: 'relative' }}>
                <pre
                  className="text-[#CDCDCD] text-[12px] p-4 whitespace-pre"
                  style={{
                    minWidth: '100%',
                    tabSize: 2,
                    fontFamily: '"JetBrains Mono", Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
                    letterSpacing: '-0.03em',
                    lineHeight: '1.4'
                  }}
                >
                  {populatetext(currentApiService.api_id, currentApiService.api_key, selectedLang)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API 基本信息 */}
      <div className="mb-6 p-4 bg-[#1A1A1A] rounded-[8px] border border-[#404040]">
        <h3 className="text-[#CDCDCD] text-[14px] mb-3"> API Details</h3>
        
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[#808080]">API ID:</label>
            <div className="flex items-center mt-1">
              <code className="flex-1 p-2 bg-[#252525] rounded text-[12px] text-[#3B9BFF] overflow-x-auto">
                {currentApiService.api_id}
              </code>
              <button
                className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                onClick={() => navigator.clipboard.writeText(currentApiService.api_id)}
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
                {currentApiService.endpoint || `${API_SERVER_URL}/execute_workflow/${currentApiService.api_id}`}
              </code>
              <button
                className="ml-2 p-2 rounded-md hover:bg-[#2A2A2A]"
                onClick={() => navigator.clipboard.writeText(currentApiService.endpoint || `${API_SERVER_URL}/execute_workflow/${currentApiService.api_id}`)}
              >
                <svg className="w-4 h-4 text-[#CDCDCD]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                  <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default DeployedApiDetail;
