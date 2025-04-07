import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ModifyConfigNodeData } from '../EditText';

// 类型定义
export type ModifyTextEdgeJsonType = {
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

export type ConstructedModifyTextJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ModifyTextEdgeJsonType }
}

// Hook 返回值类型定义
export interface EditTextLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (
        textContent: string,
        retMode: string,
        configNum: number
    ) => Promise<void>;
}

// 自定义 Hook
export default function useEditTextLogic(parentId: string): EditTextLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [currentRunParams, setCurrentRunParams] = useState<{
        textContent: string,
        retMode: string,
        configNum: number
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

        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    // 向目标节点发送数据
    const sendDataToTargets = async (params: {
        textContent: string,
        retMode: string,
        configNum: number
    }) => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

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

    // 构建JSON数据
    const constructJsonData = (params: {
        textContent: string,
        retMode: string,
        configNum: number
    }): ConstructedModifyTextJsonData => {
        const { textContent, retMode, configNum } = params;
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        let blocks: { [key: string]: NodeJsonType } = {};

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: "text",
                data: { content: "" }
            };
        });

        let edges: { [key: string]: ModifyTextEdgeJsonType } = {};

        const edgejson: ModifyTextEdgeJsonType = {
            type: "modify",
            data: {
                modify_type: "edit_text",
                extra_configs: {
                    slice: (
                        retMode === "return all" ? [0, -1] : (
                            retMode === "return first n" ? [0, configNum] : (
                                retMode === "return last n" ? [-configNum, -1] : (
                                    retMode === "exclude first n" ? [configNum, -1] : [0, -configNum]
                                )
                            )
                        )
                    ),
                    sort_type: "/"
                },
                content: textContent,
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        edges[parentId] = edgejson;

        return { blocks, edges };
    };

    // 数据提交主函数
    const handleDataSubmit = async (
        textContent: string,
        retMode: string,
        configNum: number
    ) => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            setCurrentRunParams({
                textContent,
                retMode,
                configNum
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
