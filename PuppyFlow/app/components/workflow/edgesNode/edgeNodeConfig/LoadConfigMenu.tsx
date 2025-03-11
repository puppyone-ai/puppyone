'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ModifyConfigNodeData } from '../edgeNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

type ModifyCopyConfigProps = {
    show: boolean,
    parentId: string,
}

export type LoadConfigJsonType = {
    // id: string,
    type: string,
    data: {
        block_type: string,
        content: string,
        extra_configs: {
            file_configs: Array<{
                file_path: string,
                file_type: string,
                configs?: Record<string, any>
            }>
        },
        inputs: Record<string, string>,
        outputs: Record<string, string>
    }
}

type ConstructedModifyCopyJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: LoadConfigJsonType }
}

function Modify2TextConfigMenu({ show, parentId }: ModifyCopyConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getNode, setNodes, setEdges } = useReactFlow()
    const { getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const { allowActivateOtherNodesWhenConnectEnd, clearAll } = useNodesPerFlowContext()
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    useEffect(() => {
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

            const resultNodeType = "structured"

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
                type: resultNodeType || "text",
            }

            const newEdge = {
                id: `connection-${Date.now()}`,
                source: parentId,
                target: resultNode,
                // type: "CTT",
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

        const sendData = async () => {
            try {
                const jsonData = constructJsonData()
                console.log(jsonData)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method: 'POST',
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

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000); // 1秒后恢复
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <button 
                key={`${node.id}-${parentId}`} 
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center justify-center px-3 h-[28px] rounded-[6px] 
                         border-[1px] text-[12px] font-medium transition-all duration-200
                         ${copiedLabel === node.label 
                           ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]' 
                           : 'bg-[#252525] border-[#3B9BFF]/30 text-[#3B9BFF]/90 hover:bg-[#3B9BFF]/5'}`}
            >
                {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
            </button>
        ))
    }

    const constructJsonData = (): ConstructedModifyCopyJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        const sourceNodeType = getNode(sourceNodeIdWithLabelGroup[0].id)?.type
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
                type: sourceNodeType || "text",
                data: { content: "" }
            }
        }

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: LoadConfigJsonType } = {}

        const input_ids = Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label])))

        const file_task_id = getNode(sourceNodeIdWithLabelGroup[0].id)?.data?.content
        const file_download_url = getNode(sourceNodeIdWithLabelGroup[0].id)?.data?.down_url
        const file_type = getNode(sourceNodeIdWithLabelGroup[0].id)?.data?.fileType
        // console.log("2 structured input ids",input_ids)
        const edgejson: LoadConfigJsonType = {
            // id: parentId,
            type: "load",
            data: {
                block_type: "file",
                content: `${sourceNodeIdWithLabelGroup[0].id}`,
                extra_configs: {
                    file_configs: [
                        {
                            file_path: file_download_url as string,
                            file_type: file_type as string,
                            // configs: {
                                    // configs for the specific file type
                            // }
                        }
                    ]
                },
                inputs: input_ids,
                outputs: { [resultNode as string]: resultNodeLabel as string }
            }
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
        if (!resultNode || !getNode(resultNode)) {

            const newResultNodeId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setResultNode(newResultNodeId)

            // setIsAddContext(false)
            setIsAddFlow(false)
        }
        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            const resultNodeType = getNode(getSourceNodeIdWithLabel(parentId)[0].id)?.type
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode) {
                    return { ...node, type: resultNodeType || "text", data: { ...node.data, content: "", isLoading: true } }
                }
                return node
            }))

        }
        setIsComplete(false)
    };

    const onResultNodeChange = (newResultNode: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newResultNode } }
            }
            return node
        }))
    }


    return (
        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[352px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[16px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="0.5" y="0.5" width="23" height="23" rx="7.5" stroke="#CDCDCD"/>
                                <path d="M8.5 11.9997C14.9167 11.9997 15.5 7.33301 15.5 7.33301" stroke="#CDCDCD" stroke-width="1.5"/>
                                <path d="M8.5 12.0003C14.9167 12.0003 15.5 16.667 15.5 16.667" stroke="#CDCDCD" stroke-width="1.5"/>
                                <rect x="5.75" y="8.75" width="3.5" height="6.5" fill="#1C1D1F" stroke="#CDCDCD" stroke-width="1.5"/>
                                <rect x="14.75" y="5.75" width="3.5" height="3.5" fill="#1C1D1F" stroke="#CDCDCD" stroke-width="1.5"/>
                                <rect x="14.75" y="14.75" width="3.5" height="3.5" fill="#1C1D1F" stroke="#CDCDCD" stroke-width="1.5"/>
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                            Load
                        </div>
                    </div>
                </div>
                <div className='flex flex-row gap-[8px] items-center justify-center'>
                    <button className='w-[57px] h-[24px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' onClick={onDataSubmit}>
                        <span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                <path d="M8 5L0 10V0L8 5Z" fill="black" />
                            </svg>
                        </span>
                        <span>Run</span>
                    </button>
                </div>
            </li>
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Input</label>
                    <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
                </div>
                <div className='flex gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2'>
                        {displaySourceNodeLabels()}
                    </div>
                </div>
            </li>
        </ul>
    )
}

export default Modify2TextConfigMenu
