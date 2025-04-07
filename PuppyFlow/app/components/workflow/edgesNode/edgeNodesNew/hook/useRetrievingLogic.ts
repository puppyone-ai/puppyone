import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { RetrievingConfigNodeData } from '../Retrieving';

// 导出类型定义
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

export type ConstructedSearchByVectorJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchByVectorEdgeJsonType }
}

// 简化后的Hook返回值类型定义
export interface RetrievingLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (
        query: { id: string, label: string },
        top_k: number | undefined,
        threshold: number | undefined,
        nodeLabels: { id: string, label: string }[]
    ) => Promise<void>;
}

// 导出自定义Hook
export default function useRetrievingLogic(parentId: string): RetrievingLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    
    // 状态管理 - 只保留与执行相关的状态
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [currentRunParams, setCurrentRunParams] = useState<{
        query: { id: string, label: string },
        top_k: number | undefined,
        threshold: number | undefined,
        nodeLabels: { id: string, label: string }[]
    } | null>(null);
    
    // 执行流程
    useEffect(() => {
        if (isComplete || !currentRunParams) return;

        const runWithTargetNodes = async () => {
            try {
                // Get target nodes
                const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

                if (targetNodeIdWithLabelGroup.length === 0 && !isAddFlow) {
                    // No target nodes, need to create one
                    await createNewTargetNode();
                    setIsAddFlow(true);
                } else if (isAddFlow) {
                    // Target nodes exist, send data
                    await sendDataToTargets(currentRunParams);
                }
            } catch (error) {
                console.error("Error in runWithTargetNodes:", error);
            } finally {
                setIsLoading(false);
            }
        };

        runWithTargetNodes();
    }, [isAddFlow, isComplete, parentId, currentRunParams]);
    
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

    // 向目标节点发送数据
    const sendDataToTargets = async (params: {
        query: { id: string, label: string },
        top_k: number | undefined,
        threshold: number | undefined,
        nodeLabels: { id: string, label: string }[]
    }) => {
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
            const jsonData = constructJsonData(params);
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
    
    // 构建JSON数据
    const constructJsonData = (params: {
        query: { id: string, label: string },
        top_k: number | undefined,
        threshold: number | undefined,
        nodeLabels: { id: string, label: string }[]
    }): ConstructedSearchByVectorJsonData => {
        const { query, top_k, threshold, nodeLabels } = params;
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

        // 处理节点数据进行向量搜索特定转换
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

        // 获取必要标签
        const query_label = getNode(query.id)?.data?.label as string | undefined ?? query.label;

        // 创建 edges
        let edges: { [key: string]: SearchByVectorEdgeJsonType } = {};

        const edgejson: SearchByVectorEdgeJsonType = {
            type: "search",
            data: {
                search_type: "vector",
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: { id: string, label: string }) => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                top_k: top_k ?? 5,
                threshold: threshold ?? 0.7,
                extra_configs: {},
                doc_ids: nodeLabels.map(node => node.id),
                query_id: { [query.id]: query_label },
            },
            id: parentId
        };

        edges[parentId] = edgejson;
        console.log("Search by vector JSON Data:", { blocks: final_blocks, edges });

        return {
            blocks: final_blocks,
            edges
        };
    };
    
    // 数据提交主函数
    const handleDataSubmit = async (
        query: { id: string, label: string },
        top_k: number | undefined,
        threshold: number | undefined,
        nodeLabels: { id: string, label: string }[]
    ) => {
        setIsLoading(true);
        try {
            // Clear activation
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            // 保存当前的运行参数
            setCurrentRunParams({
                query,
                top_k,
                threshold,
                nodeLabels
            });

            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
            
            // Check if there are target nodes
            if (targetNodeIdWithLabelGroup.length === 0) {
                // No target nodes, need to create one
                setIsAddFlow(false);
            } else {
                // Target nodes exist, update them
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