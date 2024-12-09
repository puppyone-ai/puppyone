'use client'
import React, { useEffect, useRef, useState, useCallback, useMemo} from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { useNodeContext } from '../../states/NodeContext'
import { EmbeddingConfigNodeData } from '@/app/components/workflow/edges/configNodes/EmbeddingConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'


type EmbeddingConfigProps = {
    show: boolean,
    parentId: string,
}

export type EmbeddingEdgeJsonType = {
    id: string,
    type: "embedding",
    data: {
        inputs: {id: string, label: string}[],
        model: modelNames,
        method: methodNames,
        looped: boolean,
        outputs: {id: string, label: string}[]
    },
}


export type methodNames = "cosine" | "distance"
export type modelNames = "text-embedding-ada-002"

function EmbeddingConfigMenu({show, parentId}: EmbeddingConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const modelRef = useRef<HTMLSelectElement>(null)
    const methodRef = useRef<HTMLSelectElement>(null)
    const [method, setMethod] = useState<methodNames>((getNode(parentId)?.data as EmbeddingConfigNodeData)?.method ?? "distance")
    const [model, setModel] = useState<modelNames>((getNode(parentId)?.data as EmbeddingConfigNodeData)?.model ?? "text-embedding-ada-002")
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as EmbeddingConfigNodeData)?.resultNode ?? null)
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)

    useEffect(() => {
        onModelChange(model)
    }, [model])

    useEffect(() => {
        onMethodChange(method)
    }, [method])


    useEffect( () => {
        if (!resultNode) return
        if (isComplete) return
    
        const addNodeAndSetFlag = async () => {
          await addNode(resultNode); // 假设 addNode 返回一个 Promise
          setIsAddContext(true);
        };

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
                    setIsComplete(true)
                }
        }
    
        if (!isAddContext) {
          addNodeAndSetFlag()
          addCount()
        }
        else if (isAddContext && !isAddFlow) {
            const parentEdgeNode = getNode(parentId)
            if (!parentEdgeNode) return
            const location = {
                // 88 - 40 = 48 is half of the width of the target node - embedding node
                x: parentEdgeNode.position.x - 48,
                y: parentEdgeNode.position.y + 160
            }
            setNodes(prevNodes => [
                ...prevNodes,
                {
                    id: resultNode,
                    position: location,
                    data: { content: "" },
                    type: 'vector_database',
                }
        ]);
        setEdges((edges) => edges.concat({
            id: `connection-${Date.now()}`,
            source: parentId,
            target: resultNode,
            type: "CTT",
            markerEnd: markerEnd,
        }))
           setIsAddFlow(true)  
            allowActivateNode()
            clear()
    
        }
        else if (isAddContext && isAddFlow) {
            sendData()
            
        }
      }, [resultNode, isAddContext, isAddFlow, isComplete])

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

    const constructJsonData = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        let resultNodeLabel
        if (resultNode && getNode(resultNode)?.data?.label !== undefined) {
            resultNodeLabel = getNode(resultNode)?.data?.label as string
        }
        else {
            resultNodeLabel = resultNode || `${totalCount + 1}`
        }
        let blocks: NodeJsonType[] = [{
            id: resultNode || `${totalCount + 1}`,
            label: resultNodeLabel,
            type: "vector_database",
            data:{content: ""}
        }]
        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id)
            if (!nodeInfo) continue
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any) : nodeInfo.data.content as string
            if (nodeContent === "error") return "error"
            const nodejson: NodeJsonType = {
                id: nodeInfo.id,
                label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                    ...(nodeInfo.type === "none" ? {subType: nodeInfo.data?.subType as string ?? "text"}: {})
                }
            }
            blocks = [...blocks, nodejson]
        }

        let edges:EmbeddingEdgeJsonType[] = []

        const edgejson: EmbeddingEdgeJsonType = {
            id: parentId,
            type: "embedding",
            data: {  
                inputs: sourceNodeIdWithLabelGroup,
                model: model,
                method: method,
                looped: false,
                outputs: [{id: resultNode || `${totalCount + 1}`, label: resultNodeLabel}]
            },
        }

        edges = [...edges, edgejson]
        console.log(blocks, edges)

        return {
            blocks,
            edges
        }
    }


    const onDataSubmit = async () => {
        if (!resultNode || !getNode(resultNode)){

            onResultNodeChange(`${totalCount+1}`)
            setResultNode(`${totalCount+1}`)
            
            setIsAddContext(false)
            setIsAddFlow(false)
        }
        else {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode){
                    return {...node, data: {...node.data, content: ""}}
                }
                return node
            }))
            allowActivateNode()
            clear()
        }
        setIsComplete(false)
        };

        const onResultNodeChange = (newResultNode: string) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, resultNode: newResultNode}}
                }
                return node
            }))
        }

        const onModelChange = (newModel: modelNames) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, model: newModel}}
                }
                return node
            }))
        }

        const onMethodChange = (newMethod: methodNames) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, method: newMethod}}
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
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                        <path fill="#CDCDCD" d="m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M7 9V2"/>
                        <path fill="#CDCDCD" d="M7 0 4.69 4h4.62L7 0Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9-5 3.5"/>
                        <path fill="#CDCDCD" d="m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9 5 3.5"/>
                        </svg>
                    </div>
                    <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                    Embedding
                    </div>
                </div>
            </div>
            <div className='w-[57px] h-[26px]'>
                <button className='w-full h-full rounded-[6px] bg-[#39BC66] text-[#000] text-[12px] font-[700] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' onClick={onDataSubmit}>
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
            <div className='text-[#6D7177] w-[115px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             model
            </div>
            <select ref={modelRef} value={model} onChange={() => {
                if (modelRef.current) {
                    setModel(modelRef.current.value as modelNames)
                }
            }} id="model" className='flex flex-row items-center justify-start py-[5px] px-[12px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value="text-embedding-ada-002">text-embedding-ada-002</option>
            </select>
        </li>
        
        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[115px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             method
            </div>
            <select ref={methodRef} id='method' value={method} onChange={() => {
                if (methodRef.current){
                    setMethod(methodRef.current.value as methodNames)
                }
            }} className='flex flex-row items-center justify-start py-[5px] px-[12px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value="cosine">cosine</option>
                <option value="distance">distance</option>
            </select>
            
        </li>
        
    </ul>
  )
}

export default EmbeddingConfigMenu