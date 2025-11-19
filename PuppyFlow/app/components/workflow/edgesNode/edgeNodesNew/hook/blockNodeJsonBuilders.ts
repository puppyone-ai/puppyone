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

  // 如果是 external 指针，按数据最小化规范构建
  const isExternalPointer =
    nodeData?.storage_class === 'external' &&
    nodeData?.external_metadata &&
    typeof nodeData.external_metadata?.resource_key === 'string';

  if (isExternalPointer) {
    return {
      label,
      type: 'text',
      storage_class: 'external',
      data: {
        external_metadata: nodeData.external_metadata,
      },
      looped: !!nodeData.looped,
      collection_configs: [],
    };
  }

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

  // 如果是 external 指针，按数据最小化规范构建
  const isExternalPointer =
    nodeData?.storage_class === 'external' &&
    nodeData?.external_metadata &&
    typeof nodeData.external_metadata?.resource_key === 'string';

  if (isExternalPointer) {
    return {
      label,
      type: 'structured',
      storage_class: 'external',
      data: {
        external_metadata: nodeData.external_metadata,
        // Phase 3.9: Include indexingList for runtime resolution
        indexingList: nodeData.indexingList || [],
      },
      looped: !!nodeData.looped,
      collection_configs: collectionConfigs, // Backward compatibility
    };
  }

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
      // Phase 3.9: Include indexingList for runtime resolution
      indexingList: nodeData.indexingList || [],
    },
    looped: !!nodeData.looped,
    collection_configs: collectionConfigs, // Backward compatibility
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

  // File blocks ALWAYS use external storage mode (FILE-BLOCK-CONTRACT.md)
  // Standard contract: external_metadata with resource_key
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

  // Fallback: empty file block (will be populated by user upload or prefetch)
  return {
    label,
    type: 'file',
    data: { content: null },
    looped: !!nodeData.looped,
    collection_configs: [],
  };
}
