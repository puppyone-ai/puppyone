import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
    backend_IP_address_for_sendingData,
    NodeJsonType
} from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { useAppSettings } from '../../../../states/AppSettingsContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';

// 基础类型定义
export type BaseNodeData = {
    content: string;
    label: string;
    resultNode?: string;
    isLoading?: boolean;
    locked?: boolean;
    isInput?: boolean;
    isOutput?: boolean;
    editable?: boolean;
}

// 定义基础类型
export type EdgeNodeType = "copy" | "chunkingAuto" | "chunkingByCharacter" | "chunkingByLength" | "convert2structured" | "convert2text" | "editText" | string;

// Copy 操作的数据类型
export type CopyEdgeJsonType = {
    type: "modify";
    data: {
        modify_type: "copy";
        content: string;
        extra_configs: {};
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}


// Chunking 操作的数据类型
export type ChunkingAutoEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "auto" | "size" | "tokenizer";
        extra_configs: {
            model?: "gpt-4o" | "gpt-4-turbo" | "gpt-4o-mini";
            chunk_size?: number;
            overlap?: number;
            handle_half_word?: boolean;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 在 BaseEdgeJsonType 中添加 ChunkingByCharacter 类型
export type ChunkingByCharacterEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "character";
        sub_chunking_mode: "character";
        extra_configs: {
            delimiters: string[];
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 ChunkingByLength 类型
export type ChunkingByLengthEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "length";
        sub_chunking_mode: "size" | "tokenizer";
        extra_configs: {
            chunk_size: number;
            overlap: number;
            handle_half_word: boolean;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 Convert2Structured 类型
export type Convert2StructuredEdgeJsonType = {
    type: "modify";
    data: {
        content: string;
        modify_type: "convert2structured";
        extra_configs: {
            conversion_mode: string;
            action_type: "default" | "json";
            list_separator?: string[];
            length_separator?: number;
            dict_key?: string;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 Convert2Text 类型
export type Convert2TextEdgeJsonType = {
    type: "modify";
    data: {
        content: string;
        modify_type: "convert2text";
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 EditText 类型
export type EditTextEdgeJsonType = {
    type: "modify",
    data: {
        modify_type: "edit_text",
        extra_configs: {
            slice: number[],
            sort_type: string
        },
        content: string,
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

// 添加 Retrieving 类型
export type SearchByVectorEdgeJsonType = {
    type: "search",
    data: {
        search_type: "vector",
        top_k: number,
        inputs: { [key: string]: string },
        threshold: number,
        extra_configs: {
            provider?: "openai",
            model?: "text-embedding-ada-002",
            db_type?: "pgvector" | "pinecone",
            collection_name?: string,
        } | {},
        doc_ids: string[], 
        query_id: { [key: string]: string },
        outputs: { [key: string]: string }
    },
    id: string
}

// 添加 SearchGoogle 类型
export type SearchGoogleEdgeJsonType = {
    type: "search",
    data: {
        search_type: "web",
        sub_search_type: "google",
        top_k: number,
        inputs: { [key: string]: string },
        query_id: { [key: string]: string },
        extra_configs: {},
        outputs: { [key: string]: string }
    },
}

// 添加 Perplexity 类型
export type perplexityModelNames = "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online";

export type SearchPerplexityEdgeJsonType = {
    type: "search",
    data: {
        search_type: "qa",
        sub_search_type: "perplexity",
        inputs: { [key: string]: string },
        query_id: { [key: string]: string },
        extra_configs: {
            model: perplexityModelNames
        },
        outputs: { [key: string]: string }
    },
}

// 添加 LLM 类型
export type LLMEdgeJsonType = {
    type: "llm",
    data: {
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        base_url: string,
        max_tokens: number,
        temperature: number,
        inputs: { [key: string]: string },
        structured_output: boolean,
        outputs: { [key: string]: string }
    }
}

// 更新联合类型
export type BaseEdgeJsonType = CopyEdgeJsonType | ChunkingAutoEdgeJsonType | 
    ChunkingByCharacterEdgeJsonType | ChunkingByLengthEdgeJsonType | 
    Convert2StructuredEdgeJsonType | Convert2TextEdgeJsonType | EditTextEdgeJsonType |
    SearchByVectorEdgeJsonType | SearchGoogleEdgeJsonType | SearchPerplexityEdgeJsonType |
    LLMEdgeJsonType;

// 构造的数据类型
export type BaseConstructedJsonData = {
    blocks: { [key: string]: NodeJsonType };
    edges: { [key: string]: BaseEdgeJsonType };
}

// Hook 配置类型
export type BaseEdgeNodeConfig = {
    parentId: string;
    targetNodeType: string;
    nodeType: EdgeNodeType;
    constructJsonData?: () => BaseConstructedJsonData;
    delimiters?: string[];
    setDelimiters?: (delimiters: string[]) => void;
    // 添加 ChunkingByLength 的配置
    subChunkMode?: "size" | "tokenizer";
    setSubChunkMode?: (mode: "size" | "tokenizer") => void;
    chunkSize?: number;
    setChunkSize?: (size: number | undefined) => void;
    overlap?: number;
    setOverlap?: (overlap: number | undefined) => void;
    handleHalfWord?: boolean;
    setHandleHalfWord?: (value: boolean) => void;
    // 添加 Convert2Structured 的配置
    execMode?: string;
    deliminator?: string;
    bylen?: number;
    wrapInto?: string;
    textContent?: string,
    retMode?: string,
    configNum?: number,
    query?: { id: string, label: string },
    nodeLabels?: { id: string, label: string }[],
    top_k?: number,
    threshold?: number,
    model?: perplexityModelNames;
    messages?: { role: "system" | "user" | "assistant", content: string }[];
    llmModel?: string;
    baseUrl?: string;
    structuredOutput?: boolean;
}

// Hook 返回值类型
export interface BaseEdgeNodeLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useBaseEdgeNodeLogic({
    parentId,
    targetNodeType,
    nodeType,
    constructJsonData: customConstructJsonData,  // 重命名为 customConstructJsonData
    delimiters,
    setDelimiters,
    // 添加 ChunkingByLength 的配置
    subChunkMode,
    setSubChunkMode,
    chunkSize,
    setChunkSize,
    overlap,
    setOverlap,
    handleHalfWord,
    setHandleHalfWord,
    // 添加 Convert2Structured 的配置
    execMode,
    deliminator,
    bylen,
    wrapInto,
    textContent,
    retMode,
    configNum,
    query,
    nodeLabels,
    top_k,
    threshold,
    model,
    messages,
    llmModel,
    baseUrl,
    structuredOutput
}: BaseEdgeNodeConfig): BaseEdgeNodeLogicReturn {
    // 基础 hooks
    const { getNode, setNodes, setEdges } = useReactFlow();
    const {
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        streamResult,
        reportError,
        resetLoadingUI
    } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    const { getAuthHeaders } = useAppSettings();

    // 状态管理
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    // 执行流程
    useEffect(() => {
        if (isComplete) return;

        const runWithTargetNodes = async () => {
            try {
                const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

                if (targetNodeIdWithLabelGroup.length === 0 && !isAddFlow) {
                    await createNewTargetNode();
                    setIsAddFlow(true);
                } else if (isAddFlow) {
                    await sendDataToTargets();
                }
            } catch (error) {
                console.error("Error in runWithTargetNodes:", error);
            } finally {
                setIsLoading(false);
            }
        };

        runWithTargetNodes();
    }, [isAddFlow, isComplete, parentId]);

    // 创建新的目标节点
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
            type: 'text',
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

        // 更新父节点引用
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    // 发送数据到目标节点
    const sendDataToTargets = async () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

        // 设置所有目标节点为加载状态
        setNodes(prevNodes => prevNodes.map(node => {
            if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            const jsonData = customConstructJsonData ? customConstructJsonData() : defaultConstructJsonData();
            console.log("JSON Data:", jsonData);

            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                targetNodeIdWithLabelGroup.forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
                return;
            }

            const result = await response.json();
            console.log('Success:', result);

            // 流式处理结果
            await Promise.all(targetNodeIdWithLabelGroup.map(node =>
                streamResult(result.task_id, node.id)
            ));
        } catch (error) {
            console.warn(error);
            window.alert(error);
        } finally {
            targetNodeIdWithLabelGroup.forEach(node => {
                resetLoadingUI(node.id);
            });
            setIsComplete(true);
        }
    };

    // 修改 defaultConstructJsonData 实现
    const defaultConstructJsonData = (): BaseConstructedJsonData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // 创建包含所有连接节点的 blocks
        let blocks: { [key: string]: NodeJsonType } = {};

        // 添加源节点信息
        sourceNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: getNode(nodeId)?.type || "text",
                data: { content: getNode(nodeId)?.data?.content || "" }
            };
        });

        // 添加目标节点信息
        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                // 根据节点类型设置不同的目标节点类型
                type: nodeType === "chunk" ? "structured" : targetNodeType,
                data: { content: "" }
            };
        });

        // 创建 edges
        let edges: { [key: string]: BaseEdgeJsonType } = {};
        let edgeJson: BaseEdgeJsonType;

        switch (nodeType) {
            case "copy":
                edgeJson = {
                    type: "modify",
                    data: {
                        modify_type: "copy",
                        content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                        extra_configs: {},
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "chunkingAuto":
                edgeJson = {
                    type: "chunk",
                    data: {
                        chunking_mode: "auto",
                        extra_configs: {
                            model: undefined,
                            chunk_size: undefined,
                            overlap: undefined,
                            handle_half_word: undefined
                        },
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "chunkingByCharacter":
                edgeJson = {
                    type: "chunk",
                    data: {
                        chunking_mode: "character",
                        sub_chunking_mode: "character",
                        extra_configs: {
                            delimiters: delimiters || [",", ";", "\n"]
                        },
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "chunkingByLength":
                edgeJson = {
                    type: "chunk",
                    data: {
                        chunking_mode: "length",
                        sub_chunking_mode: subChunkMode || "size",
                        extra_configs: {
                            chunk_size: chunkSize ?? 200,
                            overlap: overlap ?? 20,
                            handle_half_word: handleHalfWord ?? false
                        },
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "convert2structured":
                edgeJson = {
                    type: "modify",
                    data: {
                        content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                        modify_type: "convert2structured",
                        extra_configs: {
                            conversion_mode: execMode === "split by length" ? "split_by_length" : (
                                execMode === "split by character" ? "split_by_character" : (
                                    execMode === "wrap into list" ? "parse_as_list" : (
                                        execMode === "wrap into dict" ? "wrap_into_dict" : "parse_as_json"
                                    )
                                )
                            ),
                            action_type: execMode === "JSON" ? "json" : "default",
                            ...(execMode === "split by character" ? { list_separator: JSON.parse(deliminator || "[]") } : {}),
                            ...(execMode === "wrap into dict" ? { dict_key: wrapInto } : {}),
                            ...(execMode === "split by length" ? { length_separator: bylen } : {})
                        },
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "convert2text":
                edgeJson = {
                    type: "modify",
                    data: {
                        content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                        modify_type: "convert2text",
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "editText":
                const getSliceRange = (retMode: string | undefined, configNum: number | undefined): [number, number] => {
                    const safeConfigNum = configNum ?? 100; // 默认值为100
                    
                    switch(retMode) {
                        case "return all":
                            return [0, -1];
                        case "return first n":
                            return [0, safeConfigNum];
                        case "return last n":
                            return [-safeConfigNum, -1];
                        case "exclude first n":
                            return [safeConfigNum, -1];
                        case "exclude last n":
                            return [0, -safeConfigNum];
                        default:
                            return [0, -1]; // 默认返回全部
                    }
                };

                edgeJson = {
                    type: "modify",
                    data: {
                        modify_type: "edit_text",
                        extra_configs: {
                            slice: getSliceRange(retMode, configNum),
                            sort_type: "/"
                        },
                        content: textContent || "",
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            case "retrieving":
                const construct_input_nodes_data_from_ids = (blocks: { [key: string]: NodeJsonType }) => {
                    const data = Object.entries(blocks).map(([id, node]) => {
                        const originalNode = getNode(id);

                        if (originalNode?.type === "structured") {
                            return [id, {
                                ...node,
                                data: {
                                    ...node.data,
                                    embedding_view: originalNode?.data?.chunks,
                                },
                                collection_configs: {
                                    ...(originalNode?.data as any)?.collection_configs,
                                },
                            }];
                        } else {
                            return [id, {
                                ...node,
                            }];
                        }
                    });

                    return Object.fromEntries(data);
                };

                const final_blocks = construct_input_nodes_data_from_ids(blocks);
                
                // 安全地处理 query 相关的值
                const queryId = query?.id || "";
                const queryLabel = query?.id 
                    ? (getNode(query.id)?.data?.label as string || query.label || queryId)
                    : "";

                edgeJson = {
                    type: "search",
                    data: {
                        search_type: "vector",
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        top_k: top_k ?? 5,
                        threshold: threshold ?? 0.7,
                        extra_configs: {},
                        doc_ids: nodeLabels?.map(node => node.id) ?? [],
                        query_id: queryId ? { [queryId]: queryLabel } : {}
                    },
                    id: parentId
                };

                return {
                    blocks: final_blocks,
                    edges: { [parentId]: edgeJson }
                };
                break;

            case "searchGoogle":
                edgeJson = {
                    type: "search",
                    data: {
                        search_type: "web",
                        sub_search_type: "google",
                        top_k: top_k ?? 5,
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        query_id: sourceNodeIdWithLabelGroup.length > 0 
                            ? { [sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label } 
                            : {},
                        extra_configs: {},
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    },
                };
                break;

            case "searchPerplexity":
                const resultNode = (getNode(parentId)?.data as any)?.resultNode;
                edgeJson = {
                    type: "search",
                    data: {
                        search_type: "qa",
                        sub_search_type: "perplexity",
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        query_id: sourceNodeIdWithLabelGroup.length > 0 
                            ? { [sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label } 
                            : {},
                        extra_configs: {
                            model: model ?? "llama-3.1-sonar-small-128k-online"
                        },
                        outputs: resultNode ? { [resultNode]: resultNode } : Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    },
                };
                break;

            case "llm":
                edgeJson = {
                    type: "llm",
                    data: {
                        messages: messages?.filter(msg => msg.role === "system" || msg.role === "user") ?? [],
                        model: llmModel ?? "anthropic/claude-3.5-haiku",
                        base_url: baseUrl ?? "",
                        max_tokens: 2000,
                        temperature: 0.7,
                        inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                        structured_output: structuredOutput ?? false,
                        outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                    }
                };
                break;

            default:
                throw new Error(`Unsupported node type: ${nodeType}`);
        }

        edges[parentId] = edgeJson;
        console.log(`${nodeType} Operation Data:`, { blocks, edges });

        return {
            blocks,
            edges
        };
    };

    // 使用自定义或默认的 constructJsonData
    const finalConstructJsonData = customConstructJsonData || defaultConstructJsonData();

    // 数据提交主函数
    const handleDataSubmit = async (...args: any[]) => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

            if (targetNodeIdWithLabelGroup.length === 0) {
                setIsAddFlow(false);
            } else {
                setIsAddFlow(true);
            }

            setIsComplete(false);
        } catch (error) {
            console.error("Error submitting data:", error);
            setIsLoading(false);
        }
    };

    return {
        isLoading,
        handleDataSubmit
    };
} 