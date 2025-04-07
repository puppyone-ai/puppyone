import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { backend_IP_address_for_sendingData } from '../../../../hooks/useJsonConstructUtils';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ChunkingConfigNodeData } from '../ChunkingByLength';

// 定义子分块模式类型
export type SubChunkingModeNames = "size" | "tokenizer";

// 后端 API 请求数据类型
export type ChunkingByLengthApiPayload = {
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "length",
        sub_chunking_mode: SubChunkingModeNames,
        extra_configs: {
            chunk_size: number,
            overlap: number,
            handle_half_word: boolean
        },
        outputs: { [key: string]: string }
    },
};

// 构造的JSON数据类型
export type ConstructedChunkingData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingByLengthApiPayload }
};

// 钩子返回值类型定义
export interface ChunkingByLengthLogicReturn {
    subChunkMode: SubChunkingModeNames;
    setSubChunkMode: (mode: SubChunkingModeNames) => void;
    chunkSize: number | undefined;
    setChunkSize: (size: number | undefined) => void;
    overlap: number | undefined;
    setOverlap: (overlap: number | undefined) => void;
    handleHalfWord: boolean;
    setHandleHalfWord: (value: boolean) => void;
    resultNode: string | null;
    isLoading: boolean;
    sourceNodes: { id: string; label: string }[];
    targetNodes: { id: string; label: string }[];
    handleDataSubmit: () => Promise<void>;
}

// 导出自定义Hook
export default function useChunkingByLengthLogic(parentId: string): ChunkingByLengthLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    
    // 状态管理
    const [subChunkMode, setSubChunkMode] = useState<SubChunkingModeNames>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.sub_chunking_mode ?? "size"
    );
    const [chunkSize, setChunkSize] = useState<number | undefined>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.chunk_size ?? 200
    );
    const [overlap, setOverlap] = useState<number | undefined>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.overlap ?? 20
    );
    const [handleHalfWord, setHandleHalfWord] = useState(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.extra_configs?.handle_half_word ?? false
    );
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    );
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    // 处理创建新目标节点的逻辑
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

    // 处理向目标发送数据的逻辑
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

    // 构建JSON数据的逻辑
    const constructJsonData = (): ConstructedChunkingData => {
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
        let edges: { [key: string]: ChunkingByLengthApiPayload } = {};

        const edgejson: ChunkingByLengthApiPayload = {
            type: "chunk",
            data: {
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                chunking_mode: "length",
                sub_chunking_mode: subChunkMode,
                extra_configs: {
                    chunk_size: chunkSize ?? 200,
                    overlap: overlap ?? 20,
                    handle_half_word: handleHalfWord,
                },
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        edges[parentId] = edgejson;
        console.log("Chunking JSON Data:", { blocks, edges });

        return {
            blocks,
            edges
        };
    };

    // 处理数据提交
    const handleDataSubmit = async () => {
        setIsLoading(true);
        try {
            // Clear activation
            await new Promise(resolve => {
                clearAll();
                resolve(null);
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
        }
    };

    // 处理流程执行
    useEffect(() => {
        if (isComplete) return;

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
                    await sendDataToTargets();
                }
            } catch (error) {
                console.error("Error running with target nodes:", error);
            } finally {
                setIsLoading(false);
            }
        };

        runWithTargetNodes();
    }, [isAddFlow, isComplete, parentId]);

    // 状态变化时更新节点数据
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { 
                    ...node, 
                    data: { 
                        ...node.data, 
                        sub_chunking_mode: subChunkMode,
                        extra_configs: { 
                            ...((node.data as ChunkingConfigNodeData).extra_configs), 
                            chunk_size: chunkSize,
                            overlap: overlap,
                            handle_half_word: handleHalfWord
                        } 
                    } 
                };
            }
            return node;
        }));
    }, [subChunkMode, chunkSize, overlap, handleHalfWord, parentId]);

    // 获取源节点和目标节点信息
    const sourceNodes = getSourceNodeIdWithLabel(parentId);
    const targetNodes = getTargetNodeIdWithLabel(parentId);

    return {
        subChunkMode,
        setSubChunkMode,
        chunkSize,
        setChunkSize,
        overlap,
        setOverlap,
        handleHalfWord,
        setHandleHalfWord,
        resultNode,
        isLoading,
        sourceNodes,
        targetNodes,
        handleDataSubmit
    };
} 