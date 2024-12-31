'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../tableComponent/JSONForm'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import { ChunkingConfigNodeData } from '../../workflow/edges/configNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
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
        looped: boolean,
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
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI} = useJsonConstructUtils()
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
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)


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

    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])

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
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
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

        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id)
            if (!nodeInfo) continue
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any) : nodeInfo.data.content as string
            if (nodeContent === "error") return new Error("JSON Parsing Error, please check JSON format")
            const nodejson: NodeJsonType = {
                // id: nodeInfo.id,
                label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                    // ...(nodeInfo.type === "none" ? {subType: nodeInfo.data?.subType as string ?? "text"}: {})
                }
            }
            blocks[nodeInfo.id] = nodejson
        }

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

    <ul ref={menuRef} className={`absolute top-[58px] left-[0px] text-white rounded-[9px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme pt-[7px] pb-[6px] px-[6px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
        <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                <path stroke="#CDCDCD" strokeWidth="1.5" d="M3.5 7c6.417 0 7-4.667 7-4.667M3.5 7c6.417 0 7 4.667 7 4.667"/>
                <path fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5" d="M.75 3.75h3.5v6.5H.75zm9-3h3.5v3.5h-3.5zm0 9h3.5v3.5h-3.5z"/>
                </svg>

                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Chunking
                </div>
                </div>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" fill="none" viewBox="0 0 16 10">
                        <path stroke="#CDCDCD" d="m10 3 2 2-2 2M6 3 4 5l2 2M4 5h7.5"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M1 10V0m14 10V0"/>
                        </svg>
                    </div>
                    <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                    By length
                    </div>
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
                <button className='w-[57px] h-[24px] rounded-[6px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[280px]'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>
        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             mode
            </div>
            <select ref={subChunkingModeRef} value={sub_chunk_mode} onChange={() => {
                if (subChunkingModeRef.current)
                    { setSubChunkMode(subChunkingModeRef.current.value as sub_chunking_mode_names)}
            }} id='mode' className='flex flex-row items-center justify-start py-[5px] px-[16px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value={"size"}>
                    by size
                </option>
            </select>
            
        </li>
        <li>
            <ul className='flex flex-col border-[#6D7177] rounded-[4px] w-[280px]'>
                <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-t-[4px] w-[280px] h-[36px]'>
                <div className='text-[#6D7177] w-[88px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                chunk_size
                </div>
                <input ref={chunk_sizeRef} value={chunk_size} onChange={() => {
                    if (chunk_sizeRef.current) {
                        setChunk_size(chunk_sizeRef.current.value === "" ? undefined : Number(chunk_sizeRef.current.value))
                    }
                }} id="chunk_size" type='number' className='px-[14px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
                </li>
                <li className='flex items-center justify-start font-plus-jakarta-sans border-x-[1px] border-b-[1px] bg-black border-[#6D7177] rounded-b-[4px] w-[280px] h-[36px]'>
                <div className='text-[#6D7177] w-[122px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                overlap
                </div>
                <input ref={overlapRef} value={overlap} onChange={() => {
                    if (overlapRef.current) {
                        setOverlap(overlapRef.current.value === "" ? undefined : Number(overlapRef.current.value))
                    }
                }} id="overlap" type='number' className='px-[14px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
                
                </li>
            </ul>
        </li>
        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[140px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             handle_half_word
            </div>
            <select ref={handle_half_wordRef} id='handle_half_word' value={handle_half_word === true ? "True" : "False"} onChange={() => {
                if (handle_half_wordRef.current) {
                    setHandle_half_word(handle_half_wordRef.current.value === "True" ? true : false)
                }
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal font-plus-jakarta-sans text-main-grey border-none w-full h-full'>
                <option value={"True"}>
                    True
                </option>
                <option value={"False"}>
                    False
                </option>
            </select>
            
        </li>
     

        
    </ul>
  )
}

export default ChunkingByLengthConfigMenu