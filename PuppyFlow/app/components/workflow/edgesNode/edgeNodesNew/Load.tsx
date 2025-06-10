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
    const { isOnConnect, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll, isEdgeActivated, inactivateEdge } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const [borderColor, setBorderColor] = useState("#CDCDCD")
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const [isClicked, setIsClicked] = useState(false)

    // 使用钩子处理执行逻辑
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: "text"
    });

    // 边框颜色管理
    useEffect(() => {
        if (isEdgeActivated(id)) {
            setBorderColor("#4599DF"); // 激活时使用蓝色，与block节点一致
        } else {
            setBorderColor(isOnConnect && isTargetHandleTouched ? "#FFA73D" : "#CDCDCD");
        }
    }, [isEdgeActivated, isOnConnect, isTargetHandleTouched, id]);

    useEffect(() => {
        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
        }

        return () => {
            if (isEdgeActivated(id)) {
                clearEdgeActivation()
            }
        }
    }, [])

    const onClickButton = (event: React.MouseEvent) => {
        if (isOnGeneratingNewNode) return
        
        // 单击只激活节点，不切换菜单状态
        if (!isEdgeActivated(id)) {
            // 如果是按住Ctrl键点击，则添加到选择中
            const isCtrlPressed = event.ctrlKey || event.metaKey;
            activateEdge(id, isCtrlPressed);
        }
        setIsClicked(true)
    }

    const onDoubleClickButton = () => {
        if (isOnGeneratingNewNode) return
        
        // 双击切换菜单状态
        setIsMenuOpen(!isMenuOpen)
        
        // 确保节点保持激活状态
        if (!isEdgeActivated(id)) {
            clearAll()
            activateEdge(id)
        }
        setIsClicked(true)
    }

    const onMouseEnter = () => {
        if (isOnGeneratingNewNode) return
        activateEdge(id)
    }

    const onMouseLeave = () => {
        if (isOnGeneratingNewNode) return
        // 只有在不是菜单打开状态且节点未被点击时才失活
        if (!isMenuOpen && !isClicked) {
            inactivateEdge(id)
        }
    }

    // 监听重置状态事件
    useEffect(() => {
        const handleResetState = (event: CustomEvent<{ closeMenu: boolean }>) => {
            setIsClicked(false)
            if (event.detail.closeMenu) {
                setIsMenuOpen(false)
            }
        }
        window.addEventListener('resetEdgeState', handleResetState as EventListener)
        return () => {
            window.removeEventListener('resetEdgeState', handleResetState as EventListener)
            setIsClicked(false)
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
            {/* Main node button */}
            <button 
                onClick={onClickButton}
                onDoubleClick={onDoubleClickButton}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600]`}
                style={{ borderColor }}
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
                    <ul 
                        className="absolute top-[64px] text-white w-[352px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
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
                                supportedInputTypes={['file']}
                                supportedOutputTypes={['structured']}
                            />
                        </li>
                    </ul>
            )}
        </div>
    )
}

export default LoadEdgeNode