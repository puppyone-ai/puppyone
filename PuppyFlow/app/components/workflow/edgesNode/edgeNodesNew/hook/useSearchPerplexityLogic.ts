import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { SearchConfigNodeData } from '../SearchPerplexity';

// 类型定义
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

export type perplexityModelNames = "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online"

type ConstructedSearchPerplexityJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchPerplexityEdgeJsonType }
}

// Hook 返回值类型定义
export interface SearchPerplexityLogicReturn {
    isLoading: boolean;
    handleDataSubmit: () => Promise<void>;
}

export default function useSearchPerplexityLogic(parentId: string): SearchPerplexityLogicReturn {
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

    const sendDataToTargets = async () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

        setNodes(prevNodes => prevNodes.map(node => {
            if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            const jsonData = constructJsonData();
            console.log("Search Perplexity JSON Data:", jsonData);
            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                targetNodeIdWithLabelGroup.forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
            }

            const result = await response.json();
            console.log('Success:', result);

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

    const constructJsonData = (): ConstructedSearchPerplexityJsonData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        const parentNode = getNode(parentId);
        const model = (parentNode?.data as SearchConfigNodeData)?.extra_configs?.model ?? "llama-3.1-sonar-small-128k-online";
        const resultNode = (parentNode?.data as SearchConfigNodeData)?.resultNode;

        let blocks: { [key: string]: NodeJsonType } = {};

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: "structured",
                data: { content: "" }
            };
        });

        const edgejson: SearchPerplexityEdgeJsonType = {
            type: "search",
            data: {
                search_type: "qa",
                sub_search_type: "perplexity",
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                query_id: sourceNodeIdWithLabelGroup.length > 0 ? { [sourceNodeIdWithLabelGroup[0].id]: sourceNodeIdWithLabelGroup[0].label } : {},
                extra_configs: { model },
                outputs: { [resultNode as string]: resultNode as string }
            },
        };

        let edges: { [key: string]: SearchPerplexityEdgeJsonType } = {
            [parentId]: edgejson
        };

        return { blocks, edges };
    };

    const handleDataSubmit = async () => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
            console.log(targetNodeIdWithLabelGroup, "target nodes");

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