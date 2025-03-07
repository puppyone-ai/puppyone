'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import TextConfigEditor from '../../../tableComponent/TextConfigEditor'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ModifyConfigNodeData } from '../edgeNodes/ModifyConfig'
import TextConfigEditorTextArea from '../../../tableComponent/TextConfigEditorTextArea'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

import {PuppyDropdown} from "../../../misc/PuppyDropDown"

type ModifyTextConfigProps = {
    show: boolean,
    parentId: string,
}

export type ModifyTextEdgeJsonType = {
    // id: string,
    type: "modify",
    data: {
    //   content_type: "str",
      modify_type: "edited_text",
      extra_configs: {},
      content: string,
      inputs: { [key: string]: string },
      looped: boolean,
      outputs: { [key: string]: string }
    },
  }

  type ConstructedModifyTextJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ModifyTextEdgeJsonType }
  }

function ModifyTextConfigMenu({show, parentId}: ModifyTextConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [textContent, setTextContent] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.content || "");
   
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
                type: 'text',
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
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
        ))
    }


    const constructJsonData = (): ConstructedModifyTextJsonData | Error => {
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
                type: "text",
                data:{content: ""}
            }
        }
        
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: ModifyTextEdgeJsonType } = {}

        console.log("mod text config node", getNode(parentId))

        const promptValue = getNode(parentId)?.data.content as string || ""
        const edgejson: ModifyTextEdgeJsonType = {
            // id: parentId,
            type: "modify",
            data: {  
                // content_type: "str",
                modify_type: "edited_text",
                extra_configs: {
                    slice: (
                        retMode === RET_ALL? [0, -1]:(
                            retMode === RET_FN?JSON.parse(`[0,${configNum}]`):(
                                retMode === RET_LN?JSON.parse(`[-${configNum},-1]`):(
                                    retMode === EX_FN?JSON.parse(`[${configNum},-1]`):JSON.parse(`[0,-${configNum}]`)
                                )
                            )
                        )
                    ),
                    sort_type: "/" // if no need to sort, pass the value as /
                },
                content: sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (node.label||node.id))[0],
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

   const RET_ALL = "return all"
   const RET_FN = "return first n"
   const RET_LN = "return last n"
   const EX_FN = "exclude first n"
   const EX_LN = "exclude last n"
//    const [wrapInto, setWrapInto] = useState(typeof (getNode(parentId)?.data?.extra_configs as any)?.dict_key === 'string'? (getNode(parentId)?.data?.extra_configs as any)?.dict_key : "")
   const [retMode,setRetMode] = useState(typeof (getNode(parentId)?.data?.extra_configs as any)?.retMode === 'string'? (getNode(parentId)?.data?.retMode as any)?.retMode : RET_ALL)

   const  [configNum, setConfigNum] = useState(typeof (getNode(parentId)?.data?.extra_configs as any)?.configNum === 'number'? (getNode(parentId)?.data?.extra_configs as any)?.configNum : 100) 
   
   useEffect(()=>{
    setNodes(prevNodes => prevNodes.map(node => {
        if (node.id === parentId) {
            return {...node, data: {...node.data, 
                configNum:configNum,
                retMode: retMode}}
        }
        return node
    }))
   },[retMode,configNum]

   )

   const renderRetMode = (v:string)=>{

        if(v === RET_ALL){
            return v
        }


        return (
            <>
                {v.slice(0,-1)}
                <input 
                    value={configNum}
                    onChange={(e)=>{
                        console.log(e.target.value)
                        setConfigNum(e.target.value)
                    }} 
                    className="w-[50px] text-white bg-black caret-white ml-[5px]"
                    type="number"></input>
            </>
        )
   }
    
  return (
    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[16px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box ${show ? "" : "hidden"} shadow-lg`}>
        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10H10" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                    Modify Text
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
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Input Variables</label>
                <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
            </div>
            <div className='flex gap-2 p-2 bg-[#1E1E1E] rounded-[8px]
                          border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <div className='flex flex-wrap gap-2'>
                    {displaySourceNodeLabels()}
                </div>
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Return Text</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
            <div className='bg-[#252525] rounded-[8px] p-3 border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <textarea
                    value={textContent}
                    onChange={(e)=>{
                        const newContent = e.target.value;
                        setTextContent(newContent);
                        
                        // 更新节点数据
                        setNodes(prevNodes => prevNodes.map(node => {
                            if (node.id === parentId) {
                                return {...node, data: {...node.data, content: newContent}}
                            }
                            return node
                        }));
                    }}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    placeholder='use {{}} and id to reference input content example: hello, {{parent_nodeid}}'
                    className='w-full h-[140px] bg-transparent text-[#CDCDCD] text-[12px] resize-none outline-none p-1'
                />
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Return Mode</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
            <div className='flex items-center gap-2'>
                <PuppyDropdown
                    options={[
                        RET_ALL,
                        RET_FN,
                        RET_LN,
                        EX_FN,
                        EX_LN 
                    ]}
                    onSelect={(option:string)=>{
                        setRetMode(option)
                    }}
                    selectedValue={retMode}
                    listWidth={"200px"}
                    containerClassnames="w-full"
                >
                </PuppyDropdown>
                
                {retMode !== RET_ALL && (
                    <div className='flex items-center gap-2'>
                        <input 
                            value={configNum}
                            onChange={(e)=>{
                                setConfigNum(e.target.value)
                            }} 
                            className='w-[80px] h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                     border-[1px] border-[#6D7177]/30 
                                     text-[12px] text-[#CDCDCD] 
                                     hover:border-[#6D7177]/50 transition-colors'
                            type="number"
                        />
                        <span className='text-[12px] text-[#CDCDCD]'>
                            {retMode.includes('first') || retMode.includes('last') ? 'items' : 'characters'}
                        </span>
                    </div>
                )}
            </div>
        </li>
    </ul>
  )
}

export default ModifyTextConfigMenu