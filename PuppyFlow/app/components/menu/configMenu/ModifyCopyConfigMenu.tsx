'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../tableComponent/JSONForm'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../hooks/useJsonConstructUtils'
import { useNodeContext } from '../../states/NodeContext'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { ModifyConfigNodeData } from '../../workflow/edges/configNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'

type ModifyCopyConfigProps = {
    show: boolean,
    parentId: string,
}

export type ModifyCopyEdgeJsonType = {
    id: string,
    type: "modify",
    data: {
      content_type: "str",
      modify_type: "deep_copy_string",
      extra_configs: {},
      inputs: {id: string, label: string}[],
      looped: boolean,
      outputs: {id: string, label: string}[]
    },
  }

function ModifyCopyConfigMenu({show, parentId}: ModifyCopyConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)

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
                // 120 - 40 = 80 is half of the width of the target node - modify node
                x: parentEdgeNode.position.x - 80,
                y: parentEdgeNode.position.y + 160
            }
            const resultNodeType = getNode(getSourceNodeIdWithLabel(parentId)[0].id)?.type
            setNodes(prevNodes => [
                ...prevNodes,
                {
                    id: resultNode,
                    position: location,
                    data: { content: "" },
                    type: resultNodeType || "text",
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
   
    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
        ))
    }

    const constructJsonData = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)    
        const sourceNodeType = getNode(sourceNodeIdWithLabelGroup[0].id)?.type
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
            type: sourceNodeType || "text",
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

        let edges:ModifyCopyEdgeJsonType[] = []

        const edgejson: ModifyCopyEdgeJsonType = {
            id: parentId,
            type: "modify",
            data: { 
                content_type: "str",
                modify_type: "deep_copy_string",
                extra_configs: {}, 
                inputs: sourceNodeIdWithLabelGroup,
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
            const resultNodeType = getNode(getSourceNodeIdWithLabel(parentId)[0].id)?.type
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode){
                    return {...node, type: resultNodeType || "text", data: {...node.data, content: ""}}
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

    
  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-[0px] text-white rounded-[9px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme pt-[7px] pb-[6px] px-[6px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
        <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="12" viewBox="0 0 10 12" fill="none">
                    <rect x="0.75" y="0.75" width="8.5" height="10.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M6.5 4.5L3.5 7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>

                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Modify
                </div>
            </div>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="13" viewBox="0 0 12 13" fill="none">
                    <rect x="3.75" y="0.75" width="7.5" height="7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <rect x="0.75" y="4.75" width="7.5" height="7.5" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Copy
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
     

        
    </ul>
  )
}

export default ModifyCopyConfigMenu
