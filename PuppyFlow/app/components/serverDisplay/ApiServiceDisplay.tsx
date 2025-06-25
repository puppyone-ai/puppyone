import React, { useState, useMemo } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { SYSTEM_URLS } from '@/config/urls';
import axios from 'axios';
import 'react-grid-layout/css/styles.css';
import 'react-grid-layout/css/styles.css';
import JSONForm from '@/app/components/tableComponent/JSONForm';
import TextEditor from '@/app/components/tableComponent/TextEditor';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ApiServiceDisplayProps {
  service: any;
}

const ApiServiceDisplayDashboard: React.FC<ApiServiceDisplayProps> = ({ service }) => {
  const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
  const endpoint = `${API_SERVER_URL}/api/${service.api_id}`;
  
  // 🔍 添加详细的调试信息 - 查看 service 对象的完整结构
  console.log('🔍 ApiServiceDisplay - 接收到的 service 对象:', service);

  // State for input values, output, and execution status
  const [inputValues, setInputValues] = useState<Record<string, any>>({});
  const [output, setOutput] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // 动态生成布局，每个 input parameter 都是一个独立的 block
  const generateLayout = () => {
    const inputParams = service.inputs ? Object.keys(service.inputs) : [];
    const outputParams = service.outputs ? Object.keys(service.outputs) : [];
    
    // 为不同断点生成布局
    const generateLayoutForBreakpoint = (cols: number) => {
      const layout: Layout[] = [];
      
      // 输入参数 - 第一列，所有元素都是3x2
      inputParams.forEach((paramKey, index) => {
        layout.push({
          i: `input-${paramKey}`,
          x: 0,
          y: index * 3, // 调整间距以适应2的高度，增加间距
          w: 3,
          h: 2,
          minW: 3,
          minH: 2
        });
      });

      // Execute 按钮 - 第二列，3x2
      layout.push({
        i: 'execute',
        x: 4,
        y: 0,
        w: 2,
        h: 2,
        minW: 2,
        minH: 2
      });

      // 输出参数 - 第三列，所有元素都是3x2
      outputParams.forEach((paramKey, index) => {
        layout.push({
          i: `output-${paramKey}`,
          x: 8,
          y: index * 3, // 调整间距以适应2的高度，增加间距
          w: 3,
          h: 2,
          minW: 3,
          minH: 2
        });
      });

      return layout;
    };

    return {
      lg: generateLayoutForBreakpoint(12),
      md: generateLayoutForBreakpoint(10),
      sm: generateLayoutForBreakpoint(6),
      xs: generateLayoutForBreakpoint(4),
      xxs: generateLayoutForBreakpoint(2)
    };
  };

  const [layouts, setLayouts] = useState<{ [key: string]: Layout[] }>(generateLayout());

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
      // 将 inputValues 转换为按照 parameter ID 作为键的格式
      const requestData: Record<string, any> = {};
      Object.entries(inputValues).forEach(([key, value]) => {
        const parameterId = service.inputs[key];
        if (parameterId) {
          requestData[parameterId] = value;
        }
      });

      const response = await axios.post(endpoint, requestData, {
        headers: {
          'Authorization': `Bearer ${service.api_key}`,
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

  // 从 workflow_json 中获取参数的类型信息
  const getParameterTypeFromWorkflow = (parameterId: string) => {
    if (!service.workflow_json?.blocks) {
      return { type: 'text', label: parameterId };
    }

    const block = service.workflow_json.blocks[parameterId];
    if (!block) {
      return { type: 'text', label: parameterId };
    }

    return {
      type: block.type || 'text',
      label: block.label || parameterId,
      data: block.data || {},
      collection_configs: block.collection_configs || []
    };
  };

  // 根据不同的 block type 渲染不同的样式和交互
  const renderFieldByType = (key: string, parameterId: string, blockInfo: any) => {
    const value = inputValues[key] || '';

    switch (blockInfo.type) {
      case 'text':
        return (
          <div className="rounded-[8px] border-[1px] flex-1 min-h-0"
            style={{
              border: "1px solid rgba(59, 155, 255, 0.3)", // 蓝色边框
              background: "#1C1D1F",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div className="p-4 h-full flex flex-col">
              <TextEditor
                value={value}
                onChange={(newValue) => handleInputChange(key, newValue, 'string')}
                placeholder={blockInfo.data?.content || `Enter ${blockInfo.label}...`}
                preventParentDrag={() => {}}
                allowParentDrag={() => {}}
              />
            </div>
          </div>
        );

      case 'number':
        return (
          <div className="rounded-[8px] border-[1px] flex-1 min-h-0"
            style={{
              border: "1px solid rgba(109, 113, 119, 0.3)",
              background: "#1C1D1F",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div className="p-4 h-full flex flex-col">
              <input
                type="number"
                value={value}
                onChange={(e) => handleInputChange(key, e.target.value, 'number')}
                className="w-full flex-1 bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none placeholder:text-[#666666] placeholder:italic font-plus-jakarta-sans"
                placeholder={`Enter ${blockInfo.label}...`}
              />
            </div>
          </div>
        );

      case 'structured':
        return (
          <div className="rounded-[8px] border-[1px] flex-1 min-h-0"
            style={{
              border: "1px solid rgba(155, 126, 219, 0.3)", // 紫色边框
              background: "#1C1D1F",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div className="h-full flex flex-col">
              <div className="p-2 pb-0">
                {blockInfo.collection_configs && blockInfo.collection_configs.length > 0 && (
                  <div className="mt-1">
                    <span className="text-[8px] text-[#F59E0B] bg-[#2A2A1A] px-1.5 py-0.5 rounded">
                      VECTOR DB ENABLED
                    </span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <JSONForm
                  value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                  onChange={(newValue) => {
                    try {
                      // 尝试解析 JSON，如果成功则存储为对象，否则存储为字符串
                      const parsedValue = JSON.parse(newValue);
                      handleInputChange(key, parsedValue, 'object');
                    } catch {
                      // JSON 解析失败，存储为字符串
                      handleInputChange(key, newValue, 'string');
                    }
                  }}
                  placeholder={`Enter JSON data for ${blockInfo.label}...`}
                  preventParentDrag={() => {}}
                  allowParentDrag={() => {}}
                />
              </div>
            </div>
          </div>
        );

      case 'boolean':
        return (
          <div className="rounded-[8px] border-[1px] flex-1 min-h-0"
            style={{
              border: "1px solid rgba(109, 113, 119, 0.3)",
              background: "#1C1D1F",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div className="p-4 h-full flex flex-col justify-center">
              <select
                value={value.toString()}
                onChange={(e) => handleInputChange(key, e.target.value === 'true', 'boolean')}
                className="w-full bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none font-plus-jakarta-sans"
              >
                <option value="" className="bg-[#1C1D1F] text-[#666666]">Select...</option>
                <option value="true" className="bg-[#1C1D1F] text-[#CDCDCD]">True</option>
                <option value="false" className="bg-[#1C1D1F] text-[#CDCDCD]">False</option>
              </select>
            </div>
          </div>
        );

      default:
        return (
          <div className="rounded-[8px] border-[1px] flex-1 min-h-0"
            style={{
              border: "1px solid rgba(109, 113, 119, 0.3)",
              background: "#1C1D1F",
              boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div className="p-4 h-full flex flex-col">
              <div className="mb-2">
                <span className="text-[10px] text-[#888] uppercase tracking-wide">{blockInfo.type}</span>
              </div>
              <textarea
                value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                onChange={(e) => handleInputChange(key, e.target.value, 'string')}
                className="w-full flex-1 bg-transparent border-none text-[#CDCDCD] text-sm focus:outline-none resize-none placeholder:text-[#666666] placeholder:italic font-plus-jakarta-sans"
                placeholder={`Enter ${blockInfo.label}...`}
              />
            </div>
          </div>
        );
    }
  };

  // 获取 block 类型对应的颜色和 SVG 图标
  const getBlockTypeStyle = (blockType: string) => {
    switch (blockType) {
      case 'text':
        return {
          color: '#3B9BFF',
          icon: (
            <svg width="16" height="16" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )
        };
      case 'structured':
        return {
          color: '#9B7EDB',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#9B7EDB]" />
              <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#9B7EDB]" />
              <path d="M9 9H11V11H9V9Z" className="fill-[#9B7EDB]" />
              <path d="M9 13H11V15H9V13Z" className="fill-[#9B7EDB]" />
              <path d="M13 9H15V11H13V9Z" className="fill-[#9B7EDB]" />
              <path d="M13 13H15V15H13V13Z" className="fill-[#9B7EDB]" />
            </svg>
          )
        };
      case 'file':
        return {
          color: '#9E7E5F',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-[#9E7E5F]" strokeWidth="1.5" />
              <path d="M8 13.5H16" className="stroke-[#9E7E5F]" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )
        };
      default:
        return {
          color: '#6B7280',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" className="stroke-[#6B7280]" strokeWidth="1.5" />
              <path d="M12 8V16M12 6H12.01" className="stroke-[#6B7280]" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )
        };
    }
  };

  // 渲染单个输入参数的 block - 更新版本
  const renderInputParameterBlock = (key: string, parameterId: string) => {
    const blockInfo = getParameterTypeFromWorkflow(parameterId);
    const typeStyle = getBlockTypeStyle(blockInfo.type);
    
    return (
      <div className="rounded-[8px] px-[12px] pt-[12px] pb-[12px] text-[#CDCDCD] bg-[#2A2A2A] break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden h-full relative flex flex-col group">
        {/* 右上角 INPUT 标签 - 无颜色 */}
        <div className="absolute top-2 right-2 z-10">
          <span className="text-[8px] text-[#888888] px-1.5 py-0.5 rounded font-mono">
            INPUT
          </span>
        </div>
        
        {/* Header bar */}
        <div className="h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-[6px] hover:cursor-grab active:cursor-grabbing group">
            <div className="flex items-center gap-[4px]">
              {typeStyle.icon}
              <span 
                className="flex items-center justify-start font-[400] text-[12px] leading-[18px] font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] transition-colors"
                style={{
                  '--active-color': typeStyle.color
                } as React.CSSProperties}
                onMouseDown={(e) => {
                  e.currentTarget.style.color = typeStyle.color;
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.color = '';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '';
                }}
              >
                {blockInfo.label}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex-1 min-h-0 flex flex-col">
          {renderFieldByType(key, parameterId, blockInfo)}
        </div>
      </div>
    );
  };

  // 渲染单个输出参数的 block - 更新版本
  const renderOutputParameterBlock = (key: string, outputKey: string) => {
    const blockInfo = getParameterTypeFromWorkflow(outputKey);
    const typeStyle = getBlockTypeStyle(blockInfo.type);
    const value = output && output[outputKey] ? output[outputKey] : '';
    
    return (
      <div className="rounded-[8px] px-[12px] pt-[12px] pb-[12px] text-[#CDCDCD] bg-[#252525] break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden h-full relative flex flex-col group">
        {/* 右上角 OUTPUT 标签 - 无颜色 */}
        <div className="absolute top-2 right-2 z-10">
          <span className="text-[8px] text-[#888888] px-1.5 py-0.5 rounded font-mono">
            OUTPUT
          </span>
        </div>
        
        {/* Header bar */}
        <div className="h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-[6px] hover:cursor-grab active:cursor-grabbing group">
            <div className="flex items-center gap-[4px]">
              {typeStyle.icon}
              <span 
                className="flex items-center justify-start font-[400] text-[12px] leading-[18px] font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] transition-colors"
                style={{
                  '--active-color': typeStyle.color
                } as React.CSSProperties}
                onMouseDown={(e) => {
                  e.currentTarget.style.color = typeStyle.color;
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.color = '';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '';
                }}
              >
                {blockInfo.label}
              </span>
            </div>
          </div>
          
          <div className="min-w-[60px] min-h-[24px] flex items-center justify-end">
            {value && (
              <button
                onClick={() => copyToClipboard(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))}
                className="px-2 py-1 text-xs bg-[#404040] hover:bg-[#505050] text-[#CDCDCD] rounded transition-colors"
              >
                Copy
              </button>
            )}
          </div>
        </div>
        
        <div className="rounded-[8px] border-[1px] flex-1 min-h-0 overflow-hidden"
          style={{
            border: "1px solid rgba(109, 113, 119, 0.3)",
            background: "#1C1D1F",
            boxShadow: "inset 0px 1px 2px rgba(0, 0, 0, 0.2)",
          }}
        >
          <div className="p-4 h-full overflow-auto">
            {error ? (
              <div className="text-red-400 text-sm font-plus-jakarta-sans">Error occurred</div>
            ) : value ? (
              <pre className="text-[#CDCDCD] text-sm whitespace-pre-wrap font-plus-jakarta-sans">
                {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
              </pre>
            ) : (
              <div className="text-[#666666] text-sm italic font-plus-jakarta-sans">
                Output will appear here after execution...
              </div>
            )}
          </div>
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
          /api/{service.api_id}
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

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const onResizeStop = () => {
    setIsResizing(false);
  };

  const onDragStart = () => {
    setIsDragging(true);
  };

  const onDragStop = () => {
    setIsDragging(false);
  };

  const CustomResizeHandle = React.forwardRef<HTMLDivElement>((props, ref) => {
    return (
      <div
        ref={ref}
        className="react-resizable-handle group-hover:opacity-60 opacity-0 transition-opacity duration-200"
        style={{
          position: 'absolute',
          width: '20px',
          height: '20px',
          bottom: '0',
          right: '0',
          background: 'transparent',
          cursor: 'se-resize',
          zIndex: 10,
        }}
        {...props}
      >
        <div
          style={{
            position: 'absolute',
            right: '3px',
            bottom: '3px',
            width: '14px',
            height: '14px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M10 5.99998H12V7.99998H10V5.99998Z" fill="#6D7177"/>
            <path d="M10 2H12V4H10V2Z" fill="#6D7177"/>
            <path d="M6 5.99998H8V7.99998H6V5.99998Z" fill="#6D7177"/>
            <path d="M6 10H8V12H6V10Z" fill="#6D7177"/>
            <path d="M2 10H4V12H2V10Z" fill="#6D7177"/>
            <path d="M10 10H12V12H10V10Z" fill="#6D7177"/>
          </svg>
        </div>
      </div>
    );
  });

  CustomResizeHandle.displayName = 'CustomResizeHandle';

  return (
    <div className={`w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] bg-[#252525] ${(isResizing || isDragging) ? 'select-none' : ''}`}>
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
              onResizeStart={onResizeStart}
              onResizeStop={onResizeStop}
              onDragStart={onDragStart}
              onDragStop={onDragStop}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
              rowHeight={60}
              margin={[16, 16]}
              containerPadding={[16, 16]}
              isDraggable={true}
              isResizable={true}
              useCSSTransforms={false}
              width={1200}
              resizeHandle={<CustomResizeHandle />}
            >
              {/* 为每个 input parameter 渲染独立的 block - 更新调用 */}
              {service.inputs && Object.entries(service.inputs).map(([key, parameterId]: [string, any]) => (
                <div key={`input-${key}`} className="group">
                  {renderInputParameterBlock(key, parameterId)}
                </div>
              ))}

              {/* Execute Button */}
              <div key="execute" className="rounded-[8px] px-[12px] pt-[12px] pb-[12px] text-[#CDCDCD] bg-[#2A2A2A] break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden h-full relative flex flex-col group">

                
                {/* Header bar */}
                <div className="h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2 flex-shrink-0">
                  <div className="flex items-center gap-[6px] hover:cursor-grab active:cursor-grabbing group">
                    <div className="flex items-center gap-[4px]">
                      <svg className="w-4 h-4" fill="#22C55E" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      <span className="flex items-center justify-start font-[400] text-[12px] leading-[18px] font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] transition-colors">
                        Run
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 min-h-0 flex flex-col justify-center items-center">
                  <button
                    onClick={executeWorkflow}
                    disabled={isExecuting}
                    className={`py-2 px-4 rounded-lg font-medium transition-all flex items-center gap-2 font-plus-jakarta-sans text-[14px] ${
                      isExecuting
                        ? 'bg-[#666666] text-[#AAAAAA] cursor-not-allowed'
                        : 'bg-[#22C55E] hover:bg-[#16A34A] text-black hover:shadow-lg'
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
                        <svg className="w-4 h-4 fill-black" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Run
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 为每个 output parameter 渲染独立的 block - 更新调用 */}
              {service.outputs && Object.entries(service.outputs).map(([key, outputKey]: [string, any]) => (
                <div key={`output-${key}`} className="group">
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