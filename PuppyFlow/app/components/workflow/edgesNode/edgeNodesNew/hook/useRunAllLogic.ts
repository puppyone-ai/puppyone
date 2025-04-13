import { useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, {
    backend_IP_address_for_sendingData,
    BasicNodeData,
    NodeJsonType
} from '../../../../hooks/useJsonConstructUtils';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { 
    useEdgeNodeBackEndJsonBuilder,
    EdgeNodeType,
    BaseConstructedJsonData,
} from './useEdgeNodeBackEndJsonBuilder';
import { useBlockNodeBackEndJsonBuilder } from './useBlockNodeBackEndJsonBuilder';

// Hook 返回值类型
export interface BaseEdgeNodeLogicReturn {
    handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useBaseEdgeNodeLogic({
    constructJsonData: customConstructJsonData,
}: {
    constructJsonData?: () => BaseConstructedJsonData;
} = {}): BaseEdgeNodeLogicReturn {
    // Basic hooks
    const { getNode, setNodes, getNodes, getEdges } = useReactFlow();
    const {
        streamResult,
        reportError,
        resetLoadingUI
    } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();

    // Add hooks for JSON building
    const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
    const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

    // State management
    const [isComplete, setIsComplete] = useState(true);




    // 执行流程
    useEffect(() => {
        if (isComplete) return;

        const processAllNodes = async () => {
            try {
                await sendDataToTargets();
            } catch (error) {
                console.error("Error in processAllNodes:", error);
            }
        };

        processAllNodes();
    }, [isComplete]);


    // 发送数据到目标节点
    const sendDataToTargets = async () => {
        // 获取所有节点
        const allNodes = getNodes();
        
        if (allNodes.length === 0) return;

        // 仅设置结果节点（text、none类型）为加载状态，排除输入节点
        setNodes(prevNodes => prevNodes.map(node => {
            // 检查是否为结果类型节点且不是输入节点
            if ((node.type === 'text' ||  node.type === 'structured') && 
                !node.data.isInput && !node.data.locked) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
            const jsonData = customConstructJsonData ? customConstructJsonData() : constructAllNodesJson();
            console.log("发送到后端的 JSON 数据:", jsonData);

            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                // 只向结果节点报告错误
                allNodes.filter(node => node.type === 'text' || node.type === 'structured').forEach(node => {
                    reportError(node.id, `HTTP Error: ${response.status}`);
                });
                return;
            }

            const result = await response.json();
            console.log('从后端接收到的响应:', result);

            // 处理后端返回的数据并更新节点
            if (result && result.task_id) {
                // 如果后端返回了任务ID，使用流式处理
                // 筛选出所有结果类型节点
                const resultNodes = allNodes.filter(node => 
                    (node.type === 'text' || node.type === 'structured')
                );
                
                await Promise.all(resultNodes.map(node =>
                    streamResult(result.task_id, node.id).then(res => {
                        console.log(`[全局运行] 节点 ${node.id} (类型: ${node.type}) 流式处理完成:`, res);
                        return res;
                    })
                ));
            }
            
        } catch (error) {
            console.error("处理API响应时出错:", error);
            window.alert(error);
        } finally {
            // 只重置非输入的结果节点的加载UI
            allNodes.filter(node => 
                (node.type === 'text' || node.type === 'structured') && 
                !node.data.isInput
            ).forEach(node => {
                resetLoadingUI(node.id);
            });
            setIsComplete(true);
        }
    };

    // 构建包含所有节点的JSON数据
    const constructAllNodesJson = (): BaseConstructedJsonData => {
        try {
            // 获取所有节点和边
            const allNodes = getNodes();
            const reactFlowEdges = getEdges();
            
            // 创建blocks对象
            let blocks: { [key: string]: NodeJsonType } = {};
            let edges: { [key: string]: any } = {};
            
            // 定义哪些节点类型属于 block 节点
            const blockNodeTypes = ['text', 'file', 'weblink', 'structured'];
            
            // 处理所有节点
            allNodes.forEach(node => {
                const nodeId = node.id;
                // 确保 nodeLabel 是字符串类型
                const nodeLabel = node.data?.label || nodeId;
                
                // 根据节点类型决定如何构建JSON
                if (blockNodeTypes.includes(node.type || '')) {
                    try {
                        // 使用区块节点构建函数
                        const blockJson = buildBlockNodeJson(nodeId);
                        
                        // 确保节点标签正确
                        blocks[nodeId] = {
                            ...blockJson,
                            label: String(nodeLabel) // 确保 label 是字符串
                        };
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
                    // 非 block 节点 (edge节点)
                    try {
                        // 构建边的JSON并添加到edges对象中
                        const edgeJson = buildEdgeNodeJson(nodeId);
                        edges[nodeId] = edgeJson;
                    } catch (e) {
                        console.warn(`无法构建边节点 ${nodeId} 的JSON:`, e);
                    }
                }
            });
            
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
    };

    // 数据提交主函数
    const handleDataSubmit = async (...args: any[]) => {
        try {
            await new Promise(resolve => {
                clearAll();
                resolve(null);
            });
            
            setIsComplete(false);
        } catch (error) {
            console.error("Error submitting data:", error);
        }
    };

    return {
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