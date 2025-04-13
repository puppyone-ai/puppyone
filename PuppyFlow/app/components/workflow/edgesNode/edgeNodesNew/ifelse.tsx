import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import useJsonConstructUtils from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import InputOutputDisplay from './components/InputOutputDisplay'
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown'
import { nanoid } from 'nanoid'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'

export type ChooseConfigNodeData = {
    looped?: boolean | undefined,
    content: string | null,
    switch?: string | undefined,
    ON?: string[] | undefined,
    OFF?: string[] | undefined,
}

type ChooseConfigNodeProps = NodeProps<Node<ChooseConfigNodeData>>

// Define the types for case data structures
export interface Condition {
    id: string;
    label: string;
    condition: string;
    type?: string;
    cond_v: string;
    cond_input?: string;
    operation: string;
}

export interface Action {
    from_id: string;
    from_label: string;
    outputs: string[];
}

export interface CaseItem {
    conditions: Condition[];
    actions: Action[];
}

export interface TransformedCondition {
    block: string;
    condition: string;
    parameters: { [key: string]: string | number };
    operation: string;
}

export interface TransformedCase {
    conditions: TransformedCondition[];
    then: {
        from: string;
        to: string;
    };
}

export interface TransformedCases {
    [key: string]: TransformedCase;
}

export type ChooseEdgeJsonType = {
    type: "choose" | "ifelse",
    data: {
        switch?: { [key: string]: string },
        content?: { [key: string]: string },
        inputs: { [key: string]: string },
        outputs: { [key: string]: string },
        ON?: { [key: string]: string },
        OFF?: { [key: string]: string },
        cases?: any
    }
}

export type ConstructedChooseJsonData = {
    blocks: { [key: string]: any },
    edges: { [key: string]: ChooseEdgeJsonType }
}

function IfElse({ isConnectable, id, data }: ChooseConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)

    // State management
    const [cases, setCases] = useState<CaseItem[]>([])
    const [switchValue, setSwitchValue] = useState<string>(
        (getNode(id)?.data?.switch as string) || ""
    )
    const [contentValue, setContentValue] = useState<string>(
        (getNode(id)?.data?.content as string) || ""
    )
    const [onValue, setOnValue] = useState<string[]>(
        (getNode(id)?.data?.ON as string[]) || []
    )
    const [offValue, setOffValue] = useState<string[]>(
        (getNode(id)?.data?.OFF as string[]) || []
    )

    // Source node labels with type info
    const [sourceNodeLabels, setSourceNodeLabels] = useState<{ label: string, type: string }[]>([])

    // Replace the useIfElseLogic hook with useBaseEdgeNodeLogic
    const { 
        isLoading,
        handleDataSubmit 
    } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'ifelse',  // Specify the node type as ifelse
    });

    // Initialize component
    useEffect(() => {
        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
        }

        return () => {
            if (activatedEdge === id) {
                clearEdgeActivation()
            }
        }
    }, [])

    // Update sourceNodeLabels
    useEffect(() => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(id)
        // Collect labels and types
        const labelsWithTypes = sourceNodeIdWithLabelGroup.map(node => {
            const nodeInfo = getNode(node.id)
            const nodeType = nodeInfo?.type || 'text' // Default to text if type not found
            return {
                label: node.label,
                type: nodeType
            }
        })
        setSourceNodeLabels(labelsWithTypes)
    }, [id, getNode, getSourceNodeIdWithLabel])

    // Initialize cases if not already set
    useEffect(() => {
        if (cases.length === 0 && sourceNodeLabels.length > 0) {
            const firstSourceNode = getSourceNodeIdWithLabel(id)[0];
            setCases([{
                conditions: [{
                    id: firstSourceNode?.id || '',
                    label: firstSourceNode?.label || '',
                    condition: 'contains',
                    cond_v: '',
                    operation: 'AND'
                }],
                actions: [{
                    from_id: id,
                    from_label: 'output',
                    outputs: []
                }]
            }]);
        }
    }, [sourceNodeLabels]);

    // UI interaction functions
    const onClickButton = () => {
        setIsMenuOpen(!isMenuOpen)

        if (isOnGeneratingNewNode) return
        if (activatedEdge === id) {
            clearEdgeActivation()
        } else {
            clearAll()
            activateEdge(id)
        }
    }

    const onFocus = () => {
        const curRef = menuRef.current
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag")
        }
    }

    const onBlur = () => {
        const curRef = menuRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
        }
    }

    // Data synchronization functions
    const onSwitchValueChange = (newValue: string) => {
        setSwitchValue(newValue)
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, switch: newValue } }
            }
            return node
        }))
    }

    const onContentValueChange = (newValue: string) => {
        setContentValue(newValue)
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, content: newValue } }
            }
            return node
        }))
    }

    const onONValueChange = (newValues: string[]) => {
        setOnValue(newValues)
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, ON: newValues } }
            }
            return node
        }))
    }

    const onOFFValueChange = (newValues: string[]) => {
        setOffValue(newValues)
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, OFF: newValues } }
            }
            return node
        }))
    }

    const onCasesChange = (newCases: CaseItem[]) => {
        setCases(newCases)
        // No need to sync this to ReactFlow node data as it's handled separately
    }

    // Case manipulation functions
    const onCaseAdd = () => {
        setCases(prevCases => [
            ...prevCases,
            {
                conditions: [{
                    id: nanoid(6),
                    label: sourceNodeLabels[0]?.label || '',
                    condition: 'contains',
                    cond_v: '',
                    operation: 'AND'
                }],
                actions: [{
                    from_id: id,
                    from_label: 'output',
                    outputs: []
                }]
            }
        ])
    }

    const onConditionAdd = (caseIndex: number) => (e: React.MouseEvent) => {
        // 阻止事件冒泡
        e.stopPropagation();
        
        setCases(prevCases => {
            const newCases = [...prevCases];
            // 使用第一个源节点作为默认值，如果没有则使用空字符串
            const firstSourceNode = getSourceNodeIdWithLabel(id)[0];
            newCases[caseIndex].conditions.push({
                id: firstSourceNode?.id || '',
                label: firstSourceNode?.label || '',
                condition: 'contains',
                cond_v: '',
                operation: 'AND'
            });
            return newCases;
        });
    }

    const onActionAdd = (caseIndex: number) => () => {
        setCases(prevCases => {
            const newCases = [...prevCases]
            newCases[caseIndex].actions.push({
                from_id: id,
                from_label: 'output',
                outputs: []
            })
            return newCases
        })
    }

    const onConditionDelete = (caseIndex: number, conditionIndex: number) => () => {
        setCases(prevCases => {
            const newCases = [...prevCases]
            if (newCases[caseIndex].conditions.length > 1) {
                newCases[caseIndex].conditions.splice(conditionIndex, 1)
            }
            return newCases
        })
    }

    const onAndOrSwitch = (caseIndex: number, conditionIndex: number) => () => {
        setCases(prevCases => {
            const newCases = [...prevCases]
            const currentOperation = newCases[caseIndex].conditions[conditionIndex].operation
            newCases[caseIndex].conditions[conditionIndex].operation = currentOperation === 'AND' ? 'OR' : 'AND'
            return newCases
        })
    }

    // Update condition values
    const updateCondition = (caseIndex: number, conditionIndex: number, field: keyof Condition, value: string) => {
        setCases(prevCases => {
            const newCases = [...prevCases]
            newCases[caseIndex].conditions[conditionIndex][field] = value as any
            return newCases
        })
    }

    // Helper functions for UI
    const getConditionSelections = (type: string) => {
        if (type === "text") {
            return [
                "contains", 
                "doesn't contain", 
                "is greater than [N] characters", 
                "is less than [N] characters"
            ];
        } else if (type === "structured") {
            return [
                "is empty", 
                "is not empty", 
                "contains", 
                "doesn't contain", 
                "is greater than [N] characters", 
                "is less than [N] characters", 
                "is list", 
                "is dict"
            ];
        } else if (type === "switch") {
            return ["is True", "is False"];
        }

        return [];
    };

    // Replace the data submission function
    const onDataSubmit = useCallback(() => {
        // Instead of passing cases data directly to the hook, 
        // update the node data which will be read by buildIfElseNodeJson
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { 
                    ...node, 
                    data: { 
                        ...node.data, 
                        cases: cases,
                        switch: switchValue,
                        content: contentValue,
                        ON: onValue,
                        OFF: offValue
                    } 
                }
            }
            return node
        }));
        
        // Call the new handleDataSubmit without parameters
        handleDataSubmit();
    }, [handleDataSubmit, cases, switchValue, contentValue, onValue, offValue, setNodes, id]);

    // Handle style for the component
    const handleStyle = {
        position: "absolute" as const,
        width: "calc(100%)",
        height: "calc(100%)",
        top: "0",
        left: "0",
        borderRadius: "0",
        transform: "translate(0px, 0px)",
        background: "transparent",
        border: "3px solid transparent",
        zIndex: !isOnConnect ? "-1" : "1",
    }

    return (
        <>
            {/* Main button */}
            <button
                onClick={onClickButton}
                className={`w-[80px] h-[48px] flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`}
            >
                IF/ELSE
                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
                {/* Target handles */}
                <Handle
                    id={`${id}-a`}
                    type="target"
                    position={Position.Top}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-b`}
                    type="target"
                    position={Position.Right}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-c`}
                    type="target"
                    position={Position.Bottom}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-d`}
                    type="target"
                    position={Position.Left}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            </button>
            {/* Configuration Menu (integrated directly) */}
            {isMenuOpen && (
                    <ul ref={menuRef} className="w-[535px] absolute top-[58px] left-[0px] text-white rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg">
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
                                onClick={onDataSubmit}
                                disabled={isLoading}>
                                <span>
                                    {isLoading ? (
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                            <path d="M8 5L0 10V0L8 5Z" fill="black" />
                                        </svg>
                                    )}
                                </span>
                                <span>
                                    {isLoading ? 'Running' : 'Run'}
                                </span>
                            </button>
                        </div>
                    </li>

                    {/* Input/Output display */}
                    <li>
                        <InputOutputDisplay
                            parentId={id}
                            getNode={getNode}
                            getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                            getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                        />
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
                                                                            options={getSourceNodeIdWithLabel(id)}
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
                                                                    <div className='h-[30px] border-r-[1px] border-l-[1px] px-[8px] border-[#6D7177]/30 flex items-center justify-start'>
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
                                                                            selectedValue={cases[case_index].conditions[conditions_index].cond_v}
                                                                            optionBadge={false}
                                                                            listWidth="200px"
                                                                            buttonHeight="24px"
                                                                            buttonBgColor="transparent"
                                                                            containerClassnames="w-[150px]"
                                                                            textColor="#CDCDCD"
                                                                            fontSize="11px"
                                                                            fontWeight="500"
                                                                            showDropdownIcon={true}
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
                                                onClick={(e) => onConditionAdd(case_index)(e)}
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
                                            <div key={action_index} className='inline-flex space-x-[12px] items-center justify-start w-full'>
                                                <ul className='flex-col border-[#6D7177] rounded-[4px] w-full bg-black'>
                                                    <li className='flex gap-1 h-[32px] items-center justify-start rounded-md border-[1px] border-[#6D7177]/30 bg-[#252525] min-w-[280px]'>
                                                        {/* 第一个元素：节点选择 */}
                                                        <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                                            <PuppyDropdown
                                                                options={getSourceNodeIdWithLabel(id)}
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
                                                        <div className='h-[30px] border-r-[1px] border-l-[1px] px-[8px] border-[#6D7177]/30 flex items-center justify-start'>
                                                            <span className='text-[#6D7177] text-[12px] font-medium'> copy to</span>
                                                        </div>
                                                        <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start px-[10px]'>
                                                            <PuppyDropdown
                                                                options={getTargetNodeIdWithLabel(id).map(
                                                                    (node) => {
                                                                        return {
                                                                            id: node.id,
                                                                            label: node.label
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
            )}
        </>
    );
}

export default IfElse;