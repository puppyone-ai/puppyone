'use client'

import React, { useEffect, useRef, useState, useContext } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import useJsonConstructUtils, { NodeJsonType } from '../../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../../../upbar/topLeftToolBar/AddNodeButton'
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
// 添加 PuppyDropdown 导入
import { PuppyDropdown } from '../../../misc/PuppyDropDown'


type ChooseConfigProps = {
    show: boolean,
    parentId: string,
}


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
    parameters: { [key: string]: string | number }; // Key-value pairs for parameters
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
        // looped?: boolean,
        ON?: { [key: string]: string },
        OFF?: { [key: string]: string },
        cases?: any
    }
}

type ConstructedChooseJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChooseEdgeJsonType }
}


const CustomDropdown = ({ options, onSelect, selectedValue }: any) => {
    const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility

    const handleSelect = (nodeId: string, label: string) => {
        onSelect(nodeId, label);
        setIsOpen(false); // Close dropdown after selection
    };

    // Inline styles
    const dropdownContainerStyle: React.CSSProperties = {
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
        width: '100px',
        overflowY: 'auto', // Scroll if too many items
        overflowX: 'hidden',
        color: 'white'
    };

    const dropdownItemStyle = {
        padding: '8px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div style={dropdownContainerStyle}>
            <div className={`overflow-hidden text-[12px] text-nowrap font-[700] ${selectedValue ? "text-[#000] " : "text-white"} leading-normal tracking-[0.84px] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] ${selectedValue ? "border-[3px]" : "border-[0px]"} ${selectedValue ? "bg-[#6D7177]" : ""}`} onClick={() => {

                setIsOpen(prev => {
                    console.log("open", prev)
                    return !prev
                })
            }}>
                {selectedValue || "Select a node"} {/* Display selected label or placeholder */}
            </div>
            {isOpen ? (
                <ul style={dropdownListStyle}>
                    {console.log("options", options)}
                    {options.map((node: any) => (
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
            ) : <></>}
        </div>
    );
};

function ChooseConfigMenu({ show, parentId }: ChooseConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getNode, getNodes, setNodes, setEdges, getEdges } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, cleanJsonString, reportError, streamResultForMultipleNodes, resetLoadingUIForMultipleNodes } = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount, searchNode} = useNodeContext()
    const { clearAll } = useNodesPerFlowContext()
    const { getResultNodes } = useManageReactFlowUtils()
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

    useEffect(() => {
        if (autogenerated) return
        const newOutputs = getResultNodes(parentId)
        if (isEqual(outputs, newOutputs)) return
        if (outputs.length === 5) return
        if (outputs.length < getResultNodes(parentId).length) return
        setOutputs(Array.from(new Set(newOutputs)))
        console.log("add resultnodes", newOutputs)
        onResultNodesChange(newOutputs)
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

        console.log("add nodes and edges to output", outputs)

        // 准备所有新节点
        const newNodes = outputs.map((output, index) => {

            const currentnode = getNode(output)
            console.log("add currentnode to output", currentnode)

            if (!currentnode) {
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
            } else {
                return currentnode
            }
        }

        )

        console.log("newnodes", newNodes)

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

        console.log("newedges", newEdges)
        await Promise.all([
            new Promise(resolve => {
                setNodes(prevNodes => {
                    resolve(null);
                    return Array.from(new Set([...prevNodes, ...newNodes]));
                })
            }),
            new Promise(resolve => {
                setEdges(prevEdges => {
                    resolve(null);
                    // Sort newEdges by output.id in ascending order
                    const sortedNewEdges = [...prevEdges, ...newEdges].sort((a, b) => a.id.localeCompare(b.id));

                    // Create a Set to track unique source-target combinations
                    const uniqueEdges = new Set<string>();

                    // Filter to keep only the first edge for each unique source-target combination
                    const filteredEdges = sortedNewEdges.filter(edge => {
                        const key = `${edge.source}-${edge.target}`;
                        if (!uniqueEdges.has(key)) {
                            uniqueEdges.add(key);
                            return true; // Keep this edge
                        }
                        return false; // Skip this edge
                    });

                    return [...filteredEdges];
                })
            }),
        ]);

        console.log("updated", getNode(parentId))

        onResultNodesChange(outputs)
        setIsAddFlow(true)
    };

    useEffect(() => {

        if (!outputs.length) return
        if (isComplete) return
        console.log("send data useeffect")


        const sendData = async () => {
            console.log("senddata")
            try {
                const jsonData = constructJsonData()
                // Type guarding to check if jsonData is an Error
                if (jsonData instanceof Error) {
                    throw new Error(jsonData.message); // Handle the error appropriately
                }

                console.log("jsondata", jsonData.edges)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method: 'POST',
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


    // 添加复制功能状态
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    // 修改 displaySourceNodeLabels 函数，使用更新后的状态结构
    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);

        // 不再更新状态，只返回 JSX
        return sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
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
                    <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                ),
                file: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                        <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                ),
                structured: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
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

    const displayTargetNodeLabels = () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId)
        return (
            <>
                {targetNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
                    // Get the node type from the node data
                    const nodeInfo = getNode(node.id)
                    const nodeType = nodeInfo?.type || 'text'

                    // 使用与 displaySourceNodeLabels 相同的样式配置
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

                    // 使用相同的图标
                    const nodeIcons = {
                        text: (
                            <svg width="14" height="14" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                                <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        ),
                        file: (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                                <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                                <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        ),
                        structured: (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                                <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-current" />
                                <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-current" />
                                <path d="M9 9H11V11H9V9Z" className="fill-current" />
                                <path d="M9 13H11V15H9V13Z" className="fill-current" />
                                <path d="M13 9H15V11H13V9Z" className="fill-current" />
                                <path d="M13 13H15V15H13V13Z" className="fill-current" />
                            </svg>
                        )
                    }

                    const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text
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
                })}
                {/* Add new output node button */}
                <button
                    onClick={async () => {
                        const newResultNodeOneId = nanoid(6)
                        setAutogenerated(true)
                        setOutputs(prev => Array.from(new Set([...prev, newResultNodeOneId])))
                    }}
                    className='h-[20px] w-[20px] px-[6px] flex items-center justify-center rounded-[4px] 
                            bg-[#252525] border-[1px] border-[#6D7177]/30
                            text-[#6D7177]
                            hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                            transition-colors'
                >
                    <svg width="10" height="10" viewBox="0 0 14 14">
                        <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                    </svg>
                </button>
            </>
        )
    }

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
    // {"contains":"contain", "doesn't contain":"not_contain", "is greater than [N] characters":"greater_than_n_chars", "is less than [N] characters":"less_than_n_chars"}
    // {"is empty":"is_empty", "is not empty":"is_not_empty", "contains":"contain", "doesn't contain":"not_contain", "is greater than [N] characters":"greater_than_n_chars", "is less than [N] characters":"less_than_n_chars", "is list":"is_list", "is dict":"is_dict"}
    // {"is True":"is","is False":"is_not"}
    // }

    const conditionMappings: { [key: string]: string } = {
        "contains": "contain",
        "doesn't contain": "not_contain",
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
                conditions: caseItem.conditions.map((condition, condition_id) => ({
                    block: condition.id, // Assuming 'id' is the block identifier
                    condition: getConditionValue(condition.cond_v),
                    parameters: {
                        value: !isNaN(parseInt(condition.cond_input ?? "")) ? parseInt(condition.cond_input ?? "") || "" : condition.cond_input || "" // Transform to number if possible || "" // Ensure this is a string
                    },
                    operation: condition_id === caseItem.conditions.length - 1 ? "/" : (condition.operation || "and") // Default to "and" if not provided
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
        console.log("constructjsondata", "structuredValue")

        const contentNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "text")
        const switchNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "switch")
        const structuredNodes = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "structured")

        const AllowedSourceNodes = [...contentNodes, ...switchNodes, ...structuredNodes]

        if (AllowedSourceNodes.length <= 0) return new Error("switch or text or structured text is not selected as source");

        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        let blocks: { [key: string]: NodeJsonType } = {};

        for (let output of outputs) {
            let resultNodeLabel;
            if (getNode(output) && getNode(output)?.data?.label !== undefined) {
                resultNodeLabel = getNode(output)?.data?.label as string;
            } else {
                resultNodeLabel = output;
            }

            const nodeInfo = getNode(output);
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
            blocks[output] = nodejson;
        }

        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id);
            console.log("nodeinfo", getNode(sourceNodeIdWithLabel.id))
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

        console.log("cases raw", JSON.stringify(cases))

        const casesdata = transformCases(cases)

        // Constructing the new structure for IFELSE
        const edgejson: ChooseEdgeJsonType = {
            type: "ifelse",
            data: {
                ...transformCases(cases),
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string }) => {
                    const currentNode = getNode(node.id)
                    const content = currentNode?.data.content;
                    const nodeType = currentNode?.type
                    console.log("node used for constructuring new request body", getNode(node.id))
                    const nodeLabel = currentNode?.data.label

                    return [node.id, ((typeof nodeLabel === "string") && (nodeLabel !== "")) ? nodeLabel : ""];

                })),
                outputs: Object.fromEntries(outputs.map((node: string) => {
                    let label = getNode(node)?.data.label;

                    return ([node, typeof label === "string" ? label : ""])
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
        if (!outputs.length) {

            const newResultNodeOneId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setAutogenerated(true)
            setOutputs(Array.from(new Set([newResultNodeOneId])))
            console.log(outputs)

            // setIsAddContext(false)
            setIsAddFlow(false)
        }

        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {


            if (switchValue) {
                const switchNode = getNode(switchValue)
                const nodesWaitingForUpdate = switchNode?.data?.content as string === "ON" ? ON : OFF

                setNodes(prevNodes => prevNodes.map(node => {
                    if (nodesWaitingForUpdate.length > 0 && nodesWaitingForUpdate.includes(node.id)) {
                        return { ...node, data: { ...node.data, isLoading: true } }
                    }
                    return node
                }))
            }

        }
        setIsComplete(false)
    };

    const onResultNodesChange = (newResultNodes: string[]) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNodes: newResultNodes } }
            }
            return node
        }))
    }

    const onSwitchValueChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, switch: switchValue } }
            }
            return node
        }))
    }

    const onContentValueChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, content: contentValue } }
            }
            return node
        }))
    }


    const onONValueChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, ON: ON } }
            }
            return node
        }))
    }

    const onOFFValueChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, OFF: OFF } }
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
        from_label: string;
        outputs: string[]
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


    const [AND, OR] = ["and", "or"]

    const onCaseAdd = () => {
        console.log("outputs", outputs)
        // 获取可用的源节点
        const sourceNodes = getSourceNodeIdWithLabel(parentId);
        const defaultSourceNode = sourceNodes.length > 0 ? sourceNodes[0] : {id: '', label: ''};
        
        setCases(prevCases => [
            ...prevCases,
            {
                conditions: [
                    {
                        id: defaultSourceNode.id,
                        label: defaultSourceNode.label,
                        condition: '',
                        cond_v: 'condition',
                        cond_input: "",
                        operation: AND,
                        type: defaultSourceNode.id ? getNode(defaultSourceNode.id)?.type : undefined
                    }
                ],
                actions: [
                    {
                        from_id: defaultSourceNode.id,
                        from_label: defaultSourceNode.label,
                        outputs: outputs.length > 0 ? [outputs[0]] : []
                    }
                ]
            }
        ])
    }

    const onConditionAdd = (index: number) => () => {
        console.log("hello", index)
        const sourceNodes = getSourceNodeIdWithLabel(parentId);
        const defaultSourceNode = sourceNodes.length > 0 ? sourceNodes[0] : {id: '', label: ''};
        
        setCases(prevCases => {
            console.log(prevCases)
            return prevCases.map((caseItem, caseIndex) => {
                if (caseIndex === index) {
                    return {
                        ...caseItem,
                        conditions: [
                            ...caseItem.conditions,
                            {
                                id: defaultSourceNode.id,
                                label: defaultSourceNode.label,
                                condition: `condition${caseItem.conditions.length + 1}`,
                                cond_v: 'condition',
                                operation: AND,
                                type: defaultSourceNode.id ? getNode(defaultSourceNode.id)?.type : undefined
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
        const sourceNodes = getSourceNodeIdWithLabel(parentId);
        const defaultSourceNode = sourceNodes.length > 0 ? sourceNodes[0] : {id: '', label: ''};
        
        setCases(prevCases => {
            return prevCases.map((caseItem, caseIndex) => {
                if (caseIndex === index) {
                    return {
                        ...caseItem,
                        actions: [
                            ...caseItem.actions,
                            {
                                from_id: defaultSourceNode.id,
                                from_label: defaultSourceNode.label,
                                outputs: outputs.length > 0 ? [outputs[0]] : []
                            }
                        ]
                    }
                }
                return caseItem
            })
        })
    }


    const getConditionSelections = (type: string) => {
        console.log("GetConditionSelections", type)
        if (type === "text") {
            console.log("text")
            // contains XXX
            // doesn't contain XXX
            // is greater than [N] characters
            // is less than [N] characters
            return ["contains", "doesn't contain", "is greater than [N] characters", "is less than [N] characters"]
        } else if (type === "structured") {
            // is empty
            // is not empty
            // contains XXX
            // doesn't contain XXX
            // is List
            // is Dict
            // length is greater than [N]
            // length is less than [N]
            return ["is empty", "is not empty", "contains", "doesn't contain", "is greater than [N] characters", "is less than [N] characters", "is list", "is dict"]
        } else if (type === "switch") {
            // (for Switch)
            // is True
            // is False
            return ["is True", "is False"]
        }

        return []
    }

    const onConditionDelete = (caseIndex: number, conditionIndex: number) => () => {
        setCases(prevCases => {
            return prevCases[caseIndex].conditions.length > 1 ? prevCases.map((caseItem, index) => {
                if (index === caseIndex) {
                    return {
                        ...caseItem,
                        conditions: caseItem.conditions.filter((_, condIndex) => condIndex !== conditionIndex)
                    };
                }
                return caseItem;
            }) : prevCases
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
        () => {
            console.log("outputs effect", outputs)
            if (autogenerated) {
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
            edge => edge.source == parentId
        ).map(
            edge => edge.target
        )
        console.log("currentnode effect", currentNodes)
        console.log("currentnode effect lastnodes", lastNodesRef.current)


        console.log(lastNodesRef.current, currentNodes)
        if (array1HasExtraElements(currentNodes, lastNodesRef.current)) {
            console.log("new edge effect", outputs)
            setOutputs(
                Array.from(new Set(currentNodes))
            )
        }

        if (array1HasExtraElements(lastNodesRef.current, currentNodes)) {
            console.log("new edge effect", outputs)
            setOutputs(
                Array.from(new Set(currentNodes))
            )
        }

        lastNodesRef.current = Array.from(new Set(currentNodes)); // Save the current nodes to the ref
        // You can also perform other side effects here if needed
    }, [getEdges()]); // Dependency array includes getNodes


    return (

        <ul ref={menuRef} className={`w-[535px] absolute top-[58px] left-[0px] text-white rounded-[16px] border-[1px] border-[#6D7177] bg-main-black-theme p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`} >
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2" />
                                <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5" />
                                <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9" />
                                <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9" />
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            If/Else
                        </div>
                    </div>
                </div>
                <div className='flex flex-row gap-[8px] items-center justify-center'>
                    <button className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                        onClick={onDataSubmit}>
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

            {/* Add Input/Output section with labels outside */}
            <li className='flex flex-row gap-[12px]'>
                {/* Input section - left side */}
                <div className='flex-1 flex flex-col gap-1'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Input</label>
                        <div className='flex items-center gap-[6px]'>
                            {/* Text icon - 增大尺寸 */}
                            <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            {/* Structured icon - 增大尺寸 */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#9B7EDB]" />
                                <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#9B7EDB]" />
                                <path d="M9 9H11V11H9V9Z" className="fill-[#9B7EDB]" />
                                <path d="M9 13H11V15H9V13Z" className="fill-[#9B7EDB]" />
                                <path d="M13 9H15V11H13V9Z" className="fill-[#9B7EDB]" />
                                <path d="M13 13H15V15H13V13Z" className="fill-[#9B7EDB]" />
                            </svg>
                        </div>
                    </div>
                    <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                        <div className='flex flex-wrap gap-2'>
                            {displaySourceNodeLabels()}
                        </div>
                    </div>
                </div>

                {/* Output section - right side */}
                <div className='flex-1 flex flex-col gap-1'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Output</label>
                        <div className='flex items-center gap-[6px] pl-[4px]'>
                            {/* Output types with neutral frames - smaller SVGs */}
                            <div className='flex items-center gap-[4px]'>
                                {/* Text icon */}
                                <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                                {/* Structured icon */}
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#9B7EDB]" />
                                    <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#9B7EDB]" />
                                    <path d="M9 9H11V11H9V9Z" className="fill-[#9B7EDB]" />
                                    <path d="M9 13H11V15H9V13Z" className="fill-[#9B7EDB]" />
                                    <path d="M13 9H15V11H13V9Z" className="fill-[#9B7EDB]" />
                                    <path d="M13 13H15V15H13V13Z" className="fill-[#9B7EDB]" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                        <div className='flex flex-wrap gap-2'>
                            {displayTargetNodeLabels()}
                        </div>
                    </div>
                </div>
            </li>

            {
                cases.map((case_value, case_index) => (
                    <li key={case_index} className='flex flex-col gap-2'>
                        {/* Case Header - 使用类似 LLM 配置菜单的样式 */}
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Case {case_index + 1}</label>
                            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            {/* Delete Case Button */}
                            {cases.length > 1 && (
                                <button
                                    onClick={() => {
                                        setCases(prevCases => prevCases.filter((_, index) => index !== case_index));
                                    }}
                                    className='ml-auto p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {/* Case Content Container */}
                        <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                            {/* 保持现有的 IF/THEN 内容不变，稍后我们会继续优化这部分 */}
                            <div className='flex flex-col w-full gap-[8px] p-3'>
                                <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Condition</label>
                                {
                                    case_value.conditions.map(
                                        (condition_value, conditions_index) => (
                                            <>
                                                <div className='inline-flex space-x-[12px] items-center justify-start w-full'>
                                                    <ul key={conditions_index} className='flex-col border-[#6D7177] rounded-[4px] w-full bg-black'>
                                                        <li className='flex gap-1 h-[32px] items-center justify-start rounded-md border-[1px] border-[#6D7177]/30 bg-[#252525] min-w-[280px]'>
                                                            {/* 第一个元素：节点选择 */}
                                                            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                                                <PuppyDropdown
                                                                    options={getSourceNodeIdWithLabel(parentId)}
                                                                    onSelect={(node: { id: string, label: string }) => {
                                                                        const cases_clone = [...cases];
                                                                        cases_clone[case_index].conditions[conditions_index] = {
                                                                            ...cases_clone[case_index].conditions[conditions_index],
                                                                            id: node.id,
                                                                            label: node.label,
                                                                            type: getNode(node.id)?.type
                                                                        };
                                                                        setCases(cases_clone);
                                                                        console.log("selected node:", getNode(node.id));
                                                                    }}
                                                                    selectedValue={condition_value.id}
                                                                    optionBadge={false}
                                                                    listWidth="200px"
                                                                    buttonHeight="24px"
                                                                    buttonBgColor="transparent"
                                                                    containerClassnames="w-fit"
                                                                    mapValueTodisplay={(value: string | { id: string, label: string }) => {
                                                                        if (typeof value === 'string') {
                                                                            const nodeType = getNode(value)?.type;
                                                                            const label = getNode(value)?.data?.label || value;
                                                                            const displayText = `{{${label}}}`;

                                                                            if (nodeType === 'text') {
                                                                                return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                                            } else if (nodeType === 'structured') {
                                                                                return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                                            }
                                                                            return displayText;
                                                                        }

                                                                        const nodeType = getNode(value.id)?.type;
                                                                        const displayText = `{{${value.label || value.id}}}`;

                                                                        if (nodeType === 'text') {
                                                                            return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                                        } else if (nodeType === 'structured') {
                                                                            return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                                        }
                                                                        return displayText;
                                                                    }}
                                                                    showDropdownIcon={false}
                                                                />
                                                            </div>

                                                            {/* 第二个元素：条件选择 */}
                                                            <div className='border-r-[1px] border-l-[1px] px-[8px] border-[#6D7177]/30 flex items-center justify-start'>
                                                                <PuppyDropdown
                                                                    options={getConditionSelections(getNode(cases[case_index].conditions[conditions_index].id)?.type || 'text')}
                                                                    onSelect={(value: string) => {
                                                                        const cases_clone = [...cases];
                                                                        cases_clone[case_index].conditions[conditions_index] = {
                                                                            ...cases_clone[case_index].conditions[conditions_index],
                                                                            cond_v: value
                                                                        };
                                                                        setCases(cases_clone);
                                                                    }}
                                                                    selectedValue={cases[case_index].conditions[conditions_index].cond_v || 'condition'}
                                                                    optionBadge={false}
                                                                    listWidth="200px"
                                                                    buttonHeight="24px"
                                                                    buttonBgColor="transparent"
                                                                    containerClassnames="w-[150px]"
                                                                    textColor="#CDCDCD"      // 改为蓝色，与节点选择器的文字颜色一致
                                                                    fontSize="11px"          // 稍微调小字体
                                                                    fontWeight="500"         // 调整字重
                                                                    showDropdownIcon={true}  // 显示下拉箭头
                                                                />
                                                            </div>

                                                            {/* 第三个元素：输入框 */}
                                                            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                                                                <input
                                                                    value={cases[case_index].conditions[conditions_index].cond_input || ""}
                                                                    onChange={(e) => {
                                                                        const cases_clone = [...cases];
                                                                        cases_clone[case_index].conditions[conditions_index] = {
                                                                            ...cases_clone[case_index].conditions[conditions_index],
                                                                            cond_input: e.target.value
                                                                        };
                                                                        setCases(cases_clone);
                                                                    }}
                                                                    placeholder={["is True", "is False", "is not empty", "is list", "is dict", "is empty", "condition"].includes(cases[case_index].conditions[conditions_index].cond_v) ? "No input needed" : "Enter value"}
                                                                    disabled={["is True", "is False", "is not empty", "is list", "is dict", "is empty", "condition"].includes(cases[case_index].conditions[conditions_index].cond_v)}
                                                                    className="h-[24px] w-full text-[#CDCDCD] bg-[#252525] caret-white px-2 text-[12px] outline-none disabled:opacity-50 placeholder-[#6D7177]/50"
                                                                />
                                                            </div>
                                                        </li>
                                                    </ul>
                                                    {/* 删除按钮 - 移到外面并调整间距 */}
                                                    <button
                                                        onClick={onConditionDelete(case_index, conditions_index)}
                                                        className={`p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors ${case_value.conditions.length <= 1 ? 'invisible' : ''}`}
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                            <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                                        </svg>
                                                    </button>
                                                    {conditions_index !== case_value.conditions.length - 1 && (
                                                        <button
                                                            onClick={onAndOrSwitch(case_index, conditions_index)}
                                                            className='px-2 h-[20px] flex items-center justify-center rounded-[4px] 
                                                                      bg-[#252525] border-[1px] border-[#6D7177]/30
                                                                      text-[#6D7177] text-[10px] font-medium
                                                                      hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                                                                      transition-colors'
                                                        >
                                                            {case_value.conditions[conditions_index].operation.toUpperCase()}
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        )
                                    )
                                }
                                {/* Add new condition button at the bottom */}
                                <div className='flex justify-start mt-[8px]'>
                                    <button
                                        onClick={onConditionAdd(case_index)}
                                        className='w-[24px] h-[24px] flex items-center justify-center rounded-md
                                                bg-[#252525] border-[1px] border-[#6D7177]/30
                                                text-[#6D7177] text-[10px] font-medium
                                                hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                                                transition-colors'
                                    >
                                        <svg width="10" height="10" viewBox="0 0 14 14">
                                            <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* the divider */}
                            <div className='flex items-center gap-2 px-3'>
                                <div className='h-[1px] flex-1 bg-[#6D7177]/30'></div>
                                <span className='text-[11px] font-regular text-[#6D7177]'>When conditions are met, execute the following actions</span>
                                <div className='h-[1px] flex-1 bg-[#6D7177]/30'></div>
                            </div>

                            {/* Action List*/}
                            <div className='flex flex-col border-[#6D7177] p-3 gap-[8px] w-full justify-start'>
                                <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Action</label>

                                {case_value.actions.map((action_value, action_index) => (
                                    <div className='inline-flex space-x-[12px] items-center justify-start w-full'>
                                        <ul className='flex-col border-[#6D7177] rounded-[4px] w-full bg-black'>
                                            <li className='flex gap-1 h-[32px] items-center justify-start rounded-md border-[1px] border-[#6D7177]/30 bg-[#252525] min-w-[280px]'>
                                                {/* 第一个元素：节点选择 */}
                                                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                                    <PuppyDropdown
                                                        options={getSourceNodeIdWithLabel(parentId)}
                                                        onSelect={(node: { id: string, label: string }) => {
                                                            const cases_clone = [...cases];
                                                            cases_clone[case_index].actions[action_index] = {
                                                                ...cases_clone[case_index].actions[action_index],
                                                                from_id: node.id,
                                                                from_label: node.label,
                                                            };
                                                            setCases(cases_clone);
                                                            console.log("selected node:", getNode(node.id));
                                                        }}
                                                        selectedValue={action_value.from_id}
                                                        optionBadge={false}
                                                        listWidth="200px"
                                                        buttonHeight="24px"
                                                        buttonBgColor="transparent"
                                                        containerClassnames="w-fit"
                                                        mapValueTodisplay={(value: string | { id: string, label: string }) => {
                                                            if (typeof value === 'string') {
                                                                const nodeType = getNode(value)?.type;
                                                                const label = getNode(value)?.data?.label || value;
                                                                const displayText = `{{${label}}}`;

                                                                if (nodeType === 'text') {
                                                                    return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                                } else if (nodeType === 'structured') {
                                                                    return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                                }
                                                                return displayText;
                                                            }

                                                            const nodeType = getNode(value.id)?.type;
                                                            const displayText = `{{${value.label || value.id}}}`;

                                                            if (nodeType === 'text') {
                                                                return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                            } else if (nodeType === 'structured') {
                                                                return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                            }
                                                            return displayText;
                                                        }}
                                                        showDropdownIcon={false}
                                                    />
                                                </div>
                                                <div className='border-r-[1px] border-l-[1px] px-[8px] border-[#6D7177]/30 flex items-center justify-start'>
                                                    <span className='text-[#6D7177] text-[12px] font-medium'> copy to</span>
                                                </div>
                                                <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                                    <PuppyDropdown
                                                        options={outputs.map(
                                                            (id) => {
                                                                return {
                                                                    id: id,
                                                                    label: id
                                                                }
                                                            }
                                                        )}
                                                        onSelect={(node: { id: string, label: string }) => {
                                                            const cases_clone = [...cases];
                                                            cases_clone[case_index].actions[action_index].outputs = [node.id || node.label];

                                                            setCases(cases_clone);
                                                            console.log("selected node:", getNode(node.id));
                                                        }}
                                                        selectedValue={action_value.outputs[0]}
                                                        optionBadge={false}
                                                        listWidth="200px"
                                                        buttonHeight="24px"
                                                        buttonBgColor="transparent"
                                                        containerClassnames="w-fit"
                                                        mapValueTodisplay={(value: string | { id: string, label: string }) => {
                                                            if (typeof value === 'string') {
                                                                const nodeType = getNode(value)?.type;
                                                                const label = getNode(value)?.data?.label || value;
                                                                const displayText = `{{${label}}}`;

                                                                if (nodeType === 'text') {
                                                                    return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                                } else if (nodeType === 'structured') {
                                                                    return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                                }
                                                                return displayText;
                                                            }

                                                            const nodeType = getNode(value.id)?.type;
                                                            const displayText = `{{${value.label || value.id}}}`;

                                                            if (nodeType === 'text') {
                                                                return <span className="text-[#3B9BFF]">{displayText}</span>;
                                                            } else if (nodeType === 'structured') {
                                                                return <span className="text-[#9B7EDB]">{displayText}</span>;
                                                            }
                                                            return displayText;
                                                        }}
                                                        showDropdownIcon={false}
                                                    />

                                                </div>
                                            </li>
                                        </ul>

                                        {/* 删除按钮 */}
                                        <button
                                            onClick={() => {
                                                const cases_clone = [...cases];
                                                if (cases_clone[case_index].actions.length > 1) {
                                                    cases_clone[case_index].actions.splice(action_index, 1);
                                                    setCases(cases_clone);
                                                }
                                            }}
                                            className={`p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors ${case_value.actions.length <= 1 ? 'invisible' : ''}`}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}

                                {/* 底部添加按钮保持不变 */}
                                <div className='flex justify-start mt-[8px]'>
                                    <button
                                        onClick={onActionAdd(case_index)}
                                        className='w-[24px] h-[24px] flex items-center justify-center rounded-md
                                                bg-[#252525] border-[1px] border-[#6D7177]/30
                                                text-[#6D7177] text-[10px] font-medium
                                                hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                                                transition-colors'
                                    >
                                        <svg width="10" height="10" viewBox="0 0 14 14">
                                            <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </li>

                )
                )
            }
            {/* Add Case Button - 使用更现代的样式 */}
            <div className='flex items-center'>
                <button
                    onClick={onCaseAdd}
                    className='h-[26px] px-2 flex items-center gap-1 rounded-md
                            bg-[#252525] border-[1px] border-[#6D7177]/30
                            text-[#6D7177] text-[10px] font-medium
                            hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                            transition-colors'
                >
                    <svg width="10" height="10" viewBox="0 0 14 14">
                        <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    Add Case
                </button>
            </div>

        </ul>
    )
}

export default ChooseConfigMenu
