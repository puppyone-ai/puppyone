'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { nodeSmallProps } from '../../../upbar/topLeftToolBar/AddNodeMenu'
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
            target_structure: "list"|"dict", // convert to list or object
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

            const resultNodeType = getNode(getSourceNodeIdWithLabel(parentId)[0].id)?.type

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
            <span key={`${node.id}-${parentId}`} className='w-fit text-[10px] font-semibold text-[#000] leading-normal bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[4px] border-[#6D7177]'>{`{{${node.label}}}`}</span>
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
                    target_structure: execMode===INTO_LIST_TYPE?"list":"dict", // convert to list or object
                    action_type: execMode===JSON_TYPE?"json":"default", // convert mode
                    ...(execMode===INTO_LIST_TYPE ? { list_separator: JSON.parse(deliminator) }:{}), // optional, could be , ; etc. or a string, to separate the string into parts in a list format
                    ...(execMode===BY_CHAR_TYPE ? { dict_key:`${wrapInto}` }:{}), // optional, the key to store the original text as its value, used when target_structure is dict    
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

        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[384px] rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[7px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
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
            <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full'>
                <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                    input
                </div>
                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                    {displaySourceNodeLabels()}
                </div>
            </li>

            <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full bg-black'>
                <div className='bg-black text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start rounded-l-[8px]'>
                Mode
                </div>
                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px] rounded-[8px] bg-black'>
                    <PuppyDropdown
                        options= {
                            [
                                INTO_DICT_TYPE,
                                INTO_LIST_TYPE,
                                JSON_TYPE,
                                BY_LEN_TYPE,
                                BY_CHAR_TYPE
                            ]
                        }
                        onSelect= {(option:string)=>{
                            setExecMode(option)
                        }}
                        selectedValue={execMode}
                        listWidth={"200px"}
                    >
                    </PuppyDropdown>
                </div>
            
             </li>

             {
                execMode===INTO_DICT_TYPE && (
                    <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[8px] w-full h-[36px]'>
                        <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                        key
                        </div>
                        <input value={wrapInto} onChange={(e) => {
                            setWrapInto(
                                e.target.value
                            )
                        }} id="wrap_into" type='string' className='px-[10px] py-[5px] rounded-[8px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off'></input>
                    </li>
                )
             }

            {
                execMode===BY_CHAR_TYPE && (
                    <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[8px] w-full h-[36px]'>
                        <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                        deliminators
                        </div>
                        <input value={deliminator} onChange={(e) => {
                            setDeliminator(
                                e.target.value
                            )
                        }} id="wrap_into" type='string' className='px-[10px] py-[5px] rounded-[8px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off'></input>
                    </li>
                )
             }

        {
                execMode===BY_LEN_TYPE && (
                    <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[8px] w-full h-[36px]'>
                        <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                        length
                        </div>
                        <input value={bylen} onChange={(e) => {
                            setBylen(
                                parseInt(e.target.value)
                            )
                        }} id="wrap_into" type="number" className='px-[10px] py-[5px] rounded-[8px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off'></input>
                    </li>
                )
             }
        </ul>
    )
}

export default Modify2StructuredConfigMenu
