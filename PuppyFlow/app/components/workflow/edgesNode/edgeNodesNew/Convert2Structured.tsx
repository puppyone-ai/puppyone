import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'

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
    execMode: string | null
}

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>

function Convert2Structured({ data, isConnectable, id }: ModifyConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const [showDelimiterInput, setShowDelimiterInput] = useState(false)
    const newDelimiterRef = useRef<HTMLInputElement>(null)

    // 常量定义
    const INTO_DICT_TYPE = "wrap into dict"
    const INTO_LIST_TYPE = "wrap into list"
    const JSON_TYPE = "JSON"
    const BY_LEN_TYPE = "split by length"
    const BY_CHAR_TYPE = "split by character"

    // 添加 commonDelimiters 常量定义
    const commonDelimiters = [
        { label: "Comma (,)", value: "," },
        { label: "Semicolon (;)", value: ";" },
        { label: "Enter (\\n)", value: "\n" },
        { label: "Tab (\\t)", value: "\t" },
        { label: "Space", value: " " },
        { label: "Period (.)", value: "." },
        { label: "Pipe (|)", value: "|" },
        { label: "Dash (-)", value: "-" }
    ];

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

    const [delimiters, setDelimiters] = useState<string[]>(() => {
        try {
            const parsedDeliminator = JSON.parse(deliminator);
            return Array.isArray(parsedDeliminator) ? parsedDeliminator : [",", ";", ".", "\n"];
        } catch (e) {
            return [",", ";", ".", "\n"];
        }
    });

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

    // 当显示输入框时，自动聚焦
    useEffect(() => {
        if (showDelimiterInput && newDelimiterRef.current) {
            newDelimiterRef.current.focus();
        }
    }, [showDelimiterInput]);

    // 处理自定义分隔符输入
    const handleCustomDelimiterInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.currentTarget.value) {
            addDelimiter(e.currentTarget.value);
            e.currentTarget.value = '';
            setShowDelimiterInput(false);
        } else if (e.key === 'Escape') {
            setShowDelimiterInput(false);
        }
    };

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

    // 添加新的分隔符
    const addDelimiter = (value: string) => {
        if (value && !delimiters.includes(value)) {
            const newDelimiters = [...delimiters, value];
            setDelimiters(newDelimiters);
            setDeliminator(JSON.stringify(newDelimiters));
        }
    };

    // 删除分隔符
    const removeDelimiter = (index: number) => {
        const newDelimiters = delimiters.filter((_, i) => i !== index);
        setDelimiters(newDelimiters);
        setDeliminator(JSON.stringify(newDelimiters));
    };

    // 特殊字符的显示映射
    const delimiterDisplay = (delimiter: string) => {
        switch (delimiter) {
            case "\n":
                return (
                    <span className="flex items-center gap-1">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path d="M6 5L3 8L6 11" stroke="currentColor" strokeWidth="0.583333" />
                            <path d="M3 8H11V3" stroke="currentColor" strokeWidth="0.583333" />
                        </svg>
                        <span className="text-[10px]">Enter</span>
                    </span>
                );
            case "\t": return "Tab";
            case " ": return "Space";
            default: return delimiter;
        }
    };

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

            {/* Main button */}
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
                {/* Convert to Structured SVG icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M12 2L2 12" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2L8 2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2L12 6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 12L6 12" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 12L2 8" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Convert</span>
                    <span>Struct</span>
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

            {/* Configuration Menu (integrated directly) */}
            {isMenuOpen && (
                <ul 
                    ref={menuRef} 
                    className="absolute top-[64px] text-white w-[384px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg"
                    style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}
                >
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
                                <label className='text-[12px] font-medium text-[#6D7177]'>Delimiters</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='bg-[#1E1E1E] rounded-[8px] p-[5px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <div className='flex flex-wrap gap-2 items-center'>
                                    {delimiters.map((delimiter, index) => (
                                        <div key={index}
                                            className='flex items-center bg-[#252525] rounded-md 
                                                        border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 
                                                        transition-colors group'
                                        >
                                            <span className='text-[10px] text-[#FF9B4D] px-2 py-1'>
                                                {delimiterDisplay(delimiter)}
                                            </span>
                                            <button
                                                onClick={() => removeDelimiter(index)}
                                                className='text-[#6D7177] hover:text-[#ff6b6b] transition-colors 
                                                            px-1 py-1 opacity-0 group-hover:opacity-100'
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                                </svg>
                                            </button>
                                        </div>
                                    ))}

                                    {showDelimiterInput ? (
                                        <div className='h-[24px] bg-[#252525] rounded-md 
                                                        border border-[#FF9B4D]/30 
                                                        flex items-center'
                                        >
                                            <input
                                                ref={newDelimiterRef}
                                                type="text"
                                                placeholder="Type..."
                                                className='w-[80px] h-full bg-transparent border-none outline-none px-2
                                                            text-[10px] text-[#CDCDCD]'
                                                onKeyDown={handleCustomDelimiterInput}
                                                onBlur={() => setShowDelimiterInput(false)}
                                                onFocus={onFocus}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowDelimiterInput(true)}
                                            className='w-[24px] h-[24px] flex items-center justify-center rounded-md
                                                        bg-[#252525] border border-[#6D7177]/30 
                                                        text-[#6D7177] 
                                                        hover:border-[#6D7177]/50 hover:bg-[#252525]/80 
                                                        transition-colors'
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className='mt-1'>
                                <div className='text-[10px] text-[#6D7177] mb-2'>Common delimiters:</div>
                                <div className='flex flex-wrap gap-2'>
                                    {commonDelimiters.map((delimiter) => (
                                        <button
                                            key={delimiter.value}
                                            onClick={() => addDelimiter(delimiter.value)}
                                            className={`px-2 py-1 rounded-md text-[10px] transition-colors
                                                        ${delimiters.includes(delimiter.value)
                                                    ? 'bg-[#252525] text-[#CDCDCD] border border-[#6D7177]/50'
                                                    : 'bg-[#1E1E1E] text-[#6D7177] border border-[#6D7177]/30 hover:bg-[#252525] hover:text-[#CDCDCD]'}`}
                                        >
                                            {delimiter.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
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
            )}
        </div>
    )
}

export default Convert2Structured

