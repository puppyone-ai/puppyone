import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
    backend_IP_address_for_sendingData,
    BasicNodeData,
    NodeJsonType
} from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { useAppSettings } from '../../../../states/AppSettingsContext';
import {
    useEdgeNodeBackEndJsonBuilder,
    EdgeNodeType,
    BaseConstructedJsonData,
} from './useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from './useBlockNodeBackEndJsonBuilder';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';

// Hook 返回值类型
export interface GroupNodeLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useRunGroupNodeLogic({
    groupNodeId,
    constructJsonData: customConstructJsonData,
}: {
    groupNodeId: string;
    constructJsonData?: () => BaseConstructedJsonData;
}): GroupNodeLogicReturn {

    // Basic hooks
    const { getNode, setNodes, getNodes } = useReactFlow();
    const {
        streamResult,
        streamResultForMultipleNodes,
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
    const [isComplete, setIsComplete] = useState(true);

    // 步骤1: 获取组内所有的 BlockNode
    const getGroupBlockNodes = () => {
        const allNodes = getNodes();
        
        // 定义blockNode的类型
        const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

        // 筛选出组内的 blockNodes - 检查 groupIds 数组
        const groupBlockNodes = allNodes.filter(node => {
            const groupIds = (node.data as any)?.groupIds;
            const isInGroup = Array.isArray(groupIds) && groupIds.includes(groupNodeId);
            const isBlockNode = blockNodeTypes.includes(node.type || '');
            return isInGroup && isBlockNode;
        });

        return groupBlockNodes.map(node => ({
            id: node.id,
            label: String(node.data?.label || node.id)
        }));
    };

    // 步骤1: 根据组内的blocknode找到它的input和output的edgenode
    const collectAllRelatedEdgeNodes = (blockNodes: { id: string, label: string }[]) => {
        const allEdgeNodes = new Set<string>();

        blockNodes.forEach(blockNode => {
            // 获取每个blockNode的源节点（连入该block的edge nodes）
            const sourceNodes = getSourceNodeIdWithLabel(blockNode.id, 'edgenode');
            sourceNodes.forEach(sourceNode => {
                allEdgeNodes.add(sourceNode.id);
            });

            // 获取每个blockNode的目标节点（从该block连出的edge nodes）
            const targetNodes = getTargetNodeIdWithLabel(blockNode.id, 'edgenode');
            targetNodes.forEach(targetNode => {
                allEdgeNodes.add(targetNode.id);
            });
        });

        return Array.from(allEdgeNodes);
    };

    // 步骤2: 确定哪些edgenode要被提交到后端：input和output都至少有一个blocknode在group里面
    const filterValidEdgeNodes = (edgeNodeIds: string[], groupBlockNodeIds: string[]) => {
        const validEdgeNodes: string[] = [];
        const groupBlockNodeSet = new Set(groupBlockNodeIds);

        edgeNodeIds.forEach(edgeNodeId => {
            // 获取该edge node的输入节点（source nodes）
            const inputNodes = getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
            const inputNodeIds = inputNodes.map(node => node.id);

            // 获取该edge node的输出节点（target nodes）
            const outputNodes = getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
            const outputNodeIds = outputNodes.map(node => node.id);

            // 检查input中是否有至少一个在组内
            const hasInputInGroup = inputNodeIds.some(nodeId => groupBlockNodeSet.has(nodeId));
            
            // 检查output中是否有至少一个在组内
            const hasOutputInGroup = outputNodeIds.some(nodeId => groupBlockNodeSet.has(nodeId));

            // 只有当input和output都至少有一个在组内时，才认为这个edge node是有效的
            if (hasInputInGroup && hasOutputInGroup) {
                validEdgeNodes.push(edgeNodeId);
                console.log(`✅ Edge node ${edgeNodeId} 有效: input有${inputNodeIds.filter(id => groupBlockNodeSet.has(id)).length}个在组内, output有${outputNodeIds.filter(id => groupBlockNodeSet.has(id)).length}个在组内`);
            } else {
                console.log(`❌ Edge node ${edgeNodeId} 无效: input有${inputNodeIds.filter(id => groupBlockNodeSet.has(id)).length}个在组内, output有${outputNodeIds.filter(id => groupBlockNodeSet.has(id)).length}个在组内`);
            }
        });

        return validEdgeNodes;
    };

    // 步骤3: 根据确定好的要提交到后端的edgenode，找到所有input和output的blocknode（无论在不在group里面），然后剔除相同的
    const collectAllRelatedBlockNodes = (validEdgeNodeIds: string[]) => {
        const allBlockNodes = new Set<string>();

        // 处理每个有效的edge node
        validEdgeNodeIds.forEach(edgeNodeId => {
            console.log(`🔍 处理edge node: ${edgeNodeId}`);
            
            // 获取该edge node的输入节点（source nodes）- 全部添加（无论在不在组内）
            const inputNodes = getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
            inputNodes.forEach(inputNode => {
                allBlockNodes.add(inputNode.id);
                console.log(`  📥 添加input block node: ${inputNode.id}`);
            });

            // 获取该edge node的输出节点（target nodes）- 全部添加（无论在不在组内）
            const outputNodes = getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
            outputNodes.forEach(outputNode => {
                allBlockNodes.add(outputNode.id);
                console.log(`  📤 添加output block node: ${outputNode.id}`);
            });
        });

        const result = Array.from(allBlockNodes);
        console.log(`📊 最终收集到的block nodes: ${result.length}个`, result);
        return result;
    };

    // 构建包含所有相关节点的JSON数据
    const constructGroupNodeJson = (): BaseConstructedJsonData => {
        try {
            // 步骤1: 获取组内所有 block nodes
            const groupBlockNodes = getGroupBlockNodes();

            if (groupBlockNodes.length === 0) {
                console.warn('没有找到组内的BlockNode');
                return { blocks: {}, edges: {} };
            }

            const groupBlockNodeIds = groupBlockNodes.map(node => node.id);
            console.log('🎯 步骤1 - 组内的block nodes:', groupBlockNodeIds);

            // 步骤1: 根据组内的blocknode找到它的input和output的edgenode
            const allRelatedEdgeNodeIds = collectAllRelatedEdgeNodes(groupBlockNodes);
            console.log('🔗 步骤1 - 所有相关的edge nodes:', allRelatedEdgeNodeIds);

            // 步骤2: 确定哪些edgenode要被提交到后端
            const validEdgeNodeIds = filterValidEdgeNodes(allRelatedEdgeNodeIds, groupBlockNodeIds);
            console.log('✅ 步骤2 - 有效的edge nodes:', validEdgeNodeIds);

            // 步骤3: 根据确定好的edgenode，找到所有input和output的blocknode（无论在不在组内）
            const allRelatedBlockNodeIds = collectAllRelatedBlockNodes(validEdgeNodeIds);
            console.log('📦 步骤3 - 所有相关的block nodes:', allRelatedBlockNodeIds);

            // 步骤4: 使用确定要提交到后端的blocknode和edgenode构建JSON
            let blocks: { [key: string]: NodeJsonType } = {};
            let edges: { [key: string]: any } = {};

            // 定义哪些节点类型属于 block 节点
            const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

            // 构建所有相关的block nodes
            allRelatedBlockNodeIds.forEach(blockNodeId => {
                const node = getNode(blockNodeId);
                if (!node) return;

                const nodeLabel = node.data?.label || blockNodeId;

                if (blockNodeTypes.includes(node.type || '')) {
                    try {
                        // 使用区块节点构建函数
                        const blockJson = buildBlockNodeJson(blockNodeId);

                        blocks[blockNodeId] = {
                            ...blockJson,
                            label: String(nodeLabel)
                        };
                    } catch (e) {
                        console.warn(`无法使用blockNodeBuilder构建节点 ${blockNodeId}:`, e);

                        // 回退到默认行为
                        blocks[blockNodeId] = {
                            label: String(nodeLabel),
                            type: node.type || '',
                            data: { ...node.data } as BasicNodeData
                        };
                    }
                }
            });

            // 构建所有有效的 edge nodes的JSON
            validEdgeNodeIds.forEach(edgeNodeId => {
                try {
                    const edgeJson = buildEdgeNodeJson(edgeNodeId);
                    edges[edgeNodeId] = edgeJson;
                } catch (e) {
                    console.warn(`无法构建边节点 ${edgeNodeId} 的JSON:`, e);
                }
            });

            // 去重逻辑：如果有相同的edge node，则删除
            const uniqueEdges: { [key: string]: any } = {};
            const edgeSignatures = new Map<string, string>();

            Object.entries(edges).forEach(([edgeId, edgeData]) => {
                // 创建边的签名，基于类型和数据内容
                const signature = JSON.stringify({
                    type: edgeData.type,
                    data: edgeData.data
                });

                const existingEdgeId = edgeSignatures.get(signature);
                if (existingEdgeId) {
                    console.log(`🔄 发现重复的边节点: ${edgeId} 与 ${existingEdgeId} 相同，删除 ${edgeId}`);
                    // 不添加到uniqueEdges中，相当于删除
                } else {
                    edgeSignatures.set(signature, edgeId);
                    uniqueEdges[edgeId] = edgeData;
                }
            });

            console.log('🚀 步骤4 - 最终构建的JSON:', { 
                blocks: Object.keys(blocks), 
                edges: Object.keys(uniqueEdges) 
            });

            return {
                blocks,
                edges: uniqueEdges
            };
        } catch (error) {
            console.error(`构建GroupNode JSON 时出错: ${error}`);

            // 如果出错，返回空结构
            return {
                blocks: {},
                edges: {}
            };
        }
    };

    // 步骤5: 发送数据到后端并保持现有的更新逻辑
    const sendDataToTargets = async () => {
        const groupBlockNodes = getGroupBlockNodes();

        if (groupBlockNodes.length === 0) {
            console.warn('没有找到组内的BlockNode');
            return;
        }

        const jsonData = customConstructJsonData ? customConstructJsonData() : constructGroupNodeJson();
        console.log("GroupNode 发送到后端的 JSON 数据:", jsonData);

        // 找到所有作为edge output的block nodes
        const blockNodesAsEdgeOutput = new Set<string>();
        Object.values(jsonData.edges).forEach(edge => {
            if (edge.data && edge.data.outputs) {
                Object.values(edge.data.outputs).forEach(outputId => {
                    if (typeof outputId === 'string') {
                        blockNodesAsEdgeOutput.add(outputId);
                    }
                });
            }
        });

        console.log('🎯 作为edge output的block nodes:', Array.from(blockNodesAsEdgeOutput));

        // 找到开始的block nodes（不作为任何edge的output的block）
        const startBlockNodes = new Set<string>();
        Object.keys(jsonData.blocks).forEach(blockId => {
            if (!blockNodesAsEdgeOutput.has(blockId)) {
                startBlockNodes.add(blockId);
            }
        });

        console.log('🚀 开始的block nodes:', Array.from(startBlockNodes));

        // 确定要设置为加载状态的节点：只包括组内的且作为edge output的block nodes
        const outputNodeIds = new Set<string>();
        groupBlockNodes.forEach(blockNode => {
            // 只有当这个block node确实在最终的blocks中，且作为edge的output时，才作为输出节点
            if (jsonData.blocks[blockNode.id] && blockNodesAsEdgeOutput.has(blockNode.id)) {
                outputNodeIds.add(blockNode.id);
            }
        });

        console.log('⏳ 将被设置为加载状态的block nodes:', Array.from(outputNodeIds));

        // 找到组内的开始节点
        const groupStartNodes = new Set<string>();
        groupBlockNodes.forEach(blockNode => {
            if (jsonData.blocks[blockNode.id] && startBlockNodes.has(blockNode.id)) {
                groupStartNodes.add(blockNode.id);
            }
        });

        console.log('🎯 组内的开始节点（将设为isWaitingForFlow）:', Array.from(groupStartNodes));

        // 设置节点状态
        setNodes(prevNodes => prevNodes.map(node => {
            if (groupStartNodes.has(node.id)) {
                // 组内的开始节点设为isWaitingForFlow
                console.log(`🎯 设置node ${node.id} 为等待flow状态`);
                return { ...node, data: { ...node.data, isWaitingForFlow: true } };
            } else if (outputNodeIds.has(node.id)) {
                // 组内的输出节点设为isLoading
                console.log(`⏳ 设置node ${node.id} 为加载状态`);
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                outputNodeIds.forEach(nodeId => {
                    if (nodeId) reportError(nodeId, `HTTP Error: ${response.status}`);
                });
                return;
            }

            const result = await response.json();
            console.log('GroupNode 从后端接收到的响应:', result);

            // 处理后端返回的数据并更新节点
            if (result && result.task_id) {
                // 使用输出节点的ID进行流式处理
                const resultNodeIds = Array.from(outputNodeIds);
                
                // 使用流式处理
                await streamResultForMultipleNodes(result.task_id, resultNodeIds).then(res => {
                    console.log(`[GroupNode运行] 所有节点流式处理完成:`, res);
                    
                    // 清空所有group里面的blocknode的isWaitingForFlow状态
                    const allGroupBlockNodeIds = groupBlockNodes.map(node => node.id);
                    setNodes(prevNodes => prevNodes.map(node => {
                        if (allGroupBlockNodeIds.includes(node.id)) {
                            return {
                                ...node,
                                data: {
                                    ...node.data,
                                    isWaitingForFlow: false
                                }
                            };
                        }
                        return node;
                    }));
                    
                    return res;
                });
            }
            
        } catch (error) {
            console.error("GroupNode 处理API响应时出错:", error);
            window.alert(error);
        }
    };

    // 添加useEffect来处理异步流程
    useEffect(() => {
        if (isComplete) return;

        const processGroupNode = async () => {
            try {
                await sendDataToTargets();
            } catch (error) {
                console.error("GroupNode 处理过程中出错:", error);
            } finally {
                setIsComplete(true);
                setIsLoading(false);
            }
        };

        processGroupNode();
    }, [isComplete]);

    // 修改数据提交主函数
    const handleDataSubmit = async (...args: any[]) => {
        if (!isComplete) return;  // 防止重复提交

        setIsLoading(true);
        clearAll();
        setIsComplete(false);  // 触发useEffect
    };

    return {
        isLoading,
        handleDataSubmit
    };
} 