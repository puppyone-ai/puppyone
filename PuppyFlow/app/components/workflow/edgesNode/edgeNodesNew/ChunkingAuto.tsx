import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import InputOutputDisplay from './components/InputOutputDisplay'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils'
import { useAppSettings } from '@/app/components/states/AppSettingsContext'
import { runSingleEdgeNode, RunSingleEdgeNodeContext } from './hook/runSingleEdgeNodeExecutor'

// 前端节点配置数据
export type ChunkingConfigNodeData = {
    looped: boolean | undefined,
    subMenuType: string | null,
    sub_chunking_mode: "size" | "tokenizer" | undefined,
    content: string | null,
    extra_configs: {
        model: "gpt-4o" | "gpt-4-turbo" | "gpt-4o-mini" | undefined,
        chunk_size: number | undefined,
        overlap: number | undefined,
        handle_half_word: boolean | undefined,
    }
}

type ChunkingAutoProps = NodeProps<Node<ChunkingConfigNodeData>>

function ChunkingAuto({ data: { subMenuType }, isConnectable, id }: ChunkingAutoProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, getInternalNode, setNodes, setEdges } = useReactFlow()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()
    
    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } = useJsonConstructUtils()
    const { getAuthHeaders } = useAppSettings()

    // 创建执行上下文
    const createExecutionContext = useCallback((): RunSingleEdgeNodeContext => ({
        getNode,
        setNodes,
        setEdges,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        streamResult,
        reportError,
        resetLoadingUI,
        getAuthHeaders,
    }), [getNode, setNodes, setEdges, getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, clearAll, streamResult, reportError, resetLoadingUI, getAuthHeaders]);

    // 使用执行函数的 handleDataSubmit
    const handleDataSubmit = useCallback(async () => {
        if (isLoading) return;
        
        setIsLoading(true);
        try {
            const context = createExecutionContext();
            await runSingleEdgeNode({
                parentId: id,
                targetNodeType: 'structured',
                context,
                // 可以选择不提供 constructJsonData，使用默认实现
            });
        } catch (error) {
            console.error('执行失败:', error);
        } finally {
            setIsLoading(false);
        }
    }, [id, isLoading, createExecutionContext]);

    // 初始化和清理
    useEffect(() => {
        console.log(getInternalNode(id))

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
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
                style={{
                    borderColor: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY
                }}
            >
                {/* Chunking Auto SVG icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="11" fill="none" viewBox="0 0 16 15">
                    <path fill="currentColor" d="M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Zm3.938 1.582V9.238h-.68v-.597h1.47v5.513h-1.47v-.612h.68Z" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Chunk</span>
                    <span>Auto</span>
                </div>
                {/* Source handles */}
                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />

                {/* Target handles */}
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

            {/* Configuration Menu (integrated directly) */}
            {isMenuOpen && (
                <ul
                    ref={menuRef}
                    className="absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
                    style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}
                >
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" fill="none" viewBox="0 0 16 15">
                                        <path fill="#CDCDCD" d="M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Zm3.938 1.582V9.238h-.68v-.597h1.47v5.513h-1.47v-.612h.68Z" />
                                    </svg>
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Chunk Auto
                                </div>
                            </div>
                        </div>

                        <div className='flex flex-row gap-[8px] items-center justify-between'>
                            <button
                                className='w-[57px] h-[24px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                                onClick={handleDataSubmit}
                                disabled={isLoading}
                            >
                                <span>
                                    {isLoading ? (
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

                    {/* Input/Output display */}
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
                </ul>
            )}
        </div>
    )
}

export default ChunkingAuto
