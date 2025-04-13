import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import React, { useState, useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import useJsonConstructUtils from '../../../hooks/useJsonConstructUtils'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import InputOutputDisplay from './components/InputOutputDisplay'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'
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

type ChunkingByLengthProps = NodeProps<Node<ChunkingConfigNodeData>>

function ChunkingByLength({ data: { subMenuType }, isConnectable, id }: ChunkingByLengthProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode } = useReactFlow()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()

    // 状态管理
    const [subChunkMode, setSubChunkMode] = useState<"size" | "tokenizer">(
        (getNode(id)?.data as ChunkingConfigNodeData)?.sub_chunking_mode ?? "size"
    );
    const [chunkSize, setChunkSize] = useState<number | undefined>(
        (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs?.chunk_size ?? 200
    );
    const [overlap, setOverlap] = useState<number | undefined>(
        (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs?.overlap ?? 20
    );
    const [handleHalfWord, setHandleHalfWord] = useState(
        (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs?.handle_half_word ?? false
    );

    // 使用基础 edge node 逻辑
    const { 
        isLoading,
        handleDataSubmit 
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured'
    });

    // 添加展开/收起状态
    const [showSettings, setShowSettings] = useState(false);

    // 更新节点数据
    useEffect(() => {
        const node = getNode(id);
        if (node) {
            const nodeData = node.data as ChunkingConfigNodeData;
            const newData = {
                ...nodeData,
                sub_chunking_mode: subChunkMode,
                extra_configs: {
                    ...nodeData.extra_configs,
                    chunk_size: chunkSize,
                    overlap: overlap,
                    handle_half_word: handleHalfWord
                }
            };
            node.data = newData;
        }
    }, [subChunkMode, chunkSize, overlap, handleHalfWord]);

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
        <>
            {/* Main button */}
            <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`w-[80px] h-[48px] flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] gap-[8px]`}
            >
                Chunking
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
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" fill="none" viewBox="0 0 16 10">
                                            <path stroke="#CDCDCD" d="m10 3 2 2-2 2M6 3 4 5l2 2M4 5h7.5" />
                                            <path stroke="#CDCDCD" strokeWidth="1.5" d="M1 10V0m14 10V0" />
                            </svg>
                        </div>
                                    <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                                        Chunking By length
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
            
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[12px] font-semibold text-[#6D7177]'>Mode</label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <PuppyDropdown
                        options={["size"]}
                                    selectedValue={subChunkMode}
                        onSelect={(value: string) => {
                                        setSubChunkMode(value as "size" | "tokenizer");
                        }}
                        buttonHeight="32px"
                        buttonBgColor="transparent"
                        menuBgColor="#1A1A1A"
                        listWidth="100%"
                        containerClassnames="w-full"
                        mapValueTodisplay={(v: string) => v === "size" ? "by size" : v}
                    />
                </div>
            </li>

            <li className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[12px] font-semibold text-[#6D7177]'>Settings</label>
                        <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
                    </div>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className='text-[12px] text-[#6D7177] hover:text-[#39BC66] transition-colors flex items-center gap-1'
                    >
                        {showSettings ? 'Hide' : 'Show'}
                        <svg
                            className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>

                {showSettings && (
                    <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                        <div className='flex flex-col gap-1'>
                            <label className='text-[12px] text-[#6D7177]'>Chunk Size</label>
                            <input
                                            value={chunkSize}
                                            onChange={(e) => setChunkSize(e.target.value === "" ? undefined : Number(e.target.value))}
                                type='number'
                                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD]
                                     hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                            />
                        </div>
                        <div className='flex flex-col gap-1'>
                            <label className='text-[12px] text-[#6D7177]'>Overlap</label>
                            <input
                                value={overlap}
                                            onChange={(e) => setOverlap(e.target.value === "" ? undefined : Number(e.target.value))}
                                type='number'
                                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD]
                                     hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                            />
                        </div>
                        <div className='flex flex-col gap-1'>
                            <label className='text-[12px] text-[#6D7177]'>Handle Half Word</label>
                            <select
                                            value={handleHalfWord ? "True" : "False"}
                                            onChange={(e) => setHandleHalfWord(e.target.value === "True")}
                                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD] appearance-none cursor-pointer 
                                     hover:border-[#6D7177]/50 transition-colors'
                            >
                                <option value="True">True</option>
                                <option value="False">False</option>
                            </select>
                        </div>
                    </div>
                )}
            </li>
        </ul>
                </div>
            )}
        </>
    )
}

export default ChunkingByLength