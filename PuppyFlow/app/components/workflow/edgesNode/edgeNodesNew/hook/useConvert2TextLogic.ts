import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ModifyConfigNodeData } from '../Convert2Text';

// Export type definitions
export type Modify2TextJsonType = {
    type: "modify",
    data: {
        content: string,
        modify_type: "convert2text",
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

export type ConstructedModify2TextJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: Modify2TextJsonType }
}

// Define the hook's return type
export interface Convert2TextLogicReturn {
    isLoading: boolean;
    handleDataSubmit: () => Promise<void>;
}

const RESULT_NODE_TYPE = "text";

// Export custom hook
export default function useConvert2TextLogic(parentId: string): Convert2TextLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    
    // State management - only keep execution-related state
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    
    // Create a new target node
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
            type: RESULT_NODE_TYPE,
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

    // Send data to target nodes
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
            setIsLoading(false);
        }
    };

    // Construct JSON data
    const constructJsonData = (): ConstructedModify2TextJsonData => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // Create blocks containing all connected nodes
        let blocks: { [key: string]: NodeJsonType } = {};

        // Add source node information
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        // Add target node information
        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: RESULT_NODE_TYPE,
                data: { content: "" }
            };
        });

        // Create edges
        let edges: { [key: string]: Modify2TextJsonType } = {};

        const edgejson: Modify2TextJsonType = {
            type: "modify",
            data: {
                content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                modify_type: "convert2text",
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        edges[parentId] = edgejson;
        console.log("Modify2Text JSON Data:", { blocks, edges });

        return {
            blocks,
            edges
        };
    };

    // Main data submission function
    const handleDataSubmit = async () => {
        setIsLoading(true);
        try {
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
                await createNewTargetNode();
                await sendDataToTargets();
            } else {
                // Target nodes exist, update them
                await sendDataToTargets();
            }
        } catch (error) {
            console.error("Error submitting data:", error);
            setIsLoading(false);
            setIsComplete(true);
        }
    };

    return {
        isLoading,
        handleDataSubmit
    };
} 