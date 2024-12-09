'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { useNodeContext } from '../../states/NodeContext'
import JsonConfigEditor from '../tableComponent/JSONConfigEditor'
import { ChunkingConfigNodeData } from '../../workflow/edges/configNodes/ChunkingConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'

type ChunkingByCharacterConfigProps = {
    show: boolean,
    parentId: string,
}


export type ChunkingByCharacterEdgeJsonType = {
    id: string,
    type: "chunk",
    data: {
        inputs: {id: string, label: string}[],
        chunking_mode: "character",
        sub_chunking_mode: "character",
        extra_configs: {
            delimiters: string[]
        },
        looped: boolean,
        outputs: {id: string, label: string}[]
    },
}

function ChunkingByCharacterConfigMenu({show, parentId}: ChunkingByCharacterConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel,cleanJsonString, streamResult, reportError} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount, preventInactivateNode, allowInactivateNode} = useNodeContext()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ChunkingConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData).resultNode ?? null
    )
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)


    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])
  
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
                }
                finally {
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
                // 120 - 40 = 80 is half of the width of the target node - chunk node
                x: parentEdgeNode.position.x - 80,
                y: parentEdgeNode.position.y + 160
            }
            setNodes(prevNodes => [
                ...prevNodes,
                {
                    id: resultNode,
                    position: location,
                    data: { content: "" },
                    type: "structured",
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
            type: "structured",
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

        let edges:ChunkingByCharacterEdgeJsonType[] = []

        const delimiterConfig = cleanJsonString(getNode(parentId)?.data.content as string) as string[]
        const edgejson: ChunkingByCharacterEdgeJsonType = {
            id: parentId,
            type: "chunk",
            data: {  
                inputs: sourceNodeIdWithLabelGroup,
                chunking_mode: "character",
                sub_chunking_mode: "character",
                extra_configs: {delimiters: delimiterConfig},
                looped: isLoop,
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="9" fill="none" viewBox="0 0 14 9">
                    <path fill="#CDCDCD" d="m2.816 2.584-.474 4.031h-.873L.982 2.584V.393h1.834v2.191ZM2.77 7.307V9H1.023V7.307H2.77Zm8.789-1.495c-.047.149-.073.38-.077.692H9.9c.024-.66.086-1.115.188-1.365.102-.254.363-.545.785-.873l.428-.334a1.52 1.52 0 0 0 .34-.346 1.18 1.18 0 0 0 .234-.709c0-.297-.088-.566-.264-.809-.171-.246-.488-.369-.949-.369-.453 0-.775.15-.967.451-.187.301-.28.614-.28.938H7.72c.047-1.113.435-1.902 1.166-2.367.46-.297 1.027-.446 1.699-.446.883 0 1.615.211 2.197.633.586.422.88 1.047.88 1.875 0 .508-.128.936-.382 1.283-.148.211-.433.48-.855.809l-.416.322a1.257 1.257 0 0 0-.451.615ZM11.605 9H9.86V7.307h1.746V9Z"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal whitespace-nowrap'>
                by character
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[300px]'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>
        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
                delimiters
            </div>
            <JsonConfigEditor preventParentDrag={onFocus} 
                      allowParentDrag={onBlur} 
                      placeholder='[“,”,”;”,”\n”]'
                      parentId={parentId}
                      widthStyle={300} 
                      heightStyle={140} />
        </li>

        
    </ul>
  )
}

export default ChunkingByCharacterConfigMenu