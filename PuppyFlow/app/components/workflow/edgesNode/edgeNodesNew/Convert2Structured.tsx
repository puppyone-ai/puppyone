import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import useJsonConstructUtils from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'

export type ModifyConfigNodeData = {
    subMenuType: string | null,
    content: string | null,
    looped: boolean | undefined,
    content_type: "list" | "dict" | null,
    extra_configs: {
        index?: number | undefined,
        key?: string | undefined,
        params?: {
            path: (string | number)[]
        },
        list_separator?: string[],
        dict_key?: string, 
        length_separator?: number
    },
    resultNode: string | null,
    execMode: string | null
}

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>

function Convert2Structured({ data, isConnectable, id }: ModifyConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)

    // 常量定义
    const INTO_DICT_TYPE = "wrap into dict"
    const INTO_LIST_TYPE = "wrap into list"
    const JSON_TYPE = "JSON"
    const BY_LEN_TYPE = "split by length" 
    const BY_CHAR_TYPE = "split by character"
    
    // 状态管理
    const [showSettings, setShowSettings] = useState(false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(id)?.data as ModifyConfigNodeData)?.resultNode ?? null
    )
    
    // 加载配置值
    const [execMode, setExecMode] = useState(
        (getNode(id)?.data as any)?.execMode || JSON_TYPE
    )
    const [wrapInto, setWrapInto] = useState(
        typeof (getNode(id)?.data?.extra_configs as any)?.dict_key === 'string' 
            ? (getNode(id)?.data?.extra_configs as any)?.dict_key 
            : ""
    )
    const [deliminator, setDeliminator] = useState(
        typeof (getNode(id)?.data?.extra_configs as any)?.list_separator === 'string' 
            ? (getNode(id)?.data?.extra_configs as any)?.list_separator 
            : `[",",";",".","\\n"]`
    )
    const [bylen, setBylen] = useState<number>(
        typeof (getNode(id)?.data?.extra_configs as any)?.length_separator === 'number' 
            ? (getNode(id)?.data?.extra_configs as any)?.length_separator 
            : 10
    )
    
    // 使用基础 edge node 逻辑，只传入最小必要参数
    const { 
        isLoading,
        handleDataSubmit 
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured'
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

    // 状态同步到 ReactFlow
    useEffect(() => {
        const node = getNode(id);
        if (node) {
            setNodes(prevNodes => prevNodes.map(n => {
                if (n.id === id) {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            // 保存 execMode 到 data 对象中
                            execMode: execMode,
                            extra_configs: {
                                ...(n.data?.extra_configs || {}),
                                list_separator: deliminator,
                                dict_key: wrapInto,
                                length_separator: bylen
                            }
                        }
                    };
                }
                return n;
            }));
        }
    }, [execMode, deliminator, bylen, wrapInto, id, setNodes, getNode]);

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
    
    // 执行函数
    const onDataSubmit = () => {
        handleDataSubmit();
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
        <>
            {/* Main button */}
            <button 
                onClick={onClickButton}
                className={`w-[80px] h-[48px] flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`}
            >
                Convert to Structured
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

            {/* Configuration Menu (integrated directly) */}
            {isMenuOpen && (
                <div className="absolute top-[8px] left-0 w-[80px]">
                    <ul ref={menuRef} className="absolute top-[58px] left-0 text-white w-[384px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg">
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
                                        Convert to Structured
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

                        {/* Mode selector menu */}
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Mode</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='flex gap-2 bg-[#252525] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <PuppyDropdown
                                    options={[INTO_DICT_TYPE, INTO_LIST_TYPE, JSON_TYPE, BY_LEN_TYPE, BY_CHAR_TYPE]}
                                    onSelect={(option: string) => {
                                        setExecMode(option)
                                    }}
                                    selectedValue={execMode}
                                    listWidth={"200px"}
                                />
                            </div>
                        </li>

                        {execMode === INTO_DICT_TYPE && (
                            <li className='flex flex-col gap-2'>
                                <div className='flex items-center gap-2'>
                                    <label className='text-[12px] font-medium text-[#6D7177]'>Key</label>
                                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                                </div>
                                <input
                                    value={wrapInto}
                                    onChange={(e) => setWrapInto(e.target.value)}
                                    type='string'
                                    className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                                    autoComplete='off'
                                    onMouseDownCapture={onFocus}
                                    onBlur={onBlur}
                                />
                            </li>
                        )}

                        {execMode === BY_CHAR_TYPE && (
                            <li className='flex flex-col gap-2'>
                                <div className='flex items-center gap-2'>
                                    <label className='text-[12px] font-medium text-[#6D7177]'>Deliminators</label>
                                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                                </div>
                                <input
                                    value={deliminator}
                                    onChange={(e) => setDeliminator(e.target.value)}
                                    type='string'
                                    className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                                    autoComplete='off'
                                    onMouseDownCapture={onFocus}
                                    onBlur={onBlur}
                                />
                            </li>
                        )}

                        {execMode === BY_LEN_TYPE && (
                            <li className='flex flex-col gap-2'>
                                <div className='flex items-center gap-2'>
                                    <label className='text-[12px] font-medium text-[#6D7177]'>Length</label>
                                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                                </div>
                                <input
                                    value={bylen}
                                    onChange={(e) => setBylen(parseInt(e.target.value))}
                                    type='number'
                                    className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                                    autoComplete='off'
                                    onMouseDownCapture={onFocus}
                                    onBlur={onBlur}
                                />
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </>
    )
}

export default Convert2Structured

