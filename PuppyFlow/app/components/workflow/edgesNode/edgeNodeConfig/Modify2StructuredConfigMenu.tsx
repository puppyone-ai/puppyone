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
import {PuppyDropdown} from '../../../misc/PuppyDropDown'

type ModifyCopyConfigProps = {
    show: boolean,
    parentId: string,
}


// "<edge_id>": {
//   "type": "modify",
//   "data": {
// 		"modify_type": "convert2structured",
// 		"content": "111,{{a}}, 222,{{b}}",
// 		"extra_configs": {
// 			"target_structure": "list/dict",
// 	    "action_type": "default/json",
// 	    "list_separator": [], // could be , ; etc. or a string
// 	    "dict_key": "key_here", // the key to store the original text as its value
// 		}
//     "inputs": {"2": "2/label_2"},
//     "outputs": { "3": "3/label_3" },
//   }
// }

// source_type: "text",
// target_type: "structured",
// target_structure": "list/dict", // convert to list or object
// action_type: "default/json", // convert mode
// list_separator: [], // optional, could be , ; etc. or a string, to separate the string into parts in a list format
// dict_key: "key_here", // optional, the key to store the original text as its value, used when target_structure is dict
// }
// inputs: {"2": "2/label_2"},
// outputs: { "3": "3/label_3" },
export type Modify2SturcturedJsonType = {
    // id: string,
    type: "modify",
    data: {
        content: string,
        modify_type: "convert2structured",
		extra_configs: {
            conversion_mode:string,
            action_type: "default"|"json", // convert mode
            list_separator?: string[], // optional, could be , ; etc. or a string, to separate the string into parts in a list format
            length_separator?:number,
            dict_key?: string, // the key to store the original text as its value
		}
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

type ConstructedModifyCopyJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: Modify2SturcturedJsonType }
}

const RESULT_NODE_TYPE = "structured"

function Modify2StructuredConfigMenu({ show, parentId }: ModifyCopyConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getNode, setNodes, setEdges } = useReactFlow()
    const { getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const { allowActivateOtherNodesWhenConnectEnd, clearAll } = useNodesPerFlowContext()
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)

    // 添加复制功能状态
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

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

            const resultNodeType = RESULT_NODE_TYPE

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

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
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

        let edges: { [key: string]: Modify2SturcturedJsonType } = {}

        const input_ids = Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label])))

        // const config = JSON.parse(wrapInto)
        // const targetStructure = Array.isArray(config) ? "list" : "dict"; // Check if config is a list or object
        // const firstKey = !Array.isArray(config) && typeof config === 'object' ? Object.keys(config)[0] : undefined; 


        // "<edge_id>": {
        //     "type": "modify",
        //     "data": {
        //             "modify_type": "convert2structured",
        //             "content": "111,{{a}}, 222,{{b}}",
        //             "extra_configs": {
        //                 "source_type": "text",
        //                 "target_type": "structured",
        //                 "target_structure": "list/dict", // convert to list or object
        //             "action_type": "default/json", // convert mode
        //             "list_separator": [], // optional, could be , ; etc. or a string, to separate the string into parts in a list format
        //             "dict_key": "key_here", // optional, the key to store the original text as its value, used when target_structure is dict
        //             }
        //         "inputs": {"2": "2/label_2"},
        //         "outputs": { "3": "3/label_3" },
        //     }
        // }


        // Deafult Mode: 

        //     - "some text" → ["some text"] (for list), or, {"key_here": "some text"} (for dict)
        //     - When "list_separator": [","]: "some, text, here" → ["some", "text", "here"]

        //     Json Mode: 

        //     - "{'key_here': 'some text'} xxx [1,2,3]" → {"key_here": "some text", "list_1": [1, 2, 3]} (parse all the lists and dicts to be a json object)
        
        const edgejson: Modify2SturcturedJsonType = {
            // id: parentId,
            type: "modify",
            data: {
                content: `{{${sourceNodeIdWithLabelGroup[0].label||sourceNodeIdWithLabelGroup[0].id}}}`,
                modify_type: "convert2structured",
                extra_configs: {
                    conversion_mode: execMode===BY_LEN_TYPE? "split_by_length": (
                        execMode===BY_CHAR_TYPE? "split_by_character":(
                            execMode===INTO_LIST_TYPE? "parse_as_list":(
                                execMode===INTO_DICT_TYPE?"wrap_into_dict":"parse_as_json"
                            )
                        )
                    ),
                    action_type: execMode===JSON_TYPE?"json":"default", // convert mode
                    ...(execMode===BY_CHAR_TYPE ? { list_separator: JSON.parse(deliminator) }:{}), // optional, could be , ; etc. or a string, to separate the string into parts in a list format
                    ...(execMode===INTO_DICT_TYPE ? { dict_key:wrapInto }:{}), // optional, the key to store the original text as its value, used when target_structure is dict    
                    ...(execMode===BY_LEN_TYPE ? { length_separator:bylen }:{}) // optional, the key to store the original text as its value, used when target_structure is dict    
                },
                inputs: input_ids,
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
        if (!resultNode || !getNode(resultNode)) {

            const newResultNodeId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setResultNode(newResultNodeId)

            // setIsAddContext(false)
            setIsAddFlow(false)
        }
        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            const resultNodeType = RESULT_NODE_TYPE
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

    const [wrapInto, setWrapInto] = useState(typeof (getNode(parentId)?.data?.extra_configs as any)?.dict_key === 'string'? (getNode(parentId)?.data?.extra_configs as any)?.dict_key : "")

    const INTO_DICT_TYPE= "wrap into dict"
    const INTO_LIST_TYPE= "wrap into list"
    const JSON_TYPE= "JSON"
    const BY_LEN_TYPE= "split by length"
    const BY_CHAR_TYPE= "split by character"

    const [execMode, setExecMode] = useState(JSON_TYPE)

    const [deliminator, setDeliminator] = useState(typeof (getNode(parentId)?.data?.extra_configs as any)?.list_separator === 'string'? (getNode(parentId)?.data?.extra_configs as any)?.list_separator : `[",",";",".","\\n"]`)
    const [bylen, setBylen] = useState<number>(typeof (getNode(parentId)?.data?.extra_configs as any)?.length_separator === 'number' ? (getNode(parentId)?.data?.extra_configs as any)?.length_separator : 10)

    // ...(execMode===INTO_LIST_TYPE ? { list_separator: JSON.parse(deliminator) }:{}), // optional, could be , ; etc. or a string, to separate the string into parts in a list format
    // ...(execMode===BY_CHAR_TYPE ? { dict_key:`${wrapInto}` }:{}) // optional, the key to store the original text as its value, used when target_structure is dict   
    useEffect(
        ()=>{
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId){
                    return {...node, data: {
                        ...node.data, 
                        extra_configs:{
                            list_separator: deliminator,
                            dict_key: wrapInto,
                            length_separator: bylen
                        }
                    }}
                }
                return node
            }))
        },
        [deliminator, bylen, wrapInto]
    )

    return (
        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[384px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 10H10" stroke="#CDCDCD" strokeWidth="1.5"/>
                                <path d="M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            Modify
                        </div>
                    </div>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M12 2L2 12" stroke="#CDCDCD" strokeWidth="1.5"/>
                            <path d="M12 2L8 2" stroke="#CDCDCD" strokeWidth="1.5"/>
                            <path d="M12 2L12 6" stroke="#CDCDCD" strokeWidth="1.5"/>
                            <path d="M2 12L6 12" stroke="#CDCDCD" strokeWidth="1.5"/>
                            <path d="M2 12L2 8" stroke="#CDCDCD" strokeWidth="1.5"/>
                        </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                Convert to Structured
                        </div>
                    </div>
                </div>
                <div className='flex flex-row gap-[8px] items-center justify-center'>
                    <button className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' onClick={onDataSubmit}>
                        <span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                <path d="M8 5L0 10V0L8 5Z" fill="black" />
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
                <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2'>
                        {displaySourceNodeLabels()}
                    </div>
                </div>
            </li>

            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Mode</label>
                    <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
                </div>
                <div className='flex gap-2 bg-[#252525] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <PuppyDropdown
                        options={[INTO_DICT_TYPE, INTO_LIST_TYPE, JSON_TYPE, BY_LEN_TYPE, BY_CHAR_TYPE]}
                        onSelect={(option:string) => {
                            setExecMode(option)
                        }}
                        selectedValue={execMode}
                        listWidth={"200px"}
                    />
                </div>
            </li>

            {execMode === INTO_DICT_TYPE && (
                <li className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[12px] font-medium text-[#6D7177]'>Key</label>
                        <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
                    </div>
                    <input 
                        value={wrapInto} 
                        onChange={(e) => setWrapInto(e.target.value)} 
                        type='string' 
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                 text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                 hover:border-[#6D7177]/50 transition-colors'
                        autoComplete='off'
                    />
                </li>
            )}

            {execMode === BY_CHAR_TYPE && (
                <li className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[12px] font-medium text-[#6D7177]'>Deliminators</label>
                        <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
                    </div>
                    <input 
                        value={deliminator} 
                        onChange={(e) => setDeliminator(e.target.value)} 
                        type='string' 
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                 text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                 hover:border-[#6D7177]/50 transition-colors'
                        autoComplete='off'
                    />
                </li>
            )}

            {execMode === BY_LEN_TYPE && (
                <li className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[12px] font-medium text-[#6D7177]'>Length</label>
                        <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
                    </div>
                    <input 
                        value={bylen} 
                        onChange={(e) => setBylen(parseInt(e.target.value))} 
                        type='number' 
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                 text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                 hover:border-[#6D7177]/50 transition-colors'
                        autoComplete='off'
                    />
                </li>
            )}
        </ul>
    )
}

export default Modify2StructuredConfigMenu
