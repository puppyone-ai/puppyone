import { useState, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { backend_IP_address_for_sendingData } from '../../../../hooks/useJsonConstructUtils';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ChunkingConfigNodeData } from '../ChunkingByCharacter';

// 后端 API 请求数据类型
export type ChunkingByCharacterApiPayload = {
    type: "chunk",
    data: {
        inputs: { [key: string]: string },
        chunking_mode: "character",
        sub_chunking_mode: "character",
        extra_configs: {
            delimiters: string[]
        },
        outputs: { [key: string]: string }
    },
};

// 构造的JSON数据类型
export type ConstructedChunkingCharacterData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ChunkingByCharacterApiPayload }
};

// 常用分隔符预设
export const commonDelimiters = [
    { label: "Comma", value: "," },
    { label: "Semicolon", value: ";" },
    { label: "New Line", value: "\n" },
    { label: "Tab", value: "\t" },
    { label: "Space", value: " " },
    { label: "Period", value: "." },
    { label: "Colon", value: ":" },
    { label: "Dash", value: "-" },
];

// 钩子返回值类型定义
export interface ChunkingByCharacterLogicReturn {
    delimiters: string[];
    setDelimiters: (delimiters: string[]) => void;
    resultNode: string | null;
    isLoading: boolean;
    sourceNodes: { id: string; label: string }[];
    targetNodes: { id: string; label: string }[];
    handleDataSubmit: () => Promise<void>;
    addDelimiter: (value: string) => void;
    removeDelimiter: (index: number) => void;
}

// 导出自定义Hook
export default function useChunkingByCharacterLogic(parentId: string): ChunkingByCharacterLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    
    // 状态管理
    const [delimiters, setDelimiters] = useState<string[]>(() => {
        try {
            const content = getNode(parentId)?.data.content as string;
            return content ? JSON.parse(content) : [",", ";", "\n"];
        } catch (e) {
            return [",", ";", "\n"];
        }
    });
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as ChunkingConfigNodeData)?.resultNode ?? null
    );
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    // 添加新的分隔符
    const addDelimiter = (value: string) => {
        if (value && !delimiters.includes(value)) {
            setDelimiters([...delimiters, value]);
        }
    };

    // 删除分隔符
    const removeDelimiter = (index: number) => {
        setDelimiters(delimiters.filter((_, i) => i !== index));
    };

    // 更新分隔符到节点数据
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, content: JSON.stringify(delimiters) } }
            }
            return node
        }));
    }, [delimiters, parentId, setNodes]);

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
    const constructJsonData = (): ConstructedChunkingCharacterData => {
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
        let edges: { [key: string]: ChunkingByCharacterApiPayload } = {};

        const edgejson: ChunkingByCharacterApiPayload = {
            type: "chunk",
            data: {
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                chunking_mode: "character",
                sub_chunking_mode: "character",
                extra_configs: { delimiters: delimiters },
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        edges[parentId] = edgejson;
        console.log("Chunking Character JSON Data:", { blocks, edges });

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

    // 获取源节点和目标节点信息
    const sourceNodes = getSourceNodeIdWithLabel(parentId);
    const targetNodes = getTargetNodeIdWithLabel(parentId);

    return {
        delimiters,
        setDelimiters,
        resultNode,
        isLoading,
        sourceNodes,
        targetNodes,
        handleDataSubmit,
        addDelimiter,
        removeDelimiter
    };
} 