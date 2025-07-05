import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'
import { useAppSettings, Model } from '@/app/components/states/AppSettingsContext'
import { UI_COLORS } from '@/app/utils/colors'

export type GenerateConfigNodeData = {
    query_ids: { id: string, label: string } | undefined,
    document_ids: { id: string, label: string } | undefined,
    promptTemplate: string | null,
    model: string | undefined,
    structured_output: boolean | undefined,
    base_url: string | undefined,
}

// 预设的模板类型
export type PromptTemplateType = 
    | 'default'
    | 'data_cleaning'
    | 'content_retrieval'
    | 'data_augmentation'
    | 'data_labeling'
    | 'data_analysis'
    | 'data_processing'
    | 'content_sorting'
    | 'keyword_search'
    | 'format_conversion'
    | 'content_matching'
    | 'text_summarization'
    | 'data_filtering'
    | 'document_ranking'
    | 'language_detection'
    | 'error_handling'
    | 'contextual_comparison'
    | 'data_normalization';

// 预设模板内容的映射 (英文版)
const PROMPT_TEMPLATES: Record<PromptTemplateType, string> = {
    default: `Answer the question using the provided data. Use only information from the context and do not fabricate content.`,
    
    data_cleaning: `Analyze the provided data and clean it. Identify and remove duplicates, errors, and outliers. Normalize formats and ensure consistency.`,
    
    content_retrieval: `Retrieve information from the provided documents that is relevant to the query. Provide accurate, relevant information and cite sources.`,
    
    data_augmentation: `Augment the provided dataset to increase its diversity and scale. Maintain the characteristics and distribution of the original data.`,
    
    data_labeling: `Add appropriate labels or categories to the provided data. Use a consistent categorization scheme and explain your labeling choices.`,
    
    data_analysis: `Analyze the provided data to discover patterns, trends, and insights. Provide a detailed statistical overview and key findings.`,
    
    data_processing: `Process and transform the provided data to prepare for further analysis. Apply necessary transformations and normalization steps.`,
    
    content_sorting: `Sort the provided content based on relevance, importance, or other specified criteria. Explain the sorting logic.`,
    
    keyword_search: `Search for specified keywords and phrases in the provided documents. Return all relevant passages containing these terms.`,
    
    format_conversion: `Convert the provided data from one format to another. Preserve all original information and ensure accurate conversion.`,
    
    content_matching: `Compare two sets of content and identify matches or similarities. Provide similarity scores and rationale for matches.`,
    
    text_summarization: `Summarize the provided text, preserving key information and main points. Create a concise yet comprehensive summary.`,
    
    data_filtering: `Filter the provided dataset based on specified criteria. Return only results that meet the filtering conditions.`,
    
    document_ranking: `Rank a collection of documents based on relevance to a query. Provide a ranked list and rationale for each ranking.`,
    
    language_detection: `Detect the language of the provided text. Identify the primary language used and any secondary languages.`,
    
    error_handling: `Detect and handle errors in the provided data. Provide detailed feedback about the nature of errors and possible solutions.`,
    
    contextual_comparison: `Compare multiple items or concepts within a specific context. Highlight their similarities and differences.`,
    
    data_normalization: `Normalize the provided dataset to ensure consistency and comparability. Apply appropriate normalization techniques.`
};

type GenerateNodeProps = NodeProps<Node<GenerateConfigNodeData>>

function Generate({ data, isConnectable, id }: GenerateNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    
    // 使用 AppSettingsContext
    const { availableModels, isLocalDeployment } = useAppSettings()
    
    // 获取可用的激活模型列表 - 只显示 LLM 类型的模型
    const activeModels = useMemo(() => {
        return availableModels.filter(m => m.active && m.type === 'llm');
    }, [availableModels]);
    
    // 状态管理 - 使用第一个可用的激活 LLM 模型作为默认值
    const [model, setModel] = useState<string>(() => {
        // 首先尝试获取节点已有的模型值
        const nodeModel = getNode(id)?.data?.model as string;
        if (nodeModel) return nodeModel;
        
        // 如果节点没有模型值，则使用第一个可用的激活 LLM 模型
        return activeModels.length > 0 ? activeModels[0].id : "";
    });
    
    // 当可用模型变化且当前模型不在可用列表中时，更新为第一个可用 LLM 模型
    useEffect(() => {
        if (activeModels.length > 0 && !activeModels.some(m => m.id === model)) {
            setModel(activeModels[0].id);
        }
    }, [activeModels, model]);
    
    // 自定义渲染模型选项的函数
    const renderModelOption = (modelObj: Model) => {
        return (
            <div className="flex items-center justify-between w-full">
                <span className="truncate mr-2">{modelObj.name || modelObj.id}</span>
                {modelObj.isLocal ? (
                    <span className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#2A4365] text-[#90CDF4] flex-shrink-0">
                        Local
                    </span>
                ) : (
                    <span className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#4A4A4A] text-[#CDCDCD] flex-shrink-0">
                        Cloud
                    </span>
                )}
            </div>
        );
    };
    
    // 自定义显示选择的模型的函数
    const mapModelToDisplay = (modelId: string) => {
        const selectedModel = activeModels.find(m => m.id === modelId);
        if (!selectedModel) return modelId;
        return selectedModel.name || selectedModel.id;
    };
    
    const [structuredOutput, setStructuredOutput] = useState<boolean>(
        (getNode(id)?.data as GenerateConfigNodeData)?.structured_output ?? false
    )
    
    const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplateType>(
        ((getNode(id)?.data as GenerateConfigNodeData)?.promptTemplate as PromptTemplateType) || 'default'
    )

    // 基础URL(可选)
    const [baseUrl, setBaseUrl] = useState<string>(
        (getNode(id)?.data as GenerateConfigNodeData)?.base_url ?? ""
    )
    
    // 显示高级设置
    const [showSettings, setShowSettings] = useState(false)
    
    // 复制功能状态
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
    
    // 使用Hook处理执行逻辑
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: "text"
    });

    useEffect(() => {
        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
        }

        return () => {
            if (activatedEdge === id) {
                clearEdgeActivation()
            }
        }
    }, [])

    // 辅助函数
    const onFocus = () => {
        const curRef = menuRef.current
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag")
        }
    }

    const onBlur = () => {
        const curRef = menuRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
        }
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    // 同步状态到ReactFlow
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return {
                    ...node,
                    data: {
                        ...node.data,
                        model,
                        promptTemplate: selectedTemplate,
                        structured_output: structuredOutput,
                        base_url: baseUrl
                    }
                };
            }
            return node;
        }));
    }, [id, setNodes, model, selectedTemplate, structuredOutput, baseUrl]);

    const onClickButton = () => {
        setIsMenuOpen(!isMenuOpen)
        
        if (isOnGeneratingNewNode) return
        if (activatedEdge === id) {
            clearEdgeActivation()
        }
        else {
            clearAll()
            activateEdge(id)
        }
    }

    // 在组件顶部定义共享样式
    const handleStyle = {
        position: "absolute" as const,
        width: "calc(100%)",
        height: "calc(100%)",
        top: "0",
        left: "0",
        borderRadius: "0",
        transform: "translate(0px, 0px)",
        background: "transparent",
        border: "3px solid transparent",
        zIndex: !isOnConnect ? "-1" : "1",
    };

    return (
        <div className='p-[3px] w-[80px] h-[48px] relative'>
            {/* Invisible hover area between node and run button */}
            <div
                className="absolute -top-[40px] left-0 w-full h-[40px]"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            />

            {/* Run button positioned above the node - show when node or run button is hovered */}
            <button
                className={`absolute -top-[40px] left-1/2 transform -translate-x-1/2 w-[57px] h-[24px] rounded-[6px] border-[1px] text-[10px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[4px] transition-all duration-200 ${
                    (isHovered || isRunButtonHovered) ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                    backgroundColor: isRunButtonHovered ? '#39BC66' : '#181818',
                    borderColor: isRunButtonHovered ? '#39BC66' : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isRunButtonHovered ? '#000' : UI_COLORS.EDGENODE_BORDER_GREY
                }}
                onClick={handleDataSubmit}
                disabled={isLoading}
                onMouseEnter={() => setIsRunButtonHovered(true)}
                onMouseLeave={() => setIsRunButtonHovered(false)}
            >
                <span>
                    {isLoading ? (
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="6" height="8" viewBox="0 0 8 10" fill="none">
                            <path d="M8 5L0 10V0L8 5Z" fill="currentColor" />
                        </svg>
                    )}
                </span>
                <span>
                    {isLoading ? '' : 'Run'}
                </span>
            </button>

            <button 
                onClick={onClickButton}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
                style={{
                    borderColor: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY
                }}
            >
                {/* Generate SVG icon */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 3v18M3 12h18M5 5l14 14M19 5L5 19" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Generate</span>
                </div>

                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
                
                <Handle
                    id={`${id}-a`}
                    type="target"
                    position={Position.Top}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-b`}
                    type="target"
                    position={Position.Right}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-c`}
                    type="target"
                    position={Position.Bottom}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-d`}
                    type="target"
                    position={Position.Left}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            </button>

            {/* Configuration Menu */}
            {isMenuOpen && (
                    <ul ref={menuRef} className="absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg" style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}>
                        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                            <div className='flex flex-row gap-[12px]'>
                                <div className='flex flex-row gap-[8px] justify-center items-center'>
                                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CDCDCD" strokeWidth="1.5">
                                            <path d="M12 3v18M3 12h18M5 5l14 14M19 5L5 19" />
                                        </svg>
                                    </div>
                                    <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                        Generate
                                    </div>
                                </div>
                            </div>
                            <div className='w-[57px] h-[26px]'>
                                <button 
                                    className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' 
                                    onClick={handleDataSubmit}
                                    disabled={isLoading}
                                >
                                    <span>
                                        {isLoading ? (
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                                <path d="M8 5L0 10V0L8 5Z" fill="black" />
                                            </svg>
                                        )}
                                    </span>
                                    <span>
                                        {isLoading ? '' : 'Run'}
                                    </span>
                                </button>
                            </div>
                        </li>

                        <li>
                            <InputOutputDisplay
                                parentId={id}
                                getNode={getNode}
                                getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                                getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                                supportedInputTypes={['text', 'structured']}
                                supportedOutputTypes={['text', 'structured']}
                            />
                        </li>

                        {/* Queries 下拉选项 */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Queries</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='relative h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <PuppyDropdown
                                    options={getSourceNodeIdWithLabel(id).map(node => node.label)}
                                    selectedValue={(getNode(id)?.data as GenerateConfigNodeData)?.query_ids?.label}
                                    onSelect={(value: string) => {
                                        const selectedNode = getSourceNodeIdWithLabel(id).find(node => node.label === value);
                                        setNodes(prevNodes => prevNodes.map(node => {
                                            if (node.id === id) {
                                                return {
                                                    ...node,
                                                    data: {
                                                        ...node.data,
                                                        query_ids: selectedNode
                                                    }
                                                };
                                            }
                                            return node;
                                        }));
                                    }}
                                    buttonHeight="32px"
                                    buttonBgColor="transparent"
                                    menuBgColor="#1A1A1A"
                                    listWidth="100%"
                                    containerClassnames="w-full"
                                />
                            </div>
                        </li>

                        {/* Documents 下拉选项 */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Documents</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='relative h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <PuppyDropdown
                                    options={getSourceNodeIdWithLabel(id).map(node => node.label)}
                                    selectedValue={(getNode(id)?.data as GenerateConfigNodeData)?.document_ids?.label || "Choose Document"}
                                    onSelect={(value: string) => {
                                        const selectedNode = getSourceNodeIdWithLabel(id).find(node => node.label === value);
                                        setNodes(prevNodes => prevNodes.map(node => {
                                            if (node.id === id) {
                                                return {
                                                    ...node,
                                                    data: {
                                                        ...node.data,
                                                        document_ids: selectedNode
                                                    }
                                                };
                                            }
                                            return node;
                                        }));
                                    }}
                                    buttonHeight="32px"
                                    buttonBgColor="transparent"
                                    menuBgColor="#1A1A1A"
                                    listWidth="100%"
                                    containerClassnames="w-full"
                                />
                            </div>
                        </li>

                        {/* Prompt Template 下拉选择 */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Prompt Template</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='relative h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <PuppyDropdown
                                    options={Object.keys(PROMPT_TEMPLATES) as PromptTemplateType[]}
                                    selectedValue={selectedTemplate}
                                    onSelect={(value: string) => {
                                        setSelectedTemplate(value as PromptTemplateType);
                                    }}
                                    buttonHeight="32px"
                                    buttonBgColor="transparent"
                                    menuBgColor="#1A1A1A"
                                    listWidth="100%"
                                    containerClassnames="w-full"
                                    mapValueTodisplay={(v: string) => v.replace(/_/g, ' ')}
                                />
                            </div>
                        </li>

                        {/* Prompt Template 预览区域 */}
                        <li className='flex flex-col gap-2'>
                            <div className=' text-[10px] text-[#6D7177]'>
                                {PROMPT_TEMPLATES[selectedTemplate]}
                            </div>
                        </li>

                        {/* Output Type */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Output type</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <PuppyDropdown
                                    options={["text", "structured text"]}
                                    selectedValue={structuredOutput ? "structured text" : "text"}
                                    onSelect={(value: string) => {
                                        setStructuredOutput(value === "structured text");
                                        onBlur && onBlur();
                                    }}
                                    buttonHeight="32px"
                                    buttonBgColor="transparent"
                                    menuBgColor="#1A1A1A"
                                    listWidth="100%"
                                    containerClassnames="w-full"
                                    onFocus={onFocus}
                                />
                            </div>
                        </li>

                        {/* Settings 设置选项 */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center justify-between'>
                                <div className='flex items-center gap-2'>
                                    <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                                    <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
                                </div>
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className='text-[12px] text-[#6D7177] hover:text-[#39BC66] transition-colors flex items-center gap-1'
                                >
                                    {showSettings ? 'Hide' : 'Show'}
                                    <svg
                                        className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`}
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                            </div>

                            {showSettings && (
                                <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                                    <div className='flex flex-col gap-2'>
                                        <div className='flex items-center gap-2'>
                                            <label className='text-[12px] font-medium text-[#6D7177]'>Model</label>
                                        </div>
                                        <div className='relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                            <PuppyDropdown
                                                options={activeModels}
                                                selectedValue={model}
                                                onSelect={(selectedModel: Model) => setModel(selectedModel.id)}
                                                buttonHeight="32px"
                                                buttonBgColor="transparent"
                                                menuBgColor="#1A1A1A"
                                                listWidth="100%"
                                                containerClassnames="w-full"
                                                onFocus={onFocus}
                                                onBlur={onBlur}
                                                mapValueTodisplay={mapModelToDisplay}
                                                renderOption={renderModelOption}
                                            />
                                        </div>

                                        <div className='flex flex-col gap-1 mt-2'>
                                            <label className='text-[12px] font-medium text-[#6D7177]'>Base URL (Optional)</label>
                                            <input
                                                type="text"
                                                value={baseUrl}
                                                onChange={(e) => setBaseUrl(e.target.value)}
                                                placeholder="Enter base URL if needed"
                                                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                                        text-[#CDCDCD] text-[12px] font-medium appearance-none
                                                        hover:border-[#6D7177]/50 transition-colors'
                                                onMouseDownCapture={onFocus}
                                                onBlur={onBlur}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </li>
                    </ul>
            )}
        </div>
    )
}

export default Generate
