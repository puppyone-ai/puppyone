// 全局运行所有节点执行函数（对应 useRunAllLogic）

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

// 全局运行所有节点执行上下文接口
export interface RunAllNodesContext {
    // React Flow 相关
    getNode: (id: string) => any;
    getNodes: () => any[];
    getEdges: () => any[];
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

// 构建包含所有节点的JSON数据
function constructAllNodesJson(context: RunAllNodesContext, customConstructJsonData?: () => BaseConstructedJsonData): BaseConstructedJsonData {
    console.log(`🔧 [constructAllNodesJson] 开始构建所有节点的JSON数据`);
    
    if (customConstructJsonData) {
        return customConstructJsonData();
    }
    
    try {
        // 获取所有节点和边
        const allNodes = context.getNodes();
        const reactFlowEdges = context.getEdges();
        
        console.log(`📊 [constructAllNodesJson] 所有节点数量: ${allNodes.length}, 边数量: ${reactFlowEdges.length}`);
        
        // 创建blocks对象
        let blocks: { [key: string]: NodeJsonType } = {};
        let edges: { [key: string]: any } = {};
        
        // 定义哪些节点类型属于 block 节点
        const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];
        
        // 创建构建上下文
        const blockContext: BlockNodeBuilderContext = {
            getNode: context.getNode
        };
        
        const edgeContext: EdgeNodeBuilderContext = {
            getNode: context.getNode,
            getSourceNodeIdWithLabel: context.getSourceNodeIdWithLabel,
            getTargetNodeIdWithLabel: context.getTargetNodeIdWithLabel
        };
        
        // 处理所有节点
        allNodes.forEach(node => {
            const nodeId = node.id;
            // 确保 nodeLabel 是字符串类型
            const nodeLabel = node.data?.label || nodeId;
            
            console.log(`🔧 [constructAllNodesJson] 处理节点: ${nodeId}, 类型: ${node.type}`);
            
            // 根据节点类型决定如何构建JSON
            if (blockNodeTypes.includes(node.type || '')) {
                console.log(`📦 [constructAllNodesJson] 构建block节点: ${nodeId}`);
                
                try {
                    // 使用区块节点构建函数
                    const blockJson = buildBlockNodeJson(nodeId, blockContext);
                    
                    // 确保节点标签正确
                    blocks[nodeId] = {
                        ...blockJson,
                        label: String(nodeLabel) // 确保 label 是字符串
                    };
                    
                    console.log(`✅ [constructAllNodesJson] 成功构建block节点: ${nodeId}`);
                } catch (e) {
                    console.warn(`无法使用blockNodeBuilder构建节点 ${nodeId}:`, e);
                    
                    // 回退到默认行为
                    blocks[nodeId] = {
                        label: String(nodeLabel), // 确保 label 是字符串
                        type: node.type || '',
                        data: {...node.data} as BasicNodeData // 确保复制数据而不是引用
                    };
                }
            } else {
                console.log(`🔗 [constructAllNodesJson] 构建edge节点: ${nodeId}`);
                
                // 非 block 节点 (edge节点)
                try {
                    // 构建边的JSON并添加到edges对象中
                    const edgeJson = buildEdgeNodeJson(nodeId, edgeContext);
                    edges[nodeId] = edgeJson;
                    
                    console.log(`✅ [constructAllNodesJson] 成功构建edge节点: ${nodeId}`);
                } catch (e) {
                    console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
                }
            }
        });
        
        console.log(`🚀 [constructAllNodesJson] 构建完成 - blocks: ${Object.keys(blocks).length}, edges: ${Object.keys(edges).length}`);
        
        return {
            blocks,
            edges
        };
    } catch (error) {
        console.error(`构建全节点 JSON 时出错: ${error}`);
        
        // 如果出错，返回空结构
        return {
            blocks: {},
            edges: {}
        };
    }
}

// 发送数据到目标节点
async function sendDataToTargets(context: RunAllNodesContext, customConstructJsonData?: () => BaseConstructedJsonData): Promise<void> {
    console.log(`🚀 [sendDataToTargets] 开始发送数据到目标节点`);
    
    // 获取所有节点
    const allNodes = context.getNodes();
    console.log(`📊 [sendDataToTargets] 获取所有节点数量: ${allNodes.length}`);
    
    if (allNodes.length === 0) {
        console.log(`❌ [sendDataToTargets] 没有节点，直接返回`);
        return;
    }

    // 仅设置结果节点（text、structured类型）为加载状态，排除输入节点
    const resultNodes = allNodes.filter(node => 
        (node.type === 'text' || node.type === 'structured') && 
        !node.data.isInput && !node.data.locked
    );
    console.log(`📊 [sendDataToTargets] 找到${resultNodes.length}个结果节点需要设置为加载状态`);

    context.setNodes(prevNodes => prevNodes.map(node => {
        // 检查是否为结果类型节点且不是输入节点
        if ((node.type === 'text' ||  node.type === 'structured') && 
            !node.data.isInput && !node.data.locked) {
            return { ...node, data: { ...node.data, content: "", isLoading: true } };
        }
        return node;
    }));

    try {
        console.log(`🔧 [sendDataToTargets] 开始构建JSON数据`);
        
        // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
        const jsonData = constructAllNodesJson(context, customConstructJsonData);
        console.log("发送到后端的 JSON 数据:", jsonData);

        console.log(`🌐 [sendDataToTargets] 开始发送HTTP请求`);
        
        const response = await fetch(`${backend_IP_address_for_sendingData}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...context.getAuthHeaders(),
            },
            body: JSON.stringify(jsonData)
        });

        if (!response.ok) {
            console.error(`❌ [sendDataToTargets] HTTP请求失败: ${response.status}`);
            
            // 只向结果节点报告错误
            allNodes.filter(node => node.type === 'text' || node.type === 'structured').forEach(node => {
                context.reportError(node.id, `HTTP Error: ${response.status}`);
            });
            return;
        }

        const result = await response.json();
        console.log('从后端接收到的响应:', result);

        // 处理后端返回的数据并更新节点
        if (result && result.task_id) {
            console.log(`🔄 [sendDataToTargets] 开始流式处理，task_id: ${result.task_id}`);
            
            // 如果后端返回了任务ID，使用流式处理
            // 筛选出所有结果类型节点
            const resultNodes = allNodes.filter(node => 
                (node.type === 'text' || node.type === 'structured')
            );
            
            console.log(`📊 [sendDataToTargets] 准备流式处理${resultNodes.length}个结果节点`);
            
            // 使用streamResultForMultipleNodes替代对每个节点调用streamResult
            const resultNodeIds = resultNodes.map(node => node.id);
            await context.streamResultForMultipleNodes(result.task_id, resultNodeIds).then(res => {
                console.log(`[全局运行] 所有节点流式处理完成:`, res);
                return res;
            });
        }
        
    } catch (error) {
        console.error("处理API响应时出错:", error);
        window.alert(error);
    } finally {
        console.log(`🔄 [sendDataToTargets] 开始重置加载UI`);
        
        // 只重置非输入的结果节点的加载UI
        const nodesToReset = allNodes.filter(node => 
            (node.type === 'text' || node.type === 'structured') && 
            !node.data.isInput
        );
        
        console.log(`📊 [sendDataToTargets] 重置${nodesToReset.length}个节点的加载UI`);
        
        nodesToReset.forEach(node => {
            context.resetLoadingUI(node.id);
        });
    }
}

// 主执行函数
export async function runAllNodes({
    context,
    constructJsonData,
    onComplete,
    onStart
}: {
    context: RunAllNodesContext;
    constructJsonData?: () => BaseConstructedJsonData;
    onComplete?: () => void;
    onStart?: () => void;
}): Promise<void> {
    console.log(`🚀 [runAllNodes] 开始执行全局运行`);
    
    try {
        // 清空所有状态
        context.clearAll();
        
        // 添加开始回调
        if (onStart) {
            console.log(`🔄 [runAllNodes] 调用onStart回调`);
            onStart();
        }
        
        // 发送数据到后端
        await sendDataToTargets(context, constructJsonData);
        
        // 添加完成回调
        if (onComplete) {
            console.log(`🔄 [runAllNodes] 调用onComplete回调`);
            onComplete();
        }
        
    } catch (error) {
        console.error("Error executing runAllNodes:", error);
        throw error;
    }
} 