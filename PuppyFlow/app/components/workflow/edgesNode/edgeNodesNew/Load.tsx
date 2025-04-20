'use client'
import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import React, { useState, useEffect, useRef } from 'react'
import useJsonConstructUtils, { NodeJsonType } from '../../../hooks/useJsonConstructUtils'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { BaseConstructedJsonData } from './hook/useEdgeNodeBackEndJsonBuilder'

// 前端节点配置数据
export type LoadNodeFrontendConfig = {
    resultNode: string | null,
}

// 后端 API 请求数据
export type LoadOperationApiPayload = {
    type: "load",
    data: {
        block_type: string,
        content: string,
        extra_configs: {
            file_configs: Array<{
                file_path: string,
                file_type: string,
                configs?: Record<string, any>
            }>
        },
        inputs: Record<string, string>,
        outputs: Record<string, string>
    }
}

type LoadConfigNodeProps = NodeProps<Node<LoadNodeFrontendConfig>>

function LoadEdgeNode({ isConnectable, id }: LoadConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode } = useReactFlow()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    
    // 使用 BaseEdgeNodeLogic，注意这里不需要自定义 constructJsonData，因为我们在 useEdgeNodeBackEndJsonBuilder 中添加了 Load 节点的处理
    const { 
        isLoading,
        handleDataSubmit 
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured', // Load 节点默认产生 structured 类型的输出
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
    
    // 定义共享样式
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
            {/* Main node button */}
            <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600]`}
                title="Load Node"
            >
                Load
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
                        className="absolute top-[58px] left-0 text-white w-[352px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
                    >
                        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                            <div className='flex flex-row gap-[12px]'>
                                <div className='flex flex-row gap-[8px] justify-center items-center'>
                                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="10" viewBox="0 0 13 10" fill="none">
                                            <rect x="0.75" y="0.75" width="5.5" height="8.5" stroke="#D9D9D9" strokeWidth="1.5" />
                                            <path d="M13 5L9 2.6906V7.3094L13 5ZM9 5.4H9.4V4.6H9V5.4Z" fill="#D9D9D9" />
                                            <path d="M6 5H10" stroke="#D9D9D9" strokeWidth="1.5" />
                                        </svg>
                                    </div>
                                    <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                                        Load
                                    </div>
                                </div>
                            </div>
                            <div className='flex flex-row gap-[8px] items-center justify-center'>
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
                            />
                        </li>
                    </ul>
                </div>
            )}
        </div>
    )
}

export default LoadEdgeNode