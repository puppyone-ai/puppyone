import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ChooseConfigNodeData, ChooseEdgeJsonType, ConstructedChooseJsonData, TransformedCase, TransformedCases } from '../ifelse';

// Hook return type definition
export interface IfElseLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (cases: any[], switchValue?: string, contentValue?: string, onValue?: string[], offValue?: string[]) => Promise<void>;
}

export default function useIfElseLogic(parentId: string): IfElseLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

    // State management
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [currentRunParams, setCurrentRunParams] = useState<{
        cases: any[];
        switchValue?: string;
        contentValue?: string;
        onValue?: string[];
        offValue?: string[];
    } | null>(null);

    // Execution flow
    useEffect(() => {
        if (isComplete || !currentRunParams) return;

        const runWithTargetNodes = async () => {
            try {
                const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

                if (targetNodeIdWithLabelGroup.length === 0 && !isAddFlow) {
                    await createNewTargetNode();
                    setIsAddFlow(true);
                } else if (isAddFlow) {
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

    // Create new target node
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

        // Update parent node to reference the result node
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    // Send data to target nodes
    const sendDataToTargets = async (params: {
        cases: any[];
        switchValue?: string;
        contentValue?: string;
        onValue?: string[];
        offValue?: string[];
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
                targetNodeIdWithLabelGroup.forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
                return;
            }

            const result = await response.json();
            console.log('Success:', result);

            // Stream results to all target nodes
            await Promise.all(targetNodeIdWithLabelGroup.map(node =>
                streamResult(result.task_id, node.id)
            ));
        } catch (error) {
            console.error(error);
            window.alert(error);
        } finally {
            targetNodeIdWithLabelGroup.forEach(node => {
                resetLoadingUI(node.id);
            });
            setIsComplete(true);
        }
    };

    // Transform conditions for JSON structure
    const transformCases = (inputCases: any[]): { cases: TransformedCases } => {
        const transformedCases: TransformedCases = {};

        inputCases.forEach((caseItem, index) => {
            const caseId = `case_${index + 1}`;
            const transformedConditions = caseItem.conditions.map((cond: any) => ({
                block: cond.id,
                condition: cond.condition,
                parameters: { value: cond.cond_v },
                operation: cond.operation || "equals"
            }));

            const actionItem = caseItem.actions[0]; // Assuming single action
            transformedCases[caseId] = {
                conditions: transformedConditions,
                then: {
                    from: actionItem.from_id,
                    to: actionItem.outputs[0] // Assuming single output
                }
            };
        });

        return { cases: transformedCases };
    };

    // Construct JSON data
    const constructJsonData = (params: {
        cases: any[];
        switchValue?: string;
        contentValue?: string;
        onValue?: string[];
        offValue?: string[];
    }): ConstructedChooseJsonData => {
        const { cases, switchValue, contentValue, onValue, offValue } = params;
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // Create blocks
        let blocks: { [key: string]: any } = {};

        // Add source and target node information
        [...sourceNodeIdWithLabelGroup, ...targetNodeIdWithLabelGroup].forEach(({ id, label }) => {
            const node = getNode(id);
            const nodeType = node?.type || 'text'; // Default to text if type not found
            blocks[id] = {
                label,
                type: nodeType,
                data: { content: node?.data?.content || "" }
            };
        });

        // Create edges
        let edges: { [key: string]: ChooseEdgeJsonType } = {};
        
        // Transform cases
        const transformedCasesData = transformCases(cases);
        
        edges[parentId] = {
            type: "ifelse",
            data: {
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => [node.id, node.label])),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => [node.id, node.label])),
                ...transformedCasesData
            }
        };

        // Add optional properties if they exist
        if (switchValue) {
            edges[parentId].data.switch = { value: switchValue };
        }
        
        if (contentValue) {
            edges[parentId].data.content = { value: contentValue };
        }
        
        if (onValue && onValue.length > 0) {
            edges[parentId].data.ON = Object.fromEntries(onValue.map((val, idx) => [`on_${idx}`, val]));
        }
        
        if (offValue && offValue.length > 0) {
            edges[parentId].data.OFF = Object.fromEntries(offValue.map((val, idx) => [`off_${idx}`, val]));
        }

        return { blocks, edges };
    };

    // Main data submit function
    const handleDataSubmit = async (
        cases: any[],
        switchValue?: string,
        contentValue?: string,
        onValue?: string[],
        offValue?: string[]
    ) => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            setCurrentRunParams({
                cases,
                switchValue,
                contentValue,
                onValue,
                offValue
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