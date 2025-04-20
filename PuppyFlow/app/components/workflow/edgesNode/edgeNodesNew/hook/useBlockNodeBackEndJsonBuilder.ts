import { useReactFlow } from '@xyflow/react';

// 定义返回的 JSON 类型
export interface BlockNodeJsonData {
    label: string;
    type: string;
    data: any;
    looped?: boolean;
    collection_configs?: {
        set_name: string;
        model: string;
        vdb_type: string;
        user_id: string;
        collection_name: string;
    };
}

export function useBlockNodeBackEndJsonBuilder() {
    // 使用 React Flow 获取节点数据
    const { getNode } = useReactFlow();

    // 构建区块节点 JSON 的主函数
    const buildBlockNodeJson = (nodeId: string): BlockNodeJsonData => {
        // 获取节点数据
        const node = getNode(nodeId);
        if (!node) {
            throw new Error(`节点 ${nodeId} 不存在`);
        }
        
        const nodeType = node.type as string;
        const nodeData = node.data;
        
        // 根据节点类型构建相应的 JSON
        switch (nodeType) {
            case "text":
                return buildTextNodeJson(nodeId, nodeData);
            case "structured":
                return buildStructuredNodeJson(nodeId, nodeData);
            default:
                throw new Error(`不支持的区块节点类型: ${nodeType}`);
        }
    };
    
    // 构建文本节点 JSON
    const buildTextNodeJson = (nodeId: string, nodeData: any): BlockNodeJsonData => {
        const node = getNode(nodeId);
        if (!node) {
            throw new Error(`节点 ${nodeId} 不存在`);
        }
        
        // 提取节点标签
        const label = nodeData.label || node.id;
        
        return {
            label,
            type: "text",
            data: {
                content: nodeData.content || ""
            },
            looped: !!nodeData.looped // 转换为布尔值
        };
    };
    
    // 构建结构化节点 JSON
    const buildStructuredNodeJson = (nodeId: string, nodeData: any): BlockNodeJsonData => {
        const node = getNode(nodeId);
        if (!node) {
            throw new Error(`节点 ${nodeId} 不存在`);
        }
        
        // 提取节点标签
        const label = nodeData.label || node.id;
        
        // 处理内容 - 确保结构化内容是解析过的 JSON
        let parsedContent = nodeData.content;
        
        // 如果内容是字符串且看起来像 JSON，尝试解析
        if (typeof parsedContent === 'string' && 
            (parsedContent.trim().startsWith('{') || parsedContent.trim().startsWith('['))) {
            try {
                parsedContent = JSON.parse(parsedContent);
            } catch (e) {
                console.warn(`无法解析节点 ${nodeId} 的 JSON:`, e);
                // 解析失败时保持原始字符串
            }
        }
        
        // 获取 collection_configs
        const collectionConfigs = nodeData.collection_configs || {
            set_name: label,
            model: "text-embedding-ada-002",
            vdb_type: "pgvector",
            user_id: nodeData.user_id || "",
            collection_name: nodeData.collection_name || `public${Math.random().toString(36).substring(2)}`
        };
        
        return {
            label,
            type: "structured",
            data: {
                content: parsedContent,
                embedding_view: nodeData.chunks || []
            },
            looped: !!nodeData.looped, // 转换为布尔值
            collection_configs: collectionConfigs
        };
    };
    
    return { buildBlockNodeJson };
}