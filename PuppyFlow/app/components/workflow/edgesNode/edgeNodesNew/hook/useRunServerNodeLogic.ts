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

// Hook 返回值类型
export interface ServerNodeLogicReturn {
    isLoading: boolean;
    handleDataSubmit: (...args: any[]) => Promise<void>;
}

export function useRunServerNodeLogic({
    serverNodeId,
    constructJsonData: customConstructJsonData,
}: {
    serverNodeId: string;
    constructJsonData?: () => BaseConstructedJsonData;
}): ServerNodeLogicReturn {
    
    // Basic hooks
    const { getNode, setNodes, getNodes } = useReactFlow();
    const {
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        streamResult,
        streamResultForMultipleNodes,
        reportError,
        resetLoadingUI
    } = useJsonConstructUtils();
    const { clearAll } = useNodesPerFlowContext();
    const { getAuthHeaders } = useAppSettings();

    // Add hooks for JSON building
    const { buildEdgeNodeJson } = useEdgeNodeBackEndJsonBuilder();
    const { buildBlockNodeJson } = useBlockNodeBackEndJsonBuilder();

    // State management
    const [isLoading, setIsLoading] = useState(false);
    const [isComplete, setIsComplete] = useState(true);

    // 获取所有连接到ServerNode的targetNodes中的edgeNode
    const getTargetEdgeNodes = () => {
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(serverNodeId);
        
        // 定义edgeNode的类型
        const edgeNodeTypes = [
            'copy', 'chunkingAuto', 'chunkingByCharacter', 'chunkingByLength', 
            'convert2structured', 'convert2text', 'editText', 'retrieving',
            'searchGoogle', 'searchPerplexity', 'llmnew', 'ifelse'
        ];
        
        // 筛选出edgeNodes
        const edgeNodes = targetNodeIdWithLabelGroup.filter(targetNode => {
            const node = getNode(targetNode.id);
            return node && edgeNodeTypes.includes(node.type || '');
        });
        
        return edgeNodes;
    };

    // 收集所有相关的块节点
    const collectAllRelatedBlockNodes = (edgeNodes: { id: string, label: string }[]) => {
        const allBlockNodes = new Set<string>();
        
        edgeNodes.forEach(edgeNode => {
            // 获取每个edgeNode的源节点
            const sourceNodes = getSourceNodeIdWithLabel(edgeNode.id);
            sourceNodes.forEach(sourceNode => {
                allBlockNodes.add(sourceNode.id);
            });
            
            // 获取每个edgeNode的目标节点
            const targetNodes = getTargetNodeIdWithLabel(edgeNode.id);
            targetNodes.forEach(targetNode => {
                allBlockNodes.add(targetNode.id);
            });
        });
        
        return Array.from(allBlockNodes);
    };

    // 构建包含所有相关节点的JSON数据
    const constructServerNodeJson = (): BaseConstructedJsonData => {
        try {
            // 获取所有target edge nodes
            const targetEdgeNodes = getTargetEdgeNodes();
            
            if (targetEdgeNodes.length === 0) {
                console.warn('没有找到连接到ServerNode的EdgeNode');
                return { blocks: {}, edges: {} };
            }

            // 收集所有相关的block nodes
            const allRelatedBlockNodeIds = collectAllRelatedBlockNodes(targetEdgeNodes);
            
            // 创建blocks对象
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
                            data: {...node.data} as BasicNodeData
                        };
                    }
                }
            });
            
            // 构建所有target edge nodes的JSON
            targetEdgeNodes.forEach(edgeNode => {
                try {
                    const edgeJson = buildEdgeNodeJson(edgeNode.id);
                    edges[edgeNode.id] = edgeJson;
                } catch (e) {
                    console.warn(`无法构建边节点 ${edgeNode.id} 的JSON:`, e);
                }
            });
            
            return {
                blocks,
                edges
            };
        } catch (error) {
            console.error(`构建ServerNode JSON 时出错: ${error}`);
            
            // 如果出错，返回空结构
            return {
                blocks: {},
                edges: {}
            };
        }
    };

    // 发送数据到后端
    const sendDataToTargets = async () => {
        const targetEdgeNodes = getTargetEdgeNodes();
        
        if (targetEdgeNodes.length === 0) {
            console.warn('没有找到连接到ServerNode的EdgeNode');
            return;
        }

        // 收集所有相关的结果节点
        const allRelatedBlockNodeIds = collectAllRelatedBlockNodes(targetEdgeNodes);
        const resultNodes = allRelatedBlockNodeIds.map(nodeId => getNode(nodeId)).filter(node => 
            node && (node.type === 'text' || node.type === 'structured') && 
            !node.data.isInput && !node.data.locked
        );

        // 设置结果节点为加载状态
        setNodes(prevNodes => prevNodes.map(node => {
            if (resultNodes.some(resultNode => resultNode?.id === node.id)) {
                return { ...node, data: { ...node.data, content: "", isLoading: true } };
            }
            return node;
        }));

        try {
            // 优先使用自定义的 JSON 构建函数，如果没有则使用默认的
            const jsonData = customConstructJsonData ? customConstructJsonData() : constructServerNodeJson();
            console.log("ServerNode 发送到后端的 JSON 数据:", jsonData);

            const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify(jsonData)
            });

            if (!response.ok) {
                resultNodes.forEach(node => {
                    if (node) reportError(node.id, `HTTP Error: ${response.status}`);
                });
                return;
            }

            const result = await response.json();
            console.log('ServerNode 从后端接收到的响应:', result);

            // 处理后端返回的数据并更新节点
            if (result && result.task_id) {
                // 筛选出所有结果类型节点的ID
                const resultNodeIds = resultNodes.map(node => node?.id).filter(id => id) as string[];
                
                // 使用流式处理
                await streamResultForMultipleNodes(result.task_id, resultNodeIds).then(res => {
                    console.log(`[ServerNode运行] 所有节点流式处理完成:`, res);
                    return res;
                });
            }
            
        } catch (error) {
            console.error("ServerNode 处理API响应时出错:", error);
            window.alert(error);
        }
    };

    // 添加useEffect来处理异步流程
    useEffect(() => {
        if (isComplete) return;

        const processServerNode = async () => {
            try {
                await sendDataToTargets();
            } catch (error) {
                console.error("ServerNode 处理过程中出错:", error);
            } finally {
                setIsComplete(true);
                setIsLoading(false);
            }
        };

        processServerNode();
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

// 重新导出类型，以便其他文件可以从这里导入
export type {
    BaseNodeData,
    EdgeNodeType,
    BaseConstructedJsonData,
} from './useEdgeNodeBackEndJsonBuilder'; 