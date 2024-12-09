import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType, Node} from '@xyflow/react'
import JSONForm from '../tableComponent/JSONForm'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../hooks/useJsonConstructUtils'
import { useNodeContext } from '../../states/NodeContext'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { ModifyConfigNodeData } from '../../workflow/edges/configNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'

type ModifyGetConfigProps = {
    show: boolean,
    parentId: string,
}


export type ModifyGetEdgeJsonType = {
    id: string,
    type: "modify",
    data: {
      content_type: modeNames, // or dict
      modify_type: "get",
      extra_configs: {
        index?: number,
        key?: string // omit if not needed
      },
      inputs: {id: string, label: string}[],
      looped: boolean,
      outputs: {id: string, label: string}[]
    },
   
  }

type modeNames = "list" | "dict"
function ModifyGetConfigMenu({show, parentId}: ModifyGetConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const modeRef = useRef<HTMLSelectElement>(null)
    const [mode, setMode] = useState<modeNames>(
        (getNode(parentId)?.data as ModifyConfigNodeData).content_type === "dict" ? "dict" : "list"
    )
    const numKeyRef = useRef<HTMLInputElement>(null)
    const [numKeyValue, setNumKeyValue] = useState<string | number>(
        (getNode(parentId) as Node)?.data.content_type === "list"
          ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.index as number) :
          (getNode(parentId)?.data.content_type === "dict")
          ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.key as string) : ""
      )
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.looped ?? false)

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

    // trigger when states change, reactflow ConfigNodes data properties should be updated
    useEffect(() => {
        onModeChange()
    }, [mode])

    useEffect(() => {
        onNumKeyChange()
    }, [numKeyValue])

    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])

    // useEffect(() => {
    //     onResultNodeChange()
    // }, [resultNode])

    useEffect(() => {
        if (!resultNode) return
        if (isComplete) {
            // onResultNodeChange()
            return
        }
    
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
            setNodes(prevNodes => [
                ...prevNodes,
                {
                    id: resultNode,
                    position: location,
                    data: { content: "" },
                    type: 'structured',
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
                label: nodeInfo.data.label as string | undefined ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                    ...(nodeInfo.type === "none" ? {subType: nodeInfo.data?.subType as string ?? "text"}: {})
                }
            }
            blocks = [...blocks, nodejson]
        }

        let edges:ModifyGetEdgeJsonType[] = []

        const edgejson: ModifyGetEdgeJsonType = {
            id: parentId,
            type: "modify",
            data: {  
                content_type: mode,
                modify_type: "get",
                extra_configs: {
                    index: mode === "list" && typeof numKeyValue === "number" ? numKeyValue : undefined,
                    key: mode === "dict" && typeof numKeyValue === "string" ?   numKeyValue : undefined
                },
                inputs: sourceNodeIdWithLabelGroup,
                looped: isLoop,
                outputs: [{id: resultNode || `${totalCount + 1}`, label: resultNodeLabel}]
            },
        }

        edges = [...edges, edgejson]
        console.log(blocks, edges, "blocks and edges constructed result")

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

    
    const onModeChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                // return {...node, data: {...node.data, content_type: modeRef.current.value as modeNames}}
                return {...node, data: {...node.data, content_type: mode}}
            }
            return node
        }))
    }

    const onNumKeyChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                // return {...node, data: {...node.data, extra_configs: { index: mode === "list" ? Number(numKeyRef.current.value) : undefined, key: mode === "dict" ? numKeyRef.current.value : undefined}}
                return {...node, data: {...node.data, extra_configs: { index: (typeof numKeyValue === "number" ? numKeyValue : undefined), key: (typeof numKeyValue === "string" ? numKeyValue : undefined)}}}
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
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10.5 7.00016C4.08333 7.00016 3.5 2.3335 3.5 2.3335" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 0)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M13.25 5.25H9.75V8.75H13.25V5.25Z" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 9)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Get
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
            <select ref={modeRef} value={mode} onChange={() => {
                if (modeRef.current){
                    setMode(modeRef.current.value as modeNames)
                    if (numKeyRef.current) {
                        setNumKeyValue("")
                    }
                }
            }} id='mode' className='flex flex-row items-center justify-start py-[5px] px-[16px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value={"list"}>
                    list
                </option>
                <option value={"dict"}>
                    dict
                </option>
            </select>
            
        </li>
        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[100px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             num / key
            </div>
            <input ref={numKeyRef} value={numKeyValue} onChange={() => {
                if (numKeyRef.current) {
                    setNumKeyValue(numKeyRef.current.value === "" ? "" : mode === "list" ? Number(numKeyRef.current.value) : numKeyRef.current.value)
                }
            }} id="model" type={mode === "list" ? "number" : "text"} className='px-[10px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
            </li>

        
    </ul>
  )
}

export default ModifyGetConfigMenu
