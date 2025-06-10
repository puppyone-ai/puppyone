import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'

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

type SearchConfigNodeProps = NodeProps<Node<SearchConfigNodeData>>

function SearchGoogle({ data, isConnectable, id }: SearchConfigNodeProps) {
    const { isOnConnect, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll, isEdgeActivated, inactivateEdge } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const [borderColor, setBorderColor] = useState("#CDCDCD")
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const [isClicked, setIsClicked] = useState(false)

    // 状态管理
    const [showSettings, setShowSettings] = useState(false)
    
    // 加载配置值
    const [top_k, setTop_k] = useState<number | undefined>(
        (getNode(id)?.data as SearchConfigNodeData)?.top_k ?? 5
    )
    const topkRef = useRef<HTMLInputElement>(null)
    

    // 使用Hook处理执行逻辑
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: "structured"
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


    // 状态同步到 ReactFlow
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                // 确保 node.data 存在并且是对象类型
                const nodeData = typeof node.data === 'object' && node.data !== null 
                    ? node.data 
                    : {};
                
                return {
                    ...node,
                    data: {
                        ...nodeData,
                        top_k: top_k,
                    }
                };
            }
            return node;
        }));
    }, [id, setNodes, top_k]);

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

    // 修改 onDataSubmit 函数（如果存在的话）
    const onDataSubmit = () => {
        handleDataSubmit();
    }

    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
            <button 
                onClick={onClickButton}
                onDoubleClick={onDoubleClickButton}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600]`}
                style={{ borderColor }}
            >
                Search <br /> Google
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
                <ul ref={menuRef} className={`absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg`}>
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <FontAwesomeIcon icon={faGoogle} className='text-main-grey w-[14px] h-[14px]' />
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Google
                                </div>
                            </div>
                        </div>
                        <div className='w-[57px] h-[26px]'>
                            <button 
                                className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' 
                                onClick={onDataSubmit}
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
                        />
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                            <div className='w-2 h-2 rounded-full bg-[#6D7177]'></div>
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className='ml-auto text-[12px] font-medium text-[#6D7177] hover:text-[#CDCDCD] transition-colors flex items-center gap-1'
                            >
                                {showSettings ? 'Hide' : 'Show'}
                                <svg
                                    className={`w-4 h-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        fill="none"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M19 9l-7 7-7-7"
                                    />
                                </svg>
                            </button>
                        </div>
                        {showSettings && (
                            <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                                <div className='flex flex-col gap-2'>
                                    <div className='flex items-center gap-2'>
                                        <label className='text-[12px] font-medium text-[#6D7177]'>Result Number</label>
                                    </div>
                                    <input
                                        ref={topkRef}
                                        value={top_k}
                                        onChange={() => {
                                            if (topkRef.current) {
                                                setTop_k(topkRef.current.value === "" ? undefined : Number(topkRef.current.value))
                                            }
                                        }}
                                        type='number'
                                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                                        autoComplete='off'
                                        required
                                        onMouseDownCapture={onFocus}
                                        onBlur={onBlur}
                                    />
                                </div>
                            </div>
                        )}
                    </li>
                </ul>
            )}
        </div>
    )
}

export default SearchGoogle