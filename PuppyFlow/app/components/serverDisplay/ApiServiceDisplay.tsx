import React, { useState, useMemo } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { SYSTEM_URLS } from '@/config/urls';
import axios from 'axios';
import 'react-grid-layout/css/styles.css';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ApiServiceDisplayProps {
  service: any;
}

const ApiServiceDisplayDashboard: React.FC<ApiServiceDisplayProps> = ({ service }) => {
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
  const endpoint = `${API_SERVER_URL}/execute_workflow/${service.api_id}`;
  
  // State for input values, output, and execution status
  const [inputValues, setInputValues] = useState<Record<string, any>>({});
  const [output, setOutput] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);

  // 动态生成布局，每个 input parameter 都是一个独立的 block
  const generateLayout = () => {
    const inputParams = service.inputs ? Object.keys(service.inputs) : [];
    const outputParams = service.outputs ? Object.keys(service.outputs) : [];
    const layout: Layout[] = [];

    // 为每个 input parameter 创建一个 block
    inputParams.forEach((paramKey, index) => {
      const row = Math.floor(index / 3); // 每行最多3个参数
      const col = (index % 3) * 4; // 每个参数占4列宽度
      layout.push({
        i: `input-${paramKey}`,
        x: col,
        y: row * 3, // 从第一行开始，每个参数占3行高度
        w: 4,
        h: 3,
        minW: 3,
        minH: 2
      });
    });

    // Execute 按钮
    const executeRow = Math.floor(inputParams.length / 3);
    layout.push({
      i: 'execute',
      x: 0,
      y: executeRow * 3,
      w: 2,
      h: 2,
      minW: 2,
      minH: 2
    });

    // 为每个 output parameter 创建一个 block
    outputParams.forEach((paramKey, index) => {
      const outputStartRow = executeRow * 3 + 3; // 在 execute 按钮下方开始
      const row = Math.floor(index / 3); // 每行最多3个参数
      const col = (index % 3) * 4; // 每个参数占4列宽度
      layout.push({
        i: `output-${paramKey}`,
        x: col,
        y: outputStartRow + row * 3, // 从 execute 按钮下方开始
        w: 4,
        h: 3,
        minW: 3,
        minH: 2
      });
    });

    return layout;
  };

  const [layouts, setLayouts] = useState<{ [key: string]: Layout[] }>({
    lg: generateLayout()
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('📋 Endpoint copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  // Handle input value changes
  const handleInputChange = (key: string, value: any, type: string) => {
    setInputValues(prev => ({
      ...prev,
      [key]: type === 'number' ? (value === '' ? '' : Number(value)) : value
    }));
  };

  // Execute the API workflow
  const executeWorkflow = async () => {
    setIsExecuting(true);
    setError(null);
    setOutput(null);
    
    const startTime = Date.now();
    
    try {
      const response = await axios.post(endpoint, {
        inputs: inputValues,
        api_key: service.api_key
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000
      });
      
      const endTime = Date.now();
      setExecutionTime(endTime - startTime);
      setOutput(response.data);
    } catch (err: any) {
      const endTime = Date.now();
      setExecutionTime(endTime - startTime);
      
      if (err.response) {
        setError(`API Error (${err.response.status}): ${err.response.data?.message || err.response.data || 'Unknown error'}`);
      } else if (err.request) {
        setError('Network Error: Unable to reach the API server');
      } else {
        setError(`Error: ${err.message}`);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // 渲染单个输入参数的 block
  const renderInputParameterBlock = (key: string, schema: any) => {
    const value = inputValues[key] || '';
    
    const renderField = () => {
      switch (schema.type) {
        case 'string':
          if (schema.format === 'textarea') {
            return (
              <div className="bg-[#2A2A2A] rounded p-4 flex-1 overflow-auto">
                <textarea
                  value={value}
                  onChange={(e) => handleInputChange(key, e.target.value, 'string')}
                  className="w-full h-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none resize-none placeholder:text-[#666666] placeholder:italic"
                  placeholder={schema.description || `Enter ${key}...`}
                />
              </div>
            );
          }
          return (
            <div className="bg-[#2A2A2A] rounded p-4 flex-1 overflow-auto">
              <textarea
                value={value}
                onChange={(e) => handleInputChange(key, e.target.value, 'string')}
                className="w-full h-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none resize-none placeholder:text-[#666666] placeholder:italic"
                placeholder={schema.description || `Enter ${key}...`}
              />
            </div>
          );
        
        case 'number':
        case 'integer':
          return (
            <div className="bg-[#2A2A2A] rounded p-4 flex-1 overflow-auto">
              <textarea
                value={value}
                onChange={(e) => handleInputChange(key, e.target.value, 'number')}
                className="w-full h-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none resize-none placeholder:text-[#666666] placeholder:italic"
                placeholder={schema.description || `Enter ${key}...`}
              />
            </div>
          );
        
        case 'boolean':
          return (
            <div className="bg-[#2A2A2A] rounded p-4 flex-1 overflow-auto">
              <select
                value={value.toString()}
                onChange={(e) => handleInputChange(key, e.target.value === 'true', 'boolean')}
                className="w-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none"
              >
                <option value="" className="bg-[#2A2A2A] text-[#666666]">Select...</option>
                <option value="true" className="bg-[#2A2A2A] text-[#CDCDCD]">True</option>
                <option value="false" className="bg-[#2A2A2A] text-[#CDCDCD]">False</option>
              </select>
            </div>
          );
        
        default:
          return (
            <div className="bg-[#2A2A2A] rounded p-4 flex-1 overflow-auto">
              <textarea
                value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    handleInputChange(key, parsed, 'object');
                  } catch {
                    handleInputChange(key, e.target.value, 'string');
                  }
                }}
                className="w-full h-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none resize-none font-mono placeholder:text-[#666666] placeholder:italic"
                placeholder={`Enter ${key} (JSON format)...`}
              />
            </div>
          );
      }
    };

    return (
      <div className="bg-[#1F1F1F] rounded-lg p-4 h-full overflow-hidden relative flex flex-col">
        {/* 参数名称和类型标识在同一行 - 淡化参数名称 */}
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <h3 className="text-[10px] font-normal text-[#888888]">{service.inputs[key]}</h3>
          <span className="text-[10px] text-[#4A90E2] bg-[#1A2A3A] px-2 py-1 rounded">
            INPUT
          </span>
        </div>
        
        <div className="flex-1 min-h-0 flex flex-col">
          {renderField()}
        </div>
      </div>
    );
  };

  // 渲染单个输出参数的 block
  const renderOutputParameterBlock = (key: string, outputKey: string) => {
    const value = output && output[outputKey] ? output[outputKey] : '';
    
    return (
      <div className="bg-[#1F1F1F] rounded-lg p-4 h-full overflow-hidden relative flex flex-col">
        {/* 参数名称和类型标识在同一行，以及复制按钮 - 淡化参数名称 */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-normal text-[#888888]">{outputKey}</h3>
            <span className="text-[10px] text-[#F59E0B] bg-[#2A2A1A] px-2 py-1 rounded">
              OUTPUT
            </span>
          </div>
          {value && (
            <button
              onClick={() => copyToClipboard(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))}
              className="px-2 py-1 text-xs bg-[#404040] hover:bg-[#505050] text-[#CDCDCD] rounded transition-colors"
            >
              Copy
            </button>
          )}
        </div>
        
        <div className="bg-[#2A2A2A] rounded p-4 min-h-[80px] flex-1 overflow-auto">
          {error ? (
            <div className="text-red-400 text-sm">Error occurred</div>
          ) : value ? (
            <pre className="text-[#CDCDCD] text-sm whitespace-pre-wrap">
              {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
            </pre>
          ) : (
            <div className="text-[#666666] text-sm italic">
              Output will appear here after execution...
            </div>
          )}
        </div>
      </div>
    );
  };

  // 状态信息区域组件
  const StatusSection = () => (
    <>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>API ID: <span className="text-[#606060] break-all">{service.api_id}</span></span>
      </div>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Endpoint: <span className="text-[#606060] break-all">
          /execute_workflow/{service.api_id}
        </span></span>
      </div>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>API Key: <span className={`break-all ${service.api_key ? "text-[#606060]" : "text-[#FF6B6B]"}`}>
          {service.api_key || 'Not configured'}
        </span></span>
      </div>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Input Schema: <span className={`break-all ${service.inputs && Object.keys(service.inputs).length > 0 ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}`}>
          {service.inputs && Object.keys(service.inputs).length > 0 ? `${Object.keys(service.inputs).length} parameters` : 'Not configured'}
        </span></span>
      </div>
      <div className="text-[11px] text-[#505050] mb-2 break-words">
        <span>Output Schema: <span className={`break-all ${service.outputs && Object.keys(service.outputs).length > 0 ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}`}>
          {service.outputs && Object.keys(service.outputs).length > 0 ? `${Object.keys(service.outputs).length} parameters` : 'Not configured'}
        </span></span>
      </div>
      <div className="text-[11px] text-[#505050] break-words">
        <span>Full Endpoint: <span className="text-[#606060] break-all">
          {endpoint}
        </span></span>
      </div>
    </>
  );

  const onLayoutChange = (layout: Layout[], layouts: { [key: string]: Layout[] }) => {
    setLayouts(layouts);
  };

  return (
    <div className="w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] bg-[#252525]">
      <div className="w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px] relative">
        <div className="w-full h-full overflow-auto">
          <div className="w-full max-w-[1200px] mx-auto h-full">
            {/* Header - 移到 ResponsiveGridLayout 外面 */}
            <div className="bg-transparent">
              <div className="mb-[16px] pb-[16px] border-b border-[#303030] flex items-center px-[16px] pt-[32px]">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 border border-[#60A5FA] bg-[#2A2A2A] rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#60A5FA]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-[16px] font-medium text-[#CDCDCD]">API Service</h1>
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

            <ResponsiveGridLayout
              className="layout"
              layouts={layouts}
              onLayoutChange={onLayoutChange}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
              rowHeight={60}
              margin={[16, 16]}
              containerPadding={[16, 16]}
              isDraggable={true}
              isResizable={true}
              useCSSTransforms={false}
              width={1200}
            >
              {/* 为每个 input parameter 渲染独立的 block */}
              {service.inputs && Object.entries(service.inputs).map(([key, inputKey]: [string, any]) => (
                <div key={`input-${key}`}>
                  {renderInputParameterBlock(key, { type: 'string', description: `Input parameter: ${inputKey}` })}
                </div>
              ))}

              {/* Execute Button */}
              <div key="execute" className="bg-[#1F1F1F] rounded-lg p-4 h-full overflow-hidden relative flex flex-col">
                {/* Block ID 和类型标识 */}
                <div className="flex items-center gap-2 mb-3 flex-shrink-0">
                  <span className="text-[10px] text-[#22C55E] bg-[#1A2A1A] px-2 py-1 rounded">
                    ACTION
                  </span>
                </div>
                
                <div className="flex-1 min-h-0 flex flex-col justify-center items-center">
                  <button
                    onClick={executeWorkflow}
                    disabled={isExecuting}
                    className={`py-2 px-4 rounded-lg font-medium transition-all flex items-center gap-2 ${
                      isExecuting
                        ? 'bg-[#666666] text-[#AAAAAA] cursor-not-allowed'
                        : 'bg-[#22C55E] hover:bg-[#16A34A] text-white hover:shadow-lg'
                    }`}
                  >
                    {isExecuting ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Running...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Run
                      </>
                    )}
                  </button>
                  
                  {executionTime !== null && (
                    <div className="mt-3 text-center text-sm text-[#888888]">
                      {executionTime}ms
                    </div>
                  )}
                </div>
              </div>

              {/* 为每个 output parameter 渲染独立的 block */}
              {service.outputs && Object.entries(service.outputs).map(([key, outputKey]: [string, any]) => (
                <div key={`output-${key}`}>
                  {renderOutputParameterBlock(key, outputKey)}
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiServiceDisplayDashboard; 