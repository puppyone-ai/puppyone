'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import useJsonConstructUtils, { ProcessingData, NodeJsonType } from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import JsonConfigEditor from '../../../tableComponent/JSONConfigEditor'
import { ChunkingConfigNodeData } from '../edgeNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

type ChunkingByCharacterConfigProps = {
    show: boolean,
    parentId: string,
}

export type ChunkingByCharacterEdgeJsonType = {
    // id: string,
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "character",
        sub_chunking_mode: "character",
        extra_configs: {
            delimiters: string[]
        },
        looped: boolean,
        outputs: { [key: string]: string }
    },
}

type ConstructedChunkingByCharacterJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingByCharacterEdgeJsonType }
}

function ChunkingByCharacterConfigMenu({ show, parentId }: ChunkingByCharacterConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const newDelimiterRef = useRef<HTMLInputElement>(null)
    const { getNode, setNodes, setEdges } = useReactFlow()
    const { getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount, preventInactivateNode, allowInactivateNode} = useNodeContext()
    const { clearAll } = useNodesPerFlowContext()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData).resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
    const [showDelimiterInput, setShowDelimiterInput] = useState(false)

    // 分隔符状态管理
    const [delimiters, setDelimiters] = useState<string[]>(() => {
        try {
            const content = getNode(parentId)?.data.content as string;
            return content ? JSON.parse(content) : [",", ";", "\n"];
        } catch (e) {
            return [",", ";", "\n"];
        }
    });

    // 常用分隔符预设
    const commonDelimiters = [
        { label: "Comma", value: "," },
        { label: "Semicolon", value: ";" },
        { label: "New Line", value: "\n" },
        { label: "Tab", value: "\t" },
        { label: "Space", value: " " },
        { label: "Period", value: "." },
        { label: "Colon", value: ":" },
        { label: "Dash", value: "-" },
    ];

    // 特殊字符的显示映射
    const delimiterDisplay = (delimiter: string) => {
        switch(delimiter) {
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
                            <path d="M6 5L3 8L6 11" stroke="currentColor" strokeWidth="0.583333"/>
                            <path d="M3 8H11V3" stroke="currentColor" strokeWidth="0.583333"/>
                        </svg>
                        <span className="text-[11px]">Enter</span>
                    </span>
                );
            case "\t": return "Tab";
            case " ": return "Space";
            default: return delimiter;
        }
    };

    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])

    // 更新分隔符到节点数据
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, content: JSON.stringify(delimiters) } }
            }
            return node
        }));
    }, [delimiters, parentId, setNodes]);

    // 当显示输入框时，自动聚焦
    useEffect(() => {
        if (showDelimiterInput && newDelimiterRef.current) {
            newDelimiterRef.current.focus();
        }
    }, [showDelimiterInput]);

    useEffect(() => {
        if (!resultNode) return
        if (isComplete) return

        const addNewNodeEdgeIntoFlow = async () => {
            const parentEdgeNode = getNode(parentId)
            if (!parentEdgeNode) return
            const location = {
                // 120 - 24 = 96 is half of the height of the targetNode - chunk node
                x: parentEdgeNode.position.x + 160,
                y: parentEdgeNode.position.y - 96,
            }

            const newNode = {
                id: resultNode,
                position: location,
                data: {
                    content: "",
                    label: resultNode,
                    isLoading: true,
                    locked: false,
                    isInput: false,
                    isOutput: false,
                    editable: false,
                },
                type: 'structured',
            }

            const newEdge = {
                id: `connection-${Date.now()}`,
                source: parentId,
                target: resultNode,
                type: "floating",
                data: {
                    connectionType: "CTT",
                },
                markerEnd: markerEnd,
            }

            await Promise.all([
                new Promise(resolve => {
                    setNodes(prevNodes => {
                        resolve(null);
                        return [...prevNodes, newNode];
                    })
                }),
                new Promise(resolve => {
                    setEdges(prevEdges => {
                        resolve(null);
                        return [...prevEdges, newEdge];
                    })
                }),
            ]);

            onResultNodeChange(resultNode)
            setIsAddFlow(true)
            // 不可以和 setEdge, setNodes 发生冲突一定要一先一后
            // clearActivation()
        }

        const sendData = async () => {
            try {
                const jsonData = constructJsonData()
                console.log(jsonData)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(jsonData)
                })

                if (!response.ok) {
                    reportError(resultNode, `HTTP Error: ${response.status}`)
                }

                console.log(response)
                const result = await response.json();  // 解析响应的 JSON 数据
                console.log('Success:', result);
                console.log(resultNode, "your result node")
                await streamResult(result.task_id, resultNode);

            } catch (error) {
                console.warn(error)
                window.alert(error)
            } finally {
                resetLoadingUI(resultNode)
                setIsComplete(true)
            }
        }

        if (!isAddFlow && !isComplete) {
            addNewNodeEdgeIntoFlow()
        }
        else if (isAddFlow && !isComplete) {
            sendData()
        }
    }, [resultNode, isAddFlow, isComplete])

    const onFocus: () => void = () => {
        const curRef = menuRef.current
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag")
        }
    }

    const onBlur: () => void = () => {
        const curRef = menuRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
        }
    }

    // 复制变量到剪贴板
    const copyToClipboard = (label: string) => {
        navigator.clipboard.writeText(`{{${label}}}`).then(() => {
            setCopiedLabel(label);
            setTimeout(() => setCopiedLabel(null), 2000);
        });
    };

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => (
            <button
                key={`${node.id}-${parentId}`}
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center justify-center px-3 h-[28px] rounded-[6px] 
                         border-[1px] text-[12px] font-medium transition-all duration-200
                         ${copiedLabel === node.label
                        ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]'
                        : 'bg-[#252525] border-[#3B9BFF]/30 text-[#3B9BFF]/90 hover:bg-[#3B9BFF]/5'}`}
            >
                {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
            </button>
        ))
    }

    // 添加新的分隔符
    const addDelimiter = (value: string) => {
        if (value && !delimiters.includes(value)) {
            setDelimiters([...delimiters, value]);
        }
        setShowDelimiterInput(false);
    };

    // 删除分隔符
    const removeDelimiter = (index: number) => {
        setDelimiters(delimiters.filter((_, i) => i !== index));
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

    const constructJsonData = (): ConstructedChunkingByCharacterJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        let resultNodeLabel
        if (resultNode && getNode(resultNode)?.data?.label !== undefined) {
            resultNodeLabel = getNode(resultNode)?.data?.label as string
        }
        else {
            resultNodeLabel = resultNode as string
        }
        let blocks: { [key: string]: NodeJsonType } = {
            [resultNode as string]: {
                label: resultNodeLabel as string,
                type: "structured",
                data: { content: "" }
            }
        }

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: ChunkingByCharacterEdgeJsonType } = {}

        const edgejson: ChunkingByCharacterEdgeJsonType = {
            // id: parentId,
            type: "chunk",
            data: {
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label]))),
                chunking_mode: "character",
                sub_chunking_mode: "character",
                extra_configs: { delimiters: delimiters },
                looped: isLoop,
                outputs: { [resultNode as string]: resultNodeLabel as string }
            },
        }

        edges[parentId] = edgejson
        console.log(blocks, edges)

        return {
            blocks,
            edges
        }
    }

    const onDataSubmit = async () => {
        // click 第一步： clearActivation
        await new Promise(resolve => {
            clearAll()
            resolve(null)
        });

        // click 第二步： 如果 resultNode 不存在，则创建一个新的 resultNode
        if (!resultNode || !getNode(resultNode)) {
            const newResultNodeId = nanoid(6)
            setResultNode(newResultNodeId)
            setIsAddFlow(false)
        }
        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode) {
                    return { ...node, data: { ...node.data, content: "", isLoading: true } }
                }
                return node
            }))
        }
        setIsComplete(false)
    };

    const onLoopChange = (newLoop: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, looped: newLoop } }
            }
            return node
        }))
    }

    const onResultNodeChange = (newResultNode: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newResultNode } }
            }
            return node
        }))
    }

    return (
        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[16px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box ${show ? "" : "hidden"} shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0.5" y="0.5" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5" />
                            <rect x="9" y="0.5" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5" />
                            <rect x="0.5" y="9" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5" />
                            <rect x="9" y="9" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5" />
                            <path d="M5 2.75H9" stroke="#CDCDCD" strokeWidth="1.5" />
                            <path d="M2.75 5V9" stroke="#CDCDCD" strokeWidth="1.5" />
                            <path d="M11.25 5V9" stroke="#CDCDCD" strokeWidth="1.5" />
                            <path d="M5 11.25H9" stroke="#CDCDCD" strokeWidth="1.5" />
                        </svg>
                    </div>
                    <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                        Chunking by Character
                    </div>
                </div>
                <div className='flex flex-row gap-[8px] items-center justify-center'>
                    <div className='flex flex-col items-center justify-center'>
                        <button className='w-[23px] h-[13px] rounded-[8px] border-[1px] border-[#6D7177] relative' onClick={() => {
                            setIsLoop(!isLoop)
                        }}>
                            <div className={`w-[8px] h-[8px] rounded-[50%] absolute top-[1.5px] transition-all ease-in-out
                                ${isLoop ? "right-[2px] bg-[#39BC66]" : "left-[2px] bg-[#6D7177]"}`}>
                            </div>
                        </button>
                        <div className={`text-[6px] font-plus-jakarta-sans font-[700] leading-normal transition-all duration-300 ease-in-out
                            ${isLoop ? "text-[#39BC66]" : "text-[#6D7177]"}`}>
                            Loop
                        </div>
                    </div>
                    <button className='w-[57px] h-[24px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                        onClick={onDataSubmit}>
                        <span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                <path d="M8 5L0 10V0L8 5Z" fill="black" />
                            </svg>
                        </span>
                        <span>
                            Run
                        </span>
                    </button>
                </div>
            </li>

            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Input Variables</label>
                    <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
                </div>
                <div className='flex gap-2 p-2 bg-[#1E1E1E] rounded-[8px]
                              border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2'>
                        {displaySourceNodeLabels()}
                    </div>
                </div>
            </li>

            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Delimiters</label>
                    <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
                </div>

                <div className='bg-[#1E1E1E] rounded-[8px] p-2 border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2 items-center'>
                        {delimiters.map((delimiter, index) => (
                            <div key={index}
                                className='flex items-center bg-[#252525] rounded-md 
                                          border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 
                                          transition-colors group'
                            >
                                <span className='text-[12px] text-[#FF9B4D] px-2 py-1'>
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
                            <div className='h-[28px] bg-[#252525] rounded-md 
                                         border border-[#FF9B4D]/30 
                                         flex items-center'
                            >
                                <input
                                    ref={newDelimiterRef}
                                    type="text"
                                    placeholder="Type..."
                                    className='w-[80px] h-full bg-transparent border-none outline-none px-2
                                             text-[12px] text-[#CDCDCD]'
                                    onKeyDown={handleCustomDelimiterInput}
                                    onBlur={() => setShowDelimiterInput(false)}
                                    onFocus={onFocus}
                                />
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowDelimiterInput(true)}
                                className='w-[28px] h-[28px] flex items-center justify-center rounded-md
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
                    <div className='text-[11px] text-[#6D7177] mb-2'>Common delimiters:</div>
                    <div className='flex flex-wrap gap-2'>
                        {commonDelimiters.map((delimiter) => (
                            <button
                                key={delimiter.value}
                                onClick={() => addDelimiter(delimiter.value)}
                                className={`px-2 py-1 rounded-md text-[11px] transition-colors
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
    )
}

export default ChunkingByCharacterConfigMenu