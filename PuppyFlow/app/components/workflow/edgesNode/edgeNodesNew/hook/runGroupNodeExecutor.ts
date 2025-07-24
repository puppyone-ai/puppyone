import { 
    backend_IP_address_for_sendingData,
    BasicNodeData,
    NodeJsonType
} from '../../../../hooks/useJsonConstructUtils';
import { BaseConstructedJsonData } from './hookhistory/useEdgeNodeBackEndJsonBuilder';
import { buildBlockNodeJson, BlockNodeBuilderContext } from './blockNodeJsonBuilders';
import { buildEdgeNodeJson, EdgeNodeBuilderContext } from './edgeNodeJsonBuilders';

// 导入NodeCategory类型定义
type NodeCategory = 'blocknode' | 'edgenode' | 'servernode' | 'groupnode' | 'all';

// 组节点执行上下文接口
export interface RunGroupNodeContext {
    // React Flow 相关
    getNode: (id: string) => any;
    getNodes: () => any[];
    setNodes: (updater: (nodes: any[]) => any[]) => void;
    
    // 工具函数
    getSourceNodeIdWithLabel: (parentId: string, category?: NodeCategory) => { id: string, label: string }[];
    getTargetNodeIdWithLabel: (parentId: string, category?: NodeCategory) => { id: string, label: string }[];
    clearAll: () => void;
    
    // 通信相关
    streamResult: (taskId: string, nodeId: string) => Promise<any>;
    streamResultForMultipleNodes: (taskId: string, nodeIds: string[]) => Promise<any>;
    reportError: (nodeId: string, error: string) => void;
    resetLoadingUI: (nodeId: string) => void;
    getAuthHeaders: () => HeadersInit;
}

// 步骤1: 获取组内所有的 BlockNode
function getGroupBlockNodes(groupNodeId: string, context: RunGroupNodeContext) {
    console.log(`📊 [getGroupBlockNodes] 开始执行 - groupNodeId: ${groupNodeId}`);
    
    const allNodes = context.getNodes();
    console.log(`📊 [getGroupBlockNodes] 获取所有节点数量: ${allNodes.length}`);
    
    // 定义blockNode的类型
    const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

    // 筛选出组内的 blockNodes - 检查 groupIds 数组
    const groupBlockNodes = allNodes.filter(node => {
        const groupIds = (node.data as any)?.groupIds;
        const isInGroup = Array.isArray(groupIds) && groupIds.includes(groupNodeId);
        const isBlockNode = blockNodeTypes.includes(node.type || '');
        return isInGroup && isBlockNode;
    });

    console.log(`📊 [getGroupBlockNodes] 组内BlockNode数量: ${groupBlockNodes.length}`);
    
    const result = groupBlockNodes.map(node => ({
        id: node.id,
        label: String(node.data?.label || node.id)
    }));
    
    console.log(`📊 [getGroupBlockNodes] 执行完成，返回:`, result);
    return result;
}

// 步骤1: 根据组内的blocknode找到它的input和output的edgenode
function collectAllRelatedEdgeNodes(blockNodes: { id: string, label: string }[], context: RunGroupNodeContext) {
    console.log(`🔗 [collectAllRelatedEdgeNodes] 开始执行 - 处理${blockNodes.length}个block nodes`);
    
    const allEdgeNodes = new Set<string>();

    blockNodes.forEach(blockNode => {
        console.log(`🔗 [collectAllRelatedEdgeNodes] 处理blockNode: ${blockNode.id}`);
        
        // 获取每个blockNode的源节点（连入该block的edge nodes）
        const sourceNodes = context.getSourceNodeIdWithLabel(blockNode.id, 'edgenode');
        console.log(`🔗 [collectAllRelatedEdgeNodes] ${blockNode.id} 的源节点数量: ${sourceNodes.length}`);
        
        sourceNodes.forEach(sourceNode => {
            allEdgeNodes.add(sourceNode.id);
        });

        // 获取每个blockNode的目标节点（从该block连出的edge nodes）
        const targetNodes = context.getTargetNodeIdWithLabel(blockNode.id, 'edgenode');
        console.log(`🔗 [collectAllRelatedEdgeNodes] ${blockNode.id} 的目标节点数量: ${targetNodes.length}`);
        
        targetNodes.forEach(targetNode => {
            allEdgeNodes.add(targetNode.id);
        });
    });

    const result = Array.from(allEdgeNodes);
    console.log(`🔗 [collectAllRelatedEdgeNodes] 执行完成，找到${result.length}个edge nodes`);
    return result;
}

// 步骤2: 确定哪些edgenode要被提交到后端：input和output都至少有一个blocknode在group里面
function filterValidEdgeNodes(edgeNodeIds: string[], groupBlockNodeIds: string[], context: RunGroupNodeContext) {
    console.log(`✅ [filterValidEdgeNodes] 开始执行 - 处理${edgeNodeIds.length}个edge nodes`);
    
    const validEdgeNodes: string[] = [];
    const groupBlockNodeSet = new Set(groupBlockNodeIds);

    edgeNodeIds.forEach(edgeNodeId => {
        console.log(`✅ [filterValidEdgeNodes] 处理edge node: ${edgeNodeId}`);
        
        // 获取该edge node的输入节点（source nodes）
        const inputNodes = context.getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
        const inputNodeIds = inputNodes.map(node => node.id);

        // 获取该edge node的输出节点（target nodes）
        const outputNodes = context.getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
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

    console.log(`✅ [filterValidEdgeNodes] 执行完成，${validEdgeNodes.length}个有效edge nodes`);
    return validEdgeNodes;
}

// 步骤3: 根据确定好的要提交到后端的edgenode，找到所有input和output的blocknode（无论在不在group里面），然后剔除相同的
function collectAllRelatedBlockNodes(validEdgeNodeIds: string[], context: RunGroupNodeContext) {
    console.log(`📦 [collectAllRelatedBlockNodes] 开始执行 - 处理${validEdgeNodeIds.length}个有效edge nodes`);
    
    const allBlockNodes = new Set<string>();

    // 处理每个有效的edge node
    validEdgeNodeIds.forEach(edgeNodeId => {
        console.log(`🔍 处理edge node: ${edgeNodeId}`);
        
        // 获取该edge node的输入节点（source nodes）- 全部添加（无论在不在组内）
        const inputNodes = context.getSourceNodeIdWithLabel(edgeNodeId, 'blocknode');
        inputNodes.forEach(inputNode => {
            allBlockNodes.add(inputNode.id);
            console.log(`  📥 添加input block node: ${inputNode.id}`);
        });

        // 获取该edge node的输出节点（target nodes）- 全部添加（无论在不在组内）
        const outputNodes = context.getTargetNodeIdWithLabel(edgeNodeId, 'blocknode');
        outputNodes.forEach(outputNode => {
            allBlockNodes.add(outputNode.id);
            console.log(`  📤 添加output block node: ${outputNode.id}`);
        });
    });

    const result = Array.from(allBlockNodes);
    console.log(`📊 最终收集到的block nodes: ${result.length}个`, result);
    return result;
}

// 构建包含所有相关节点的JSON数据
function constructGroupNodeJson(groupNodeId: string, context: RunGroupNodeContext, customConstructJsonData?: () => BaseConstructedJsonData): BaseConstructedJsonData {
    console.log(`🚀 [constructGroupNodeJson] 开始构建JSON数据`);
    
    if (customConstructJsonData) {
        return customConstructJsonData();
    }
    
    try {
        // 步骤1: 获取组内所有 block nodes
        const groupBlockNodes = getGroupBlockNodes(groupNodeId, context);

        if (groupBlockNodes.length === 0) {
            console.warn('没有找到组内的BlockNode');
            return { blocks: {}, edges: {} };
        }

        const groupBlockNodeIds = groupBlockNodes.map(node => node.id);
        console.log('🎯 步骤1 - 组内的block nodes:', groupBlockNodeIds);

        // 步骤1: 根据组内的blocknode找到它的input和output的edgenode
        const allRelatedEdgeNodeIds = collectAllRelatedEdgeNodes(groupBlockNodes, context);
        console.log('🔗 步骤1 - 所有相关的edge nodes:', allRelatedEdgeNodeIds);

        // 步骤2: 确定哪些edgenode要被提交到后端
        const validEdgeNodeIds = filterValidEdgeNodes(allRelatedEdgeNodeIds, groupBlockNodeIds, context);
        console.log('✅ 步骤2 - 有效的edge nodes:', validEdgeNodeIds);

        // 步骤3: 根据确定好的edgenode，找到所有input和output的blocknode（无论在不在组内）
        const allRelatedBlockNodeIds = collectAllRelatedBlockNodes(validEdgeNodeIds, context);
        console.log('📦 步骤3 - 所有相关的block nodes:', allRelatedBlockNodeIds);

        // 步骤4: 使用确定要提交到后端的blocknode和edgenode构建JSON
        console.log(`🔧 [constructGroupNodeJson] 开始构建blocks和edges`);
        
        let blocks: { [key: string]: NodeJsonType } = {};
        let edges: { [key: string]: any } = {};

        // 定义哪些节点类型属于 block 节点
        const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];

        // 创建 BlockNode 构建上下文
        const blockContext: BlockNodeBuilderContext = {
            getNode: context.getNode
        };
        
        // 创建 EdgeNode 构建上下文
        const edgeContext: EdgeNodeBuilderContext = {
            getNode: context.getNode,
            getSourceNodeIdWithLabel: context.getSourceNodeIdWithLabel,
            getTargetNodeIdWithLabel: context.getTargetNodeIdWithLabel
        };

        // 构建所有相关的block nodes
        allRelatedBlockNodeIds.forEach(blockNodeId => {
            console.log(`🔧 [constructGroupNodeJson] 构建block node: ${blockNodeId}`);
            
            const node = context.getNode(blockNodeId);
            if (!node) return;

            const nodeLabel = node.data?.label || blockNodeId;

            if (blockNodeTypes.includes(node.type || '')) {
                try {
                    // 使用区块节点构建函数
                    const blockJson = buildBlockNodeJson(blockNodeId, blockContext);

                    blocks[blockNodeId] = {
                        ...blockJson,
                        label: String(nodeLabel)
                    };
                    console.log(`✅ [constructGroupNodeJson] 成功构建block node: ${blockNodeId}`);
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
            console.log(`🔧 [constructGroupNodeJson] 构建edge node: ${edgeNodeId}`);
            
            try {
                const edgeJson = buildEdgeNodeJson(edgeNodeId, edgeContext);
                edges[edgeNodeId] = edgeJson;
                console.log(`✅ [constructGroupNodeJson] 成功构建edge node: ${edgeNodeId}`);
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
}

// 步骤5: 发送数据到后端并保持现有的更新逻辑
async function sendGroupDataToTargets(groupNodeId: string, context: RunGroupNodeContext, customConstructJsonData?: () => BaseConstructedJsonData): Promise<void> {
    console.log(`🚀 [sendGroupDataToTargets] 开始发送数据到后端`);
    
    const groupBlockNodes = getGroupBlockNodes(groupNodeId, context);

    if (groupBlockNodes.length === 0) {
        console.warn('没有找到组内的BlockNode');
        return;
    }

    const jsonData = constructGroupNodeJson(groupNodeId, context, customConstructJsonData);
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
    context.setNodes(prevNodes => prevNodes.map(node => {
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
        console.log(`🌐 [sendGroupDataToTargets] 开始发送HTTP请求`);
        
        const response = await fetch(`${backend_IP_address_for_sendingData}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...context.getAuthHeaders(),
            },
            body: JSON.stringify(jsonData)
        });

        if (!response.ok) {
            outputNodeIds.forEach(nodeId => {
                if (nodeId) context.reportError(nodeId, `HTTP Error: ${response.status}`);
            });
            return;
        }

        const result = await response.json();
        console.log('GroupNode 从后端接收到的响应:', result);

        // 处理后端返回的数据并更新节点
        if (result && result.task_id) {
            console.log(`🔄 [sendGroupDataToTargets] 开始流式处理，task_id: ${result.task_id}`);
            
            // 使用输出节点的ID进行流式处理
            const resultNodeIds = Array.from(outputNodeIds);
            
            // 使用流式处理
            await context.streamResultForMultipleNodes(result.task_id, resultNodeIds).then(res => {
                console.log(`[GroupNode运行] 所有节点流式处理完成:`, res);
                
                // 清空所有group里面的blocknode的isWaitingForFlow状态
                const allGroupBlockNodeIds = groupBlockNodes.map(node => node.id);
                context.setNodes(prevNodes => prevNodes.map(node => {
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
}

// 主执行函数
export async function runGroupNode({
    groupNodeId,
    context,
    constructJsonData
}: {
    groupNodeId: string;
    context: RunGroupNodeContext;
    constructJsonData?: () => BaseConstructedJsonData;
}): Promise<void> {
    console.log(`🚀 [runGroupNode] 开始执行 - groupNodeId: ${groupNodeId}`);
    
    try {
        context.clearAll();
        await sendGroupDataToTargets(groupNodeId, context, constructJsonData);
    } catch (error) {
        console.error("Error executing group node:", error);
        throw error;
    }
}

// 新增：只构建JSON数据而不执行的函数
export function buildGroupNodeJson({
    groupNodeId,
    context,
    constructJsonData
}: {
    groupNodeId: string;
    context: RunGroupNodeContext;
    constructJsonData?: () => BaseConstructedJsonData;
}): BaseConstructedJsonData {
    console.log(`🔧 [buildGroupNodeJson] 开始构建JSON数据 - groupNodeId: ${groupNodeId}`);
    
    try {
        // 直接调用JSON构建函数，不执行发送和状态更新
        const jsonData = constructGroupNodeJson(groupNodeId, context, constructJsonData);
        
        console.log(`✅ [buildGroupNodeJson] JSON构建完成:`, {
            blocksCount: Object.keys(jsonData.blocks).length,
            edgesCount: Object.keys(jsonData.edges).length,
            blockIds: Object.keys(jsonData.blocks),
            edgeIds: Object.keys(jsonData.edges)
        });
        
        return jsonData;
    } catch (error) {
        console.error("Error building group node JSON:", error);
        throw error;
    }
} 