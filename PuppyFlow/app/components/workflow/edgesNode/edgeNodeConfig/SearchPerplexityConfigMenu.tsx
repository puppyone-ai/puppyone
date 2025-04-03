'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
import useJsonConstructUtils, { NodeJsonType, FileData } from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { SearchConfigNodeData } from '../edgeNodes/SearchConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'

type SearchPerplexityConfigProps = {
    show: boolean,
    parentId: string,
}

export type SearchPerplexityEdgeJsonType = {
    // id: string,
    type: "search",
    data: {
        search_type: "qa" ,
        sub_search_type: "perplexity",
        inputs: { [key: string]: string },
        query_id: { [key: string]: string },
        extra_configs: {
            model: perplexityModelNames
        },
        // looped: boolean,
        outputs: { [key: string]: string }
    },
}

type ConstructedSearchPerplexityJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchPerplexityEdgeJsonType }
}

type perplexityModelNames = "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online"
function SearchPerplexityConfigMenu({ show, parentId }: SearchPerplexityConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getNode, setNodes, setEdges } = useReactFlow()
    const { getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const { clearAll } = useNodesPerFlowContext()
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [model, setModel] = useState<perplexityModelNames>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.extra_configs?.model ?? "llama-3.1-sonar-small-128k-online"
    )
    const modelRef = useRef<HTMLSelectElement>(null)
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

    useEffect(() => {
        onModelChange(model)
    }, [model])

    useEffect(() => {
        if (isComplete) return;

        const runWithTargetNodes = async () => {
            // Get target nodes
            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

            if (targetNodeIdWithLabelGroup.length === 0 && !isAddFlow) {
                // No target nodes, need to create one
                await createNewTargetNode();
                setIsAddFlow(true);
            } else if (isAddFlow) {
                // Target nodes exist, send data
                await sendDataToTargets();
            }
        };

        runWithTargetNodes();
    }, [isAddFlow, isComplete, parentId]);

    const createNewTargetNode = async () => {
        const parentEdgeNode = getNode(parentId);
        if (!parentEdgeNode) return;

        const newTargetId = nanoid(6);
        setResultNode(newTargetId);

        const location = {
            x: parentEdgeNode.position.x + 160,
            y: parentEdgeNode.position.y - 64,
        };

        const newNode = {
            id: newTargetId,
            position: location,
            data: {
                content: "",
                label: newTargetId,
                isLoading: true,
                locked: false,
                isInput: false,
                isOutput: false,
                editable: false,
            },
            type: 'structured',
        };

        const newEdge = {
            id: `connection-${Date.now()}`,
            source: parentId,
            target: newTargetId,
            type: "floating",
            data: {
                connectionType: "CTT",
            },
            markerEnd: markerEnd,
        };

        await Promise.all([
            new Promise(resolve => {
                setNodes(prevNodes => {
                    resolve(null);
                    return [...prevNodes, newNode];
                });
            }),
            new Promise(resolve => {
                setEdges(prevEdges => {
                    resolve(null);
                    return [...prevEdges, newEdge];
                });
            }),
        ]);

        // Update parent node to reference the result node
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    const sendDataToTargets = async () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

        // Mark all target nodes as loading
        setNodes(prevNodes => prevNodes.map(node => {
            if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            const jsonData = constructJsonData();
            console.log(jsonData);
            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                // Report error for all target nodes
                targetNodeIdWithLabelGroup.forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
            }

            console.log(response);
            const result = await response.json();
            console.log('Success:', result);

            // Stream results to all target nodes
            await Promise.all(targetNodeIdWithLabelGroup.map(node =>
                streamResult(result.task_id, node.id)
            ));
        } catch (error) {
            console.warn(error);
            window.alert(error);
        } finally {
            // Reset loading state for all target nodes
            targetNodeIdWithLabelGroup.forEach(node => {
                resetLoadingUI(node.id);
            });
            setIsComplete(true);
        }
    };

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
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                ),
                file: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                        <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
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

    const displayTargetNodeLabels = () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        return targetNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
            // Get the node type from the node data
            const nodeInfo = getNode(node.id);
            const nodeType = nodeInfo?.type || 'text';

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
            };

            // 使用相同的图标
            const nodeIcons = {
                text: (
                    <svg width="12" height="12" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M3 8H17" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 12H15" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 16H13" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                ),
                file: (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
                        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-current" strokeWidth="1.5" />
                        <path d="M8 13.5H16" className="stroke-current" strokeWidth="1.5" strokeLinecap="round" />
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
            };

            const colors = colorClasses[nodeType as keyof typeof colorClasses] || colorClasses.text;
            const icon = nodeIcons[nodeType as keyof typeof nodeIcons] || nodeIcons.text;

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
            );
        });
    };

    const constructJsonData = (): ConstructedSearchPerplexityJsonData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // 创建包含所有连接节点的 blocks
        let blocks: { [key: string]: NodeJsonType } = {};

        // 添加源节点的信息
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        // 添加目标节点的信息
        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: "structured",
                data: { content: "" }
            };
        });

        // 创建 edges
        let edges: { [key: string]: SearchPerplexityEdgeJsonType } = {};

        const edgejson: SearchPerplexityEdgeJsonType = {
            type: "search",

            data: { 
                search_type:"qa", 
                sub_search_type:"perplexity",
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                query_id: sourceNodeIdWithLabelGroup.length > 0 ? {[sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label} : {},
                extra_configs: {model: model},
                // looped: false,
                outputs: {[resultNode as string]: resultNode as string}
            },
        };

        edges[parentId] = edgejson;
        console.log("Search Perplexity JSON Data:", { blocks, edges });

        return {
            blocks,
            edges
        };
    };

    const onDataSubmit = async () => {
        // Clear activation
        await new Promise(resolve => {
            clearAll();
            resolve(null);
        });

        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        console.log(targetNodeIdWithLabelGroup, "target nodes");

        // Check if there are target nodes
        if (targetNodeIdWithLabelGroup.length === 0) {
            // No target nodes, need to create one
            setIsAddFlow(false);
        } else {
            // Target nodes exist, update them
            setIsAddFlow(true);
        }

        setIsComplete(false);
    };

    const onModelChange = (newModel: perplexityModelNames) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, extra_configs: { ...((node.data as SearchConfigNodeData).extra_configs), model: newModel } } }
            }
            return node
        }))
    }

    return (
        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 13 13">
                                <path stroke="#CDCDCD" strokeWidth="2" d="M5.143 5.143 12 12" />
                                <circle cx="4.714" cy="4.714" r="3.714" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2" />
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            Search
                        </div>
                    </div>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <img src="/Perplexity.svg" alt="Perplexity icon" />
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            Perplexity
                        </div>
                    </div>
                </div>
                <div className='w-[57px] h-[26px]'>
                    <button className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]' onClick={onDataSubmit}>
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
            {/* Side-by-side Input/Output section with labels outside */}
            <li className='flex flex-row gap-[12px]'>
                {/* Input section - left side */}
                <div className='flex-1 flex flex-col gap-1'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Input</label>

                    <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                        <div className='flex flex-wrap gap-2'>
                            {displaySourceNodeLabels()}
                        </div>
                    </div>
                </div>

                {/* Output section - right side */}
                <div className='flex-1 flex flex-col gap-1'>
                    <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Output</label>
                    <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                        <div className='flex flex-wrap gap-2'>
                            {displayTargetNodeLabels()}
                        </div>
                    </div>
                </div>
            </li>
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Model</label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='relative h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <PuppyDropdown
                        options={[
                            "llama-3.1-sonar-small-128k-online",
                            "llama-3.1-sonar-large-128k-online",
                            "llama-3.1-sonar-huge-128k-online"
                        ]}
                        selectedValue={model}
                        onSelect={(value: string) => {
                            setModel(value as perplexityModelNames);
                        }}
                        buttonHeight="32px"
                        buttonBgColor="transparent"
                        menuBgColor="#1A1A1A"
                        listWidth="100%"
                        containerClassnames="w-full"
                    />
                </div>
            </li>
        </ul>
    )
}

export default SearchPerplexityConfigMenu