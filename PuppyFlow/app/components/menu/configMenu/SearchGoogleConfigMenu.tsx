'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../tableComponent/JSONForm'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {faGoogle} from '@fortawesome/free-brands-svg-icons'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import { SearchConfigNodeData } from '../../workflow/edges/configNodes/SearchConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
type SearchGoogleConfigProps = {
    show: boolean,
    parentId: string,
}

export type SearchGoogleEdgeJsonType = {
    // id: string,
    type: "search",
    data: {
            search_type: "web",
            sub_search_type: "google",
            top_k: number,
            inputs: { [key: string]: string },
            query_id: {[key: string]: string},
            extra_configs: {},
            looped: boolean,
            outputs: { [key: string]: string }
        },
}

type ConstructedSearchGoogleJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchGoogleEdgeJsonType }
}

function SearchGoogleConfigMenu({show, parentId}: SearchGoogleConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [top_k, setTop_k] = useState<number | undefined>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.top_k ?? 5
    )
    const topkRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        onTopKChange(top_k)
    }, [top_k])
  
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
        const sourceNodes = getSourceNodeIdWithLabel(parentId)
        return sourceNodes.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
        ))
    }

    const constructJsonData = (): ConstructedSearchGoogleJsonData | Error => {
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
    
        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id)
            if (!nodeInfo) continue
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any) : nodeInfo.data.content as string
            if (nodeContent === "error") return new Error("JSON Parsing Error, please check JSON format")
            const nodejson: NodeJsonType = {
                // id: nodeInfo.id,
                label: nodeInfo.data.label as string | undefined ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                    // ...(nodeInfo.type === "none" ? {subType: nodeInfo.data?.subType as string ?? "text"}: {})
                }
            }
            blocks[nodeInfo.id] = nodejson
        }

        let edges: { [key: string]: SearchGoogleEdgeJsonType } = {}

        const edgejson: SearchGoogleEdgeJsonType = {
            // id: parentId,
            type: "search",
            data: { 
                search_type:"web", 
                sub_search_type:"google",
                top_k: top_k ?? 5,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                query_id: sourceNodeIdWithLabelGroup.length > 0 ? {[sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label} : {},
                extra_configs: {},
                looped: false,
                outputs: {[resultNode as string]: resultNodeLabel as string}
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


    const onTopKChange = (newTopK: number | undefined) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, top_k: newTopK}}
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

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white rounded-[9px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme pt-[7px] pb-[6px] px-[6px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
         <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 13 13">
                    <path stroke="#CDCDCD" strokeWidth="2" d="M5.143 5.143 12 12"/>
                    <circle cx="4.714" cy="4.714" r="3.714" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Search
                </div>
                </div>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <FontAwesomeIcon icon={faGoogle} className='text-main-grey w-[14px] h-[14px]' />
                    </div>
                    <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                    Google
                    </div>
                </div>
            </div>
            <div className='w-[57px] h-[26px]'>
                <button className='w-full h-full rounded-[6px] bg-[#39BC66] text-[#000] text-[12px] font-[700] font-plus-jakarta-sans flex flex-row items-center  justify-center gap-[7px]' onClick={onDataSubmit}>
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
            <div className='text-[#6D7177] w-[120px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             result number
            </div>
            <input ref={topkRef} value={top_k} onChange={() => {
                if (topkRef.current) {
                    setTop_k( topkRef.current.value === "" ? undefined : Number(topkRef.current.value) as number)
                }
            }} id="result_number" type='number' className='px-[10px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
            
        </li>
        
    </ul>
  )
}

export default SearchGoogleConfigMenu