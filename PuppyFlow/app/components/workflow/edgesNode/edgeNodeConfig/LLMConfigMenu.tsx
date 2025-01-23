'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { nodeSmallProps } from '../../../upbar/topLeftToolBar/AddNodeMenu'
import useJsonConstructUtils, { ProcessingData, NodeJsonType } from '../../../hooks/useJsonConstructUtils'
import JSONConfigEditor from '../../../tableComponent/JSONConfigEditor'
import { LLMConfigNodeData } from '../edgeNodes/LLMConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

type LLMConfigProps = {
    show: boolean,
    parentId: string,
}

type messageType = {
    role: "system" | "user",
    content: string,
}

type modelType = "gpt-4o" | "gpt-4o-mini" | "gpt-4"
export interface LLMEdgeJsonType {
    // id: string,
    type: "llm",
    data: {
        messages: messageType[],
        model: modelType,
        base_url: string,
        max_tokens: number,
        temperature: number,
        inputs: { [key: string]: string },
        structured_output: boolean,
        looped: boolean,
        outputs: { [key: string]: string }
    }
   
}

type ConstructedLLMJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: LLMEdgeJsonType }
}

function LLMConfigMenu({show, parentId}: LLMConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getZoom, getViewport, getNode, flowToScreenPosition, getEdges, setNodes, setEdges, getNodes} = useReactFlow()
    // const {totalCount, addCount, addNode, allowActivateNode, clear} = useNodeContext()
    const {allowActivateOtherNodesWhenConnectEnd, clearAll} = useNodesPerFlowContext()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI} = useJsonConstructUtils()
    const modelRef = useRef<HTMLSelectElement>(null)
    const baseUrlRef = useRef<HTMLInputElement>(null)
    const structured_outputRef = useRef<HTMLSelectElement>(null)
    const [model, setModel] = useState<"gpt-4o" | "gpt-4o-mini" | "gpt-4">(
        (getNode(parentId)?.data as LLMConfigNodeData)?.model ?? "gpt-4o"
    )
    const [baseUrl, setBaseUrl] = useState<string>(
        (getNode(parentId)?.data as LLMConfigNodeData)?.base_url ?? ""
    )
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as LLMConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [isStructured_output, setStructured_output] = useState(
        (getNode(parentId)?.data as LLMConfigNodeData)?.structured_output ?? false
    )
    const [isLoop, setIsLoop] = useState(
        (getNode(parentId)?.data as LLMConfigNodeData)?.looped ?? false
    )
    
    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])

    useEffect(() => {
        onModelChange(model)
    }, [model])

    useEffect(() => {
        onBaseUrlChange(baseUrl)
    }, [baseUrl])

    useEffect(() => {
        onStructuredOutputChange(isStructured_output)
    }, [isStructured_output])

    useEffect( () => {
        if (!resultNode) return
        if (isComplete) return
        console.log(resultNode, "send data")
        // const addNodeAndSetFlag = async () => {
        //   await addNode(resultNode); // 假设 addNode 返回一个 Promise
        //   setIsAddContext(true);
        // };

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
                type: isStructured_output ? "structured" : "text",
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

            // setNodes(prevNodes => {
            //     return [...prevNodes, newNode];
            // });
        
            // setEdges(prevEdges => {
            //     return [...prevEdges, newEdge];
            // });
            // setIsAddFlow(true)  

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
            <span key={`${node.id}-${parentId}`} className='w-fit text-[10px] font-semibold text-[#000] leading-normal bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[4px] border-[#6D7177] '>{`{{${node.label}}}`}</span>
        ))
    }


    const constructJsonData = (): ConstructedLLMJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        let resultNodeLabel
        // const newResultNodeId = nanoid()
        if (resultNode && getNode(resultNode)?.data?.label !== undefined) {
            resultNodeLabel = getNode(resultNode)?.data?.label as string
        }
        else {
            resultNodeLabel = resultNode as string
        }
        let blocks: { [key: string]: NodeJsonType } = {
            [resultNode as string]: {
                label: resultNodeLabel as string,
                type: isStructured_output ? "structured" : "text",
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

        let edges: { [key: string]: LLMEdgeJsonType } = {}

        const messageContent = cleanJsonString(getNode(parentId)?.data.content as string)
        const edgejson: LLMEdgeJsonType = {
            // id: parentId,
            type: "llm",
            data: {
                messages: messageContent !== "error" ? messageContent : [
                    {"role": "system", 
                     "content": "You are an AI"},
                    {"role": "user", 
                    "content": "introduce yourself"}
                   ],
                model: model,
                base_url: baseUrl,
                max_tokens: 4096,
                temperature: 0.7,
                structured_output: isStructured_output,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
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
            const newNodeType = isStructured_output ? "structured" : "text"
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode){
                    return {...node, type: newNodeType, data: {...node.data, content: "", isLoading: true}}
                }
                return node
            }))
            // allowActivateNode()
            // clear()
            // clearActivation()
            // inactivateNode(parentId)
        }
        setIsComplete(false)
        
        };

    const onModelChange = (newModel: "gpt-4o" | "gpt-4o-mini" | "gpt-4") => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, model: newModel}}
            }
            return node
        }))
    }

    const onBaseUrlChange = (newBaseUrl: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, base_url: newBaseUrl}}
            }
            return node
        }))
    }

    const onStructuredOutputChange = (newStructuredOutput: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, structured_output: newStructuredOutput}}
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

    const onLoopChange = (newLoop: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, looped: newLoop}}
            }
            return node
        }))
    }
        
        
    
  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[7px] font-plus-jakarta-sans flex flex-col gap-[13px] border-box ${show ? "" : "hidden"} `} >
        <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans '>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <g clipPath="url(#clip0_3289_923)">
                        <mask id="mask0_3289_923" style={{maskType:"luminance"}} maskUnits="userSpaceOnUse" x="0" y="0" width="14" height="14">
                        <path d="M14 0H0V14H14V0Z" fill="white"/>
                        </mask>
                        <g mask="url(#mask0_3289_923)">
                        <path d="M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164ZM4.84408 7.50494L3.66546 6.82463C3.65277 6.8185 3.64446 6.80625 3.64271 6.79225V3.53769C3.64358 2.08869 4.81915 0.914439 6.26815 0.915314C6.88108 0.915314 7.47433 1.13056 7.94552 1.52256C7.92408 1.53394 7.88733 1.5545 7.86283 1.56938L5.07508 3.17938C4.93246 3.26031 4.84496 3.41169 4.84583 3.57575L4.84408 7.50406V7.50494ZM5.48415 6.12506L7.00008 5.24963L8.51602 6.12463V7.87506L7.00008 8.75006L5.48415 7.87506V6.12506Z" fill="#CDCDCD"/>
                        </g>
                    </g>
                    <defs>
            <clipPath id="clip0_3289_923">
            <rect width="14" height="14" fill="white"/>
            </clipPath>
        </defs>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                LLM
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[600] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>
        
     
        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans w-full'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[600] leading-normal ml-[4px]'>
                message
            </div>
            <JSONConfigEditor preventParentDrag={onFocus} allowParentDrag={onBlur} placeholder='[
            {"role": "system", 
            "content": "You are an AI"},
            {"role": "user", 
            "content": "{{1}}"}
            ]' parentId={parentId}  widthStyle={432} heightStyle={208} />
        </li>
        
        <li className='flex items-center justify-start bg-black font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[600] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             model
            </div>  
            <select ref={modelRef} id='model' value={model} onChange={() => {
                if (modelRef.current){
                    setModel(modelRef.current.value as "gpt-4o" | "gpt-4o-mini" | "gpt-4")
                }
            }}
            className='flex flex-row items-center justify-start py-[5px] px-[16px] text-[12px] font-[600] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value={"gpt-4o"}>
                    gpt-4o
                </option>
                <option value={"gpt-4o-mini"}>
                    gpt-4o-mini
                </option>
                <option value={"gpt-4-turbo"}>
                    gpt-4
                </option>
            </select>
            
        </li>
        
        <li className='flex items-center justify-start bg-black font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[130px] font-plus-jakarta-sans text-[12px] font-[600] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             structured output
            </div>  
            <select ref={structured_outputRef} id='structured_output' value={isStructured_output === true ? "True" : "False"} onChange={() => {
                if (structured_outputRef.current){
                    setStructured_output(structured_outputRef.current.value === "True" ? true : false)
                }
            }}
            className='flex flex-row items-center justify-start py-[5px] px-[16px] text-[12px] font-[600] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                <option value={"True"}>
                    True
                </option>
                <option value={"False"}>
                    False
                </option>
            </select>
            
        </li>

        {/* <li className='flex flex-col gap-1  items-start justify-center font-plus-jakarta-sans'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[600] leading-normal ml-[4px]'>
                base url
            </div>
            <input ref={baseUrlRef} id="base_url" type='text' className='px-[9px] py-[8px] border-[1px] border-[#6D7177] rounded-[8px] bg-black text-[12px] font-[600] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center w-[384px] font-plus-jakarta-sans' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur} value={baseUrl} onChange={() => {
                if (baseUrlRef.current){
                    setBaseUrl(baseUrlRef.current.value)
                }
            }}></input>
        </li> */}
        
    </ul>
  )
}

export default LLMConfigMenu