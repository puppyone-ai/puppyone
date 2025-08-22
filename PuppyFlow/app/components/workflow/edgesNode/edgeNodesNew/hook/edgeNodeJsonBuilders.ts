// Edge 节点 JSON 构建函数（对应 useEdgeNodeBackEndJsonBuilder）

import {
  EdgeNodeType,
  BaseEdgeJsonType,
  CopyEdgeJsonType,
  ChunkingAutoEdgeJsonType,
  ChunkingByCharacterEdgeJsonType,
  ChunkingByLengthEdgeJsonType,
  Convert2StructuredEdgeJsonType,
  Convert2TextEdgeJsonType,
  EditTextEdgeJsonType,
  SearchGoogleEdgeJsonType,
  SearchPerplexityEdgeJsonType,
  LLMEdgeJsonType,
  EditStructuredEdgeJsonType,
  RetrievingEdgeJsonType,
  IfElseEdgeJsonType,
  GenerateEdgeJsonType,
  LoadEdgeJsonType,
  DeepResearchEdgeJsonType,
  perplexityModelNames,
} from './hookhistory/useEdgeNodeBackEndJsonBuilder';

// 导入 DeepResearchNodeData 类型
import { DeepResearchNodeData } from '../DeepResearch';

// 导入NodeCategory类型定义
type NodeCategory =
  | 'blocknode'
  | 'edgenode'
  | 'servernode'
  | 'groupnode'
  | 'all';

export interface EdgeNodeBuilderContext {
  getNode: (id: string) => any;
  // 修正类型定义以匹配useGetSourceTarget
  getSourceNodeIdWithLabel: (
    parentId: string,
    category?: NodeCategory
  ) => { id: string; label: string }[];
  getTargetNodeIdWithLabel: (
    parentId: string,
    category?: NodeCategory
  ) => { id: string; label: string }[];
}

export function buildEdgeNodeJson(
  nodeId: string,
  context: EdgeNodeBuilderContext
): BaseEdgeJsonType {
  const node = context.getNode(nodeId);
  if (!node) {
    throw new Error(`节点 ${nodeId} 不存在`);
  }

  const nodeData = node.data;
  const nodeType = node.type as EdgeNodeType;

  const sourceNodeIdWithLabelGroup = context.getSourceNodeIdWithLabel(
    nodeId,
    'blocknode'
  );
  const targetNodeIdWithLabelGroup = context.getTargetNodeIdWithLabel(
    nodeId,
    'blocknode'
  );

  let edgeJson: BaseEdgeJsonType;

  switch (nodeType) {
    case 'copy':
      edgeJson = buildCopyNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'chunkingAuto':
      edgeJson = buildChunkingAutoNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'chunkingByCharacter':
      edgeJson = buildChunkingByCharacterNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'chunkingByLength':
      edgeJson = buildChunkingByLengthNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'convert2structured':
      edgeJson = buildConvert2StructuredNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'convert2text':
      edgeJson = buildConvert2TextNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'editText':
      edgeJson = buildEditTextNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'searchGoogle':
      edgeJson = buildSearchGoogleNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'searchPerplexity':
      edgeJson = buildSearchPerplexityNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'llmnew':
      edgeJson = buildLLMNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'editStructured':
      edgeJson = buildEditStructuredNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'retrieving':
      edgeJson = buildRetrievingNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'ifelse':
      edgeJson = buildIfElseNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'generate':
      edgeJson = buildGenerateNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'load':
      edgeJson = buildLoadNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    case 'deepresearch':
      edgeJson = buildDeepResearchNodeJson(
        nodeId,
        sourceNodeIdWithLabelGroup,
        targetNodeIdWithLabelGroup,
        context
      );
      break;
    default:
      throw new Error(`不支持的节点类型: ${nodeType}`);
  }

  return edgeJson;
}

// Copy 节点构建函数
function buildCopyNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): CopyEdgeJsonType {
  return {
    type: 'modify',
    data: {
      modify_type: 'copy',
      content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
      extra_configs: {},
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildChunkingAutoNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): ChunkingAutoEdgeJsonType {
  return {
    type: 'chunk',
    data: {
      chunking_mode: 'auto',
      extra_configs: {
        model: undefined,
        chunk_size: undefined,
        overlap: undefined,
        handle_half_word: undefined,
      },
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildChunkingByCharacterNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): ChunkingByCharacterEdgeJsonType {
  const characterNodeData = context.getNode(nodeId)?.data;

  let delimitersFromNode: string[] = [',', ';', '\n'];

  if (
    characterNodeData?.delimiters &&
    Array.isArray(characterNodeData.delimiters)
  ) {
    delimitersFromNode = characterNodeData.delimiters;
  } else if (characterNodeData?.content) {
    try {
      const parsedContent =
        typeof characterNodeData.content === 'string'
          ? JSON.parse(characterNodeData.content)
          : characterNodeData.content;
      if (Array.isArray(parsedContent)) {
        delimitersFromNode = parsedContent;
      }
    } catch (e) {
      console.warn('无法从content解析delimiters:', e);
    }
  }

  return {
    type: 'chunk',
    data: {
      chunking_mode: 'character',
      sub_chunking_mode: 'character',
      extra_configs: {
        delimiters: delimitersFromNode,
      },
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildChunkingByLengthNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): ChunkingByLengthEdgeJsonType {
  const lengthNodeData = context.getNode(nodeId)?.data;

  let subChunkModeFromNode: 'size' | 'tokenizer' = 'size';
  let chunkSizeFromNode = 200;
  let overlapFromNode = 20;
  let handleHalfWordFromNode = false;

  if (
    lengthNodeData?.sub_chunking_mode === 'size' ||
    lengthNodeData?.sub_chunking_mode === 'tokenizer'
  ) {
    subChunkModeFromNode = lengthNodeData.sub_chunking_mode;
  }

  if (
    lengthNodeData?.extra_configs &&
    typeof lengthNodeData.extra_configs === 'object'
  ) {
    const configChunkSize = (lengthNodeData.extra_configs as any).chunk_size;
    if (typeof configChunkSize === 'number') {
      chunkSizeFromNode = configChunkSize;
    }

    const configOverlap = (lengthNodeData.extra_configs as any).overlap;
    if (typeof configOverlap === 'number') {
      overlapFromNode = configOverlap;
    }

    const configHandleHalfWord = (lengthNodeData.extra_configs as any)
      .handle_half_word;
    if (typeof configHandleHalfWord === 'boolean') {
      handleHalfWordFromNode = configHandleHalfWord;
    }
  }

  return {
    type: 'chunk',
    data: {
      chunking_mode: 'length',
      sub_chunking_mode: subChunkModeFromNode,
      extra_configs: {
        chunk_size: chunkSizeFromNode,
        overlap: overlapFromNode,
        handle_half_word: handleHalfWordFromNode,
      },
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildConvert2StructuredNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): Convert2StructuredEdgeJsonType {
  const structuredNodeData = context.getNode(nodeId)?.data;

  // 提取配置值
  let conversionMode: string;
  let actionType: 'default' | 'json' = 'default';
  let listSeparator: string[] | undefined;
  let lengthSeparator: number | undefined;
  let dictKey: string | undefined;

  // 直接从节点数据中获取execMode
  const execModeFromNode = structuredNodeData?.execMode;

  // 基于execMode设置转换模式
  switch (execModeFromNode) {
    case 'JSON':
      conversionMode = 'parse_as_json';
      actionType = 'json';
      break;
    case 'wrap into list':
      conversionMode = 'parse_as_list';
      break;
    case 'wrap into dict':
      conversionMode = 'wrap_into_dict';
      // 获取dict键名
      if (
        structuredNodeData?.extra_configs &&
        typeof structuredNodeData.extra_configs === 'object'
      ) {
        dictKey = (structuredNodeData.extra_configs as any)?.dict_key;
      }
      break;
    case 'split by length':
      conversionMode = 'split_by_length';
      // 获取长度值
      if (
        structuredNodeData?.extra_configs &&
        typeof structuredNodeData.extra_configs === 'object'
      ) {
        lengthSeparator = (structuredNodeData.extra_configs as any)
          ?.length_separator;
      }
      break;
    case 'split by character':
      conversionMode = 'split_by_character';
      // 获取分隔符列表
      if (
        structuredNodeData?.extra_configs &&
        typeof structuredNodeData.extra_configs === 'object'
      ) {
        try {
          const separatorStr = (structuredNodeData.extra_configs as any)
            ?.list_separator;
          if (typeof separatorStr === 'string') {
            listSeparator = JSON.parse(separatorStr);
          }
        } catch (e) {
          console.warn('无法解析列表分隔符:', e);
          listSeparator = [',', ';', '.', '\n'];
        }
      }
      break;
    default:
      conversionMode = 'parse_as_json';
      break;
  }

  // 构建extra_configs对象
  const extraConfigs: {
    conversion_mode: string;
    action_type: 'default' | 'json';
    list_separator?: string[];
    length_separator?: number;
    dict_key?: string;
  } = {
    conversion_mode: conversionMode,
    action_type: actionType,
  };

  // 根据需要添加额外配置
  if (conversionMode === 'split_by_character' && listSeparator) {
    extraConfigs.list_separator = listSeparator;
  }
  if (conversionMode === 'split_by_length' && lengthSeparator) {
    extraConfigs.length_separator = lengthSeparator;
  }
  if (conversionMode === 'wrap_into_dict' && dictKey) {
    extraConfigs.dict_key = dictKey;
  }

  return {
    type: 'modify',
    data: {
      content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
      modify_type: 'convert2structured',
      extra_configs: extraConfigs,
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildConvert2TextNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): Convert2TextEdgeJsonType {
  return {
    type: 'modify',
    data: {
      content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
      modify_type: 'convert2text',
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildEditTextNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): EditTextEdgeJsonType {
  const editTextNodeData = context.getNode(nodeId)?.data;

  // 从节点数据中获取必要参数并确保是字符串类型
  let textContentFromNode = '';

  // 检查content是否存在且为字符串
  if (editTextNodeData && 'content' in editTextNodeData) {
    const content = editTextNodeData.content;
    if (typeof content === 'string') {
      textContentFromNode = content;
    } else if (content) {
      // 尝试将非字符串内容转换为字符串
      try {
        textContentFromNode = JSON.stringify(content);
      } catch (e) {
        console.warn('无法stringify内容:', e);
      }
    }
  }

  // 获取retMode和configNum，设置默认值
  let retModeFromNode = 'return all';
  let configNumFromNode = 100;

  // 安全地检查并获取extra_configs属性
  if (
    editTextNodeData?.extra_configs &&
    typeof editTextNodeData.extra_configs === 'object'
  ) {
    // 获取retMode
    const extractedRetMode = (editTextNodeData.extra_configs as any)?.retMode;
    if (typeof extractedRetMode === 'string') {
      retModeFromNode = extractedRetMode;
    }

    // 获取configNum
    const extractedConfigNum = (editTextNodeData.extra_configs as any)
      ?.configNum;
    if (typeof extractedConfigNum === 'number') {
      configNumFromNode = extractedConfigNum;
    }
  }

  // 辅助函数，根据retMode和configNum计算切片范围
  const getSliceRange = (
    retMode: string,
    configNum: number
  ): [number, number] => {
    switch (retMode) {
      case 'return all':
        return [0, -1];
      case 'return first n':
        return [0, configNum];
      case 'return last n':
        return [-configNum, -1];
      case 'exclude first n':
        return [configNum, -1];
      case 'exclude last n':
        return [0, -configNum];
      default:
        return [0, -1]; // 默认返回全部
    }
  };

  return {
    type: 'modify',
    data: {
      modify_type: 'edit_text',
      extra_configs: {
        slice: getSliceRange(retModeFromNode, configNumFromNode),
        sort_type: '/',
      },
      content: textContentFromNode, // 确保是字符串
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildSearchGoogleNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): SearchGoogleEdgeJsonType {
  const googleNodeData = context.getNode(nodeId)?.data;

  // 安全地获取top_k，如果不存在则使用默认值5
  const googleTopK =
    typeof googleNodeData?.top_k === 'number' ? googleNodeData.top_k : 5;

  return {
    type: 'search',
    data: {
      search_type: 'web',
      sub_search_type: 'google',
      top_k: googleTopK,
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      query_id:
        sourceNodes.length > 0
          ? { [sourceNodes[0].id]: sourceNodes[0].label }
          : {},
      extra_configs: {},
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildSearchPerplexityNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): SearchPerplexityEdgeJsonType {
  const perplexityNodeData = context.getNode(nodeId)?.data;

  // 添加正确的类型检查
  let perplexityModel: perplexityModelNames = 'sonar-pro'; // 默认值

  // 检查extra_configs是否存在并有model属性
  if (
    perplexityNodeData?.extra_configs &&
    typeof perplexityNodeData.extra_configs === 'object' &&
    perplexityNodeData.extra_configs !== null
  ) {
    // 从extra_configs获取model并进行类型断言
    const configModel = (perplexityNodeData.extra_configs as { model?: string })
      .model;

    // 验证是允许的模型名称之一
  if (
    configModel === 'sonar' ||
    configModel === 'sonar-pro' ||
    configModel === 'sonar-reasoning-pro'
  ) {
      perplexityModel = configModel;
    }
  }

  // 构建model对象，与LLM节点保持一致的结构
  const modelObject: { [key: string]: { inference_method?: string } } = {
    [perplexityModel]: {},
  };

  return {
    type: 'search',
    data: {
      search_type: 'qa',
      sub_search_type: 'perplexity',
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      query_id:
        sourceNodes.length > 0
          ? { [sourceNodes[0].id]: sourceNodes[0].label }
          : {},
      extra_configs: {
        model: modelObject,
      },
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildLLMNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): LLMEdgeJsonType {
  const llmNodeData = context.getNode(nodeId)?.data;

  // 定义消息类型
  type PromptMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
  };

  // 从content字段解析消息并正确类型化
  let parsedMessages: PromptMessage[] = [];
  try {
    if (llmNodeData?.content) {
      const contentData =
        typeof llmNodeData.content === 'string'
          ? JSON.parse(llmNodeData.content)
          : llmNodeData.content;

      // 确保是正确类型的数组
      if (Array.isArray(contentData)) {
        parsedMessages = contentData as PromptMessage[];
      }
    }
  } catch (e) {
    console.warn('无法解析LLM节点内容:', e);
    parsedMessages = [];
  }

  // 获取模型信息 - 添加类型检查
  const modelAndProvider = llmNodeData?.modelAndProvider as
    | {
        id: string;
        name: string;
        provider: string;
        isLocal: boolean;
      }
    | undefined;

  let modelString = 'openai/gpt-4o-mini'; // 默认值

  if (
    modelAndProvider &&
    typeof modelAndProvider === 'object' &&
    'id' in modelAndProvider
  ) {
    modelString = modelAndProvider.id;
  }

  const llmBaseUrl =
    typeof llmNodeData?.base_url === 'string' ? llmNodeData.base_url : '';
  const llmStructuredOutput = !!llmNodeData?.structured_output; // 转换为布尔值
  const maxTokens = (llmNodeData?.max_tokens as number) || 2000;

  // 过滤消息，只保留 system 和 user 角色的消息
  const filteredMessages = parsedMessages.filter(
    (msg: PromptMessage) => msg.role === 'system' || msg.role === 'user'
  );

  return {
    type: 'llm',
    data: {
      messages: filteredMessages,
      chat_histories: filteredMessages, // 添加 chat_histories 字段，内容与 messages 相同
      model: modelString,
      base_url: llmBaseUrl,
      max_tokens: maxTokens,
      temperature: 0.7,
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      structured_output: llmStructuredOutput,
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildEditStructuredNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): EditStructuredEdgeJsonType {
  const nodeData = context.getNode(nodeId)?.data;

  // 从节点获取配置数据
  const execMode = nodeData?.type || 'get';
  const getConfigData =
    (nodeData?.getConfigData as Array<{ key: string; value: string }>) || [];
  const paramv = nodeData?.paramv;

  // 从配置数据准备路径
  const path = getConfigData.map(item => {
    if (item.key === 'num') {
      const num = Number(item.value);
      return isNaN(num) ? item.value : num;
    }
    return item.value;
  });

  // 根据操作类型创建适当的参数
  let params: any = {};

  if (execMode === 'get_keys' || execMode === 'get_values') {
    params = {
      max_depth: 100,
    };
  } else {
    params = {
      path: path,
      ...(execMode === 'get' && { default: 'Get Failed, value not exist' }),
      ...(execMode === 'replace' && { value: paramv }),
    };
  }

  // 转换操作类型: 如果UI中显示为"replace"，传递给后端时应使用"set_value"
  const operationType = execMode === 'replace' ? 'set_value' : execMode;

  return {
    type: 'modify',
    data: {
      content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
      modify_type: 'edit_structured',
      extra_configs: {
        operations: [
          {
            type: operationType as string, // 使用转换后的操作类型
            params: params,
          },
        ],
      },
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

function buildRetrievingNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): RetrievingEdgeJsonType {
  // 从 React Flow 获取节点数据
  const nodeData = context.getNode(nodeId)?.data;

  // 准备输入映射
  const inputs: { [key: string]: string } = {};
  sourceNodes.forEach(node => {
    inputs[node.id] = node.label;
  });

  // 准备输出映射
  const outputs: { [key: string]: string } = {};
  targetNodes.forEach(node => {
    outputs[node.id] = node.label;
  });

  // 准备查询 ID 映射
  const queryId: { [key: string]: string } = {};
  // 安全地访问可能不存在的属性
  const queryIdData = nodeData?.query_id as
    | { id?: string; label?: string }
    | undefined;
  if (
    queryIdData &&
    typeof queryIdData.id === 'string' &&
    typeof queryIdData.label === 'string'
  ) {
    queryId[queryIdData.id] = queryIdData.label;
  }

  // 安全地获取阈值，默认为 0.7
  let threshold = 0.7;
  const extraConfigs = nodeData?.extra_configs as
    | { threshold?: number }
    | undefined;
  if (extraConfigs && typeof extraConfigs.threshold === 'number') {
    threshold = extraConfigs.threshold;
  }

  // 安全地获取 top_k，默认为 5
  let top_k = 5;
  if (nodeData && typeof nodeData.top_k === 'number') {
    top_k = nodeData.top_k;
  }

  // 直接使用完整的 dataSource 结构，确保保留所有字段包括 index_item
  const dataSourceArray = nodeData?.dataSource as
    | {
        id: string;
        label: string;
        index_item: {
          index_name: string;
          collection_configs: {
            set_name: string;
            model: string;
            vdb_type: string;
            user_id: string;
            collection_name: string;
          };
        };
      }[]
    | undefined;

  return {
    type: 'search',
    data: {
      search_type: 'vector',
      top_k: top_k,
      inputs: inputs,
      threshold: threshold,
      extra_configs: {
        provider: 'openai',
        model: 'text-embedding-ada-002',
        db_type: 'pgvector',
      },
      query_id: queryId,
      data_source: dataSourceArray || [],
      outputs: outputs,
    },
  };
}

function buildIfElseNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): IfElseEdgeJsonType {
  // Get the node data from ReactFlow
  const nodeData = context.getNode(nodeId)?.data;

  // Check if nodeData.cases exists and is an array
  if (
    !nodeData ||
    !nodeData.cases ||
    !Array.isArray(nodeData.cases) ||
    nodeData.cases.length === 0
  ) {
    // Return a default structure if no cases defined or cases is not an array
    return {
      type: 'ifelse',
      data: {
        cases: {},
        inputs: sourceNodes.reduce(
          (acc, node) => ({ ...acc, [node.id]: node.label }),
          {}
        ),
        outputs: targetNodes.reduce(
          (acc, node) => ({ ...acc, [node.id]: node.label }),
          {}
        ),
      },
    };
  }

  // Transform the conditions to the backend format
  const transformedCases: {
    [key: string]: {
      conditions: {
        block: string;
        condition: string;
        parameters: { [key: string]: string | number };
        operation: string;
      }[];
      thens: {
        from: string;
        to: string;
      }[];
    };
  } = {};

  // Map frontend condition types to backend condition types
  const conditionMap: { [key: string]: string } = {
    // For text nodes
    contains: 'contain',
    "doesn't contain": 'not_contain',
    'is greater than [N] characters': 'greater_than_n_chars',
    'is less than [N] characters': 'less_than_n_chars',
    'is empty': 'is_empty',
    'is not empty': 'is_not_empty',
    'is True': 'is',
    'is False': 'is_not',

    // For structured nodes
    'is list': 'is_list',
    'is dict': 'is_dict',
    'is greater than [N]': 'greater_than_n',
    'is less than [N]': 'less_than_n',
  };

  // Process each case
  nodeData.cases.forEach((caseItem: any, index: number) => {
    const caseKey = `case${index + 1}`;

    // Verify that conditions array exists and is valid
    if (!caseItem.conditions || !Array.isArray(caseItem.conditions)) {
      return; // Skip this case if conditions are invalid
    }

    // Process conditions
    const conditions = caseItem.conditions.map(
      (condition: any, condIndex: number) => {
        // Convert the frontend condition to backend condition format
        const backendCondition =
          conditionMap[condition.cond_v] || condition.cond_v;

        // Operation should be "/" if it's the last condition in the group
        const isLastCondition = condIndex === caseItem.conditions.length - 1;
        const operation = isLastCondition
          ? '/'
          : condition.operation.toLowerCase();

        return {
          block: condition.id,
          condition: backendCondition,
          parameters: {
            value: condition.cond_input || '',
          },
          operation: operation,
        };
      }
    );

    // 处理 thens
    let thens: { from: string; to: string }[] = [];
    if (Array.isArray(caseItem.actions) && caseItem.actions.length > 0) {
      caseItem.actions.forEach((action: any) => {
        if (Array.isArray(action.outputs) && action.outputs.length > 0) {
          action.outputs.forEach((outputId: string) => {
            thens.push({
              from: action.from_id || sourceNodes[0]?.id || '',
              to: outputId,
            });
          });
        } else {
          // fallback
          thens.push({
            from: action.from_id || sourceNodes[0]?.id || '',
            to: targetNodes[0]?.id || '',
          });
        }
      });
    }

    if (thens.length === 0) {
      // fallback
      thens.push({
        from: sourceNodes[0]?.id || '',
        to: targetNodes[0]?.id || '',
      });
    }

    transformedCases[caseKey] = {
      conditions,
      thens,
    };
  });

  // If no valid cases were processed, we might end up with an empty object
  // Make sure we have at least one case if there were cases in the input
  if (Object.keys(transformedCases).length === 0 && nodeData.cases.length > 0) {
    transformedCases['case1'] = {
      conditions: [
        {
          block: sourceNodes[0]?.id || '',
          condition: 'contain',
          parameters: { value: '' },
          operation: '/',
        },
      ],
      thens: [
        {
          from: sourceNodes[0]?.id || '',
          to: targetNodes[0]?.id || '',
        },
      ],
    };
  }

  return {
    type: 'ifelse',
    data: {
      cases: transformedCases,
      inputs: sourceNodes.reduce(
        (acc, node) => ({ ...acc, [node.id]: node.label }),
        {}
      ),
      outputs: targetNodes.reduce(
        (acc, node) => ({ ...acc, [node.id]: node.label }),
        {}
      ),
    },
  };
}

function buildGenerateNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): GenerateEdgeJsonType {
  const nodeData = context.getNode(nodeId)?.data;

  // 获取查询节点ID
  const queryNode = nodeData?.query_ids as
    | { id: string; label: string }
    | undefined;
  const queryIds = queryNode ? [queryNode.id] : [];

  // 获取文档节点ID
  const docNode = nodeData?.document_ids as
    | { id: string; label: string }
    | undefined;
  const docIds = docNode ? [docNode.id] : [];

  // 获取其他必要参数
  const promptTemplate = (nodeData?.promptTemplate as string) || 'default';
  const model = (nodeData?.model as string) || 'openai/gpt-4o-mini';
  const structuredOutput = !!nodeData?.structured_output;
  const baseUrl = (nodeData?.base_url as string) || undefined;

  return {
    type: 'generator',
    data: {
      queries: queryIds,
      docs: docIds,
      sys_prompt_template: promptTemplate,
      user_prompt_template: promptTemplate,
      hoster: 'openrouter',
      model: model,
      max_tokens: 2048,
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
      structured_output: structuredOutput,
      ...(baseUrl && baseUrl.trim() !== '' ? { base_url: baseUrl } : {}),
    },
  };
}

function buildLoadNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): LoadEdgeJsonType {
  // 获取源节点内容（文件数据）
  const sourceNode = sourceNodes[0]; // 通常只有一个源节点
  if (!sourceNode) {
    throw new Error('Load 节点需要至少一个源节点');
  }

  const sourceNodeFull = context.getNode(sourceNode.id);
  const externalMetadata = sourceNodeFull?.data?.external_metadata;
  const nodeContent = sourceNodeFull?.data?.content;

  // 优先使用 external_metadata 和 nodeContent 中的详细文件列表
  if (
    externalMetadata &&
    externalMetadata.resource_key &&
    Array.isArray(nodeContent)
  ) {
    console.log(
      'Building LoadNode JSON using external_metadata and detailed file list from node content:',
      { externalMetadata, nodeContent }
    );

    const fileConfigs = nodeContent.reduce<
      { file_path: string; file_type: string }[]
    >((acc, file) => {
      // task_id 存储了文件在 storage 中的唯一 key
      if (file.task_id) {
        acc.push({
          file_path: file.task_id,
          file_type: file.fileType,
        });
      } else {
        console.warn(
          `File ${file.fileName} is missing task_id (storage key). Skipping.`
        );
      }
      return acc;
    }, []);

    return {
      type: 'load',
      data: {
        block_type: 'file',
        content: sourceNode.id,
        extra_configs: {
          file_configs: fileConfigs,
        },
        inputs: Object.fromEntries(
          sourceNodes.map(node => [node.id, node.label])
        ),
        outputs: Object.fromEntries(
          targetNodes.map(node => [node.id, node.label])
        ),
      },
    };
  }

  // Fallback: 如果没有 external_metadata，尝试使用旧的 download_url 逻辑
  console.log(
    'Fallback: Building LoadNode JSON using node content with download_url:',
    nodeContent
  );

  // 构建文件配置
  const fileConfigsFallback = Array.isArray(nodeContent)
    ? nodeContent.reduce<{ file_path: string; file_type: string }[]>(
        (acc, file) => {
          if (file.download_url) {
            acc.push({
              file_path: file.download_url,
              file_type: file.fileType,
            });
          } else {
            console.warn(
              `File ${file.fileName} is missing download_url. Skipping.`
            );
          }
          return acc;
        },
        []
      )
    : [];

  if (fileConfigsFallback.length === 0 && Array.isArray(nodeContent)) {
    console.error(
      'LoadNode Error: No valid files with download_url found in source node content.',
      nodeContent
    );
    // 即使没有有效的 URL，也发送一个空的 file_configs，让后端决定如何处理
  }

  // 创建 Load 节点的 JSON
  return {
    type: 'load',
    data: {
      block_type: 'file',
      content: sourceNode.id,
      extra_configs: {
        file_configs: fileConfigsFallback,
      },
      inputs: Object.fromEntries(
        sourceNodes.map(node => [node.id, node.label])
      ),
      outputs: Object.fromEntries(
        targetNodes.map(node => [node.id, node.label])
      ),
    },
  };
}

// 创建标准化的 DeepResearch 节点数据
function createStandardizedDeepResearchNodeData(
  nodeId: string,
  context: EdgeNodeBuilderContext
): DeepResearchNodeData {
  const currentNode = context.getNode(nodeId);
  const existingData = currentNode?.data as Partial<DeepResearchNodeData>;

  // 创建默认配置
  const defaultData: DeepResearchNodeData = {
    nodeLabels: existingData?.nodeLabels || [],
    subMenuType: existingData?.subMenuType || null,
    content: existingData?.content || null,
    looped: existingData?.looped || false,
    query_id: existingData?.query_id || undefined,
    modelAndProvider: existingData?.modelAndProvider || {
      id: 'openai/gpt-4o-mini',
      name: 'GPT-4o-mini',
      provider: 'openai',
      isLocal: false,
    },
    extra_configs: {
      max_rounds: existingData?.extra_configs?.max_rounds ?? 3,
      llm_model: existingData?.extra_configs?.llm_model || 'openai/gpt-4o-mini',
      vector_config: {
        enabled: existingData?.extra_configs?.vector_config?.enabled ?? false,
        data_source:
          existingData?.extra_configs?.vector_config?.data_source || [],
        top_k: existingData?.extra_configs?.vector_config?.top_k ?? 5,
        threshold: existingData?.extra_configs?.vector_config?.threshold ?? 0.5,
      },
      web_config: {
        top_k: existingData?.extra_configs?.web_config?.top_k ?? 5,
        disable_content_filtering:
          existingData?.extra_configs?.web_config?.disable_content_filtering ??
          true,
        disable_quality_filtering:
          existingData?.extra_configs?.web_config?.disable_quality_filtering ??
          true,
      },
      perplexity_config: {
        model: existingData?.extra_configs?.perplexity_config?.model || 'sonar',
        sub_search_type:
          existingData?.extra_configs?.perplexity_config?.sub_search_type ||
          'perplexity',
      },
    },
  };

  return defaultData;
}

function buildDeepResearchNodeJson(
  nodeId: string,
  sourceNodes: { id: string; label: string }[],
  targetNodes: { id: string; label: string }[],
  context: EdgeNodeBuilderContext
): DeepResearchEdgeJsonType {
  // 使用标准化的节点数据
  const nodeData = createStandardizedDeepResearchNodeData(nodeId, context);
  console.log(`📊 [buildDeepResearchNodeJson] 标准化节点数据:`, nodeData);

  // 获取查询内容
  if (sourceNodes.length === 0) {
    throw new Error(
      'DeepResearch node requires at least one source node for query content'
    );
  }

  const query = `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`;

  // 获取配置参数 - 现在可以安全地访问，因为数据已经标准化
  const extraConfigs = nodeData.extra_configs;
  const maxRounds = extraConfigs.max_rounds;

  // 获取模型信息 - 处理可能为 undefined 的情况
  const modelAndProvider = nodeData.modelAndProvider;
  if (!modelAndProvider) {
    throw new Error(
      'DeepResearch node requires modelAndProvider configuration'
    );
  }
  const modelId = modelAndProvider.id;
  const isLocal = modelAndProvider.isLocal;

  let modelObject: { [key: string]: { inference_method?: string } } = {};

  if (isLocal) {
    // 本地模型：添加 inference_method
    modelObject[modelId] = { inference_method: 'ollama' };
  } else {
    // 非本地模型：保持内部 JSON 为空
    modelObject[modelId] = {};
  }

  // 获取配置 - 现在可以安全地访问，因为数据已经标准化
  const vectorConfig = extraConfigs.vector_config;
  const webConfig = extraConfigs.web_config;
  const perplexityConfig = extraConfigs.perplexity_config;

  // 构建输入输出映射
  const inputs = Object.fromEntries(
    sourceNodes.map(node => [node.id, node.label])
  );
  const outputs = Object.fromEntries(
    targetNodes.map(node => [node.id, node.label])
  );

  const result = {
    type: 'deep_research' as const,
    data: {
      query: query,
      extra_configs: {
        max_rounds: maxRounds,
        llm_model: modelObject,
        vector_config: vectorConfig,
        web_config: webConfig,
        perplexity_config: perplexityConfig,
      },
      inputs: inputs,
      outputs: outputs,
    },
  };

  return result;
}
