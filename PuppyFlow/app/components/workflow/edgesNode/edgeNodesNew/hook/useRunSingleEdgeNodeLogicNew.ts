import { useState, useEffect, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
    backend_IP_address_for_sendingData,
    BasicNodeData,
    NodeJsonType
} from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { useAppSettings } from '../../../../states/AppSettingsContext';
import { markerEnd } from '../../../connectionLineStyles/ConfigToTargetEdge';
import { nanoid } from 'nanoid';
import { 
    useEdgeNodeBackEndJsonBuilder,
    EdgeNodeType,
    BaseConstructedJsonData,

} from './useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from './useBlockNodeBackEndJsonBuilder';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';

// Hook 返回值类型
export interface BaseEdgeNodeLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useBaseEdgeNodeLogic({
    parentId,
    targetNodeType,
    constructJsonData: customConstructJsonData,
}: {
    parentId: string;
    targetNodeType: string;
    constructJsonData?: () => BaseConstructedJsonData;
}): BaseEdgeNodeLogicReturn {
    
    // Basic hooks
    const { getNode, setNodes, setEdges } = useReactFlow();
    const {
        streamResult,
        reportError,
        resetLoadingUI
    } = useJsonConstructUtils();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget();
    const { clearAll } = useNodesPerFlowContext();
    const { getAuthHeaders } = useAppSettings();

    // Add hooks for JSON building
    const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
    const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

    // State management
    const [isLoading, setIsLoading] = useState(false);

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
                isOutput: true,
                editable: false,
            },
            width: 240,
            height: 176,
            measured: {
                width: 240,
                height: 176,
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

        // 更新父节点引用
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return { ...node, data: { ...node.data, resultNode: newTargetId } };
            }
            return node;
        }));
    };

    // 发送数据到目标节点
    const sendDataToTargets = async () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        if (targetNodeIdWithLabelGroup.length === 0) return;

        // 设置所有目标节点为加载状态
        setNodes(prevNodes => prevNodes.map(node => {
            if (targetNodeIdWithLabelGroup.some(targetNode => targetNode.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
            const jsonData = customConstructJsonData ? customConstructJsonData() : defaultConstructJsonData();
            console.log("JSON Data:", jsonData);

            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
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
            console.log('Backend Response:', result);

            // 流式处理结果
            const streamPromises = await Promise.all(targetNodeIdWithLabelGroup.map(node =>
                streamResult(result.task_id, node.id).then(res => {
                    console.log(`NODE ${node.id} STREAM COMPLETE:`, res);
                    return res;
                })
            ));
        } catch (error) {
            console.warn(error);
            window.alert(error);
        } finally {
            targetNodeIdWithLabelGroup.forEach(node => {
                resetLoadingUI(node.id);
            });
        }
    };

    // Modify defaultConstructJsonData to use the extracted parameters
    const defaultConstructJsonData = (): BaseConstructedJsonData => {
        // 获取源节点和目标节点
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);
        
        try {
            // 创建blocks对象
            let blocks: { [key: string]: NodeJsonType } = {};
            
            // 添加源节点信息 - 使用 buildBlockNodeJson
            sourceNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
                try {
                    // 使用区块节点构建函数
                    const blockJson = buildBlockNodeJson(nodeId);
                    
                    // 确保节点标签正确
                    blocks[nodeId] = {
                        ...blockJson,
                        label: nodeLabel
                    };
                } catch (e) {
                    console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);
                    
                    // 回退到默认行为
                    blocks[nodeId] = {
                        label: nodeLabel,
                        type: getNode(nodeId)?.type as string,
                        data: getNode(nodeId)?.data as any
                    };
                }
            });
            
            // 添加目标节点信息
            targetNodeIdWithLabelGroup.forEach(({ id: nodeId, label: nodeLabel }) => {
                // 获取节点类型
                const nodeType = getNode(nodeId)?.type as string;
                
                // 设置基本结构
                blocks[nodeId] = {
                    label: nodeLabel,
                    type: nodeType,
                    data: { content: "" }
                };
            });
            
            // 构建边的JSON - 使用 buildEdgeNodeJson
            const edgeJson = buildEdgeNodeJson(parentId);
            
            return {
                blocks,
                edges: { [parentId]: edgeJson }
            };
        } catch (error) {
            console.error(`构建节点 JSON 时出错: ${error}`);
            
            // 如果出错，回退到简单的默认结构
            return {
                blocks: {
                    // 添加源节点和目标节点的基本信息
                    ...Object.fromEntries(sourceNodeIdWithLabelGroup.map(({ id, label }) => [
                        id, { 
                            label, 
                            type: getNode(id)?.type as string, 
                            data: getNode(id)?.data as BasicNodeData 
                        }
                    ])),
                    ...Object.fromEntries(targetNodeIdWithLabelGroup.map(({ id, label }) => [
                        id, { 
                            label, 
                            type: targetNodeType, 
                            data: { content: "" } 
                        }
                    ])),
                },
                edges: {}
            };
        }
    };

    // 数据提交主函数 - 现在包含完整的执行逻辑
    const handleDataSubmit = async (...args: any[]) => {
        setIsLoading(true);
        try {
            clearAll();

            const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(parentId);

            if (targetNodeIdWithLabelGroup.length === 0) {
                // 如果没有目标节点，创建一个新的
                await createNewTargetNode();
            } else {
                // 如果有目标节点，直接发送数据
                await sendDataToTargets();
            }
        } catch (error) {
            console.error("Error submitting data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        isLoading,
        handleDataSubmit
    };
}

// 重新导出类型，以便其他文件可以从这里导入
export type {
    BaseNodeData,
    EdgeNodeType,
    BaseEdgeJsonType,
    BaseConstructedJsonData,
    BaseEdgeNodeConfig,
    perplexityModelNames
} from './useEdgeNodeBackEndJsonBuilder'; 