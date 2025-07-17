import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import InputOutputDisplay from './components/InputOutputDisplay'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils'
import { useAppSettings } from '@/app/components/states/AppSettingsContext'
import { runSingleEdgeNode, RunSingleEdgeNodeContext } from './hook/runSingleEdgeNodeExecutor'

export type ModifyConfigNodeData = {
    content: string | null,
}

type Convert2TextNodeProps = NodeProps<Node<ModifyConfigNodeData>>

function Convert2Text({ isConnectable, id }: Convert2TextNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const { getNode, getInternalNode, setNodes, setEdges } = useReactFlow()
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
                targetNodeType: 'text',
                context,
                // 可以选择不提供 constructJsonData，使用默认实现
            });
        } catch (error) {
            console.error('执行失败:', error);
        } finally {
            setIsLoading(false);
        }
    }, [id, isLoading, createExecutionContext]);

    useEffect(() => {
        console.log(getInternalNode(id))

        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
            setIsMenuOpen(true)
        }

        return () => {
            if (activatedEdge === id) {
                clearEdgeActivation()
            }
        }
    }, [])

    // 添加 effect 来监听 activatedEdge 的变化
    useEffect(() => {
        // 当 activatedEdge 不再是当前节点时，关闭菜单
        if (activatedEdge !== id && isMenuOpen) {
            setIsMenuOpen(false)
        }
    }, [activatedEdge, id])

    const onClickButton = () => {
        if (isOnGeneratingNewNode) return
        
        // 切换菜单状态
        const newMenuState = !isMenuOpen
        setIsMenuOpen(newMenuState)
        
        // 同步 activatedEdge 状态
        if (newMenuState) {
            clearAll()
            activateEdge(id)
        } else {
            clearEdgeActivation()
        }
    }

    // 定义 handle 样式
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
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
                style={{
                    borderColor: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY
                }}
                onClick={onClickButton}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {/* Convert to Text SVG icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M12 2L2 12" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2L8 2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2L12 6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 12L6 12" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 12L2 8" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Convert</span>
                    <span>Text</span>
                </div>

                {/* Source Handles */}
                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
                
                {/* Target Handles */}
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
            
            {/* Config Menu */}
            {isMenuOpen && <Convert2TextConfigMenu show={true} parentId={id} isLoading={isLoading} handleDataSubmit={handleDataSubmit} />}
        </div>
    )
}

type Convert2TextConfigProps = {
    show: boolean;
    parentId: string;
    isLoading: boolean;
    handleDataSubmit: () => Promise<void>;
}

function Convert2TextConfigMenu({ show, parentId, isLoading, handleDataSubmit }: Convert2TextConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getNode } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()

    return (
        <ul ref={menuRef} className={`absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M12 2L2 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M12 2L8 2" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M12 2L12 6" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M2 12L6 12" stroke="#CDCDCD" strokeWidth="1.5" />
                                <path d="M2 12L2 8" stroke="#CDCDCD" strokeWidth="1.5" />
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            Convert to Text
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
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 718-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                    <path d="M8 5L0 10V0L8 5Z" fill="black" />
                                </svg>
                            )}
                        </span>
                        <span>{isLoading ? '' : 'Run'}</span>
                    </button>
                </div>
            </li>
            <li>
                <InputOutputDisplay
                    parentId={parentId}
                    getNode={getNode}
                    getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                    getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                    supportedInputTypes={['structured']}
                    supportedOutputTypes={['text']}
                    inputNodeCategory="blocknode"
                    outputNodeCategory="blocknode"
                />
            </li>
        </ul>
    )
}

export default Convert2Text
