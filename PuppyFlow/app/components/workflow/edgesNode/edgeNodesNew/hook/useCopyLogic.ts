import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { backend_IP_address_for_sendingData } from '../../../../hooks/useJsonConstructUtils';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import { 
  CopyNodeFrontendConfig,
  CopyOperationApiPayload
} from '../Copy';


// 将类型定义也导出，方便其他组件使用
export type ConstructedCopyOperationData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: CopyOperationApiPayload }
}

// 钩子返回值类型定义
export interface CopyEdgeLogicReturn {
    resultNode: string | null;
    isLoading: boolean;
    sourceNodes: { id: string; label: string }[];
    targetNodes: { id: string; label: string }[];
    handleDataSubmit: () => Promise<void>;
}

// 导出自定义Hook
export default function useCopyEdgeLogic(parentId: string): CopyEdgeLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as CopyNodeFrontendConfig)?.resultNode ?? null);
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    // 处理创建新目标节点的逻辑
    const createNewTargetNode = async () => {
        const parentEdgeNode = getNode(parentId);
        if (!parentEdgeNode) return;

        // Get source node type to create a target node of the same type
        const sourceNodeType = getNode(getSourceNodeIdWithLabel(parentId)[0]?.id)?.type || "text";
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
            type: sourceNodeType,
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
    const constructJsonData = (): ConstructedCopyOperationData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // 创建包含所有连接节点的 blocks
        let blocks: { [key: string]: NodeJsonType } = {};

        // 添加源节点的信息
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        // 获取源节点类型用于目标节点
        const sourceNodeType = getNode(sourceNodeIdWithLabelGroup[0]?.id)?.type || "text";

        // 添加目标节点的信息
        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: sourceNodeType,
                data: { content: "" }
            };
        });

        // 创建 edges
        let edges: { [key: string]: CopyOperationApiPayload } = {};
        
        // 获取当前节点类型，用于确定要创建什么类型的 edge
        const currentNode = getNode(parentId);
        const nodeType = currentNode?.type || "copy"; // 默认为 copy
        
        // 根据节点类型创建不同的 edge JSON
        let edgejson: CopyOperationApiPayload;
        
        // 这里添加对不同类型的判断
        if (nodeType === "copy" ) {
            // 原有的 copy 逻辑
            edgejson = {
                type: "modify",
                data: {
                    modify_type: "copy",
                    content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                    extra_configs: {},
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                    outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                },
            };
        } else {
            // 默认情况，使用基本的 deep_copy 逻辑
            edgejson = {
                type: "modify",
                data: {
                    modify_type: "deep_copy",
                    content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                    extra_configs: {},
                    inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                    outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
                },
            };
        }

        edges[parentId] = edgejson;
        console.log("Copy Operation Data:", { blocks, edges });

        return {
            blocks,
            edges
        };
    };

    // 处理数据提交
    const handleDataSubmit = async () => {
        setIsLoading(true)
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
    }

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
        resultNode,
        isLoading,
        sourceNodes,
        targetNodes,
        handleDataSubmit
    };
}