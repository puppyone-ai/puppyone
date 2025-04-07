import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { backend_IP_address_for_sendingData, NodeJsonType } from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { ModifyConfigNodeData } from '../Convert2Structured';

// 类型定义
export type Modify2SturcturedJsonType = {
    type: "modify",
    data: {
        content: string,
        modify_type: "convert2structured",
        extra_configs: {
            conversion_mode: string,
            action_type: "default" | "json",
            list_separator?: string[],
            length_separator?: number,
            dict_key?: string,
        }
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

export type ConstructedModifyCopyJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: Modify2SturcturedJsonType }
}

// Hook 返回值类型定义
export interface Convert2StructuredLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (
        execMode: string,
        deliminator: string,
        bylen: number,
        wrapInto: string
    ) => Promise<void>;
}

// 自定义 Hook
export default function useConvert2StructuredLogic(parentId: string): Convert2StructuredLogicReturn {
    const { getNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

    const [isAddFlow, setIsAddFlow] = useState(true);
    const [isComplete, setIsComplete] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [currentRunParams, setCurrentRunParams] = useState<{
        execMode: string,
        deliminator: string,
        bylen: number,
        wrapInto: string
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

        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    // 向目标节点发送数据
    const sendDataToTargets = async (params: {
        execMode: string,
        deliminator: string,
        bylen: number,
        wrapInto: string
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
        execMode: string,
        deliminator: string,
        bylen: number,
        wrapInto: string
    }): ConstructedModifyCopyJsonData => {
        const { execMode, deliminator, bylen, wrapInto } = params;
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

        let blocks: { [key: string]: NodeJsonType } = {};

        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup);

        targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
            blocks[nodeId] = {
                label: nodeLabel,
                type: "structured",
                data: { content: "" }
            };
        });

        let edges: { [key: string]: Modify2SturcturedJsonType } = {};

        const edgejson: Modify2SturcturedJsonType = {
            type: "modify",
            data: {
                content: `{{${sourceNodeIdWithLabelGroup[0]?.label || sourceNodeIdWithLabelGroup[0]?.id}}}`,
                modify_type: "convert2structured",
                extra_configs: {
                    conversion_mode: execMode === "split by length" ? "split_by_length" : (
                        execMode === "split by character" ? "split_by_character" : (
                            execMode === "wrap into list" ? "parse_as_list" : (
                                execMode === "wrap into dict" ? "wrap_into_dict" : "parse_as_json"
                            )
                        )
                    ),
                    action_type: execMode === "JSON" ? "json" : "default",
                    ...(execMode === "split by character" ? { list_separator: JSON.parse(deliminator) } : {}),
                    ...(execMode === "wrap into dict" ? { dict_key: wrapInto } : {}),
                    ...(execMode === "split by length" ? { length_separator: bylen } : {})
                },
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodeIdWithLabelGroup.map(node => ([node.id, node.label])))
            },
        };

        edges[parentId] = edgejson;

        return { blocks, edges };
    };

    // 数据提交主函数
    const handleDataSubmit = async (
        execMode: string,
        deliminator: string,
        bylen: number,
        wrapInto: string
    ) => {
        setIsLoading(true);
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });

            setCurrentRunParams({
                execMode,
                deliminator,
                bylen,
                wrapInto
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
