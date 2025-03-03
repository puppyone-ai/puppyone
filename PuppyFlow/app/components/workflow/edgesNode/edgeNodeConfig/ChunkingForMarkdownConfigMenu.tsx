'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import JSONConfigEditor from '../../../tableComponent/JSONConfigEditor'
import { ChunkingConfigNodeData } from '../edgeNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
type ChunkingForMarkdownConfigProps = {
    show: boolean,
    parentId: string,
}

export type ChunkingMarkdownEdgeJsonType = {
    // id: string,
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "advanced",
        sub_chunking_mode: "markdown",
        extra_configs: {
            tags: tagType
        },
        looped: boolean,
        outputs: { [key: string]: string }
    },
}

type ConstructedChunkingForMarkdownJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingMarkdownEdgeJsonType }
}

type tagType = [string, string][]
function ChunkingForMarkdownConfigMenu({show, parentId}: ChunkingForMarkdownConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    

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

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[10px] font-semibold text-[#000] leading-normal bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[4px] border-[#6D7177]'>{`{{${node.label}}}`}</span>
        ))
    }

    const constructJsonData = (): ConstructedChunkingForMarkdownJsonData | Error => {
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

        let edges: { [key: string]: ChunkingMarkdownEdgeJsonType } = {}

        const tagValue: tagType = getNode(parentId)?.data.content ? cleanJsonString(getNode(parentId)?.data.content as string) : []
        const edgejson: ChunkingMarkdownEdgeJsonType = {
            // id: parentId,
            type: "chunk",
            data: {  
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                chunking_mode: "advanced",
                sub_chunking_mode: "markdown",
                extra_configs: {
                    tags:tagValue
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

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[384px] rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[7px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="10" fill="none" viewBox="0 0 18 10">
                    <path fill="#CDCDCD" d="M2.974 8H1.572V.803H3.76l1.308 5.659 1.3-5.66H8.53V8h-1.4V3.132c0-.14.002-.335.005-.586a49.2 49.2 0 0 0 .005-.586L5.776 8h-1.46L2.964 1.96c0 .137.001.332.005.586.003.25.005.446.005.586V8Z"/>
                    <path stroke="#CDCDCD" strokeWidth="1.5" d="M13.5 1v6m-3-3 3 3 3-3"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal whitespace-nowrap'>
                for Markdown
                </div>
            </div>
            </div>
            <div className='flex flex-row gap-[8px] items-center justify-center'>
                <button className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
               {displaySourceNodeLabels()}
            </div>
        </li>
        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans w-full'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
                tags
            </div>
            <JSONConfigEditor preventParentDrag={onFocus} 
                      allowParentDrag={onBlur} 
                      placeholder='["h1", "heading 1"]'
                      parentId={parentId}
                      widthStyle={368} 
                      heightStyle={140} />
        </li>
    </ul>
  )
}

export default ChunkingForMarkdownConfigMenu