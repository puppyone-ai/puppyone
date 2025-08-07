// Block 节点 JSON 构建函数（对应 useBlockNodeBackEndJsonBuilder）

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

export interface BlockNodeBuilderContext {
  getNode: (id: string) => any;
}

export function buildBlockNodeJson(
  nodeId: string,
  context: BlockNodeBuilderContext
): BlockNodeJsonData {
  const node = context.getNode(nodeId);
  if (!node) {
    throw new Error(`节点 ${nodeId} 不存在`);
  }

  const nodeType = node.type as string;
  const nodeData = node.data;

  switch (nodeType) {
    case 'text':
      console.log('finish the construction of text node', nodeData);
      return buildTextNodeJson(nodeId, nodeData, context);

    case 'structured':
      console.log('finish the construction of structured node', nodeData);
      return buildStructuredNodeJson(nodeId, nodeData, context);
    default:
      throw new Error(`不支持的区块节点类型: ${nodeType}`);
  }
}

function buildTextNodeJson(
  nodeId: string,
  nodeData: any,
  context: BlockNodeBuilderContext
): BlockNodeJsonData {
  const node = context.getNode(nodeId);
  if (!node) {
    throw new Error(`节点 ${nodeId} 不存在`);
  }

  const label = nodeData.label || node.id;

  return {
    label,
    type: 'text',
    data: {
      content: nodeData.content || '',
    },
    looped: !!nodeData.looped,
    collection_configs: [],
  };
}

function buildStructuredNodeJson(
  nodeId: string,
  nodeData: any,
  context: BlockNodeBuilderContext
): BlockNodeJsonData {
  const node = context.getNode(nodeId);
  if (!node) {
    throw new Error(`节点 ${nodeId} 不存在`);
  }

  const label = nodeData.label || node.id;

  let parsedContent = nodeData.content;

  if (
    typeof parsedContent === 'string' &&
    (parsedContent.trim().startsWith('{') ||
      parsedContent.trim().startsWith('['))
  ) {
    try {
      parsedContent = JSON.parse(parsedContent);
    } catch (e) {
      console.warn(`无法解析节点 ${nodeId} 的 JSON:`, e);
    }
  }

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
    looped: !!nodeData.looped,
    collection_configs: collectionConfigs,
  };
}
