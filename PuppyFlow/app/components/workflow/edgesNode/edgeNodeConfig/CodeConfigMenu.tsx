'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
// import PythonConfigEditor from '../tableComponent/PythonConfigEditor'
import { CodeConfigNodeData } from '../edgeNodes/CodeConfig'
import isEqual from 'lodash/isEqual'
import dynamic from 'next/dynamic';
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
// dynamic import python monaco editor
const PythonConfigEditor = dynamic(() => import('../../../tableComponent/PythonConfigEditor'), {
  ssr: false
});

type CodeConfigProps = {
    show: boolean,
    parentId: string,
}


export type CodeEdgeJsonType = {
    // id: string,
    type: "code",
    data: {
        code: string,
        inputs: { [key: string]: string },
        looped: boolean,
        outputs: { [key: string]: string }
    },
}

type ConstructedCodeJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: CodeEdgeJsonType }
}

function CodeConfigMenu({show, parentId}: CodeConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as CodeConfigNodeData)?.looped ?? false)
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as CodeConfigNodeData)?.resultNode ?? null)
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [codeInputs, setCodeInputs] = useState<string[]>(
        getSourceNodeIdWithLabel(parentId).map(node => node.label)
    )
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

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
                type: 'text', // default type
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
        const newCodeInputs = sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => node.label)
        if (!isEqual(codeInputs, newCodeInputs)) {
            setCodeInputs(newCodeInputs)
        }
        
        const copyToClipboard = (label: string) => {
            navigator.clipboard.writeText(`{{${label}}}`).then(() => {
                setCopiedLabel(label);
                setTimeout(() => setCopiedLabel(null), 2000);
            });
        };
        
        return sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => (
            <button 
                key={`${node.id}-${parentId}`} 
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center justify-center px-[8px] h-[20px] rounded-[4px] 
                         border-[1px] text-[10px] font-medium transition-all duration-200
                         ${copiedLabel === node.label 
                           ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]' 
                           : 'bg-[#252525] border-[#3B9BFF]/30 text-[#3B9BFF]/90 hover:bg-[#3B9BFF]/5'}`}
            >
                {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
            </button>
        )
    )
    }

    const constructJsonData = (): ConstructedCodeJsonData | Error => {
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
                type: "text",
                data:{content: ""}
            }
        }
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: CodeEdgeJsonType } = {}

        const edgejson: CodeEdgeJsonType = {
            // id: parentId,
            type: "code",
            data: {  
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                code: getNode(parentId)?.data.code as string ?? "",
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
    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box ${show ? "" : "hidden"} shadow-lg`}>
        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" viewBox="0 0 16 9" fill="none">
                    <path d="M3.65714 0H5.48571L1.82857 4.5L5.48571 9H3.65714L0 4.5L3.65714 0Z" fill="#D9D9D9"/>
                    <path d="M12.3429 0H10.5143L14.1714 4.5L10.5143 9H12.3429L16 4.5L12.3429 0Z" fill="#D9D9D9"/>
                    <rect x="4.57129" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="10.0571" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="7.31445" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                Code
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
                <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
            </div>
            <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px]
                          border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <div className='flex flex-wrap gap-2'>
                    {displaySourceNodeLabels()}
                </div>
            </div>
        </li>
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Python Function</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
            
                <PythonConfigEditor 
                    preventParentDrag={onFocus} 
                    placeholder="Define your function"
                    allowParentDrag={onBlur} 
                    parentId={parentId}
                    widthStyle={420} 
                    heightStyle={208} 
                    inputs={codeInputs}
                />
            
        </li>
    </ul>
  )
}

export default CodeConfigMenu