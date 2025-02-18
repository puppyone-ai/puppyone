'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {NodeJsonType} from '../../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../../../upbar/topLeftToolBar/AddNodeMenu'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
// import PythonConfigEditor from '../tableComponent/PythonConfigEditor'
import isEqual from 'lodash/isEqual'

import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { ChooseConfigNodeData } from '../edgeNodes/ChooseConfig'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { Select } from 'antd'
import useManageReactFlowUtils from '../../../hooks/useManageReactFlowUtils'
import { nanoid } from 'nanoid'


type ChooseConfigProps = {
    show: boolean,
    parentId: string,
}


// export type ChooseEdgeJsonType = {
//     id: string,
//     type: "choose",
//     data: {
//     switch: {id: string, label: string},
//     content: { id: string, label: string },
//     inputs: {id: string, label: string}[],
//     outputs: {id: string, label: string}[],
//     looped: boolean,
//     ON: {id: string, label: string}[],
//     OFF: {id: string, label: string}[]
//   }
// }


interface Condition {
    id: string;
    label: string;
    condition: string;
    type?: string;
    cond_v: string;
    cond_input?: string;
    operation?: string; // Optional, as it may not always be provided
}

interface Action {
    from_id: string;
    from_label: string;
    outputs: string[];
}

interface CaseItem {
    conditions: Condition[];
    actions: Action[];
}

interface TransformedCondition {
    block: string;
    condition: string;
    parameters: { [key: string]: string }; // Key-value pairs for parameters
    operation: string;
}

interface TransformedCase {
    conditions: TransformedCondition[];
    then: {
        from: string;
        to: string;
    };
}

interface TransformedCases {
    [key: string]: TransformedCase; // Dynamic keys for cases
}


export type ChooseEdgeJsonType = {
    type: "choose" | "ifelse",
    data: {
        switch?: { [key: string]: string },
        content?: { [key: string]: string },
        inputs: { [key: string]: string },
        outputs: { [key: string]: string },
        looped?: boolean,
        ON?: { [key: string]: string },
        OFF?: { [key: string]: string },
        cases?: any
    }
}

type ConstructedChooseJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChooseEdgeJsonType }
}


const CustomDropdown = ({ options, onSelect, selectedValue }:any) => {
    const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility

    const handleSelect = (nodeId: string, label: string) => {
        onSelect(nodeId, label);
        setIsOpen(false); // Close dropdown after selection
    };

    // Inline styles
    const dropdownContainerStyle: React.CSSProperties  = {
        position: 'relative',
        cursor: 'pointer',
    };

    const dropdownHeaderStyle = {
        padding: '8px',
        backgroundColor: '#333', // Background color
        color: 'white', // Text color
        border: '1px solid #6D7177', // Border color
        borderRadius: '4px', // Rounded corners
    };

    const dropdownListStyle: React.CSSProperties = {
        position: 'absolute',
        top: '150%',
        left: 0,
        right: 0,
        backgroundColor: 'black', // Background color for dropdown items
        border: '1px solid #6D7177', // Border color
        borderRadius: '4px', // Rounded corners
        zIndex: 1000, // Ensure dropdown is above other elements
        height: 'auto', // Max height for dropdown
        width:'100px',
        overflowY: 'auto', // Scroll if too many items
        overflowX:'hidden',
        color:'white'
    };

    const dropdownItemStyle = {
        padding: '8px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div style={dropdownContainerStyle}>
            <div  className={`overflow-hidden text-[12px] text-nowrap font-[700] ${selectedValue?"text-[#000] ":"text-white"} leading-normal tracking-[0.84px] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] ${selectedValue?"border-[3px]":"border-[0px]"} ${selectedValue?"bg-[#6D7177]":""}`} onClick={() => {
                
                setIsOpen(prev => {
                    console.log("open",prev)
                    return !prev})
                }}>
                {selectedValue || "Select a node"} {/* Display selected label or placeholder */}
            </div>
            {isOpen ? (
                <ul style={dropdownListStyle}>
                    {console.log("options",options)}
                    {options.map((node:any) => (
                        <li
                            key={node.id}
                            style={dropdownItemStyle}
                            onClick={() => handleSelect(node.id, node.label)}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)'} // Set hover color
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} // Reset hover color
                        >
                            {node.label || node.id}
                        </li>
                    ))}
                </ul>
            ):<></>}
        </div>
    );
};

function ChooseConfigMenu({show, parentId}: ChooseConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, getNodes, setNodes, setEdges, getEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, reportError, streamResultForMultipleNodes, resetLoadingUIForMultipleNodes} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount, searchNode} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const {getResultNodes} = useManageReactFlowUtils()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [switchValue, setSwitchValue] = useState<string | null>((getNode(parentId)?.data as ChooseConfigNodeData)?.switch ?? null)
    const [contentValue, setContentValue] = useState<string | null>((getNode(parentId)?.data as ChooseConfigNodeData)?.content ?? null)
    // const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as CodeConfigNodeData)?.resultNode ?? null)
    const [outputs, setOutputs] = useState<string[]>(() => {
        const outputIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.resultNodes 
        return outputIds ? outputIds : []
    })
    const [ON, setON] = useState<string[]>(() => {
        const ONIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.ON
        return ONIds ?? []
    })
    const [OFF, setOFF] = useState<string[]>(() => {
        const OFFIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.OFF
        return OFFIds ?? []
    })
    const switchRef = useRef<HTMLSelectElement>(null)
    const contentRef = useRef<HTMLSelectElement>(null)
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [autogenerated, setAutogenerated] = useState(false)
    const [shouldUpdateONOFF, setShouldUpdateONOFF] = useState(false)
    
    useEffect(() => {
        onSwitchValueChange()
    }, [switchValue])

    useEffect(() => {
        onContentValueChange()
    }, [contentValue])

    useEffect(() => {
        if (shouldUpdateONOFF) {
            setON(prevOn => prevOn.filter(node => outputs.includes(node)))
            setOFF(prevOff => prevOff.filter(node => outputs.includes(node)))
            setShouldUpdateONOFF(false)
        }
    }, [shouldUpdateONOFF])


    // useEffect(() => {
    //     if (autogenerated) return
    //     const newOutputs = getResultNodes(parentId)
    //     if (isEqual(outputs, newOutputs)) return
    //     setOutputs(newOutputs)
    //     onResultNodesChange(newOutputs)
    //     // console.log(ON.filter(node => newOutputs.includes(node)))
    //     setShouldUpdateONOFF(true)
       
    // }, [isEqual(outputs, getResultNodes(parentId))])
    useEffect(() => {
        if (autogenerated) return
        const newOutputs = getResultNodes(parentId)
        if (isEqual(outputs, newOutputs)) return
        if(outputs.length ===5)return
        if(outputs.length < getResultNodes(parentId).length) return
        setOutputs(Array.from(new Set(newOutputs)))
        console.log("add resultnodes", newOutputs)
        onResultNodesChange(newOutputs)
        // console.log(ON.filter(node => newOutputs.includes(node)))
        setShouldUpdateONOFF(true)
       
    }, [isEqual(outputs, getResultNodes(parentId))])

    useEffect(() => {
        onONValueChange()
    }, [ON])

    useEffect(() => {
        onOFFValueChange()
    }, [OFF])

    // useEffect(() => {
    //     console.log(ON, "ON")
    //     console.log(OFF, "OFF")
    // }, [outputs])


    // useEffect(() => {
    //     setON(prevOn => prevOn.filter(node => outputs.includes(node)))
    //     setOFF(prevOff => prevOff.filter(node => outputs.includes(node)))
    // }, [outputs])
    //TODO
    const addNewNodesEdgesIntoFlow = async () => {
        const parentEdgeNode = getNode(parentId)
        if (!parentEdgeNode) return
        // calculate rightside two ResultNodes x and y
        const centerY = parentEdgeNode.position.y - 96;
        const spacing = 288;
        const totalHeight = spacing * (outputs.length - 1)
        const startY = centerY - totalHeight / 2

        console.log("add nodes and edges to output",outputs)

        // 准备所有新节点
        const newNodes = outputs.map((output, index) => {
                
            const currentnode = getNode(output)
            console.log("add currentnode to output",currentnode)
            
            if(!currentnode){
                return ({
                    id: output,
                    position: {
                        x: parentEdgeNode.position.x + 160,
                        y: startY + spacing * index
                    },
                    data: {  
                        content: "", 
                        label: output,
                        isLoading: false,
                        locked: false,
                        isInput: false,
                        isOutput: false,
                        editable: false,
                    },
                    type: 'text',
                })
            } else{
                return currentnode
            }
        }
              
    )

        console.log("newnodes",newNodes)

        // 准备所有新边
        const newEdges = outputs.map((output, index) => ({
            id: `connection-${Date.now() + index}`,
            source: parentId,
            target: output,
            // type: "CTT",
            type: "floating",
            data: {
                connectionType: "CTT",
            },
            markerEnd: markerEnd,
        }));

        console.log("newedges",newEdges)
        await Promise.all([
            new Promise(resolve => {
                setNodes(prevNodes => {
                    resolve(null);
                    return [...prevNodes, ...newNodes];
                })
            }),
            new Promise(resolve => {
                setEdges(prevEdges => {
                    resolve(null);
                    return [...prevEdges, ...newEdges];
                })
            }),
        ]);
        
        console.log("updated",getNode(parentId))

        onResultNodesChange(outputs)
        setIsAddFlow(true)
    };

    useEffect(() => {

        if (!outputs.length) return
        if (isComplete) return
        console.log("send data useeffect")
    

        const sendData = async  () => {
            console.log("senddata")
            try {
                const jsonData = constructJsonData()
                                // Type guarding to check if jsonData is an Error
                if (jsonData instanceof Error) {
                    throw new Error(jsonData.message); // Handle the error appropriately
                }

                console.log("jsondata",jsonData.edges)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method:'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(jsonData)
                })

                if (!response.ok) {
                    for (let output of outputs) {
                        reportError(output, `HTTP Error: ${response.status}`)
                    }
                }
                
                console.log(response)
                const result = await response.json();  // 解析响应的 JSON 数据
                console.log('Success:', result);
                console.log(outputs, "your result node")
                await streamResultForMultipleNodes(result.task_id, outputs);
                
                } catch (error) {
                    console.warn(error)
                    window.alert(error)
                } finally {
                    resetLoadingUIForMultipleNodes(outputs)
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
            console.log("addNewNodesEdgesIntoFlow")
           addNewNodesEdgesIntoFlow()

        }
        else if (isAddFlow && !isComplete) {
            setAutogenerated(false)
            sendData()
        }
      }, [outputs, isAddFlow, isComplete])

      
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

    const displaySwitchLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        const switchNodes = sourceNodeIdWithLabelGroup.filter(node => getNode(node.id)?.type === "switch")
        if (switchNodes.length > 0 && !switchValue) {
            setSwitchValue(switchNodes[0].id)
        }
        else if (switchNodes.length > 0 && switchValue) {
            if (!switchNodes.map(node => node.id).includes(switchValue)) {
                setSwitchValue(switchNodes[0].id)
            }
        }
        else if (switchNodes.length === 0 && switchValue) {
            setSwitchValue(null)
        }
        return switchNodes.map((node: {id: string, label: string}) => (
            <option key={`switch.${node.id}-${Date.now()}`} value={node.id}>
                {node.label}
            </option>
        ))
    }

    //to check if sourcenode is sturctured text
    const displayContentLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        console.log(getNode(sourceNodeIdWithLabelGroup[0].id))
        const contentNodes = sourceNodeIdWithLabelGroup.filter(node => getNode(node.id)?.type === "text")
        if (contentNodes.length > 0 && !contentValue) {
            setContentValue(contentNodes[0].id)
        }
        else if (contentNodes.length > 0 && contentValue) {
            if (!contentNodes.map(node => node.id).includes(contentValue)) {
                setContentValue(contentNodes[0].id)
            }
        }
        else if (contentNodes.length === 0 && contentValue) {
            setContentValue(null)
        }
        return contentNodes.map((node: {id: string, label: string}) => (
            <option key={`content.${node.id}-${Date.now()}`} value={node.id}>
                {node.label}
            </option>
        ))
    }

    const displayOutputNodeLabels = () => {
        if (outputs.length === 0) return [].map((node: string) => (
            <span key={`${node}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{getNode(node)?.data?.label as string ?? node}</span>
        ))

        return outputs.map((node: string) => (
            <span key={`${node}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{getNode(node)?.data?.label as string ?? node}</span>
        ))
    }

    // const displayONLabels = () => {
    //     return outputs.map((node: string) => (
    //         <option key={`ON.${node}-${Date.now()}`} value={node}>
    //             {getNode(node)?.data?.label as string ?? node}
    //         </option>
    //     ))
    // }

    // const displayOFFLabels = () => {
    //     return outputs.map((node: string) => (
    //         <option key={`OFF.${node}-${Date.now()}`} value={node}>
    //             {getNode(node)?.data?.label as string ?? node}
    //         </option>
    //     ))
    // }

    // const transformCondV = () => {
        // // for text
        //     "is_empty"
        //     "is_not_empty"
        //     "contain"
        //     "not_contain"
        //     "greater_than_n_chars"
        //     "less_than_n_chars"
        //     "is"
        //     "is_not"
        //     // for structured 1text
        //     "is_empty"
        //     "is_not_empty"
        //     "is_list"
        //     "is_dict"
        //     "greater_than_n"
        //     "less_than_n"
        // {"contains":"contain", "doesn’t contain":"not_contain", "is greater than [N] characters":"greater_than_n_chars", "is less than [N] characters":"less_than_n_chars"}
        // {"is empty":"is_empty", "is not empty":"is_not_empty", "contains":"contain", "doesn’t contain":"not_contain", "is greater than [N] characters":"greater_than_n_chars", "is less than [N] characters":"less_than_n_chars", "is list":"is_list", "is dict":"is_dict"}
        // {"is True":"is","is False":"is_not"}
    // }

    const conditionMappings: { [key: string]: string } = {
        "contains": "contain",
        "doesn’t contain": "not_contain",
        "is greater than [N] characters": "greater_than_n_chars",
        "is less than [N] characters": "less_than_n_chars",
        "is empty": "is_empty",
        "is not empty": "is_not_empty",
        "is list": "is_list",
        "is dict": "is_dict",
        "is True": "is",
        "is False": "is_not"
    };
    
    const getConditionValue = (key: string): string | any => {
        return conditionMappings[key];
    };

    const transformCases = (inputCases: CaseItem[]): { cases: TransformedCases } => {
        const transformedCases: TransformedCases = {};
    
        inputCases.forEach((caseItem, index) => {
            const caseKey = `case${index + 1}`; // Create case keys like "case1", "case2", etc.
            transformedCases[caseKey] = {
                conditions: caseItem.conditions.map(condition => ({
                    block: condition.id, // Assuming 'id' is the block identifier
                    condition: getConditionValue(condition.cond_v),
                    parameters: { 
                        [getConditionValue(condition.cond_v)]: condition.cond_input || "" // Ensure this is a string
                    },
                    operation: condition.operation || "and" // Default to "and" if not provided
                })),
                then: {
                    from: caseItem.actions[0]?.from_id || "", // Get the from_id from actions
                    to: caseItem.actions[0]?.outputs[0] || "" // Get the first output
                }
            };
        });
    
        return { cases: transformedCases };
    };

    const constructJsonData = (): ConstructedChooseJsonData | Error => {
        console.log("constructjsondata","structuredValue")
        
        const contentNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "text")
        const switchNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "switch")
        const structuredNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "structured")
        
        const AllowedSourceNodes = [...contentNodes,...switchNodes,...structuredNodes]
        
        if (AllowedSourceNodes.length<=0 ) return new Error("switch or text or structured text is not selected as source");

        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        let blocks: { [key: string]: NodeJsonType } = {};

        for (let output of outputs) {
            let resultNodeLabel;
            if (getNode(output) && getNode(output)?.data?.label !== undefined) {
                resultNodeLabel = getNode(output)?.data?.label as string;
            } else {
                resultNodeLabel = output;
            }

            const nodejson: any = getNode(output)?getNode(output):{
                label: resultNodeLabel,
                type: "text",
                data: { content: "" }
            };
            blocks[output] = nodejson;
        }

        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id);
            console.log("nodeinfo",getNode(sourceNodeIdWithLabel.id))
            if (!nodeInfo) continue;
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any, nodeInfo.type) : nodeInfo.data.content as string;
            if (nodeContent === "error") return new Error("JSON Parsing Error, please check JSON format");
            const nodejson: NodeJsonType = {
                label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                },
                looped: (nodeInfo as any).looped ? (nodeInfo as any).looped : false
            };
            blocks[nodeInfo.id] = nodejson;
        }

        let edges: { [key: string]: ChooseEdgeJsonType } = {};

        // [
        //     {
        //       "conditions": [
        //         {
        //           "id": "R7QmgN",
        //           "label": "R7QmgN",
        //           "condition": "",
        //           "type": "text",
        //           "cond_v": "contains",
        //           "cond_input": "dsa"
        //         }
        //       ],
        //       "actions": [
        //         {
        //           "from_id": "R7QmgN",
        //           "from_label": "R7QmgN",
        //           "outputs": [
        //             "7VrC5i"
        //           ]
        //         }
        //       ]
        //     },
        // case2
        //     {
        //       "conditions": [
        //         {
        //           "id": "R7QmgN", //block
        //           "label": "R7QmgN", 
        //           "condition": "", //condition
        //           "type": "text", 
        //           "cond_v": "contains",  // "parameters": {cond_v + " " + cond_input}
        //           "cond_input": "dsa" // "parameters": {cond_v + " " + cond_input}
        //           "operation": "and" // "operation"
        //         }
        //       ],
        //       "actions": [
        //         {
        //           "from_id": "R7QmgN", // then from
        //           "from_label": "R7QmgN",
        //           "outputs": [
        //             "7VrC5i"  //then to
        //           ]
        //         }
        //       ]
        //     }
        //   ]

        // "cases": {
        //     "case1": {
        //       "conditions": [
        //         {
        //           "block": "no1",
        //           "condition": "is_empty",
        //           "parameters": {},
        //           "operation": "and"
        //         },
        //         {
        //           "block": "no2",
        //           "condition": "is_empty",
        //           "parameters": {},
        //           "operation": "or"
        //         }
        //       ],
        //       "then": {
        //         "from": "",
        //         "to": ""
        //       }
        //     }

        console.log("cases raw",JSON.stringify(cases))

        const casesdata =  transformCases(cases)

        // Constructing the new structure for IFELSE
        const edgejson: ChooseEdgeJsonType = {
            type: "ifelse",
            data: {
                ...transformCases(cases),
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string }) => {
                    const currentNode = getNode(node.id)
                    const content = currentNode?.data.content;
                    const nodeType= currentNode?.type
                    console.log("node used for constructuring new request body",getNode(node.id))
                    const nodeLabel = currentNode?.data.label

                    return [node.id, ((typeof nodeLabel === "string") && (nodeLabel !== "") ) ? nodeLabel : ""];

                })),
                outputs: Object.fromEntries(outputs.map((node: string) => {
                    let label = getNode(node)?.data.label;

                    return ([node, typeof label === "string" ? label: ""])
                })) // Adjust outputs as needed
            }
        };

        const ifelseid = parentId.replace(/choose/g, 'IFELSE');

        edges[ifelseid] = edgejson;

        return {
            blocks,
            edges
        };
    }


//     "IFELSE-124782085": {
//   "type": "ifelse",
//   "data": {
//     "cases": { 
// 	    "case1": {
// 		    "conditions": [
// 			    {"block": "no1", // block id
// 			    "condition": "is_empty",
// 			    "parameters": {}, // for conditions with params, e.g. contains xxx
// 			    "operation": "and"}, // can only be `and` or `or` or `/` for last condition
// 			    {"block": "no2",  // block id
// 			    "condition": "is_empty",
// 			    "parameters": {}, // for conditions with params, e.g. contains xxx
// 			    "operation": "or"}  // can only be `and` or `or` or `/` for last condition
// 		    ],
// 		    "then": {
// 			    "from":"",
// 			    "to":""
// 		    }
// 	    } 
//     },
//     "inputs": { "1": "", "2": "" },
//     "outputs": { "3": "", "4": "" }
//   }
// }

    
    const onDataSubmit = async () => {
          // click 第一步： clearActivation
          await new Promise(resolve => {
            clearAll()
            resolve(null)
        });

        console.log(outputs)

        // click 第二步： 如果 resultNode 不存在，则创建一个新的 resultNode
        if (!outputs.length){

            const newResultNodeOneId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setAutogenerated(true)
            setOutputs(Array.from(new Set([newResultNodeOneId])))
            console.log(outputs)
            
            // setIsAddContext(false)
            setIsAddFlow(false)
        }
       
        // else if (outputs.length > 0 && outputs.map(output => getNode(output)).includes(undefined)) {
        //     const definedNodes = outputs.filter(output => getNode(output))
        //     if (definedNodes.length >= 2) {
        //         onResultNodesChange(definedNodes)
        //         setOutputs(definedNodes)
        //         allowActivateNode()
        //         clear()
        //         setIsAddContext(true)
        //         setIsAddFlow(true)
        //     }
        // }
         // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            // setNodes(prevNodes => prevNodes.map(node => {
            //     if (node.id === resultNode){
            //         return {...node, data: {...node.data, content: ""}}
            //     }
            //     return node
            // }))
            // onResultNodesChange(currentResultNodes)

            if (switchValue) {
                const switchNode = getNode(switchValue)
                const nodesWaitingForUpdate = switchNode?.data?.content as string === "ON" ? ON : OFF

                setNodes(prevNodes => prevNodes.map(node => {
                    if (nodesWaitingForUpdate.length > 0 && nodesWaitingForUpdate.includes(node.id)) {
                        return {...node, data: {...node.data, isLoading: true}}
                    }
                    return node
                }))
            }
            
            // setIsAddContext(true)
            // setIsAddFlow(true)
            // allowActivateNode()
            // clear()
        }
        setIsComplete(false)
        };

        // const onLoopChange = (newLoop: boolean) => {
        //     setNodes(prevNodes => prevNodes.map(node => {
        //         if (node.id === parentId) {
        //             return {...node, data: {...node.data, looped: newLoop}}
        //         }
        //         return node
        //     }))
        // }

    
        const onResultNodesChange = (newResultNodes: string[]) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, resultNodes: newResultNodes}}
                }
                return node
            }))
        }

        const onSwitchValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, switch: switchValue}}
                }
                return node
            }))
        }

        const onContentValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, content: contentValue}}
                }
                return node
            }))
        }


        const onONValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, ON: ON}}
                }
                return node
            }))
        }

        const onOFFValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, OFF: OFF}}
                }
                return node
            }))
        }

        interface Condition {
            id: string;
            label: string;
            condition: string;
            type?: string;
            cond_v: string;
            cond_input?: string;
            operation: string;
        }
    
        interface Action {
            from_id: string;
            from_label:string;
            outputs:string[]
        }
    
        interface Case {
            conditions: Condition[];
            actions: Action[];
        }
    
        // TODO 3
        const [cases, setCases] = useState<Case[]>(getNode(parentId)?.data.cases as Case[] || []);
    

        useEffect(() => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return { ...node, data: { ...node.data, cases } }; // Update the cases in the node's data
                }
                return node;
            }));
            
            setTimeout(() => {
                console.log(getNode(parentId))
            }, 2000) // Log after 2 seconds
        }, [cases]); // Dependency array includes cases
    

        const [AND,OR] = ["and","or"]

        const onConditionAdd = (index: number) => () => {
            console.log("hello", index)
            setCases(prevCases => {
                console.log(prevCases)
                return prevCases.map((caseItem, caseIndex) => {
                    if (caseIndex === index) {
                        return {
                            ...caseItem,
                            conditions: [
                                ...caseItem.conditions,
                                {
                                    id: "",
                                    label: "",
                                    condition: `condition${caseItem.conditions.length + 1}`,
                                    cond_v:'condition',
                                    operation:AND
                                }
                            ]
                        }
                    }
                    return caseItem
                })
            })
        }
    
        const onActionAdd = (index: number) => () => {
            console.log("hello", index)
            setCases(prevCases => {
                return prevCases.map((caseItem, caseIndex) => {
                    if (caseIndex === index) {
                        return {
                            ...caseItem,
                            actions: [
                                ...caseItem.actions,
                                {
                                    from_id: '',
                                    from_label: '',
                                    outputs: []
                                }
                            ]
                        }
                    }
                    return caseItem
                })
            })
        }

    
        const onCaseAdd = () => {
            console.log("outputs", outputs)
            setCases(prevCases => [
                ...prevCases,
                {
                    conditions: [
                        {
                            id: '',
                            label: '',
                            condition: '',
                            cond_v:'condition',
                            cond_input:"",
                            operation:AND
                        }
                    ],
                    actions: [
                        {
                            from_id: '',
                            from_label: '',
                            outputs: []
                        }
                    ]
                }
            ])
        }

        const getConditionSelections = (type:string) =>{
            console.log("GetConditionSelections",type)
            if(type === "text"){
                console.log("text")
                // contains XXX
                // doesn’t contain XXX
                // is greater than [N] characters
                // is less than [N] characters
                return ["contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters"]
            }else if(type === "structured"){
            // is empty
            // is not empty
            // contains XXX
            // doesn’t contain XXX
            // is List
            // is Dict
            // length is greater than [N]
            // length is less than [N]
                return ["is empty", "is not empty", "contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters", "is list","is dict"]
            }else if(type === "switch"){
                // (for Switch)
                // is True
                // is False
                return ["is True","is False"]
            }

            return []
        }

        const onConditionDelete = (caseIndex: number, conditionIndex: number) => () => {
            setCases(prevCases => {
                return prevCases[caseIndex].conditions.length>1? prevCases.map((caseItem, index) => {
                    if (index === caseIndex) {
                        return {
                            ...caseItem,
                            conditions: caseItem.conditions.filter((_, condIndex) => condIndex !== conditionIndex)
                        };
                    }
                    return caseItem;
                }): prevCases
            });
        };

        const onAndOrSwitch = (caseIndex: number, conditionIndex: number) => () => {
            setCases(prevCases => {
                return prevCases.map((caseItem, index) => {
                    if (index === caseIndex) {
                        return {
                            ...caseItem,
                            conditions: caseItem.conditions.map((condition, condIndex) => {
                                if (condIndex === conditionIndex) {
                                    return {
                                        ...condition,
                                        operation: condition.operation === AND ? OR : AND // Toggle operation
                                    };
                                }
                                return condition;
                            })
                        };
                    }
                    return caseItem;
                });
            });
        };


        useEffect(
            ()=>{
                console.log("outputs effect",outputs)
                if(autogenerated){
                    setIsAddFlow(false)
                    setAutogenerated(false)
                    addNewNodesEdgesIntoFlow()
                }
            },
            [outputs]
        )


        const lastNodesRef = useRef<any>();
        
        function array1HasExtraElements(array1: any[], array2: any[]): boolean {
            // Convert arrays to sets
            const set1 = new Set(array1);
            const set2 = new Set(array2);
        
            // Check if any element in set1 is not in set2
            for (const item of set1) {
                if (!set2.has(item)) {
                    return true; // array1 has an element that array2 doesn't have
                }
            }
        
            return false; // All elements in array1 are present in array2
        }
        
      
        useEffect(() => {
          const currentNodes = getEdges().filter(
            edge=>edge.source==parentId
          ).map(
            edge=>edge.target
          )
          console.log("currentnode effect",currentNodes)
          console.log("currentnode effect lastnodes",lastNodesRef.current)
          

        console.log(lastNodesRef.current,currentNodes)
            if(array1HasExtraElements(currentNodes,lastNodesRef.current)){
                console.log("new edge effect",outputs)
                setOutputs(
                    Array.from(new Set(currentNodes))
                )
            }

            if(array1HasExtraElements(lastNodesRef.current,currentNodes)){
                console.log("new edge effect",outputs)
                setOutputs(
                    Array.from(new Set(currentNodes))
                )
            }

          lastNodesRef.current = Array.from(new Set(currentNodes)); // Save the current nodes to the ref
          // You can also perform other side effects here if needed
        }, [getEdges()]); // Dependency array includes getNodes

        // useEffect(
        //     ()=>{
        //         const ids = getNodes().map((item: { id: string })=>item.id)
            
        //         // setOutputs(prev => prev.filter(
        //         //         output=>!ids.includes(output)
        //         //     )
        //         // )
        //     },
        //     [getNodes()]
        // )

        // const comapreAndDelete = (nodes:any)=>{
        //     const ids = nodes.map((item: { id: string })=>item.id)
        
        //     setOutputs(prev => prev.filter(
        //             output=>!ids.includes(output)
        //         )
        //     )

        //     return outputs
        // }
  
    
        return (

            <ul ref={menuRef} className={`w-[535px] absolute top-[58px] left-[0px] text-white rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[8px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
                {/* {
                    comapreAndDelete(getNodes()).map(output =><div>${output}</div>
                    )
                } */}
                <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                            <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                            <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                            <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[12px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                        If/Else
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
                <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[510px]'>
                    <div className='text-[#6D7177] w-[62px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] flex items-center justify-start'>
                     input
                    </div>
                    <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]  border-l-[1px] border-[#6D7177]'>
                        {displaySourceNodeLabels()}
                    </div>
                    
                </li>
                <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[510px]'>
                    <div className='text-[#6D7177] w-[62px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] flex items-center justify-start'>
                     output
                    </div>
                    <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]  border-l-[1px] border-[#6D7177]'>
                        {displayOutputNodeLabels()} 
                        <svg onClick={
                            async()=>{
                                // click 第二步： 如果 resultNode 不存在，则创建一个新的 resultNode
                                const newResultNodeOneId = nanoid(6)
                                // onResultNodeChange(newResultNodeId)
                                setAutogenerated(true)
                                setOutputs(prev => Array.from(new Set([...prev, newResultNodeOneId])))
                            }
                        } className='cursor-pointer' width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" stroke-width="1.5"/>
                            <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                            <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                        </svg>
                    </div>
                </li>
                {
                    cases.map((case_value,case_index)=>(
                        <li key={case_index} className='flex flex-col gap-0 items-start justify-center font-plus-jakarta-sans'>
                            <div className='flex h-[25px] gap-[4px] text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
                            Case {case_index+1}
                            <svg 
                                onClick={() => {
                                    setCases(prevCases => {
                                        return prevCases.length > 1 
                                            ? prevCases.filter((_, index) => index !== case_index) 
                                            : prevCases; // Prevent removing the last case
                                    });
                                }} 
                                className={`cursor-pointer flex-inline ${cases.length <= 1 ? 'invisible' : ''}`} 
                                width="20" 
                                height="20" 
                                viewBox="0 0 20 20" 
                                fill="none" 
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" strokeWidth="1.5"/>
                                <path d="M6 10L14 10" stroke="#6D7177" strokeWidth="2"/>
                            </svg>
                            </div>

                            <div className='border-[#6D7177] border-[1px] rounded-[8px]'>
                                
                                <div className='flex flex-col border-[#6D7177] border-b-[1px] w-[510px] p-3'>
                                    <label className='text-[12px]'>IF</label>
                                    {
                                        case_value.conditions.map(
                                            (condition_value,conditions_index)=>(
                                                <>
                                                <span className='h-[16px]'>   </span>
                                                    <div className='inline-flex space-x-[12px] items-center justify-start'>
                                                    <svg onClick={onConditionDelete(case_index, conditions_index)} className={`cursor-pointer ${case_value.conditions.length <= 1 ? 'invisible' : ''}`}  width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" strokeWidth="1.5"/>
                                                        <path d="M6 10L14 10" stroke="#6D7177" strokeWidth="2"/>
                                                    </svg>
                                                    <ul key={conditions_index} className='flex-col border-[#6D7177] rounded-[4px] w-[400px] bg-black'>
                                                        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] min-w-[280px]'>
                                                            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>

                                                            <CustomDropdown
                                                            options={getSourceNodeIdWithLabel(parentId)}
                                                                    onSelect={(nodeId:any, label:any) => {
                                                                        const cases_clone = [...cases];
                                                                        cases_clone[case_index].conditions[conditions_index] = {
                                                                            ...cases_clone[case_index].conditions[conditions_index],
                                                                            id: nodeId,
                                                                            label: label,
                                                                            type: getNode(nodeId)?.type
                                                                        };
                                                                        setCases(cases_clone);
                                                                        console.log("selected node:", getNode(nodeId));
                                                                  }}
                                                                    selectedValue={condition_value.id} // Assuming condition_value has a label property
                                                                />
                                                            </div>
                                                            <div className='text-[#6D7177] w-[190px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-l-[1px] border-[#6D7177] flex items-center justify-start'>
                                                            {
                                                                getNode(cases[case_index].conditions[conditions_index].id)?.type === "structured" && (
                                                                    <select 
                                                                        className='w-full bg-black text-white font-plus-jakarta-sans text-[12px] border-none outline-none w-[150px]'
                                                                        onChange={(e) => {
                                                    
                                                                            if (e.target.value) {
                                                                                const cases_clone = [...cases];
                                                                                cases_clone[case_index].conditions[conditions_index] = {
                                                                                    ...cases_clone[case_index].conditions[conditions_index],
                                                                                    cond_v: e.target.value
                                                                                };
                                                                                setCases(cases_clone);
                                                                                console.log("cond_v",cases)
                                                                            }
                                                                        }}
                                                                        value={cases[case_index].conditions[conditions_index].cond_v}
                                                                    >
                                                                        <option value=""> condition </option>
                                                                        {   
                                                                            getConditionSelections("structured").map((sl_v,sl_id) => (
                                                                                <option key={sl_id} value={sl_v}>
                                                                                    {sl_v}
                                                                                </option>
                                                                            ))
                                                                        }
                                                                    </select>
                                                                )
                                                                }
                                                                {               
                                                                getNode(cases[case_index].conditions[conditions_index].id)?.type === "text" && (
                                                                    <select 
                                                                        className='w-full bg-black text-white font-plus-jakarta-sans text-[12px] w-[150px] border-none outline-none'
                                                                        onChange={(e) => {
                                                    
                                                                            if (e.target.value) {
                                                                                const cases_clone = [...cases];
                                                                                cases_clone[case_index].conditions[conditions_index] = {
                                                                                    ...cases_clone[case_index].conditions[conditions_index],
                                                                                    cond_v: e.target.value
                                                                                };
                                                                                setCases(cases_clone);
                                                                                console.log("cond_v",cases)
                                                                            }
                                                                        }}
                                                                        value={cases[case_index].conditions[conditions_index].cond_v}
                                                                    >
                                                                        <option value="">condition</option>
                                                                        {   
                                                                            getConditionSelections("text").map((sl_v,sl_id) => (
                                                                                <option key={sl_id} value={sl_v}>
                                                                                    {sl_v}
                                                                                </option>
                                                                            ))
                                                                        }
                                                                    </select>
                                                                )}
                                                                {
                                                                getNode(cases[case_index].conditions[conditions_index].id)?.type === "switch" && (
                                                                    <select 
                                                                    className='w-full bg-black text-white font-plus-jakarta-sans text-[12px] border-none outline-none'
                                                                    onChange={(e) => {
                                                
                                                                        if (e.target.value) {
                                                                            const cases_clone = [...cases];
                                                                            cases_clone[case_index].conditions[conditions_index] = {
                                                                                ...cases_clone[case_index].conditions[conditions_index],
                                                                                cond_v: e.target.value
                                                                            };
                                                                            setCases(cases_clone);
                                                                            console.log("cond_v",cases)
                                                                        }
                                                                    }}
                                                                    value={cases[case_index].conditions[conditions_index].cond_v}
                                                                >
                                                                        <option value="">condition</option>
                                                                        {   
                                                                            getConditionSelections("switch").map((sl_v,sl_id) => (
                                                                                <option key={sl_id} value={sl_v}>
                                                                                    {sl_v}
                                                                                </option>
                                                                            ))
                                                                        }
                                                                    </select>
                                                                )
                                                            }
                                                            </div>
                
                
                                                                {/* ["contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters"]

                                                                return ["is empty", "is not empty", "contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters", "is list","is dict"]

                                                                return ["is True","is False"] */}
                                            
                                                            {
                                                                ["is True","is False","is not empty","is list","is dict","is empty", "condition"].includes((getNode(parentId)?.data.cases as Case[])[case_index]?.conditions[conditions_index]?.cond_v)===true ?<></>:(
                                                                    <input 
                                                                    value={cases[case_index].conditions[conditions_index].cond_input?cases[case_index].conditions[conditions_index].cond_input:""}
                                                                    onChange={(e)=>{
                                                                        const cases_clone = [...cases];
                                                                        cases_clone[case_index].conditions[conditions_index] = {
                                                                            ...cases_clone[case_index].conditions[conditions_index],
                                                                            cond_input: e.target.value
                                                                        };
                                                                        setCases(cases_clone); 
                                                                        console.log("cond_v",cases)
                                                                    }} 
                                                                    className="w-[100px] text-white bg-black caret-white"
                                                                    type="text"></input>
                                                                )
                                                            }

                                                            
                                                        </li>
                                                    </ul>
                                                    {case_value.conditions.length - 1 === conditions_index ? (
                                                        <>
                                                        <span> </span>
                                                        <svg onClick={onConditionAdd(case_index)} className='cursor-pointer' width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                            <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" stroke-width="1.5"/>
                                                            <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                                            <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                                                        </svg>
                                                        </>
                                                    ) : (
                                                        <>
                                                        <button onClick={onAndOrSwitch(case_index, conditions_index)} className='cursor-pointer rounded-[15px] mt-0 ml-0 text-[#6D7177] pl-3 pr-3 font-plus-jakarta-sans text-[20px] font-[700] border-[0px] border-[#6D7177] items-center'>
                                                            <div className='w-[22px] text-[10px] flex-col justify-center items-center'>
                                                                {case_value.conditions[conditions_index].operation.toUpperCase()}
                                                                <div className='w-[22px] text-[10px] flex justify-center items-center'>
                                                                <svg width="12" height="5" viewBox="0 0 12 5" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                    <path d="M12 3.75L2 3.75L5 0.75" stroke="#63676C" strokeWidth="1.5"/>
                                                                </svg>
                                                                </div>
                                                                <div className='w-[22px] text-[10px] flex justify-center items-center'>
                                                                <svg width="12" height="5" viewBox="0 0 12 5" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                <path d="M0 0.75H10L7 3.75" stroke="#63676C" strokeWidth="1.5"/>
                                                                </svg>
                                                                </div>
                                                            </div>
                                                        </button>
                                                        </>
                                                    )}
                                                    </div>
                                                </>
                                            )
                                        )
                                    }

                                </div>
            
                                <div className='flex flex-col border-[#6D7177] p-3 w-[510px] justify-start'>
                                    <label className='text-[12px]'>THEN</label>
                                    {
                                        case_value.actions.map(
                                            (action_value, action_index) => (
                                                <>                                
                                                    <span className='h-[16px]'></span>
                                                    <div className='inline-flex space-x-[12px] justify-start items-center'>
                                                    <svg 
                                                        onClick={() => {
                                                            const cases_clone = [...cases];
                                                            if(cases_clone[case_index].actions.length >1){
                                                                cases_clone[case_index].actions.splice(action_index, 1); // Remove the action
                                                                setCases(cases_clone);
                                                            }
                                                        }} 
                                                        className={`cursor-pointer ${case_value.actions.length <= 1 ? 'invisible' : ''}`} 
                                                        width="20" 
                                                        height="20" 
                                                        viewBox="0 0 20 20" 
                                                        fill="none" 
                                                        xmlns="http://www.w3.org/2000/svg"
                                                    >
                                                        <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" strokeWidth="1.5"/>
                                                        <path d="M6 10L14 10" stroke="#6D7177" strokeWidth="2"/>
                                                    </svg>
                                                        <ul className='flex flex-col border-[#6D7177] rounded-[4px] bg-black w-[400px]'>
                                                            <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] min-w-[280px]'>
                                                                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                                                                    <CustomDropdown
                                                                    options={getSourceNodeIdWithLabel(parentId)}
                                                                            onSelect={(nodeId:any, label:any) => {
                                                                                const cases_clone = [...cases];
                                                                                cases_clone[case_index].actions[action_index]  = {
                                                                                    ...cases_clone[case_index].actions[action_index],
                                                                                    from_id: nodeId,
                                                                                    from_label: label,

                                                                                };
                                                                                setCases(cases_clone);
                                                                                console.log("selected node:", getNode(nodeId));
                                                                            }}
                                                                            selectedValue={action_value.from_id}
                                                                        />

                                                                </div>
                                                                <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-l-[1px] border-[#6D7177] flex items-center justify-start'>
                                                                    TO
                                                                </div>
                                                                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                                                                <CustomDropdown
                                                                    options={outputs.map(
                                                                        (id)=>{
                                                                            return{
                                                                                id:id,
                                                                                label:id
                                                                            }
                                                                        }
                                                                    )}
                                                                            onSelect={(nodeId:any, label:any) => {
                                                                                const cases_clone = [...cases];
                                                                                cases_clone[case_index].actions[action_index].outputs = [nodeId || label];

                                                                                setCases(cases_clone);
                                                                                console.log("selected node:", getNode(nodeId));
                                                                            }}
                                                                            selectedValue={action_value.outputs[0]}
                                                                        />

                                                                </div>
                                                            </li>
                                                        </ul>
                                                        <>
                                                        <span> </span>
                                                        <svg onClick={onActionAdd(case_index)} className='cursor-pointer' width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                            <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" stroke-width="1.5"/>
                                                            <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                                            <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                                                        </svg>
                                                        </>
                                                    </div>
                                                </>
                                            )
                                        )
                                    }
                                    
                                </div>
                            </div>
                        </li>
        
                    )
                    )
                }
                        <div className='flex flex-col gap-0 items-start justify-center '>
                            <button onClick={onCaseAdd} className='flex rounded-[8px] bg-black text-[#6D7177] w-[52px] mt-1 font-plus-jakarta-sans text-[10px] font-[700] border-[1px] border-[#6D7177] items-center'>
                                        <svg className="flex-inline" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                            <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                                        </svg> Case
                            </button>
                        </div>
                
            </ul>
          )        
}

export default ChooseConfigMenu
