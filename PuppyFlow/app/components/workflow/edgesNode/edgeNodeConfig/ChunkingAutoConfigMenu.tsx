'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ChunkingConfigNodeData } from '../edgeNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
type ChunkingAutoConfigProps = {
    show: boolean,
    parentId: string,
}

export type ChunkingAutoEdgeJsonType = {
    // id: string,
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "auto",
        extra_configs: { [key: string]: string },
        // looped: boolean,
        outputs: { [key: string]: string }
    },
    
}

type ConstructedChunkingAutoJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingAutoEdgeJsonType }
}

function ChunkingAutoConfigMenu({show, parentId}: ChunkingAutoConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    // const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

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
                // 120 -  40 = 80 is half of the width of the target node - chunk node
                // x: parentEdgeNode.position.x - 80,
                // y: parentEdgeNode.position.y + 160
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
                // type: "CTT",
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
   
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

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

    const constructJsonData = (): ConstructedChunkingAutoJsonData | Error => {
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
                data:{content: ""}
            }
        }
        
        // let blocks: NodeJsonType[] = [{
        //     // id: resultNode as string,
        //     label: resultNodeLabel as string,
        //     type: "structured",
        //     data:{content: ""}
        // }]

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        // let edges:ChunkingAutoEdgeJsonType[] = []
        let edges: { [key: string]: ChunkingAutoEdgeJsonType } = {}

        const edgejson: ChunkingAutoEdgeJsonType = {
            // id: parentId,
            type: "chunk",
            data: {  
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                chunking_mode: "auto",
                extra_configs: {},
                // looped: isLoop,
                outputs: { [resultNode as string]: resultNodeLabel as string }
            }
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
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" fill="none" viewBox="0 0 16 15">
                                <path fill="#CDCDCD" d="M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Zm3.938 1.582V9.238h-.68v-.597h1.47v5.513h-1.47v-.612h.68Z"/>
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            Auto
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
                        <span>Run</span>
                    </button>
                </div>
            </li>
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[12px] font-semibold text-[#6D7177]'>Input</label>
                    <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
                </div>
                <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2'>
                        {displaySourceNodeLabels()}
                    </div>
                </div>
            </li>
        </ul>
    )
}

export default ChunkingAutoConfigMenu
