import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import React, { useState, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'

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

type ChunkingByCharacterProps = NodeProps<Node<ChunkingConfigNodeData>>

// 添加 commonDelimiters 常量定义（放在组件外部）
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

function ChunkingByCharacter({ data: { subMenuType }, isConnectable, id }: ChunkingByCharacterProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const newDelimiterRef = useRef<HTMLInputElement>(null)
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()

    // 使用 delimiters 状态
    const [delimiters, setDelimiters] = useState<string[]>(() => {
        // 尝试从不同的可能位置读取 delimiters 数据
        const nodeData = getNode(id)?.data;
        if (nodeData?.delimiters && Array.isArray(nodeData.delimiters)) {
            return nodeData.delimiters;
        }
        if (nodeData?.content) {
            try {
                const parsedContent = typeof nodeData.content === 'string' ?
                    JSON.parse(nodeData.content) : nodeData.content;
                if (Array.isArray(parsedContent)) {
                    return parsedContent;
                }
            } catch (e) {
                console.warn("Failed to parse delimiters:", e);
            }
        }
        return [",", ";", "\n"]; // 默认值
    });

    // 每当 delimiters 变化时，更新节点数据
    useEffect(() => {
        const node = getNode(id);
        if (node) {
            // 更新节点数据，将 delimiters 保存到 node.data 对象中
            setNodes(nodes => nodes.map(n => {
                if (n.id === id) {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            delimiters: delimiters, // 保存 delimiters 数组
                            content: JSON.stringify(delimiters) // 为了向后兼容也保存在 content 中
                        }
                    };
                }
                return n;
            }));
        }
    }, [delimiters, id, getNode, setNodes]);

    // 使用基础 edge node 逻辑，简化参数
    const {
        isLoading,
        handleDataSubmit
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured'
    });

    // 添加新的分隔符
    const addDelimiter = (value: string) => {
        if (value && !delimiters.includes(value)) {
            setDelimiters([...delimiters, value]);
        }
    };

    // 删除分隔符
    const removeDelimiter = (index: number) => {
        setDelimiters(delimiters.filter((_, i) => i !== index));
    };

    // 状态管理
    const [showDelimiterInput, setShowDelimiterInput] = useState(false)

    // 当显示输入框时，自动聚焦
    useEffect(() => {
        if (showDelimiterInput && newDelimiterRef.current) {
            newDelimiterRef.current.focus();
        }
    }, [showDelimiterInput]);

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

    // 处理自定义分隔符输入
    const handleCustomDelimiterInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.currentTarget.value) {
            addDelimiter(e.currentTarget.value);
            e.currentTarget.value = '';
        } else if (e.key === 'Escape') {
            setShowDelimiterInput(false);
        }
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

    const onFocus = () => {
        const curRef = menuRef.current;
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag");
        }
    };

    const onBlur = () => {
        const curRef = menuRef.current;
        if (curRef) {
            curRef.classList.remove("nodrag");
        }
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
                {/* Chunking By Character SVG icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M9 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Chunk</span>
                    <span>Char</span>
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
                    className="absolute top-[64px] text-white w-[448px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
                    style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}
                >
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none">
                                        <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z" stroke="#CDCDCD" strokeWidth="1.5" />
                                        <path d="M13 3v6h6" stroke="#CDCDCD" strokeWidth="1.5" />
                                        <path d="M9 14h6" stroke="#CDCDCD" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Chunk By Character
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
                        />
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[12px] font-semibold text-[#6D7177]'>Delimiters</label>
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
                </ul>
            )}
        </div>
    )
}

export default ChunkingByCharacter