'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType } from '@xyflow/react'
import JSONForm from '../../../tableComponent/JSONForm'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import useJsonConstructUtils, { ProcessingData, NodeJsonType } from '../../../hooks/useJsonConstructUtils'
import JSONConfigEditor from '../../../tableComponent/JSONConfigEditor'
import { LLMConfigNodeData } from '../edgeNodes/LLMConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import { PuppyDropdown } from '../../../misc/PuppyDropDown'

type LLMConfigProps = {
    show: boolean,
    parentId: string,
}

type messageType = {
    role: "system" | "user",
    content: string,
}


export interface LLMEdgeJsonType {
    // id: string,
    type: "llm",
    data: {
        messages: messageType[],
        model: string,
        base_url: string,
        max_tokens: number,
        temperature: number,
        inputs: { [key: string]: string },
        structured_output: boolean,
        outputs: { [key: string]: string }
    }

}

type ConstructedLLMJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: LLMEdgeJsonType }
}

// Add these new types for the prompt structure
type PromptNode = {
    id: string,
    role: "system" | "user" | "assistant",
    content: string
}

// Add the new PromptEditor component
const PromptEditor = ({ 
    prompts, 
    setPrompts,
    sourceNodeLabels = [] // 默认为空数组
}: {
    prompts: PromptNode[],
    setPrompts: React.Dispatch<React.SetStateAction<PromptNode[]>>,
    sourceNodeLabels?: { label: string, type: string }[]
}) => {

    const addNode = () => {
        setPrompts((prevPrompts) => [
            ...prevPrompts,
            {
                id: nanoid(6),
                role: "user",
                content: ""
            }
        ]);
    };

    const deleteNode = (nodeId: string) => {
        setPrompts((prevPrompts) => prevPrompts.filter(node => node.id !== nodeId));
    };

    const updateNodeContent = (nodeId: string, content: string) => {
        setPrompts((prevPrompts) => prevPrompts.map(node =>
            node.id === nodeId ? { ...node, content } : node
        ));
    };

    const updateNodeRole = (nodeId: string, role: "system" | "user" | "assistant") => {
        setPrompts((prevPrompts) => prevPrompts.map(node =>
            node.id === nodeId ? { ...node, role } : node
        ));
    };

    const renderNode = (node: PromptNode) => {
        // 简化的单一文本输入框实现
        return (
            <div key={node.id} className="relative group mb-1">
                <div className="flex items-start gap-2">
                    <div className="flex-1 relative min-h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden">
                        {/* 角色选择器 */}
                        <div
                            className={`absolute left-[6px] top-[8px] h-[20px] flex items-center 
                            px-2 rounded-[4px] cursor-pointer transition-colors z-30 bg-[#252525] border border-[#6D7177]/30 hover:border-[#6D7177]/50`}
                            onClick={() => {
                                const roles: Array<"system" | "user" | "assistant"> = ["system", "user", "assistant"];
                                const currentIndex = roles.indexOf(node.role);
                                const nextRole = roles[(currentIndex + 1) % roles.length];
                                updateNodeRole(node.id, nextRole);
                            }}
                        >
                            <div className={`text-[10px] font-semibold min-w-[24px] text-center text-[#CDCDCD]`}>
                                {node.role}
                            </div>
                        </div>
                        
                        <textarea
                            value={node.content}
                            onChange={(e) => updateNodeContent(node.id, e.target.value)}
                            className="w-full bg-transparent border-none outline-none pl-[80px] pr-2 py-2
                            text-[#CDCDCD] text-[12px]  appearance-none resize-y min-h-[32px] nodrag"
                            placeholder="Enter message content..."
                            rows={1}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ caretColor: '#CDCDCD' }}
                            onInput={(e) => {
                                // 自动调整高度
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = `${target.scrollHeight}px`;
                            }}
                        />
                        
                        {/* 高亮层逻辑更新 */}
                        <div 
                            className="absolute inset-0 pl-[80px] pr-2 py-2 pointer-events-none text-[#CDCDCD] 
                            text-[12px] overflow-hidden whitespace-pre-wrap break-words"
                            dangerouslySetInnerHTML={{
                                __html: node.content
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/\{\{([^{}]+)\}\}/g, (match, label) => {
                                        // 查找匹配的节点及其类型
                                        const sourceNode = sourceNodeLabels.find(item => item.label.trim() === label.trim());
                                        
                                        if (sourceNode) {
                                            // 根据节点类型应用不同的高亮颜色
                                            if (sourceNode.type === 'structured') {
                                                // 紫色主题 - 对应 structured 节点
                                                return `<span class="text-[#9B7EDB] rounded-sm">${match}</span>`;
                                            } else {
                                                // 蓝色主题 - 对应 text 节点（默认）
                                                return `<span class="text-[#3B9BFF] rounded-sm">${match}</span>`;
                                            }
                                        }
                                        // 如果不是源节点标签，则不添加高亮
                                        return match;
                                    })
                            }}
                        />
                    </div>

                    <button
                        onClick={() => deleteNode(node.id)}
                        className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors mt-[4px]'
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className='flex flex-col gap-2'>
            {prompts.length === 0 ? (
                <button
                    onClick={() => setPrompts([{ id: nanoid(6), role: "system", content: "You are an AI" }])}
                    className='w-full h-[32px] flex items-center justify-center gap-2 rounded-[6px] 
                   border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[12px] font-medium 
                   hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6D7177">
                        <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Create First Message
                </button>
            ) : (
                <div className="flex flex-col gap-1">
                    {prompts.map((prompt) => renderNode(prompt))}

                    {/* Replace the full-width button with a small plus button */}
                    <div className="flex items-center mt-1">
                        <button
                            onClick={addNode}
                            className='w-6 h-6 flex items-center justify-center rounded-md
                        bg-[#252525] border-[1px] border-[#6D7177]/30
                        text-[#6D7177]
                        hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                        transition-colors'
                        >
                            <svg width="10" height="10" viewBox="0 0 14 14">
                                <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const open_router_supported_models = [
    "openai/o1-pro",
    "openai/o3-mini-high",
    "openai/o3-mini",
    "openai/o1",
    "openai/o1-mini",
    "openai/gpt-4.5-preview",
    "openai/gpt-4o-2024-11-20",
    "openai/gpt-4o-mini",
    "openai/gpt-4-turbo",
    "deepseek/deepseek-chat-v3-0324:free",
    "deepseek/deepseek-r1-zero:free",
    "anthropic/claude-3.5-haiku",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.7-sonnet",
]

function LLMConfigMenu({ show, parentId }: LLMConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const { getZoom, getViewport, getNode, flowToScreenPosition, getEdges, setNodes, setEdges, getNodes } = useReactFlow()
    // const {totalCount, addCount, addNode, allowActivateNode, clear} = useNodeContext()
    const { allowActivateOtherNodesWhenConnectEnd, clearAll } = useNodesPerFlowContext()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils()
    const modelRef = useRef<HTMLSelectElement>(null)
    const baseUrlRef = useRef<HTMLInputElement>(null)
    const structured_outputRef = useRef<HTMLSelectElement>(null)
    const [model, setModel] = useState<string>(
        (getNode(parentId)?.data?.model as string) || "anthropic/claude-3.5-haiku"
    )
    const [baseUrl, setBaseUrl] = useState<string>(
        (getNode(parentId)?.data as LLMConfigNodeData)?.base_url ?? ""
    )
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as LLMConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [isStructured_output, setStructured_output] = useState(
        (getNode(parentId)?.data as LLMConfigNodeData)?.structured_output ?? false
    )
    // const [isLoop, setIsLoop] = useState(
    //     (getNode(parentId)?.data as LLMConfigNodeData)?.looped ?? false
    // )

    // 添加设置面板的展开/折叠状态
    const [showSettings, setShowSettings] = useState(false)

    // 修改初始化 prompts 的逻辑，从 content 字段读取
    const [prompts, setPrompts] = useState<PromptNode[]>(() => {
        const existingNode = getNode(parentId);
        if (existingNode?.data?.content) {
            try {
                // 尝试解析 content 字段
                const contentData = typeof existingNode.data.content === 'string'
                    ? JSON.parse(existingNode.data.content)
                    : existingNode.data.content;

                // 确保它是一个数组
                if (Array.isArray(contentData)) {
                    return contentData.map((msg: any) => ({
                        id: nanoid(6),
                        role: msg.role || "user",  // 默认为 user
                        content: msg.content || ""  // 默认为空字符串
                    }));
                }
            } catch (e) {
                console.warn("Failed to parse content JSON:", e);
                // 解析错误时返回默认消息
                return [
                    { id: nanoid(6), role: "system", content: "You are an AI" },
                    { id: nanoid(6), role: "user", content: "Answer the question" }
                ];
            }
        }

        // 如果没有现有数据，返回默认消息
        return [
            { id: nanoid(6), role: "system", content: "You are an AI" },
            { id: nanoid(6), role: "user", content: "Answer the question" }
        ];
    });

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

    const lastNodeWithLabel = useRef<string | undefined>(undefined)

    useEffect(
        () => {
            if (lastNodeWithLabel.current === getSourceNodeIdWithLabel(parentId)[0]?.label) {
                return
            }
            console.log("update llm config")
            lastNodeWithLabel.current = getSourceNodeIdWithLabel(parentId)[0]?.label
            const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
            const content = JSON.stringify(
                [
                    {
                        "role": "system",
                        "content": "You are an AI"
                    },
                    {
                        "role": "user",
                        "content": `answer the question by {{${sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => (node.label))[0]}}}`
                    }
                ]
            )

            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return { ...node, data: { ...node.data, content: content } }
                }
                return node
            }))

            setTimeout(() => {
                console.log("updated llm config", getNode(parentId)?.data.content)
            }, 500)
        },
        [getEdges()]
    )

    // useEffect(() => {
    //     onLoopChange(isLoop)
    // }, [isLoop])

    useEffect(() => {
        onModelChange(model)
    }, [model])

    useEffect(() => {
        onBaseUrlChange(baseUrl)
    }, [baseUrl])

    useEffect(() => {
        onStructuredOutputChange(isStructured_output)
    }, [isStructured_output])

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
            type: isStructured_output ? "structured" : "text",
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

    const onDataSubmit = async () => {
        // 在提交前输出当前节点的内容和prompts数据
        console.log("Current prompts:", prompts);
        console.log("Current node content:", getNode(parentId)?.data.content);
        
        // 如果需要，还可以先手动构建一次JSON看看结果
        const promptsJson = JSON.stringify(
            prompts.map(prompt => ({
                role: prompt.role,
                content: prompt.content
            }))
        );
        console.log("Constructed prompts JSON:", promptsJson);
        
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

    const constructJsonData = (): ConstructedLLMJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        
        // 创建包含所有连接节点的 blocks
        let blocks: { [key: string]: NodeJsonType } = {}

        // 添加源节点的信息
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        // 添加目标节点的信息
        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: isStructured_output ? "structured" : "text",
                data: { content: "" }
            }
        })

        // 创建 edges
        let edges: { [key: string]: LLMEdgeJsonType } = {}

        // 直接从节点的 promptsData 获取消息
        const nodeData = getNode(parentId)?.data;
        let messages = [];
        
        if (nodeData?.promptsData && Array.isArray(nodeData.promptsData)) {
            // 优先使用节点的 promptsData
            messages = nodeData.promptsData;
            console.log("Using node's promptsData:", messages);
        } else {
            // 直接使用当前组件的 prompts 状态
            messages = prompts.map(p => ({
                role: p.role,
                content: p.content
            }));
            console.log("Using current prompts state:", messages);
        }

        const edgejson: LLMEdgeJsonType = {
            type: "llm",
            data: {
                messages: messages,
                model: model as string,
                base_url: baseUrl,
                max_tokens: 4096,
                temperature: 0.7,
                structured_output: isStructured_output,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        }

        edges[parentId] = edgejson
        console.log("LLMCONFIG", blocks, edges)

        return {
            blocks,
            edges
        }
    }

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

    // 在 LLMConfigMenu 组件中，增强 sourceNodeLabels 状态以包含类型信息
    const [sourceNodeLabels, setSourceNodeLabels] = useState<{ label: string, type: string }[]>([]);

    // 在 useEffect 中更新状态时，一并存储节点类型
    useEffect(() => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        // 收集标签和类型
        const labelsWithTypes = sourceNodeIdWithLabelGroup.map(node => {
            const nodeInfo = getNode(node.id);
            const nodeType = nodeInfo?.type || 'text'; // 默认为 text
            return { 
                label: node.label,
                type: nodeType
            };
        });
        setSourceNodeLabels(labelsWithTypes);
    }, [parentId, getSourceNodeIdWithLabel]);

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
        return targetNodeIdWithLabelGroup.map((node: { id: string, label: string }) => {
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
        })
    }

    const onModelChange = (newModel: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, model: newModel } }
            }
            return node
        }))
    }

    const onBaseUrlChange = (newBaseUrl: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, base_url: newBaseUrl } }
            }
            return node
        }))
    }

    const onStructuredOutputChange = (newStructuredOutput: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, structured_output: newStructuredOutput } }
            }
            return node
        }))
    }

    const onResultNodeChange = (newResultNode: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newResultNode } }
            }
            return node
        }))
    }

    const onLoopChange = (newLoop: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, looped: newLoop } }
            }
            return node
        }))
    }

    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, model: model } };
            }
            return node;
        }));
    }, [model]);

    // 需要使用prompts内容更新节点的content
    useEffect(() => {
        // 当prompts变化时，更新节点内容
        const updatedContent = JSON.stringify(
            prompts.map(prompt => ({
                role: prompt.role,
                content: prompt.content
            }))
        );

        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, content: updatedContent } };
            }
            return node;
        }));
    }, [prompts]);

    return (
        <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[448px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box ${show ? "" : "hidden"} shadow-lg`}>
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                        <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <g clipPath="url(#clip0_3289_923)">
                                    <mask id="mask0_3289_923" style={{ maskType: "luminance" }} maskUnits="userSpaceOnUse" x="0" y="0" width="14" height="14">
                                        <path d="M14 0H0V14H14V0Z" fill="white" />
                                    </mask>
                                    <g mask="url(#mask0_3289_923)">
                                        <path d="M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164ZM4.84408 7.50494L3.66546 6.82463C3.65277 6.8185 3.64446 6.80625 3.64271 6.79225V3.53769C3.64358 2.08869 4.81915 0.914439 6.26815 0.915314C6.88108 0.915314 7.47433 1.13056 7.94552 1.52256C7.92408 1.53394 7.88733 1.5545 7.86283 1.56938L5.07508 3.17938C4.93246 3.26031 4.84496 3.41169 4.84583 3.57575L4.84408 7.50406V7.50494ZM5.48415 6.12506L7.00008 5.24963L8.51602 6.12463V7.87506L7.00008 8.75006L5.48415 7.87506V6.12506Z" fill="#CDCDCD" />
                                    </g>
                                </g>
                                <defs>
                                    <clipPath id="clip0_3289_923">
                                        <rect width="14" height="14" fill="white" />
                                    </clipPath>
                                </defs>
                            </svg>
                        </div>
                        <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                            LLM
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
                        <div className='flex items-center gap-[4px]'>
                            {/* Text icon with neutral frame - smaller SVG */}
                            <div className='w-[16px] h-[16px] flex items-center justify-center rounded-[4px] border-[0.5px] border-[#404040] bg-[#252525]'>
                                <svg width="10" height="10" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            </div>
                            {/* Structured icon with neutral frame - smaller SVG */}
                            <div className='w-[16px] h-[16px] flex items-center justify-center rounded-[4px] border-[0.5px] border-[#404040] bg-[#252525]'>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                            {displaySourceNodeLabels()}
                        </div>
                    </div>
                </div>

                {/* Output section - right side */}
                <div className='flex-1 flex flex-col gap-1'>
                    <div className='flex items-center gap-2'>
                        <label className='text-[11px] font-regular text-[#6D7177] ml-1'>Output</label>
                        <div className='flex items-center gap-[4px] pl-[4px]'>
                            {/* Output types with neutral frames - smaller SVGs */}
                            <div className='flex items-center gap-[4px]'>
                                {/* Text icon with neutral frame - smaller SVG */}
                                <div className='w-[16px] h-[16px] flex items-center justify-center rounded-[4px] border-[0.5px] border-[#404040] bg-[#252525]'>
                                    <svg width="10" height="10" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M3 8H17" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                        <path d="M3 12H15" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                        <path d="M3 16H13" className="stroke-[#3B9BFF]" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </div>
                                {/* Structured icon with neutral frame - smaller SVG - still using conditional opacity */}
                                <div className='w-[16px] h-[16px] flex items-center justify-center rounded-[4px] border-[0.5px] border-[#404040] bg-[#252525]' >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                    </div>
                    <div className='p-[8px] bg-transparent rounded-[8px] border-[1px] border-dashed border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors min-h-[36px]'>
                        <div className='flex flex-wrap gap-2'>
                            {displayTargetNodeLabels()}
                        </div>
                    </div>
                </div>
            </li>

            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Messages</label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                    <PromptEditor 
                        prompts={prompts} 
                        setPrompts={setPrompts} 
                        sourceNodeLabels={sourceNodeLabels}
                    />
                </div>
            </li>
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Output type</label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <PuppyDropdown
                        options={["text", "structured text"]}
                        selectedValue={isStructured_output ? "structured text" : "text"}
                        onSelect={(value: string) => {
                            setStructured_output(value === "structured text");
                            onBlur && onBlur();
                        }}
                        buttonHeight="32px"
                        buttonBgColor="transparent"
                        menuBgColor="#1A1A1A"
                        listWidth="100%"
                        containerClassnames="w-full"
                        onFocus={onFocus}
                    />
                </div>
            </li>
            <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className='ml-auto text-[12px] font-medium text-[#6D7177] hover:text-[#CDCDCD] transition-colors flex items-center gap-1'
                    >
                        {showSettings ? 'Hide' : 'Show'}
                        <svg
                            className={`w-4 h-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
                            viewBox="0 0 24 24"
                        >
                            <path
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M19 9l-7 7-7-7"
                            />
                        </svg>
                    </button>
                </div>
                {showSettings && (
                    <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                        <div className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[12px] font-medium text-[#6D7177]'>Model</label>
                            </div>
                            <div className='relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                                <select
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    className='w-full h-full bg-[#252525] border-none outline-none px-3
                                             text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer'
                                    onMouseDownCapture={onFocus}
                                    onBlur={onBlur}
                                >
                                    {open_router_supported_models.map((model) => (
                                        <option key={model} value={model}>{model}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1 1L5 5L9 1" stroke="#6D7177" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </li>


        </ul>
    )
}

export default LLMConfigMenu

export const DEFAULT_LLM_MESSAGE =
    `[
    {"role": "system",
     "content": "You are an AI"},
    {"role": "user",
     "content": "Answer the question by {{input_ID}}"}
  ]`
