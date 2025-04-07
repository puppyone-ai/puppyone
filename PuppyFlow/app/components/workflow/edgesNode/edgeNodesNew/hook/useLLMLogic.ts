import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { LLMConfigNodeData, LLMEdgeJsonType, ConstructedLLMJsonData } from '../LLM';

// Hook返回值类型定义
export interface LLMLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        baseUrl: string,
        structuredOutput: boolean
    ) => Promise<void>;
}

export default function useLLMLogic(parentId: string): LLMLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

    // 状态管理
    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [currentRunParams, setCurrentRunParams] = useState<{
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        baseUrl: string,
        structuredOutput: boolean
    } | null>(null);

    // 执行流程
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
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        baseUrl: string,
        structuredOutput: boolean
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

    // 构建JSON数据
    const constructJsonData = (params: {
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        baseUrl: string,
        structuredOutput: boolean
    }): ConstructedLLMJsonData => {
        const { messages, model, baseUrl, structuredOutput } = params;
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        // 创建 blocks
        let blocks: { [key: string]: any } = {};

        // 添加源节点和目标节点信息
        [...sourceNodeIdWithLabelGroup, ...targetNodeIdWithLabelGroup].forEach(({ id, label }) => {
            const node = getNode(id);
            blocks[id] = {
                label,
                type: node?.type || "text",
                data: { content: node?.data?.content || "" }
            };
        });

        // 确保在发送到后端之前过滤掉 assistant 角色的消息
        const filteredMessages = messages.filter(msg => msg.role === "system" || msg.role === "user");
        
        // 创建 edges
        let edges: { [key: string]: LLMEdgeJsonType } = {};
        edges[parentId] = {
            type: "llm",
            data: {
                messages: filteredMessages,
                model,
                base_url: baseUrl,
                max_tokens: 2000,
                temperature: 0.7,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => [node.id, node.label])),
                structured_output: structuredOutput,
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => [node.id, node.label]))
            }
        };

        return { blocks, edges };
    };

    // 数据提交主函数
    const handleDataSubmit = async (
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        baseUrl: string,
        structuredOutput: boolean
    ) => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            setCurrentRunParams({
                messages,
                model,
                baseUrl,
                structuredOutput
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