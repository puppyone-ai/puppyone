import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { SearchConfigNodeData } from '../SearchGoogle';

// 类型定义
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

type ConstructedSearchGoogleJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchGoogleEdgeJsonType }
}

// Hook 返回值类型定义
export interface SearchGoogleLogicReturn {
    isLoading: boolean;
    handleDataSubmit: () => Promise<void>;
}

// 自定义 Hook
export default function useSearchGoogleLogic(parentId: string): SearchGoogleLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

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
                    // 无目标节点，需要创建一个
                    await createNewTargetNode();
                    setIsAddFlow(true);
                } else if (isAddFlow) {
                    // 目标节点存在，发送数据
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
    const sendDataToTargets = async () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

        // 将所有目标节点标记为加载中
        setNodes(prevNodes => prevNodes.map(node => {
            if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            const jsonData = constructJsonData();
            console.log("Search Google JSON Data:", jsonData);
            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                // 为所有目标节点报告错误
                targetNodeIdWithLabelGroup.forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
            }

            const result = await response.json();
            console.log('Success:', result);

            // 将结果流式传输到所有目标节点
            await Promise.all(targetNodeIdWithLabelGroup.map(node =>
                streamResult(result.task_id, node.id)
            ));
        } catch (error) {
            console.warn(error);
            window.alert(error);
        } finally {
            // 重置所有目标节点的加载状态
            targetNodeIdWithLabelGroup.forEach(node => {
                resetLoadingUI(node.id);
            });
            setIsComplete(true);
        }
    };

    // 构建JSON数据
    const constructJsonData = (): ConstructedSearchGoogleJsonData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        const parentNode = getNode(parentId);
        const top_k = (parentNode?.data as SearchConfigNodeData)?.top_k ?? 5;

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
        const edgejson: SearchGoogleEdgeJsonType = {
            type: "search",
            data: {
                search_type: "web",
                sub_search_type: "google",
                top_k: top_k,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                query_id: sourceNodeIdWithLabelGroup.length > 0 ? { [sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label } : {},
                extra_configs: {},
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        let edges: { [key: string]: SearchGoogleEdgeJsonType } = {
            [parentId]: edgejson
        };

        return { blocks, edges };
    };

    // 数据提交主函数
    const handleDataSubmit = async () => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
            console.log(targetNodeIdWithLabelGroup, "target nodes");

            // 检查是否有目标节点
            if (targetNodeIdWithLabelGroup.length === 0) {
                // 无目标节点，需要创建一个
                setIsAddFlow(false);
            } else {
                // 目标节点存在，更新它们
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