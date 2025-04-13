import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils, { NodeJsonType } from '../../../../hooks/useJsonConstructUtils';

// 基础类型定义
export type BaseNodeData = {
    content: string;
    label: string;
    resultNode?: string;
    isLoading?: boolean;
    locked?: boolean;
    isInput?: boolean;
    isOutput?: boolean;
    editable?: boolean;
}

// 定义基础类型
export type EdgeNodeType = "copy" | "chunkingAuto" | "chunkingByCharacter" | "chunkingByLength" | "convert2structured" | "convert2text" | "editText" | string;

// Copy 操作的数据类型
export type CopyEdgeJsonType = {
    type: "modify";
    data: {
        modify_type: "copy";
        content: string;
        extra_configs: {};
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// Chunking 操作的数据类型
export type ChunkingAutoEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "auto" | "size" | "tokenizer";
        extra_configs: {
            model?: "gpt-4o" | "gpt-4-turbo" | "gpt-4o-mini";
            chunk_size?: number;
            overlap?: number;
            handle_half_word?: boolean;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 在 BaseEdgeJsonType 中添加 ChunkingByCharacter 类型
export type ChunkingByCharacterEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "character";
        sub_chunking_mode: "character";
        extra_configs: {
            delimiters: string[];
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 ChunkingByLength 类型
export type ChunkingByLengthEdgeJsonType = {
    type: "chunk";
    data: {
        chunking_mode: "length";
        sub_chunking_mode: "size" | "tokenizer";
        extra_configs: {
            chunk_size: number;
            overlap: number;
            handle_half_word: boolean;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 Convert2Structured 类型
export type Convert2StructuredEdgeJsonType = {
    type: "modify";
    data: {
        content: string;
        modify_type: "convert2structured";
        extra_configs: {
            conversion_mode: string;
            action_type: "default" | "json";
            list_separator?: string[];
            length_separator?: number;
            dict_key?: string;
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 Convert2Text 类型
export type Convert2TextEdgeJsonType = {
    type: "modify";
    data: {
        content: string;
        modify_type: "convert2text";
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// 添加 EditText 类型
export type EditTextEdgeJsonType = {
    type: "modify",
    data: {
        modify_type: "edit_text",
        extra_configs: {
            slice: number[],
            sort_type: string
        },
        content: string,
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

// 添加 Retrieving 类型
export type SearchByVectorEdgeJsonType = {
    type: "search",
    data: {
        search_type: "vector",
        top_k: number,
        inputs: { [key: string]: string },
        threshold: number,
        extra_configs: {
            provider?: "openai",
            model?: "text-embedding-ada-002",
            db_type?: "pgvector" | "pinecone",
            collection_name?: string,
        } | {},
        doc_ids: string[],
        query_id: { [key: string]: string },
        outputs: { [key: string]: string }
    },
    id: string
}

// 添加 SearchGoogle 类型
export type SearchGoogleEdgeJsonType = {
    type: "search",
    data: {
        search_type: "web",
        sub_search_type: "google",
        top_k: number,
        inputs: { [key: string]: string },
        query_id: { [key: string]: string },
        extra_configs: {},
        outputs: { [key: string]: string }
    },
}

// 添加 Perplexity 类型
export type perplexityModelNames = "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online";

export type SearchPerplexityEdgeJsonType = {
    type: "search",
    data: {
        search_type: "qa",
        sub_search_type: "perplexity",
        inputs: { [key: string]: string },
        query_id: { [key: string]: string },
        extra_configs: {
            model: perplexityModelNames
        },
        outputs: { [key: string]: string }
    },
}

// 添加 LLM 类型
export type LLMEdgeJsonType = {
    type: "llm",
    data: {
        messages: { role: "system" | "user" | "assistant", content: string }[],
        model: string,
        base_url: string,
        max_tokens: number,
        temperature: number,
        inputs: { [key: string]: string },
        structured_output: boolean,
        outputs: { [key: string]: string }
    }
}

// 添加 Edit Structured 类型
export type EditStructuredEdgeJsonType = {
    type: "modify",
    data: {
        content: string,
        modify_type: "edit_structured",
        extra_configs: {
            operations: [{
                type: string,
                params: {
                    max_depth?: number,
                    path?: (string | number)[],
                    default?: string,
                    value?: string
                }
            }]
        },
        inputs: { [key: string]: string },
        outputs: { [key: string]: string }
    },
}

// 定义 Retrieving 节点的后端 JSON 类型
export type RetrievingEdgeJsonType = {
    type: "search";
    data: {
        search_type: "vector";
        top_k: number;
        inputs: { [key: string]: string };
        threshold: number;
        extra_configs: {
            provider?: "openai";
            model?: "text-embedding-ada-002";
            db_type?: "pgvector" | "pinecone";
            collection_name?: string;
        } | {};
        query_id: { [key: string]: string };
        outputs: { [key: string]: string };
    };
}

// Add the ifelse case
export type IfElseEdgeJsonType = {
    type: "ifelse",
    data: {
        cases: {
            [key: string]: {
                conditions: {
                    block: string;
                    condition: string;
                    parameters: { [key: string]: string | number };
                    operation: string;
                }[];
                then: {
                    from: string;
                    to: string;
                };
            };
        };
        inputs: { [key: string]: string };
        outputs: { [key: string]: string };
    };
};

// 修改 BaseEdgeJsonType 以包含 RetrievingEdgeJsonType
export type BaseEdgeJsonType = CopyEdgeJsonType | ChunkingAutoEdgeJsonType |
    ChunkingByCharacterEdgeJsonType | ChunkingByLengthEdgeJsonType |
    Convert2StructuredEdgeJsonType | Convert2TextEdgeJsonType | EditTextEdgeJsonType |
    SearchByVectorEdgeJsonType | SearchGoogleEdgeJsonType | SearchPerplexityEdgeJsonType |
    LLMEdgeJsonType | EditStructuredEdgeJsonType | RetrievingEdgeJsonType | IfElseEdgeJsonType;

// 构造的数据类型
export type BaseConstructedJsonData = {
    blocks: { [key: string]: NodeJsonType };
    edges: { [key: string]: BaseEdgeJsonType };
}

// Hook 配置类型
export type BaseEdgeNodeConfig = {
    parentId: string;
    targetNodeType: string;
    nodeType: EdgeNodeType;
    constructJsonData?: () => BaseConstructedJsonData;
    delimiters?: string[];
    setDelimiters?: (delimiters: string[]) => void;
    // 添加 ChunkingByLength 的配置
    subChunkMode?: "size" | "tokenizer";
    setSubChunkMode?: (mode: "size" | "tokenizer") => void;
    chunkSize?: number;
    setChunkSize?: (size: number | undefined) => void;
    overlap?: number;
    setOverlap?: (overlap: number | undefined) => void;
    handleHalfWord?: boolean;
    setHandleHalfWord?: (value: boolean) => void;
    // 添加 Convert2Structured 的配置
    execMode?: string;
    deliminator?: string;
    bylen?: number;
    wrapInto?: string;
    textContent?: string,
    retMode?: string,
    configNum?: number,
    query?: { id: string, label: string },
    nodeLabels?: { id: string, label: string }[],
    top_k?: number,
    threshold?: number,
    model?: perplexityModelNames;
    messages?: { role: "system" | "user" | "assistant", content: string }[];
    llmModel?: string;
    baseUrl?: string;
    structuredOutput?: boolean;
}

// 修改返回的数据结构，只返回边缘节点相关的JSON
export type EdgeNodeJsonData = BaseEdgeJsonType;

export function useEdgeNodeBackEndJsonBuilder() {
    // 基础hooks
    const { getNode } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils();

    // 修改构建节点JSON的主函数，只返回边的JSON
    const buildEdgeNodeJson = (nodeId: string): EdgeNodeJsonData => {
        // 获取节点数据及类型
        const node = getNode(nodeId);
        if (!node) {
            throw new Error(`节点 ${nodeId} 不存在`);
        }
        
        const nodeData = node.data;
        const nodeType = node.type as EdgeNodeType;
        
        // 获取源节点和目标节点（仅用于构建边的JSON）
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(nodeId);
        const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(nodeId);
        
        // 根据节点类型构建相应的JSON
        let edgeJson: BaseEdgeJsonType;
        
        switch (nodeType) {
            case "copy":
                edgeJson = buildCopyNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "chunkingAuto":
                edgeJson = buildChunkingAutoNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "chunkingByCharacter":
                edgeJson = buildChunkingByCharacterNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "chunkingByLength":
                edgeJson = buildChunkingByLengthNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "convert2structured":
                edgeJson = buildConvert2StructuredNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "convert2text":
                edgeJson = buildConvert2TextNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "editText":
                edgeJson = buildEditTextNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "searchGoogle":
                edgeJson = buildSearchGoogleNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "searchPerplexity":
                edgeJson = buildSearchPerplexityNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "llmnew":
                edgeJson = buildLLMNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "editStructured":
                edgeJson = buildEditStructuredNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "retrieving":
                edgeJson = buildRetrievingNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            case "ifelse":
                edgeJson = buildIfElseNodeJson(nodeId, sourceNodeIdWithLabelGroup, targetNodeIdWithLabelGroup);
                break;
                
            default:
                throw new Error(`不支持的节点类型: ${nodeType}`);
        }
        
        return edgeJson;
    };
    
    // 为每种节点类型构建JSON的辅助函数
    const buildCopyNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): CopyEdgeJsonType => {
        return {
            type: "modify",
            data: {
                modify_type: "copy",
                content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
                extra_configs: {},
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildChunkingAutoNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): ChunkingAutoEdgeJsonType => {
        return {
            type: "chunk",
            data: {
                chunking_mode: "auto",
                extra_configs: {
                    model: undefined,
                    chunk_size: undefined,
                    overlap: undefined,
                    handle_half_word: undefined
                },
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildChunkingByCharacterNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): ChunkingByCharacterEdgeJsonType => {
        const characterNodeData = getNode(nodeId)?.data;
        
        // 尝试从多个位置获取delimiters
        let delimitersFromNode: string[] = [",", ";", "\n"]; // 默认值
        
        // 直接从nodeData.delimiters获取
        if (characterNodeData?.delimiters && Array.isArray(characterNodeData.delimiters)) {
            delimitersFromNode = characterNodeData.delimiters;
        }
        // 尝试从content中解析（向后兼容）
        else if (characterNodeData?.content) {
            try {
                const parsedContent = typeof characterNodeData.content === 'string' ?
                    JSON.parse(characterNodeData.content) : characterNodeData.content;
                if (Array.isArray(parsedContent)) {
                    delimitersFromNode = parsedContent;
                }
            } catch (e) {
                console.warn("无法从content解析delimiters:", e);
            }
        }
        
        return {
            type: "chunk",
            data: {
                chunking_mode: "character",
                sub_chunking_mode: "character",
                extra_configs: {
                    delimiters: delimitersFromNode
                },
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildChunkingByLengthNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): ChunkingByLengthEdgeJsonType => {
        const lengthNodeData = getNode(nodeId)?.data;
        
        // 从节点数据中获取参数
        let subChunkModeFromNode: "size" | "tokenizer" = "size"; // 默认值
        let chunkSizeFromNode = 200; // 默认值
        let overlapFromNode = 20; // 默认值
        let handleHalfWordFromNode = false; // 默认值
        
        // 检查并获取sub_chunking_mode
        if (lengthNodeData?.sub_chunking_mode === "size" || lengthNodeData?.sub_chunking_mode === "tokenizer") {
            subChunkModeFromNode = lengthNodeData.sub_chunking_mode;
        }
        
        // 检查并获取extra_configs中的属性
        if (lengthNodeData?.extra_configs && typeof lengthNodeData.extra_configs === 'object') {
            // 获取chunk_size
            const configChunkSize = (lengthNodeData.extra_configs as any).chunk_size;
            if (typeof configChunkSize === 'number') {
                chunkSizeFromNode = configChunkSize;
            }
            
            // 获取overlap
            const configOverlap = (lengthNodeData.extra_configs as any).overlap;
            if (typeof configOverlap === 'number') {
                overlapFromNode = configOverlap;
            }
            
            // 获取handle_half_word
            const configHandleHalfWord = (lengthNodeData.extra_configs as any).handle_half_word;
            if (typeof configHandleHalfWord === 'boolean') {
                handleHalfWordFromNode = configHandleHalfWord;
            }
        }
        
        return {
            type: "chunk",
            data: {
                chunking_mode: "length",
                sub_chunking_mode: subChunkModeFromNode,
                extra_configs: {
                    chunk_size: chunkSizeFromNode,
                    overlap: overlapFromNode,
                    handle_half_word: handleHalfWordFromNode
                },
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildConvert2StructuredNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): Convert2StructuredEdgeJsonType => {
        const structuredNodeData = getNode(nodeId)?.data;
        
        // 提取配置值
        let conversionMode: string;
        let actionType: "default" | "json" = "default";
        let listSeparator: string[] | undefined;
        let lengthSeparator: number | undefined;
        let dictKey: string | undefined;
        
        // 直接从节点数据中获取execMode
        const execModeFromNode = structuredNodeData?.execMode; 
        
        // 基于execMode设置转换模式
        switch (execModeFromNode) {
            case "JSON":
                conversionMode = "parse_as_json";
                actionType = "json";
                break;
            case "wrap into list":
                conversionMode = "parse_as_list";
                break;
            case "wrap into dict":
                conversionMode = "wrap_into_dict";
                // 获取dict键名
                if (structuredNodeData?.extra_configs &&
                    typeof structuredNodeData.extra_configs === 'object') {
                    dictKey = (structuredNodeData.extra_configs as any)?.dict_key;
                }
                break;
            case "split by length":
                conversionMode = "split_by_length";
                // 获取长度值
                if (structuredNodeData?.extra_configs &&
                    typeof structuredNodeData.extra_configs === 'object') {
                    lengthSeparator = (structuredNodeData.extra_configs as any)?.length_separator;
                }
                break;
            case "split by character":
                conversionMode = "split_by_character";
                // 获取分隔符列表
                if (structuredNodeData?.extra_configs &&
                    typeof structuredNodeData.extra_configs === 'object') {
                    try {
                        const separatorStr = (structuredNodeData.extra_configs as any)?.list_separator;
                        if (typeof separatorStr === 'string') {
                            listSeparator = JSON.parse(separatorStr);
                        }
                    } catch (e) {
                        console.warn("无法解析列表分隔符:", e);
                        listSeparator = [",", ";", ".", "\n"];
                    }
                }
                break;
            default:
                conversionMode = "parse_as_json";
                break;
        }
        
        // 构建extra_configs对象
        const extraConfigs: {
            conversion_mode: string;
            action_type: "default" | "json";
            list_separator?: string[];
            length_separator?: number;
            dict_key?: string;
        } = {
            conversion_mode: conversionMode,
            action_type: actionType
        };
        
        // 根据需要添加额外配置
        if (conversionMode === "split_by_character" && listSeparator) {
            extraConfigs.list_separator = listSeparator;
        }
        if (conversionMode === "split_by_length" && lengthSeparator) {
            extraConfigs.length_separator = lengthSeparator;
        }
        if (conversionMode === "wrap_into_dict" && dictKey) {
            extraConfigs.dict_key = dictKey;
        }
        
        return {
            type: "modify",
            data: {
                content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
                modify_type: "convert2structured",
                extra_configs: extraConfigs,
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildConvert2TextNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): Convert2TextEdgeJsonType => {
        return {
            type: "modify",
            data: {
                content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
                modify_type: "convert2text",
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildEditTextNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): EditTextEdgeJsonType => {
        const editTextNodeData = getNode(nodeId)?.data;
        
        // 从节点数据中获取必要参数并确保是字符串类型
        let textContentFromNode = "";
        
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
                    console.warn("无法stringify内容:", e);
                }
            }
        }
        
        // 获取retMode和configNum，设置默认值
        let retModeFromNode = "return all";
        let configNumFromNode = 100;
        
        // 安全地检查并获取extra_configs属性
        if (editTextNodeData?.extra_configs &&
            typeof editTextNodeData.extra_configs === 'object') {
            
            // 获取retMode
            const extractedRetMode = (editTextNodeData.extra_configs as any)?.retMode;
            if (typeof extractedRetMode === 'string') {
                retModeFromNode = extractedRetMode;
            }
            
            // 获取configNum
            const extractedConfigNum = (editTextNodeData.extra_configs as any)?.configNum;
            if (typeof extractedConfigNum === 'number') {
                configNumFromNode = extractedConfigNum;
            }
        }
        
        // 辅助函数，根据retMode和configNum计算切片范围
        const getSliceRange = (retMode: string, configNum: number): [number, number] => {
            switch (retMode) {
                case "return all":
                    return [0, -1];
                case "return first n":
                    return [0, configNum];
                case "return last n":
                    return [-configNum, -1];
                case "exclude first n":
                    return [configNum, -1];
                case "exclude last n":
                    return [0, -configNum];
                default:
                    return [0, -1]; // 默认返回全部
            }
        };
        
        return {
            type: "modify",
            data: {
                modify_type: "edit_text",
                extra_configs: {
                    slice: getSliceRange(retModeFromNode, configNumFromNode),
                    sort_type: "/"
                },
                content: textContentFromNode, // 确保是字符串
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };
    
    const buildSearchGoogleNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): SearchGoogleEdgeJsonType => {
        const googleNodeData = getNode(nodeId)?.data;
        
        // 安全地获取top_k，如果不存在则使用默认值5
        const googleTopK = typeof googleNodeData?.top_k === 'number' ? googleNodeData.top_k : 5;
        
        return {
            type: "search",
            data: {
                search_type: "web",
                sub_search_type: "google",
                top_k: googleTopK,
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                query_id: sourceNodes.length > 0
                    ? { [sourceNodes[0].id]: sourceNodes[0].label }
                    : {},
                extra_configs: {},
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            },
        };
    };
    
    const buildSearchPerplexityNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): SearchPerplexityEdgeJsonType => {
        const perplexityNodeData = getNode(nodeId)?.data;
        
        // 添加正确的类型检查
        let perplexityModel: perplexityModelNames = "llama-3.1-sonar-small-128k-online"; // 默认值
        
        // 检查extra_configs是否存在并有model属性
        if (perplexityNodeData?.extra_configs &&
            typeof perplexityNodeData.extra_configs === 'object' &&
            perplexityNodeData.extra_configs !== null) {
            
            // 从extra_configs获取model并进行类型断言
            const configModel = (perplexityNodeData.extra_configs as { model?: string }).model;
            
            // 验证是允许的模型名称之一
            if (configModel === "llama-3.1-sonar-small-128k-online" ||
                configModel === "llama-3.1-sonar-large-128k-online" ||
                configModel === "llama-3.1-sonar-huge-128k-online") {
                perplexityModel = configModel;
            }
        }
        
        return {
            type: "search",
            data: {
                search_type: "qa",
                sub_search_type: "perplexity",
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                query_id: sourceNodes.length > 0
                    ? { [sourceNodes[0].id]: sourceNodes[0].label }
                    : {},
                extra_configs: {
                    model: perplexityModel
                },
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            },
        };
    };
    
    const buildLLMNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): LLMEdgeJsonType => {
        const llmNodeData = getNode(nodeId)?.data;
        
        // 定义消息类型
        type PromptMessage = {
            role: "system" | "user" | "assistant";
            content: string;
        };
        
        // 从content字段解析消息并正确类型化
        let parsedMessages: PromptMessage[] = [];
        try {
            if (llmNodeData?.content) {
                const contentData = typeof llmNodeData.content === 'string'
                    ? JSON.parse(llmNodeData.content)
                    : llmNodeData.content;
                
                // 确保是正确类型的数组
                if (Array.isArray(contentData)) {
                    parsedMessages = contentData as PromptMessage[];
                }
            }
        } catch (e) {
            console.warn("无法解析LLM节点内容:", e);
            parsedMessages = [];
        }
        
        // 确保model和base_url是字符串
        const llmModel = typeof llmNodeData?.model === 'string' ? llmNodeData.model : "anthropic/claude-3.5-haiku";
        const llmBaseUrl = typeof llmNodeData?.base_url === 'string' ? llmNodeData.base_url : "";
        const llmStructuredOutput = !!llmNodeData?.structured_output; // 转换为布尔值
        
        return {
            type: "llm",
            data: {
                // TypeScript现在知道每条消息的结构
                messages: parsedMessages.filter((msg: PromptMessage) =>
                    msg.role === "system" || msg.role === "user"
                ),
                model: llmModel,
                base_url: llmBaseUrl,
                max_tokens: 2000,
                temperature: 0.7,
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                structured_output: llmStructuredOutput,
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };

    const buildEditStructuredNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): EditStructuredEdgeJsonType => {
        const nodeData = getNode(nodeId)?.data;
        
        // 从节点获取配置数据
        const execMode = nodeData?.type || "get";
        const getConfigData = nodeData?.getConfigData as Array<{ key: string, value: string }> || [];
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
        
        if (execMode === "get_keys" || execMode === "get_values") {
            params = {
                max_depth: 100
            };
        } else {
            params = {
                path: path,
                ...(execMode === "get" && { default: "Get Failed, value not exist" }),
                ...(execMode === "replace" && { value: paramv })
            };
        }
        
        // 转换操作类型: 如果UI中显示为"replace"，传递给后端时应使用"set_value"
        const operationType = execMode === "replace" ? "set_value" : execMode;
        
        return {
            type: "modify",
            data: {
                content: `{{${sourceNodes[0]?.label || sourceNodes[0]?.id}}}`,
                modify_type: "edit_structured",
                extra_configs: {
                    operations: [
                        {
                            type: operationType as string, // 使用转换后的操作类型
                            params: params
                        }
                    ]
                },
                inputs: Object.fromEntries(sourceNodes.map(node => ([node.id, node.label]))),
                outputs: Object.fromEntries(targetNodes.map(node => ([node.id, node.label])))
            }
        };
    };

    // 使用正确的实现，不引入外部类型
    const buildRetrievingNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): RetrievingEdgeJsonType => {
        // 从 React Flow 获取节点数据
        const nodeData = getNode(nodeId)?.data;
        
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
        const queryIdData = nodeData?.query_id as { id?: string, label?: string } | undefined;
        if (queryIdData && typeof queryIdData.id === 'string' && typeof queryIdData.label === 'string') {
            queryId[queryIdData.id] = queryIdData.label;
        }
        
        // 安全地获取阈值，默认为 0.7
        let threshold = 0.7;
        const extraConfigs = nodeData?.extra_configs as { threshold?: number } | undefined;
        if (extraConfigs && typeof extraConfigs.threshold === 'number') {
            threshold = extraConfigs.threshold;
        }
        
        // 安全地获取 top_k，默认为 5
        let top_k = 5;
        if (nodeData && typeof nodeData.top_k === 'number') {
            top_k = nodeData.top_k;
        }
        
        return {
            type: "search",
            data: {
                search_type: "vector",
                top_k: top_k,
                inputs: inputs,
                threshold: threshold,
                extra_configs: {
                    provider: "openai",
                    model: "text-embedding-ada-002",
                    db_type: "pgvector"
                },
                query_id: queryId,
                outputs: outputs
            }
        };
    };

    const buildIfElseNodeJson = (
        nodeId: string, 
        sourceNodes: { id: string, label: string }[], 
        targetNodes: { id: string, label: string }[]
    ): IfElseEdgeJsonType => {
        // Get the node data from ReactFlow
        const nodeData = getNode(nodeId)?.data;
        
        // Check if nodeData.cases exists and is an array
        if (!nodeData || !nodeData.cases || !Array.isArray(nodeData.cases) || nodeData.cases.length === 0) {
            // Return a default structure if no cases defined or cases is not an array
            return {
                type: "ifelse",
                data: {
                    cases: {},
                    inputs: sourceNodes.reduce((acc, node) => ({ ...acc, [node.id]: node.label }), {}),
                    outputs: targetNodes.reduce((acc, node) => ({ ...acc, [node.id]: node.label }), {})
                }
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
                then: {
                    from: string;
                    to: string;
                };
            };
        } = {};
        
        // Map frontend condition types to backend condition types
        const conditionMap: { [key: string]: string } = {
            // For text nodes
            "contains": "contain",
            "doesn't contain": "not_contain",
            "is greater than [N] characters": "greater_than_n_chars",
            "is less than [N] characters": "less_than_n_chars",
            "is empty": "is_empty",
            "is not empty": "is_not_empty",
            "is True": "is",
            "is False": "is_not",
            
            // For structured nodes
            "is list": "is_list",
            "is dict": "is_dict",
            "is greater than [N]": "greater_than_n",
            "is less than [N]": "less_than_n"
        };
        
        // Process each case
        nodeData.cases.forEach((caseItem: any, index: number) => {
            const caseKey = `case${index + 1}`;
            
            // Verify that conditions array exists and is valid
            if (!caseItem.conditions || !Array.isArray(caseItem.conditions)) {
                return; // Skip this case if conditions are invalid
            }
            
            // Process conditions
            const conditions = caseItem.conditions.map((condition: any, condIndex: number) => {
                // Convert the frontend condition to backend condition format
                const backendCondition = conditionMap[condition.cond_v] || condition.cond_v;
                
                // Operation should be "/" if it's the last condition in the group
                const isLastCondition = condIndex === caseItem.conditions.length - 1;
                const operation = isLastCondition ? "/" : condition.operation.toLowerCase();
                
                return {
                    block: condition.id,
                    condition: backendCondition,
                    parameters: {
                        value: condition.cond_input || ""
                    },
                    operation: operation
                };
            });
            
            // Verify that actions array exists
            if (!caseItem.actions || !Array.isArray(caseItem.actions) || caseItem.actions.length === 0) {
                return; // Skip this case if actions are invalid
            }
            
            // Process actions (take the first action as the main action)
            const action = caseItem.actions[0];
            
            // If action.outputs is not an array or is empty, use a fallback
            const outputId = Array.isArray(action.outputs) && action.outputs.length > 0 
                ? action.outputs[0] 
                : targetNodes[0]?.id || "";
            
            transformedCases[caseKey] = {
                conditions,
                then: {
                    from: action.from_id || sourceNodes[0]?.id || "",
                    to: outputId
                }
            };
        });
        
        // If no valid cases were processed, we might end up with an empty object
        // Make sure we have at least one case if there were cases in the input
        if (Object.keys(transformedCases).length === 0 && nodeData.cases.length > 0) {
            // Create a default case using the first source and target nodes
            transformedCases["case1"] = {
                conditions: [{
                    block: sourceNodes[0]?.id || "",
                    condition: "contain",
                    parameters: { value: "" },
                    operation: "/"
                }],
                then: {
                    from: sourceNodes[0]?.id || "",
                    to: targetNodes[0]?.id || ""
                }
            };
        }
        
        return {
            type: "ifelse",
            data: {
                cases: transformedCases,
                inputs: sourceNodes.reduce((acc, node) => ({ ...acc, [node.id]: node.label }), {}),
                outputs: targetNodes.reduce((acc, node) => ({ ...acc, [node.id]: node.label }), {})
            }
        };
    };
    
    // 返回构建JSON的主函数
    return { buildEdgeNodeJson, buildRetrievingNodeJson, buildIfElseNodeJson };
}