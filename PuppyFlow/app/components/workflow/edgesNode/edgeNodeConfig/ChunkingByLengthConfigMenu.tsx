'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ChunkingConfigNodeData } from '../edgeNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'

type ChunkingByLengthConfigProps = {
    show: boolean,
    parentId: string,
}

export type ChunkingByLengthEdgeJsonType = {
    // id: string,
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "length",
        sub_chunking_mode: sub_chunking_mode_names,
        extra_configs: {
            chunk_size: number,
            overlap: number,
            handle_half_word: boolean
        }, 
        // looped: boolean,
        outputs: { [key: string]: string }
    },
}

type ConstructedChunkingByLengthJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingByLengthEdgeJsonType }
}

type sub_chunking_mode_names = "size" | "tokenizer"
function ChunkingByLengthConfigMenu({show, parentId}: ChunkingByLengthConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getEdges} = useReactFlow()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, transformBlocksFromSourceNodeIdWithLabelGroup, streamResult, reportError, resetLoadingUI} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const [sub_chunk_mode, setSubChunkMode] = useState<sub_chunking_mode_names>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.sub_chunking_mode ?? "size"
    )
    const [chunk_size, setChunk_size] = useState<number | undefined>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.chunk_size ?? 200
    )
    const [overlap, setOverlap] = useState<number | undefined>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.overlap ?? 20
    )
    const [handle_half_word, setHandle_half_word] = useState(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.handle_half_word ?? false
    )
    const subChunkingModeRef = useRef<HTMLSelectElement>(null)
    const chunk_sizeRef = useRef<HTMLInputElement>(null)
    const overlapRef = useRef<HTMLInputElement>(null)
    const handle_half_wordRef = useRef<HTMLSelectElement>(null)
    // const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)

    // 添加复制功能状态
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    // 添加展开/收起状态
    const [showSettings, setShowSettings] = useState(false);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    useEffect(() => {
        onSubChunkModeChange(sub_chunk_mode)
    }, [sub_chunk_mode])

    useEffect(() => {
        onChunkSizeChange(chunk_size)
    }, [chunk_size])


    useEffect(() => {
        onOverlapChange(overlap)
    }, [overlap])

    useEffect(() => {
        onHandleHalfWordChange(handle_half_word)
    }, [handle_half_word])

    // useEffect(() => {
    //     onLoopChange(isLoop)
    // }, [isLoop])

    useEffect( () => {
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

        const sendData = async  () => {
            try {
                const jsonData = constructJsonData()
                console.log(jsonData)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method:'POST',
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
                }
                finally {
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

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <button 
                key={`${node.id}-${parentId}`} 
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center justify-center px-[8px] h-[20px] rounded-[4px] 
                         border-[1px] text-[10px] font-medium transition-all duration-200
                         ${copiedLabel === node.label 
                           ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]' 
                           : 'bg-[#252525] border-[#3B9BFF]/30 text-[#3B9BFF]/90 hover:bg-[#3B9BFF]/5'}`}
            >
                {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
            </button>
        ))
    }

    const constructJsonData = (): ConstructedChunkingByLengthJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        let resultNodeLabel
        if (resultNode && getNode(resultNode)?.data?.label !== undefined) {
            resultNodeLabel = getNode(resultNode)?.data?.label as string
        }
        else {
            resultNodeLabel = resultNode as string
        }
        let blocks: {[key: string]: NodeJsonType} = {
            [resultNode as string]: {
                label: resultNodeLabel as string,
                type: "structured",
                data:{content: ""}
            }
        }

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: ChunkingByLengthEdgeJsonType } = {}

        const edgejson: ChunkingByLengthEdgeJsonType = {
            // id: parentId,
            type: "chunk",
            data: {  
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                chunking_mode: "length",
                sub_chunking_mode: sub_chunk_mode,
                extra_configs: {
                    chunk_size: chunk_size ?? 200,
                    overlap: overlap ?? 20,
                    handle_half_word: handle_half_word,
                },
                // looped: isLoop,
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
        if (!resultNode || !getNode(resultNode)){

            const newResultNodeId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setResultNode(newResultNodeId)
            
            // setIsAddContext(false)
            setIsAddFlow(false)
        }
        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode){
                    return {...node, data: {...node.data, content: "", isLoading: true}}
                }
                return node
            }))
        }
        setIsComplete(false)
        };


        const onSubChunkModeChange = (newSubChunkMode: sub_chunking_mode_names) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, sub_chunking_mode: newSubChunkMode}}
                }
                return node
            }))
        }

        

        const onChunkSizeChange = (newChunkSize: number | undefined) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, extra_configs: {...((node.data as ChunkingConfigNodeData).extra_configs), chunk_size: newChunkSize}}}
                }
                return node
            }))
        }

        const onOverlapChange = (newOverlap: number | undefined) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, extra_configs: {...((node.data as ChunkingConfigNodeData).extra_configs), overlap: newOverlap}}}
                }
                return node
            }))
        }

        const onHandleHalfWordChange = (newHandleHalfWord: boolean) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, extra_configs: {...((node.data as ChunkingConfigNodeData).extra_configs), handle_half_word: newHandleHalfWord}}}
                }
                return node
            }))
        }

        const onLoopChange = (newLoop: boolean) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, looped: newLoop}}
                }
                return node
            }))
        }

        const onResultNodeChange = (newResultNode: string) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, resultNode: newResultNode}}
                }
                return node
            }))
        }

    
  return (
    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`}>
        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" y="0.5" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <rect x="9" y="0.5" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <rect x="0.5" y="9" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <rect x="9" y="9" width="4.5" height="4.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M5 2.75H9" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M2.75 5V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M11.25 5V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M5 11.25H9" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                Chunking
                </div>
                </div>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" fill="none" viewBox="0 0 16 10">
                        <path stroke="#CDCDCD" d="m10 3 2 2-2 2M6 3 4 5l2 2M4 5h7.5"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M1 10V0m14 10V0"/>
                        </svg>
                    </div>
                    <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    By length
                    </div>
                </div>
            </div>
            <div className='flex flex-row gap-[8px] items-center justify-center'>
                
                <button className='w-[57px] h-[24px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                onClick={onDataSubmit}>
                <span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                    <path d="M8 5L0 10V0L8 5Z" fill="black"/>
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
            <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <div className='flex flex-wrap gap-2'>
                    {displaySourceNodeLabels()}
                </div>
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Mode</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
            <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <PuppyDropdown
                    options={["size"]}
                    selectedValue={sub_chunk_mode}
                    onSelect={(value: string) => {
                        setSubChunkMode(value as sub_chunking_mode_names);
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
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                    <div className='w-2 h-2 rounded-full bg-[#6D7177]'></div>
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
                            ref={chunk_sizeRef}
                            value={chunk_size}
                            onChange={() => {
                                if (chunk_sizeRef.current) {
                                    setChunk_size(chunk_sizeRef.current.value === "" ? undefined : Number(chunk_sizeRef.current.value))
                                }
                            }}
                            type='number'
                            className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD]
                                     hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                            onMouseDownCapture={onFocus}
                            onBlur={onBlur}
                        />
                    </div>
                    <div className='flex flex-col gap-1'>
                        <label className='text-[12px] text-[#6D7177]'>Overlap</label>
                        <input 
                            ref={overlapRef}
                            value={overlap}
                            onChange={() => {
                                if (overlapRef.current) {
                                    setOverlap(overlapRef.current.value === "" ? undefined : Number(overlapRef.current.value))
                                }
                            }}
                            type='number'
                            className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD]
                                     hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                            onMouseDownCapture={onFocus}
                            onBlur={onBlur}
                        />
                    </div>
                    <div className='flex flex-col gap-1'>
                        <label className='text-[12px] text-[#6D7177]'>Handle Half Word</label>
                        <select 
                            ref={handle_half_wordRef}
                            value={handle_half_word === true ? "True" : "False"}
                            onChange={() => {
                                if (handle_half_wordRef.current) {
                                    setHandle_half_word(handle_half_wordRef.current.value === "True" ? true : false)
                                }
                            }}
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
  )
}

export default ChunkingByLengthConfigMenu