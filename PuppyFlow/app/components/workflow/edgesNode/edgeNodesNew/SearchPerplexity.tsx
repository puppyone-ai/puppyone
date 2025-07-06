import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic, perplexityModelNames } from './hook/useRunSingleEdgeNodeLogicNew'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'

export type SearchConfigNodeData = {
    nodeLabels?: { label: string, id: string }[],
    subMenuType: string | null,
    top_k: number | undefined,
    content: string | null,
    looped: boolean | undefined,
    query_id: { id: string, label: string } | undefined,
    vector_db: { id: string, label: string } | undefined,
    extra_configs: {
        model: "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online" | undefined,
        threshold: number | undefined
    },
}

type SearchPerplexityNodeProps = NodeProps<Node<SearchConfigNodeData>>

function SearchPerplexity({ data, isConnectable, id }: SearchPerplexityNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)

    // 模型配置
    const [model, setModel] = useState<perplexityModelNames>(
        (getNode(id)?.data as SearchConfigNodeData)?.extra_configs?.model ?? "llama-3.1-sonar-small-128k-online"
    )
    

    // 使用Hook处理执行逻辑
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: "structured"
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


    // 同步model状态到ReactFlow
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return {
                    ...node,
                    data: {
                        ...node.data,
                        extra_configs: {
                            ...((node.data as SearchConfigNodeData).extra_configs),
                            model: model
                        },
                    }
                };
            }
            return node;
        }));
    }, [id, setNodes, model]);

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
                {/* Perplexity icon */}
                <img src="/Perplexity.svg" alt="Perplexity icon" className="w-[10px] h-[10px]" />
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Perplexity</span>
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
                <ul 
                    ref={menuRef} 
                    className={`absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[10px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg`}
                    style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}
                >
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <img src="/Perplexity.svg" alt="Perplexity icon" />
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Perplexity
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
                            supportedInputTypes={['text']}
                            supportedOutputTypes={['structured']}
                            inputNodeCategory="blocknode"
                            outputNodeCategory="blocknode"
                        />
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Model</label>
                            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                        </div>
                        <div className='relative h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                            <PuppyDropdown
                                options={[
                                    "llama-3.1-sonar-small-128k-online",
                                    "llama-3.1-sonar-large-128k-online",
                                    "llama-3.1-sonar-huge-128k-online"
                                ]}
                                selectedValue={model}
                                onSelect={(value: string) => {
                                    setModel(value as perplexityModelNames);
                                }}
                                buttonHeight="32px"
                                buttonBgColor="transparent"
                                menuBgColor="#1A1A1A"
                                listWidth="100%"
                                containerClassnames="w-full"
                            />
                        </div>
                    </li>
                </ul>
            )}
        </div>
    )
}

export default SearchPerplexity