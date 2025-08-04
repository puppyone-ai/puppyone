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
  }[];
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
      case 'text':
        console.log('finish the construction of text node', nodeData);
        return buildTextNodeJson(nodeId, nodeData);

      case 'structured':
        console.log('finish the construction of structured node', nodeData);
        return buildStructuredNodeJson(nodeId, nodeData);
      default:
        throw new Error(`不支持的区块节点类型: ${nodeType}`);
    }
  };

  // 构建文本节点 JSON
  const buildTextNodeJson = (
    nodeId: string,
    nodeData: any
  ): BlockNodeJsonData => {
    const node = getNode(nodeId);
    if (!node) {
      throw new Error(`节点 ${nodeId} 不存在`);
    }

    // 提取节点标签
    const label = nodeData.label || node.id;

    return {
      label,
      type: 'text',
      data: {
        content: nodeData.content || '',
      },
      looped: !!nodeData.looped, // 转换为布尔值
      collection_configs: [],
    };
  };

  // 构建结构化节点 JSON
  const buildStructuredNodeJson = (
    nodeId: string,
    nodeData: any
  ): BlockNodeJsonData => {
    const node = getNode(nodeId);
    if (!node) {
      throw new Error(`节点 ${nodeId} 不存在`);
    }

    // 提取节点标签
    const label = nodeData.label || node.id;

    // 处理内容 - 确保结构化内容是解析过的 JSON
    let parsedContent = nodeData.content;

    // 如果内容是字符串且看起来像 JSON，尝试解析
    if (
      typeof parsedContent === 'string' &&
      (parsedContent.trim().startsWith('{') ||
        parsedContent.trim().startsWith('['))
    ) {
      try {
        parsedContent = JSON.parse(parsedContent);
      } catch (e) {
        console.warn(`无法解析节点 ${nodeId} 的 JSON:`, e);
        // 解析失败时保持原始字符串
      }
    }

    // 获取 indexingList 中的所有 collection_configs
    let collectionConfigs: any[] = [];
    if (
      nodeData.indexingList &&
      Array.isArray(nodeData.indexingList) &&
      nodeData.indexingList.length > 0
    ) {
      collectionConfigs = nodeData.indexingList
        .filter((item: any) => item.collection_configs)
        .map((item: any) => item.collection_configs);
    }

    return {
      label,
      type: 'structured',
      data: {
        content: parsedContent,
      },
      looped: !!nodeData.looped, // 转换为布尔值
      collection_configs: collectionConfigs,
    };
  };

  return { buildBlockNodeJson };
}
