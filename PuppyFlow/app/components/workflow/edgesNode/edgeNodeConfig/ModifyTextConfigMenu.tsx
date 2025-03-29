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
      modify_type: "edit_text",
      extra_configs: {},
      content: string,
      inputs: { [key: string]: string },
    //   looped: boolean,
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
    // const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [textContent, setTextContent] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.content || "");
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

    const copyToClipboard = (label: string) => {
        navigator.clipboard.writeText(`{{${label}}}`).then(() => {
            setCopiedLabel(label);
            setTimeout(() => setCopiedLabel(null), 2000);
        });
    };

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => {
            // Get the node type from the node data
            const nodeInfo = getNode(node.id)
            const nodeType = nodeInfo?.type || 'text' // Default to text if type not found
            
            // Define colors based on node type
            let colorClasses = {
                text: {
                    active: 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]',
                    default: 'bg-[#252525] border-[#3B9BFF]/50 text-[#3B9BFF] hover:border-[#3B9BFF]/80 hover:bg-[#3B9BFF]/5'
                },
                file: {
                    active: 'bg-[#9E7E5F]/20 border-[#9E7E5F] text-[#39BC66]',
                    default: 'bg-[#252525] border-[#9E7E5F]/50 text-[#9E7E5F] hover:border-[#9E7E5F]/80 hover:bg-[#9E7E5F]/5'
                },
                structured: {
                    active: 'bg-[#9B7EDB]/20 border-[#9B7EDB] text-[#39BC66]',
                    default: 'bg-[#252525] border-[#9B7EDB]/50 text-[#9B7EDB] hover:border-[#9B7EDB]/80 hover:bg-[#B0A4E3]/5'
                }
            }
            
            // Define SVG icons for each node type, using the provided references
            const nodeIcons = {
                text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                ),
                file: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5"/>
                        <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                ),
                structured: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                        <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                        <path d="M9 9H11V11H9V9Z" className="fill-current" />
                        <path d="M9 13H11V15H9V13Z" className="fill-current" />
                        <path d="M13 9H15V11H13V9Z" className="fill-current" />
                        <path d="M13 13H15V15H13V13Z" className="fill-current" />
                    </svg>
                )
            }
            
            // Choose the appropriate color classes based on node type
            const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text
            
            // Choose the appropriate icon based on node type
            const icon = nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text
            
            return (
                <button 
                    key={`${node.id}-${parentId}`} 
                    onClick={() => copyToClipboard(node.label)}
                    className={`flex items-center gap-[4px] px-[8px] h-[20px] rounded-[4px] 
                             border-[1px] text-[10px] font-medium transition-all duration-200
                             ${copiedLabel === node.label 
                               ? colors.active
                               : colors.default}`}
                >
                    <div className="flex-shrink-0">
                        {icon}
                    </div>
                    <span className="truncate max-w-[100px]">
                        {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
                    </span>
                </button>
            )
        })
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
                modify_type: "edit_text",
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
                content: promptValue,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                // looped: isLoop,
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
    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box ${show ? "" : "hidden"} shadow-lg`}>
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
                <span className='text-[9px] text-[#6D7177] px-[4px] py-[1.5px] rounded bg-[#282828]'>Auto</span>
            </div>
            <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px]
                          border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <div className='flex flex-wrap gap-2'>
                    {displaySourceNodeLabels()}
                </div>
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Return Text</label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
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
                    placeholder={`use {{}} and id to reference input content 
example: hello, {{parent_nodeid}}`}
                    className='w-full h-[140px] bg-transparent text-[#CDCDCD] text-[12px] resize-none outline-none p-1'
                />
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Return Mode</label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
            </div>
            <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
            
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