import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import React, { useState, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import useJsonConstructUtils from '../../../hooks/useJsonConstructUtils'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'

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
    const { getNode } = useReactFlow()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    
    // 使用通用的 BaseEdgeNodeLogic
    const { 
        isLoading,
        handleDataSubmit 
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured'  // 只传递必要的参数
    });
    
    // 初始化和清理
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
        <div className='p-[3px] w-[80px] h-[48px]'>
            <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] gap-[8px]`}
            >
                Chunking <br /> Auto
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
                <div className="absolute top-[8px] left-0 w-[80px]">
                    <ul 
                        ref={menuRef} 
                        className="absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
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
                                        Chunking Auto
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
                        
                        {/* Input/Output display */}
                        <li>
                            <InputOutputDisplay 
                                parentId={id}
                                getNode={getNode}
                                getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                                getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                            />
                        </li>


                    </ul>
                </div>
            )}
        </div>
    )
}

export default ChunkingAuto
