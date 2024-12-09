'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { useNodeContext } from '../../states/NodeContext'
// import PythonConfigEditor from '../tableComponent/PythonConfigEditor'
import { CodeConfigNodeData } from '../../workflow/edges/configNodes/CodeConfig'
import isEqual from 'lodash/isEqual'
import dynamic from 'next/dynamic';
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'

// dynamic import python monaco editor
const PythonConfigEditor = dynamic(() => import('../tableComponent/PythonConfigEditor'), {
  ssr: false
});

type CodeConfigProps = {
    show: boolean,
    parentId: string,
}


export type CodeEdgeJsonType = {
    id: string,
    type: "code",
    data: {
        code: string,
        inputs: {id: string, label: string}[],
        looped: boolean,
        outputs: {id: string, label: string}[]
    },
}

function CodeConfigMenu({show, parentId}: CodeConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as CodeConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as CodeConfigNodeData)?.resultNode ?? null)
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [codeInputs, setCodeInputs] = useState<string[]>(
        getSourceNodeIdWithLabel(parentId).map(node => node.label)
    )

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
                } finally {
                    setIsComplete(true)
                    // const realResultNode = getNode(resultNode.nodeid)
                    // if (!realResultNode) return
                    // if (resultNode.nodeType !== realResultNode.type) {
                    //     onResultNodeChange({
                    //         nodeid: resultNode.nodeid,
                    //         nodeType: realResultNode.type ?? "text"
                    //     })
                    //     setResultNode({
                    //         nodeid: resultNode.nodeid,
                    //         nodeType: realResultNode.type ?? "text"
                    //     })
                    // }
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
                // 120 - 40 = 80 is half of the width of the target node - code node
                x: parentEdgeNode.position.x - 80,
                y: parentEdgeNode.position.y + 160
            }
            setNodes(prevNodes => [
                ...prevNodes,
                {
                    id: resultNode,
                    position: location,
                    data: { content: "" },
                    type: 'text', // default type
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
        const newCodeInputs = sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => node.label)
        if (!isEqual(codeInputs, newCodeInputs)) {
            setCodeInputs(newCodeInputs)
        }
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
            type: "text",
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

        let edges:CodeEdgeJsonType[] = []

        const edgejson: CodeEdgeJsonType = {
            id: parentId,
            type: "code",
            data: {  
                inputs: sourceNodeIdWithLabelGroup,
                code: getNode(parentId)?.data.code as string ?? "",
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
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" viewBox="0 0 16 9" fill="none">
                    <path d="M3.65714 0H5.48571L1.82857 4.5L5.48571 9H3.65714L0 4.5L3.65714 0Z" fill="#D9D9D9"/>
                    <path d="M12.3429 0H10.5143L14.1714 4.5L10.5143 9H12.3429L16 4.5L12.3429 0Z" fill="#D9D9D9"/>
                    <rect x="4.57129" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="10.0571" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="7.31445" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                Code
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
        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
                Python function
            </div>
            <PythonConfigEditor preventParentDrag={onFocus} 
                      placeholder="define your function"
                      allowParentDrag={onBlur} 
                      parentId={parentId}
                      widthStyle={280} 
                      heightStyle={140} 
                      inputs={codeInputs}/>
        </li>

        
    </ul>
  )
}

export default CodeConfigMenu