import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import InputOutputDisplay from './components/InputOutputDisplay';
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import {
  useAppSettings,
  Model,
} from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

// 与后端 DeepResearcherEdge/config.json 对齐的配置结构
// 另外增加 dataSource（简化）以承载来自已索引结构化数据的选择，
// 在发送到后端时由执行器转换为 vector_search_configs.data_source
interface SimplifiedIndexItem {
  index_name: string;
  collection_configs?: {
    collection_name: string;
  };
}

// 与 Retrieving.tsx 对齐的索引项接口
interface IndexingItem {
  type: string;
  status: string;
  index_name: string;
  collection_configs?: {
    collection_name: string;
  };
}

export type DeepResearchNodeData = {
  nodeLabels?: { label: string; id: string }[];
  subMenuType: string | null;
  content: string | null;
  looped: boolean | undefined;
  query_id: { id: string; label: string } | undefined;
  // 来自上游 JSON Block 的索引数据选择（与 Retrieving.tsx 保持一致的简化结构）
  dataSource?: {
    id: string;
    label: string;
    index_item?: SimplifiedIndexItem;
  }[];
  modelAndProvider?:
    | {
        id: string;
        name: string;
        provider: string;
        isLocal: boolean;
      }
    | undefined;
  extra_configs: {
    model: string;
    temperature: number;
    max_tokens: number;
    max_iterations: number;
    vector_search_configs: {
      top_k: number;
      threshold: number;
    };
    google_search_configs: {
      enabled: boolean;
      sub_search_type: string;
      top_k: number;
      filter_unreachable_pages: boolean;
      firecrawl_config: {
        formats: string[];
        is_only_main_content: boolean;
        wait_for: number;
        skip_tls_verification: boolean;
        remove_base64_images: boolean;
      };
    };
    perplexity_search_configs: {
      enabled: boolean;
      sub_search_type: string;
      model: string;
      max_tokens: number;
      temperature: number;
    };
  };
};

type DeepResearchNodeProps = NodeProps<Node<DeepResearchNodeData>>;

// 定义各字段的可选值
const GOOGLE_SEARCH_TYPES = [
  { id: 'google', name: 'Google Standard' },
  { id: 'google_v2', name: 'Google V2 (Firecrawl)' },
  { id: 'ddg', name: 'DuckDuckGo' },
];

const PERPLEXITY_SEARCH_TYPES = [
  { id: 'perplexity', name: 'Perplexity API' },
  { id: 'ddg', name: 'DuckDuckGo Chat' },
];

const PERPLEXITY_MODELS = [
  { id: 'perplexity/sonar', name: 'Sonar' },
  { id: 'perplexity/sonar-pro', name: 'Sonar Pro' },
  { id: 'perplexity/sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
];

const FIRECRAWL_FORMATS = [
  { id: 'markdown', name: 'Markdown' },
  { id: 'html', name: 'HTML' },
  { id: 'text', name: 'Text' },
  { id: 'json', name: 'JSON' },
];

function DeepResearch({ data, isConnectable, id }: DeepResearchNodeProps) {
  const {
    isOnConnect,
    activatedEdge,
    isOnGeneratingNewNode,
    clearEdgeActivation,
    activateEdge,
    clearAll,
  } = useNodesPerFlowContext();
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false);
  const { getNode, setNodes, setEdges } = useReactFlow();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);
  const portalAnchorRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);

  // 获取所有需要的依赖
  const { streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
  const { availableModels } = useAppSettings();

  // 获取可用的激活模型列表 - 只显示 LLM 类型的模型
  const activeModels = useMemo(() => {
    return availableModels.filter(m => m.active && m.type == 'llm');
  }, [availableModels]);

  // 使用 useRef 跟踪是否已挂载
  const hasMountedRef = useRef(false);

  // 状态管理
  const [showGoogleSettings, setShowGoogleSettings] = useState(false);
  const [showPerplexitySettings, setShowPerplexitySettings] = useState(false);
  const [showVectorSettings, setShowVectorSettings] = useState(false);

  // 创建默认配置的辅助函数
  const createDefaultNodeData = useCallback(
    (existingData?: Partial<DeepResearchNodeData>): DeepResearchNodeData => {
      const defaultModel = activeModels.length > 0 ? activeModels[0] : null;

      const existingExtra = existingData?.extra_configs as
        | DeepResearchNodeData['extra_configs']
        | undefined;

      return {
        nodeLabels: existingData?.nodeLabels || [],
        subMenuType: existingData?.subMenuType || null,
        content: existingData?.content || null,
        looped: existingData?.looped || false,
        query_id: existingData?.query_id || undefined,
        dataSource: existingData?.dataSource || [],
        modelAndProvider:
          existingData?.modelAndProvider ||
          (defaultModel
            ? {
                id: defaultModel.id,
                name: defaultModel.name,
                provider: defaultModel.provider || 'Unknown',
                isLocal: defaultModel.isLocal || false,
              }
            : undefined),
        extra_configs: {
          model:
            existingExtra?.model || defaultModel?.id || 'gpt-4o-2024-08-06',
          temperature: existingExtra?.temperature ?? 0.1,
          max_tokens: existingExtra?.max_tokens ?? 10000,
          max_iterations: existingExtra?.max_iterations ?? 3,
          vector_search_configs: {
            top_k: existingExtra?.vector_search_configs?.top_k ?? 5,
            threshold: existingExtra?.vector_search_configs?.threshold ?? 0.7,
          },
          google_search_configs: {
            enabled: existingExtra?.google_search_configs?.enabled ?? true,
            sub_search_type:
              existingExtra?.google_search_configs?.sub_search_type ||
              'google_v2',
            top_k: existingExtra?.google_search_configs?.top_k ?? 5,
            filter_unreachable_pages:
              existingExtra?.google_search_configs?.filter_unreachable_pages ??
              true,
            firecrawl_config: {
              formats: existingExtra?.google_search_configs?.firecrawl_config
                ?.formats || ['markdown'],
              is_only_main_content:
                existingExtra?.google_search_configs?.firecrawl_config
                  ?.is_only_main_content ?? true,
              wait_for:
                existingExtra?.google_search_configs?.firecrawl_config
                  ?.wait_for ?? 60,
              skip_tls_verification:
                existingExtra?.google_search_configs?.firecrawl_config
                  ?.skip_tls_verification ?? true,
              remove_base64_images:
                existingExtra?.google_search_configs?.firecrawl_config
                  ?.remove_base64_images ?? true,
            },
          },
          perplexity_search_configs: {
            enabled: existingExtra?.perplexity_search_configs?.enabled ?? true,
            sub_search_type:
              existingExtra?.perplexity_search_configs?.sub_search_type ||
              'perplexity',
            model:
              existingExtra?.perplexity_search_configs?.model ||
              'perplexity/sonar',
            max_tokens:
              existingExtra?.perplexity_search_configs?.max_tokens ?? 4000,
            temperature:
              existingExtra?.perplexity_search_configs?.temperature ?? 0.1,
          },
        },
      };
    },
    [activeModels]
  );

  // 获取当前节点数据，确保完整性
  const getCurrentNodeData = useCallback((): DeepResearchNodeData => {
    const currentNode = getNode(id);
    const existingData = currentNode?.data as Partial<DeepResearchNodeData>;
    const result = createDefaultNodeData(existingData);
    return result;
  }, [id, getNode, createDefaultNodeData]);

  // 统一的数据更新函数
  // 在 updateNodeData 函数中添加调试
  // 在 updateNodeData 函数中添加调试
  const updateNodeData = useCallback(
    (updates: Partial<DeepResearchNodeData>) => {
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id === id) {
            // console.log(
            //   '🔍 [updateNodeData] 更新前的 node.data:',
            //   JSON.stringify(node.data, null, 2)
            // );

            const currentData = createDefaultNodeData(
              node.data as Partial<DeepResearchNodeData>
            );

            const newData = {
              ...currentData,
              ...updates,
              extra_configs: {
                ...currentData.extra_configs,
                ...(updates.extra_configs || {}),
                vector_search_configs: {
                  ...currentData.extra_configs.vector_search_configs,
                  ...(updates.extra_configs?.vector_search_configs || {}),
                },
                google_search_configs: {
                  ...currentData.extra_configs.google_search_configs,
                  ...(updates.extra_configs?.google_search_configs || {}),
                },
                perplexity_search_configs: {
                  ...currentData.extra_configs.perplexity_search_configs,
                  ...(updates.extra_configs?.perplexity_search_configs || {}),
                },
              },
            };

            // console.log(
            //   '🔍 [updateNodeData] 更新后的 newData:',
            //   JSON.stringify(newData, null, 2)
            // );

            return { ...node, data: newData };
          }
          return node;
        })
      );
    },
    [id, setNodes, createDefaultNodeData]
  );

  // 初始化节点数据
  // 初始化节点数据
  useEffect(() => {
    if (!hasMountedRef.current && !isOnGeneratingNewNode) {
      hasMountedRef.current = true;

      // 确保节点数据结构完整
      const currentData = getCurrentNodeData();
      updateNodeData(currentData);
    }
  }, [isOnGeneratingNewNode, getCurrentNodeData, updateNodeData]);

  useEffect(() => {
    console.log(
      '🔍 DeepResearch isOnGeneratingNewNode:',
      isOnGeneratingNewNode
    );
    console.log('🔍 hasMountedRef.current:', hasMountedRef.current);
  }, [isOnGeneratingNewNode]);

  // 获取当前配置值
  const currentData = getCurrentNodeData();

  // 状态管理 - 基于当前节点数据
  const [selectedModelAndProvider, setSelectedModelAndProvider] =
    useState<Model | null>(() => {
      const nodeModelAndProvider = currentData.modelAndProvider;
      if (nodeModelAndProvider) {
        const matchedModel = activeModels.find(
          m => m.id === nodeModelAndProvider.id
        );
        return (
          matchedModel ||
          ({
            id: nodeModelAndProvider.id,
            name: nodeModelAndProvider.name,
            provider: nodeModelAndProvider.provider,
            isLocal: nodeModelAndProvider.isLocal,
            active: true,
          } as Model)
        );
      }
      return activeModels.length > 0 ? activeModels[0] : null;
    });

  const [maxRounds, setMaxRounds] = useState<number>(
    currentData.extra_configs.max_iterations
  );
  // Vector search is always enabled by default (no enable field in backend config)
  const vectorEnabled = true;
  const [vectorTopK, setVectorTopK] = useState<number>(
    currentData.extra_configs.vector_search_configs.top_k
  );
  const [vectorThreshold, setVectorThreshold] = useState<number>(
    currentData.extra_configs.vector_search_configs.threshold
  );
  const [webTopK, setWebTopK] = useState<number>(
    currentData.extra_configs.google_search_configs.top_k
  );

  // General LLM settings
  const [temperature, setTemperature] = useState<number>(
    currentData.extra_configs.temperature
  );
  const [maxTokens, setMaxTokens] = useState<number>(
    currentData.extra_configs.max_tokens
  );

  // Google search configs
  const [googleEnabled, setGoogleEnabled] = useState<boolean>(
    currentData.extra_configs.google_search_configs.enabled
  );
  const [googleSubType, setGoogleSubType] = useState<string>(
    currentData.extra_configs.google_search_configs.sub_search_type
  );
  const [googleFilterUnreachable, setGoogleFilterUnreachable] =
    useState<boolean>(
      currentData.extra_configs.google_search_configs.filter_unreachable_pages
    );
  const [firecrawlFormats, setFirecrawlFormats] = useState<string[]>(
    currentData.extra_configs.google_search_configs.firecrawl_config
      .formats || ['markdown']
  );
  const [firecrawlIsOnlyMainContent, setFirecrawlIsOnlyMainContent] =
    useState<boolean>(
      currentData.extra_configs.google_search_configs.firecrawl_config
        .is_only_main_content
    );
  const [firecrawlWaitFor, setFirecrawlWaitFor] = useState<number>(
    currentData.extra_configs.google_search_configs.firecrawl_config.wait_for
  );
  const [firecrawlSkipTls, setFirecrawlSkipTls] = useState<boolean>(
    currentData.extra_configs.google_search_configs.firecrawl_config
      .skip_tls_verification
  );
  const [firecrawlRemoveBase64, setFirecrawlRemoveBase64] = useState<boolean>(
    currentData.extra_configs.google_search_configs.firecrawl_config
      .remove_base64_images
  );

  // Perplexity configs
  const [perplexityEnabled, setPerplexityEnabled] = useState<boolean>(
    currentData.extra_configs.perplexity_search_configs.enabled
  );
  const [perplexitySubType, setPerplexitySubType] = useState<string>(
    currentData.extra_configs.perplexity_search_configs.sub_search_type
  );
  const [perplexityModel, setPerplexityModel] = useState<string>(
    currentData.extra_configs.perplexity_search_configs.model
  );
  const [perplexityMaxTokens, setPerplexityMaxTokens] = useState<number>(
    currentData.extra_configs.perplexity_search_configs.max_tokens
  );
  const [perplexityTemperature, setPerplexityTemperature] = useState<number>(
    currentData.extra_configs.perplexity_search_configs.temperature
  );

  // 当可用模型变化且当前选择的模型不在可用列表中时，更新为第一个可用模型
  useEffect(() => {
    if (
      activeModels.length > 0 &&
      selectedModelAndProvider &&
      !activeModels.some(m => m.id === selectedModelAndProvider.id)
    ) {
      setSelectedModelAndProvider(activeModels[0]);
    }
  }, [activeModels, selectedModelAndProvider]);

  // 自定义渲染模型选项的函数
  const renderModelOption = useCallback((modelObj: Model) => {
    return (
      <div className='flex items-center justify-between w-full'>
        <span className='truncate mr-2'>{modelObj.name || modelObj.id}</span>
        {modelObj.isLocal ? (
          <span className='ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#2A4365] text-[#90CDF4] flex-shrink-0'>
            Local
          </span>
        ) : (
          <span className='ml-auto px-1.5 py-0.5 text-[10px] rounded bg-[#4A4A4A] text-[#CDCDCD] flex-shrink-0'>
            Cloud
          </span>
        )}
      </div>
    );
  }, []);

  // 自定义显示选择的模型的函数
  const mapModelToDisplay = useCallback((model: Model | null) => {
    if (!model) return 'Select a model';
    return `${model.name} (${model.provider})`;
  }, []);

  // Vector search is always enabled, so we only need to handle data source changes
  // Remove vector enabled change handler since it's always enabled

  // Google search enabled change handler
  const handleGoogleEnabledChange = useCallback((checked: boolean) => {
    setGoogleEnabled(checked);
  }, []);

  // Perplexity search enabled change handler
  const handlePerplexityEnabledChange = useCallback((checked: boolean) => {
    setPerplexityEnabled(checked);
  }, []);

  // Refs for inputs
  const maxRoundsRef = useRef<HTMLInputElement>(null);
  const vectorTopKRef = useRef<HTMLInputElement>(null);
  const vectorThresholdRef = useRef<HTMLInputElement>(null);
  const webTopKRef = useRef<HTMLInputElement>(null);

  // DeepResearch: 数据源（来自索引）
  const [dataSource, setDataSource] = useState<
    { label: string; id: string; index_item?: SimplifiedIndexItem }[]
  >(() => currentData.dataSource || []);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // 数据同步函数 - 模型选择
  const onModelAndProviderChange = useCallback(
    (newModelAndProvider: Model) => {
      const currentData = getCurrentNodeData();
      updateNodeData({
        modelAndProvider: {
          id: newModelAndProvider.id,
          name: newModelAndProvider.name,
          provider: newModelAndProvider.provider || 'Unknown',
          isLocal: newModelAndProvider.isLocal || false,
        },
        extra_configs: {
          ...currentData.extra_configs,
          model: newModelAndProvider.id,
        },
      });
    },
    [updateNodeData, getCurrentNodeData]
  );

  // 批量状态同步逻辑 - 统一处理所有状态更新
  useEffect(() => {
    if (!isOnGeneratingNewNode && hasMountedRef.current) {
      console.log('🔄 开始批量状态同步');

      const timer = setTimeout(() => {
        const currentData = getCurrentNodeData();

        const updates = {
          modelAndProvider: selectedModelAndProvider
            ? {
                id: selectedModelAndProvider.id,
                name: selectedModelAndProvider.name,
                provider: selectedModelAndProvider.provider || 'Unknown',
                isLocal: selectedModelAndProvider.isLocal || false,
              }
            : currentData.modelAndProvider,
          extra_configs: {
            model:
              selectedModelAndProvider?.id || currentData.extra_configs.model,
            temperature: temperature,
            max_tokens: maxTokens,
            max_iterations: maxRounds,
            vector_search_configs: {
              top_k: vectorTopK,
              threshold: vectorThreshold,
            },
            google_search_configs: {
              enabled: googleEnabled,
              sub_search_type: googleSubType,
              top_k: webTopK,
              filter_unreachable_pages: googleFilterUnreachable,
              firecrawl_config: {
                formats: firecrawlFormats,
                is_only_main_content: firecrawlIsOnlyMainContent,
                wait_for: firecrawlWaitFor,
                skip_tls_verification: firecrawlSkipTls,
                remove_base64_images: firecrawlRemoveBase64,
              },
            },
            perplexity_search_configs: {
              enabled: perplexityEnabled,
              sub_search_type: perplexitySubType,
              model: perplexityModel,
              max_tokens: perplexityMaxTokens,
              temperature: perplexityTemperature,
            },
          },
        };

        console.log('🔄 执行批量状态更新', updates);
        updateNodeData(updates);
      }, 150);

      return () => {
        console.log('🔄 清理状态同步定时器');
        clearTimeout(timer);
      };
    }
  }, [
    isOnGeneratingNewNode,
    selectedModelAndProvider,
    maxRounds,
    vectorTopK,
    vectorThreshold,
    webTopK,
    temperature,
    maxTokens,
    googleEnabled,
    googleSubType,
    googleFilterUnreachable,
    firecrawlFormats,
    firecrawlIsOnlyMainContent,
    firecrawlWaitFor,
    firecrawlSkipTls,
    firecrawlRemoveBase64,
    perplexityEnabled,
    perplexitySubType,
    perplexityModel,
    perplexityMaxTokens,
    perplexityTemperature,
    getCurrentNodeData,
    updateNodeData,
  ]);

  // 创建执行上下文
  const createExecutionContext = useCallback(
    (): RunSingleEdgeNodeContext => ({
      getNode,
      setNodes,
      setEdges,
      getSourceNodeIdWithLabel,
      getTargetNodeIdWithLabel,
      clearAll,
      streamResult,
      reportError,
      resetLoadingUI,
      isLocalDeployment: false,
    }),
    [
      getNode,
      setNodes,
      setEdges,
      getSourceNodeIdWithLabel,
      getTargetNodeIdWithLabel,
      clearAll,
      streamResult,
      reportError,
      resetLoadingUI,
    ]
  );

  // 使用执行函数的 handleDataSubmit
  const handleDataSubmit = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    const context = createExecutionContext();

    // 使用 getCurrentNodeData 获取标准化的节点数据
    const nodeData = getCurrentNodeData();

    try {
      await runSingleEdgeNode({
        parentId: id,
        targetNodeType: 'text',
        context,
      });
    } catch (error) {
      console.error('DeepResearch execution failed:', error);
      resetLoadingUI(id);
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    id,
    createExecutionContext,
    resetLoadingUI,
    getCurrentNodeData,
  ]);

  // UI 交互函数
  const onClickButton = useCallback(() => {
    setIsMenuOpen(!isMenuOpen);

    if (isOnGeneratingNewNode) return;
    if (activatedEdge === id) {
      clearEdgeActivation();
    } else {
      clearAll();
      activateEdge(id);
    }
  }, [
    isMenuOpen,
    isOnGeneratingNewNode,
    activatedEdge,
    id,
    clearEdgeActivation,
    clearAll,
    activateEdge,
  ]);

  const onDataSubmit = useCallback(() => {
    handleDataSubmit();
  }, [handleDataSubmit]);

  const onFocus = useCallback(() => {
    const curRef = menuRef.current;
    if (curRef && !curRef.classList.contains('nodrag')) {
      curRef.classList.add('nodrag');
    }
  }, []);

  const onBlur = useCallback(() => {
    const curRef = menuRef.current;
    if (curRef) {
      curRef.classList.remove('nodrag');
    }
  }, []);

  // 拉平可选择的索引项（参考 Retrieving.tsx）
  const flattenedIndexItems = useMemo(() => {
    const items: {
      nodeId: string;
      nodeLabel: string;
      indexItem: IndexingItem;
    }[] = [];

    getSourceNodeIdWithLabel(id).forEach(node => {
      const nodeInfo = getNode(node.id);
      if (nodeInfo?.type === 'structured') {
        const indexingList = nodeInfo?.data?.indexingList as
          | IndexingItem[]
          | undefined;
        if (Array.isArray(indexingList)) {
          indexingList.forEach(item => {
            if (item.type === 'vector' && item.status === 'done') {
              items.push({
                nodeId: node.id,
                nodeLabel: node.label,
                indexItem: item,
              });
            }
          });
        }
      }
    });
    return items;
  }, [id, getSourceNodeIdWithLabel, getNode]);

  const addNodeLabel = useCallback(
    (option: {
      nodeId: string;
      nodeLabel: string;
      indexItem: IndexingItem;
    }) => {
      const nodeId = option.nodeId;
      if (!dataSource.some(item => item.id === nodeId)) {
        const simplified: SimplifiedIndexItem = {
          index_name: option.indexItem.index_name,
          collection_configs: option.indexItem.collection_configs,
        };
        const newItem = {
          id: nodeId,
          label: option.nodeLabel,
          index_item: simplified,
        };
        const newDataSource = [...dataSource, newItem];
        setDataSource(newDataSource);
        updateNodeData({ dataSource: newDataSource });
      }
    },
    [dataSource, updateNodeData]
  );

  const removeNodeLabel = useCallback(
    (index: number) => {
      const newDataSource = [...dataSource];
      newDataSource.splice(index, 1);
      setDataSource(newDataSource);
      updateNodeData({ dataSource: newDataSource });
    },
    [dataSource, updateNodeData]
  );

  // 添加停止函数
  const onStopExecution = useCallback(() => {
    console.log('Stop execution');
    setIsLoading(false);
  }, []);

  // 处理多选格式的函数
  const handleFormatToggle = useCallback((formatId: string) => {
    setFirecrawlFormats(prev => {
      if (prev.includes(formatId)) {
        // 如果已选中，则移除（但至少保留一个）
        return prev.length > 1 ? prev.filter(f => f !== formatId) : prev;
      } else {
        // 如果未选中，则添加
        return [...prev, formatId];
      }
    });
  }, []);

  // 缓存按钮样式
  const runButtonStyle = useMemo(
    () => ({
      backgroundColor: isRunButtonHovered
        ? isLoading
          ? '#FFA73D'
          : '#39BC66'
        : '#181818',
      borderColor: isRunButtonHovered
        ? isLoading
          ? '#FFA73D'
          : '#39BC66'
        : UI_COLORS.EDGENODE_BORDER_GREY,
      color: isRunButtonHovered ? '#000' : UI_COLORS.EDGENODE_BORDER_GREY,
    }),
    [isRunButtonHovered, isLoading]
  );

  const mainButtonStyle = useMemo(
    () => ({
      borderColor: isLoading
        ? '#FFA73D'
        : isHovered
          ? UI_COLORS.LINE_ACTIVE
          : UI_COLORS.EDGENODE_BORDER_GREY,
      color: isLoading
        ? '#FFA73D'
        : isHovered
          ? UI_COLORS.LINE_ACTIVE
          : UI_COLORS.EDGENODE_BORDER_GREY,
    }),
    [isLoading, isHovered]
  );

  // Handle样式
  const handleStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      width: 'calc(100%)',
      height: 'calc(100%)',
      top: '0',
      left: '0',
      borderRadius: '0',
      transform: 'translate(0px, 0px)',
      background: 'transparent',
      border: '3px solid transparent',
      zIndex: !isOnConnect ? '-1' : '1',
    }),
    [isOnConnect]
  );

  // Use body-level fixed portal so menu does not scale with zoom
  useEffect(() => {
    if (!isMenuOpen) return;
    let rafId: number | null = null;
    const GAP = 16;

    const positionMenu = () => {
      const anchorEl = portalAnchorRef.current as HTMLElement | null;
      const container = menuContainerRef.current as HTMLDivElement | null;
      if (!container || !anchorEl) {
        rafId = requestAnimationFrame(positionMenu);
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = 448; // matches w-[448px]
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      const top = rect.bottom + GAP;

      container.style.position = 'fixed';
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.zIndex = '2000000';
      container.style.pointerEvents = 'auto';

      rafId = requestAnimationFrame(positionMenu);
    };

    positionMenu();
    const onScroll = () => positionMenu();
    const onResize = () => positionMenu();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isMenuOpen]);

  return (
    <div className='relative p-[3px] w-[80px] h-[48px]'>
      {/* Invisible hover area between node and run button */}
      <div
        className='absolute -top-[40px] left-0 w-full h-[40px]'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Run button positioned above the node - show when node or run button is hovered */}
      <button
        className={`absolute -top-[40px] left-1/2 transform -translate-x-1/2 w-[57px] h-[24px] rounded-[6px] border-[1px] text-[10px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[4px] transition-all duration-200 ${
          isHovered || isRunButtonHovered ? 'opacity-100' : 'opacity-0'
        }`}
        style={runButtonStyle}
        onClick={isLoading ? onStopExecution : onDataSubmit}
        disabled={false}
        onMouseEnter={() => setIsRunButtonHovered(true)}
        onMouseLeave={() => setIsRunButtonHovered(false)}
      >
        <span>
          {isLoading ? (
            <svg width='6' height='6' viewBox='0 0 6 6' fill='none'>
              <rect width='6' height='6' fill='currentColor' />
            </svg>
          ) : (
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='6'
              height='8'
              viewBox='0 0 8 10'
              fill='none'
            >
              <path d='M8 5L0 10V0L8 5Z' fill='currentColor' />
            </svg>
          )}
        </span>
        <span>{isLoading ? 'Stop' : 'Run'}</span>
      </button>

      {/* Main button */}
      <button
        onClick={onClickButton}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600] edge-node transition-colors gap-[4px]`}
        style={mainButtonStyle}
      >
        {/* Deep Research icon */}
        <svg
          width='10'
          height='10'
          viewBox='0 0 14 14'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M7 2.5C7 2.5 4.5 1 2 3.5C2 3.5 1.5 6.5 4 7.5C4 7.5 6 8.5 7 11.5C7 11.5 8 8.5 10 7.5C10 7.5 12.5 6.5 12 3.5C12 3.5 9.5 1 7 2.5Z'
            stroke='currentColor'
            strokeWidth='1.5'
            fill='none'
          />
          <circle
            cx='7'
            cy='7'
            r='2'
            stroke='currentColor'
            strokeWidth='1.5'
            fill='none'
          />
          <path d='M6.5 5.5L7.5 6.5' stroke='currentColor' strokeWidth='1.5' />
          <path d='M7.5 7.5L6.5 8.5' stroke='currentColor' strokeWidth='1.5' />
        </svg>
        <div className='flex flex-col items-center justify-center leading-tight text-[8px]'>
          <span>Deep</span>
          <span>Research</span>
        </div>

        {/* Handles - 保持原有的位置 */}
        <Handle
          id={`${id}-a`}
          className='edgeSrcHandle handle-with-icon handle-top'
          type='source'
          position={Position.Top}
        />
        <Handle
          id={`${id}-b`}
          className='edgeSrcHandle handle-with-icon handle-right'
          type='source'
          position={Position.Right}
        />
        <Handle
          id={`${id}-c`}
          className='edgeSrcHandle handle-with-icon handle-bottom'
          type='source'
          position={Position.Bottom}
        />
        <Handle
          id={`${id}-d`}
          className='edgeSrcHandle handle-with-icon handle-left'
          type='source'
          position={Position.Left}
        />
        {/* Target handles */}
        <Handle
          id={`${id}-a`}
          type='target'
          position={Position.Top}
          style={handleStyle}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-b`}
          type='target'
          position={Position.Right}
          style={handleStyle}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-c`}
          type='target'
          position={Position.Bottom}
          style={handleStyle}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-d`}
          type='target'
          position={Position.Left}
          style={handleStyle}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
      </button>

      {/* Invisible fixed-position anchor to tether the portal menu to this node */}
      <div ref={portalAnchorRef} className='absolute left-0 top-full h-0 w-0' />

      {/* Configuration Menu - render in portal to avoid zoom scaling */}
      {isMenuOpen &&
        createPortal(
          <div
            ref={menuContainerRef}
            style={{ position: 'fixed', zIndex: 2000000 }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <ul
              ref={menuRef}
              className='text-white w-[448px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
              style={{ borderColor: UI_COLORS.EDGENODE_BORDER_GREY }}
              onWheelCapture={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              onTouchMoveCapture={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
            >
          {/* Title and Run button section */}
          <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            <div className='flex flex-row gap-[12px]'>
              <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                  <svg
                    width='10'
                    height='10'
                    viewBox='0 0 14 14'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      d='M7 2.5C7 2.5 4.5 1 2 3.5C2 3.5 1.5 6.5 4 7.5C4 7.5 6 8.5 7 11.5C7 11.5 8 8.5 10 7.5C10 7.5 12.5 6.5 12 3.5C12 3.5 9.5 1 7 2.5Z'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                      fill='none'
                    />
                    <circle
                      cx='7'
                      cy='7'
                      r='2'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                      fill='none'
                    />
                    <path
                      d='M6.5 5.5L7.5 6.5'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                    />
                    <path
                      d='M7.5 7.5L6.5 8.5'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                    />
                  </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                  Deep Research
                </div>
              </div>
            </div>
            <div className='w-[57px] h-[26px]'>
              <button
                className='w-full h-full rounded-[8px] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                style={{
                  backgroundColor: isLoading ? '#FFA73D' : '#39BC66',
                }}
                onClick={isLoading ? onStopExecution : onDataSubmit}
                disabled={false}
              >
                <span>
                  {isLoading ? (
                    <svg width='8' height='8' viewBox='0 0 8 8' fill='none'>
                      <rect width='8' height='8' fill='currentColor' />
                    </svg>
                  ) : (
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      width='8'
                      height='10'
                      viewBox='0 0 8 10'
                      fill='none'
                    >
                      <path d='M8 5L0 10V0L8 5Z' fill='black' />
                    </svg>
                  )}
                </span>
                <span>{isLoading ? 'Stop' : 'Run'}</span>
              </button>
            </div>
          </li>

          {/* Input/Output display */}
          <li>
            <InputOutputDisplay
              parentId={id}
              getNode={getNode}
              getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
              getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
              supportedInputTypes={['text', 'structured']}
              supportedOutputTypes={['structured']}
              inputNodeCategory='blocknode'
              outputNodeCategory='blocknode'
            />
          </li>

          {/* Model Selection */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <label className='text-[13px] font-semibold text-[#6D7177]'>
                Model & Provider
              </label>
              <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
            </div>
            <div className='relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
              <PuppyDropdown
                options={activeModels}
                selectedValue={selectedModelAndProvider}
                onSelect={(selectedModel: Model) =>
                  setSelectedModelAndProvider(selectedModel)
                }
                buttonHeight='32px'
                buttonBgColor='transparent'
                menuBgColor='#1A1A1A'
                listWidth='100%'
                containerClassnames='w-full'
                onFocus={onFocus}
                onBlur={onBlur}
                mapValueTodisplay={mapModelToDisplay}
                renderOption={renderModelOption}
              />
            </div>
            {/* 显示当前选择的模型详细信息 */}
            {selectedModelAndProvider && (
              <div className='text-[11px] text-[#6D7177] flex items-center gap-2'>
                <span>Provider: {selectedModelAndProvider.provider}</span>
                <span>•</span>
                <span>
                  {selectedModelAndProvider.isLocal ? 'Local' : 'Cloud'}
                </span>
                <span>•</span>
                <span>ID: {selectedModelAndProvider.id}</span>
              </div>
            )}
          </li>

          {/* General Settings */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <label className='text-[13px] font-semibold text-[#6D7177]'>
                General Settings
              </label>
              <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <div className='flex flex-col gap-1'>
                <label className='text-[11px] text-[#6D7177]'>
                  Max Iterations
                </label>
                <input
                  ref={maxRoundsRef}
                  type='number'
                  value={maxRounds}
                  onChange={e => setMaxRounds(parseInt(e.target.value) || 3)}
                  min='1'
                  max='10'
                  className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
              <div className='flex flex-col gap-1'>
                <label className='text-[11px] text-[#6D7177]'>Max Tokens</label>
                <input
                  type='number'
                  value={maxTokens}
                  min='1'
                  max='32000'
                  onChange={e => setMaxTokens(parseInt(e.target.value) || 1)}
                  className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <div className='flex flex-col gap-1'>
                <label className='text-[11px] text-[#6D7177]'>
                  Temperature
                </label>
                <input
                  type='number'
                  value={temperature}
                  min='0'
                  max='2'
                  step='0.1'
                  onChange={e =>
                    setTemperature(parseFloat(e.target.value) || 0)
                  }
                  className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            </div>
          </li>

          {/* Google Search Settings */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Google Search
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
              </div>
              <button
                onClick={() => setShowGoogleSettings(!showGoogleSettings)}
                className='text-[11px] text-[#6D7177] hover:text-white transition-colors'
              >
                {showGoogleSettings ? 'Hide' : 'Show'}
              </button>
            </div>

            {showGoogleSettings && (
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={googleEnabled}
                    onChange={e => handleGoogleEnabledChange(e.target.checked)}
                    className='w-4 h-4'
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  <label className='text-[11px] text-[#6D7177]'>
                    Enable Google Search
                  </label>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Sub Type
                    </label>
                    <div
                      className={`relative h-[28px] rounded-[4px] border-[1px] border-[#6D7177]/30 ${
                        googleEnabled
                          ? 'bg-[#252525] hover:border-[#6D7177]/50'
                          : 'bg-[#1A1A1A] cursor-not-allowed'
                      } transition-colors`}
                    >
                      <PuppyDropdown
                        options={GOOGLE_SEARCH_TYPES}
                        selectedValue={
                          GOOGLE_SEARCH_TYPES.find(
                            type => type.id === googleSubType
                          ) || GOOGLE_SEARCH_TYPES[0]
                        }
                        onSelect={(selectedType: {
                          id: string;
                          name: string;
                        }) => setGoogleSubType(selectedType.id)}
                        buttonHeight='28px'
                        buttonBgColor='transparent'
                        menuBgColor='#1A1A1A'
                        listWidth='100%'
                        containerClassnames='w-full'
                        onFocus={onFocus}
                        onBlur={onBlur}
                        disabled={!googleEnabled}
                        mapValueTodisplay={(
                          type: { id: string; name: string } | null
                        ) => type?.name || 'Select Type'}
                      />
                    </div>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Top K Results
                    </label>
                    <input
                      ref={webTopKRef}
                      type='number'
                      value={webTopK}
                      onChange={e => setWebTopK(parseInt(e.target.value) || 5)}
                      disabled={!googleEnabled}
                      min='1'
                      max='20'
                      className={`h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none ${
                        googleEnabled
                          ? 'bg-[#252525] text-white'
                          : 'bg-[#1A1A1A] text-[#6D7177] cursor-not-allowed'
                      }`}
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      checked={googleFilterUnreachable}
                      onChange={e =>
                        setGoogleFilterUnreachable(e.target.checked)
                      }
                      disabled={!googleEnabled}
                      className='w-4 h-4'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                    <label className='text-[11px] text-[#6D7177]'>
                      Filter Unreachable
                    </label>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Wait For (s)
                    </label>
                    <input
                      type='number'
                      value={firecrawlWaitFor}
                      onChange={e =>
                        setFirecrawlWaitFor(parseInt(e.target.value) || 0)
                      }
                      disabled={!googleEnabled}
                      min='0'
                      max='120'
                      className={`h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none ${
                        googleEnabled
                          ? 'bg-[#252525] text-white'
                          : 'bg-[#1A1A1A] text-[#6D7177] cursor-not-allowed'
                      }`}
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                </div>
                <div className='flex flex-col gap-1'>
                  <label className='text-[11px] text-[#6D7177]'>
                    Firecrawl Formats
                  </label>
                  <div
                    className={`min-h-[28px] p-2 border-[1px] border-[#6D7177]/30 rounded-[4px] ${
                      googleEnabled
                        ? 'bg-[#252525]'
                        : 'bg-[#1A1A1A] cursor-not-allowed'
                    } transition-colors`}
                  >
                    <div className='flex flex-wrap gap-2'>
                      {FIRECRAWL_FORMATS.map(format => (
                        <button
                          key={format.id}
                          type='button'
                          onClick={() => handleFormatToggle(format.id)}
                          disabled={!googleEnabled}
                          className={`px-2 py-1 text-[10px] rounded-[4px] border transition-colors ${
                            firecrawlFormats.includes(format.id)
                              ? 'bg-[#39BC66] border-[#39BC66] text-black font-semibold'
                              : googleEnabled
                                ? 'bg-[#1A1A1A] border-[#6D7177]/30 text-[#6D7177] hover:border-[#6D7177]/50'
                                : 'bg-[#1A1A1A] border-[#6D7177]/20 text-[#6D7177]/50 cursor-not-allowed'
                          }`}
                        >
                          {format.name}
                        </button>
                      ))}
                    </div>
                    <div className='text-[9px] text-[#6D7177] mt-1'>
                      Selected: {firecrawlFormats.join(', ')}
                    </div>
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      checked={firecrawlIsOnlyMainContent}
                      onChange={e =>
                        setFirecrawlIsOnlyMainContent(e.target.checked)
                      }
                      disabled={!googleEnabled}
                      className='w-4 h-4'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                    <label className='text-[11px] text-[#6D7177]'>
                      Only Main Content
                    </label>
                  </div>
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      checked={firecrawlSkipTls}
                      onChange={e => setFirecrawlSkipTls(e.target.checked)}
                      disabled={!googleEnabled}
                      className='w-4 h-4'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                    <label className='text-[11px] text-[#6D7177]'>
                      Skip TLS Verification
                    </label>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={firecrawlRemoveBase64}
                    onChange={e => setFirecrawlRemoveBase64(e.target.checked)}
                    disabled={!googleEnabled}
                    className='w-4 h-4'
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  <label className='text-[11px] text-[#6D7177]'>
                    Remove Base64 Images
                  </label>
                </div>
              </div>
            )}
          </li>

          {/* Perplexity Search Settings */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Perplexity Search
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
              </div>
              <button
                onClick={() =>
                  setShowPerplexitySettings(!showPerplexitySettings)
                }
                className='text-[11px] text-[#6D7177] hover:text-white transition-colors'
              >
                {showPerplexitySettings ? 'Hide' : 'Show'}
              </button>
            </div>

            {showPerplexitySettings && (
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={perplexityEnabled}
                    onChange={e =>
                      handlePerplexityEnabledChange(e.target.checked)
                    }
                    className='w-4 h-4'
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                  <label className='text-[11px] text-[#6D7177]'>
                    Enable Perplexity Search
                  </label>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Sub Type
                    </label>
                    <div
                      className={`relative h-[28px] rounded-[4px] border-[1px] border-[#6D7177]/30 ${
                        perplexityEnabled
                          ? 'bg-[#252525] hover:border-[#6D7177]/50'
                          : 'bg-[#1A1A1A] cursor-not-allowed'
                      } transition-colors`}
                    >
                      <PuppyDropdown
                        options={PERPLEXITY_SEARCH_TYPES}
                        selectedValue={
                          PERPLEXITY_SEARCH_TYPES.find(
                            type => type.id === perplexitySubType
                          ) || PERPLEXITY_SEARCH_TYPES[0]
                        }
                        onSelect={(selectedType: {
                          id: string;
                          name: string;
                        }) => setPerplexitySubType(selectedType.id)}
                        buttonHeight='28px'
                        buttonBgColor='transparent'
                        menuBgColor='#1A1A1A'
                        listWidth='100%'
                        containerClassnames='w-full'
                        onFocus={onFocus}
                        onBlur={onBlur}
                        disabled={!perplexityEnabled}
                        mapValueTodisplay={(
                          type: { id: string; name: string } | null
                        ) => type?.name || 'Select Type'}
                      />
                    </div>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>Model</label>
                    <div
                      className={`relative h-[28px] rounded-[4px] border-[1px] border-[#6D7177]/30 ${
                        perplexityEnabled
                          ? 'bg-[#252525] hover:border-[#6D7177]/50'
                          : 'bg-[#1A1A1A] cursor-not-allowed'
                      } transition-colors`}
                    >
                      <PuppyDropdown
                        options={PERPLEXITY_MODELS}
                        selectedValue={
                          PERPLEXITY_MODELS.find(
                            model => model.id === perplexityModel
                          ) || PERPLEXITY_MODELS[0]
                        }
                        onSelect={(selectedModel: {
                          id: string;
                          name: string;
                        }) => setPerplexityModel(selectedModel.id)}
                        buttonHeight='28px'
                        buttonBgColor='transparent'
                        menuBgColor='#1A1A1A'
                        listWidth='100%'
                        containerClassnames='w-full'
                        onFocus={onFocus}
                        onBlur={onBlur}
                        disabled={!perplexityEnabled}
                        mapValueTodisplay={(
                          model: { id: string; name: string } | null
                        ) => model?.name || 'Select Model'}
                      />
                    </div>
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Max Tokens
                    </label>
                    <input
                      type='number'
                      value={perplexityMaxTokens}
                      onChange={e =>
                        setPerplexityMaxTokens(parseInt(e.target.value) || 0)
                      }
                      disabled={!perplexityEnabled}
                      min='0'
                      max='16000'
                      className={`h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none ${
                        perplexityEnabled
                          ? 'bg-[#252525] text-white'
                          : 'bg-[#1A1A1A] text-[#6D7177] cursor-not-allowed'
                      }`}
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Temperature
                    </label>
                    <input
                      type='number'
                      value={perplexityTemperature}
                      onChange={e =>
                        setPerplexityTemperature(
                          parseFloat(e.target.value) || 0
                        )
                      }
                      disabled={!perplexityEnabled}
                      min='0'
                      max='2'
                      step='0.1'
                      className={`h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none ${
                        perplexityEnabled
                          ? 'bg-[#252525] text-white'
                          : 'bg-[#1A1A1A] text-[#6D7177] cursor-not-allowed'
                      }`}
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                </div>
              </div>
            )}
          </li>

          {/* Vector Search Settings */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Vector Search
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
              </div>
              <button
                onClick={() => setShowVectorSettings(!showVectorSettings)}
                className='text-[11px] text-[#6D7177] hover:text-white transition-colors'
              >
                {showVectorSettings ? 'Hide' : 'Show'}
              </button>
            </div>

            {showVectorSettings && (
              <div className='flex flex-col gap-2'>
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Top K Results
                    </label>
                    <input
                      ref={vectorTopKRef}
                      type='number'
                      value={vectorTopK}
                      onChange={e =>
                        setVectorTopK(parseInt(e.target.value) || 5)
                      }
                      min='1'
                      max='20'
                      className='h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none bg-[#252525] text-white'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Similarity Threshold
                    </label>
                    <input
                      ref={vectorThresholdRef}
                      type='number'
                      value={vectorThreshold}
                      onChange={e =>
                        setVectorThreshold(parseFloat(e.target.value) || 0.5)
                      }
                      min='0'
                      max='1'
                      step='0.1'
                      className='h-[28px] px-2 border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] focus:border-[#6D7177]/50 focus:outline-none bg-[#252525] text-white'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                </div>

                {/* Indexed Structured Data Selection */}
                <div className='flex flex-col gap-2'>
                  <label className='text-[11px] text-[#6D7177]'>
                    Indexed Structured Data
                  </label>

                  {/* start of node labels */}
                  <div className='bg-[#1E1E1E] rounded-[8px] p-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2 items-center min-h-[12px]'>
                      {dataSource.map((item, index) => (
                        <div
                          key={index}
                          className='flex items-center bg-[#252525] rounded-[4px] h-[26px] p-[6px]
                                     border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 
                                     transition-colors group'
                        >
                          <span className='text-[10px] text-[#9B7EDB] font-medium'>
                            {item.label}
                          </span>
                          <button
                            onClick={() => removeNodeLabel(index)}
                            className='ml-2 text-[#6D7177] hover:text-[#ff6b6b] transition-colors 
                                       opacity-0 group-hover:opacity-100'
                          >
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              width='10'
                              height='10'
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                              strokeWidth='2'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            >
                              <line x1='18' y1='6' x2='6' y2='18'></line>
                              <line x1='6' y1='6' x2='18' y2='18'></line>
                            </svg>
                          </button>
                        </div>
                      ))}

                      {flattenedIndexItems.length > 0 && (
                        <div className='relative'>
                          <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className='w-[24px] h-[24px] flex items-center justify-center rounded-md
                                       bg-[#252525] border border-[#6D7177]/30 
                                       text-[#6D7177] 
                                       hover:border-[#6D7177]/50 hover:bg-[#252525]/80 
                                       transition-colors'
                          >
                            <svg
                              width='12'
                              height='12'
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                            >
                              <path
                                d='M12 5v14M5 12h14'
                                strokeWidth='2'
                                strokeLinecap='round'
                              />
                            </svg>
                          </button>

                          {isDropdownOpen && (
                            <div
                              className='absolute top-full left-0 mt-1 w-[240px] bg-[#1A1A1A] 
                                         border border-[#6D7177]/30 rounded-[8px] shadow-lg z-10 max-h-[200px] overflow-y-auto'
                            >
                              {flattenedIndexItems
                                .filter(
                                  item =>
                                    !dataSource.some(
                                      ds => ds.id === item.nodeId
                                    )
                                )
                                .map((item, index) => (
                                  <button
                                    key={index}
                                    onClick={() => {
                                      addNodeLabel(item);
                                      setIsDropdownOpen(false);
                                    }}
                                    className='w-full text-left px-3 py-2 text-[11px] text-[#CDCDCD] 
                                               hover:bg-[#252525] transition-colors border-b border-[#6D7177]/20 last:border-b-0'
                                  >
                                    <div className='font-medium text-[#9B7EDB]'>
                                      {item.nodeLabel}
                                    </div>
                                    <div className='text-[#6D7177] text-[10px] mt-1'>
                                      Index: {item.indexItem.index_name}
                                    </div>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </li>
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

export default DeepResearch;
