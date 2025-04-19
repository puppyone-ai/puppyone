import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'

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
    const menuRef = useRef<HTMLUListElement>(null)
    
    // 状态管理
    const [model, setModel] = useState<string>(
        (getNode(id)?.data?.model as string) || "openai/gpt-4o"
    )
    
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
    
    // 支持的模型列表
    const supported_models = [
        "openai/o1-pro",
        "openai/o3-mini-high",
        "openai/o3-mini",
        "openai/o1",
        "openai/o1-mini",
        "openai/gpt-4.5-preview",
        "openai/gpt-4o-2024-11-20",
        "openai/gpt-4o-mini",
        "openai/gpt-4-turbo",
        "deepseek/deepseek-chat-v3-0324:free",
        "deepseek/deepseek-r1-zero:free",
        "anthropic/claude-3.5-haiku",
        "anthropic/claude-3.5-sonnet",
        "anthropic/claude-3.7-sonnet",
    ]

    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
            <button 
                onClick={onClickButton}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`}
            >
                Generate
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
                    <ul ref={menuRef} className="absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg">
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
                                        {isLoading ? 'Running' : 'Run'}
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
                                    selectedValue={(getNode(id)?.data as GenerateConfigNodeData)?.query_ids?.label || "选择查询"}
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
                                    selectedValue={(getNode(id)?.data as GenerateConfigNodeData)?.document_ids?.label || "选择文档"}
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
                                            <select
                                                value={model}
                                                onChange={(e) => setModel(e.target.value)}
                                                className='w-full h-full bg-[#252525] border-none outline-none px-3
                                                text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer'
                                                onMouseDownCapture={onFocus}
                                                onBlur={onBlur}
                                            >
                                                {supported_models.map((model) => (
                                                    <option key={model} value={model}>{model}</option>
                                                ))}
                                            </select>
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M1 1L5 5L9 1" stroke="#6D7177" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
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
