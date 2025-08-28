// Block 节点 JSON 构建函数（对应 useBlockNodeBackEndJsonBuilder）

export interface BlockNodeJsonData {
  label: string;
  type: string;
  data: any;
  // Optional storage class to support external pointer format
  storage_class?: 'internal' | 'external';
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
    case 'file':
      console.log('finish the construction of file node', nodeData);
      return buildFileNodeJson(nodeId, nodeData, context);
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

  // 🚀 架构优化：统一使用content传递，后端不再从外部存储下载
  // 这样可以大幅简化逻辑，减少网络请求，提升性能
  console.log(
    `🔧 [buildTextNodeJson] Building text block ${nodeId} with direct content`
  );

  return {
    label,
    type: 'text',
    data: {
      content:
        nodeData.content !== undefined &&
        nodeData.content !== null &&
        nodeData.content !== ''
          ? nodeData.content
          : null, // 使用 null 而不是空字符串，确保后端不会将其标记为已处理
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

  // 🚀 架构优化：统一使用content传递，后端不再从外部存储下载
  // 这样可以大幅简化逻辑，减少网络请求，提升性能
  console.log(
    `🔧 [buildStructuredNodeJson] Building structured block ${nodeId} with direct content`
  );

  return {
    label,
    type: 'structured',
    data: {
      content:
        parsedContent !== undefined &&
        parsedContent !== null &&
        parsedContent !== ''
          ? parsedContent
          : null, // 使用 null 而不是空字符串，确保后端不会将其标记为已处理
    },
    looped: !!nodeData.looped,
    collection_configs: collectionConfigs,
  };
}

function buildFileNodeJson(
  nodeId: string,
  nodeData: any,
  context: BlockNodeBuilderContext
): BlockNodeJsonData {
  const node = context.getNode(nodeId);
  if (!node) {
    throw new Error(`节点 ${nodeId} 不存在`);
  }

  const label = nodeData.label || node.id;

  // File block 最小实现：external 指针，携带 resource_key
  const externalMeta = nodeData?.external_metadata;
  const resourceKey: string | undefined = externalMeta?.resource_key;
  const contentType: string = externalMeta?.content_type || 'files';

  if (
    nodeData?.storage_class === 'external' &&
    typeof resourceKey === 'string'
  ) {
    return {
      label,
      type: 'file',
      storage_class: 'external',
      data: {
        external_metadata: {
          resource_key: resourceKey,
          content_type: contentType,
        },
      },
      looped: !!nodeData.looped,
      collection_configs: [],
    };
  }

  // 回退：无 external 配置时，返回空内容（不建议）
  return {
    label,
    type: 'file',
    data: {
      content: null,
    },
    looped: !!nodeData.looped,
    collection_configs: [],
  };
}
