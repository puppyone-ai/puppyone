import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
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

export type DeepResearchNodeData = {
  nodeLabels?: { label: string; id: string }[];
  subMenuType: string | null;
  content: string | null;
  looped: boolean | undefined;
  query_id: { id: string; label: string } | undefined;
  modelAndProvider?:
    | {
        id: string;
        name: string;
        provider: string;
        isLocal: boolean;
      }
    | undefined;
  extra_configs: {
    max_rounds: number;
    llm_model: string;
    vector_config: {
      enabled: boolean;
      data_source: string[];
      top_k: number;
      threshold: number;
    };
    web_config: {
      top_k: number;
      disable_content_filtering: boolean;
      disable_quality_filtering: boolean;
    };
    perplexity_config: {
      model: string;
      sub_search_type: string;
    };
  };
};

type DeepResearchNodeProps = NodeProps<Node<DeepResearchNodeData>>;

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
  const [isHovered, setIsHovered] = useState(false);
  const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);

  // 获取所有需要的依赖
  const { streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
  const { getAuthHeaders, availableModels, isLocalDeployment } =
    useAppSettings();

  // 获取可用的激活模型列表 - 只显示 LLM 类型的模型
  const activeModels = useMemo(() => {
    return availableModels.filter(m => m.active && m.type == 'llm');
  }, [availableModels]);

  // 使用 useRef 跟踪是否已挂载
  const hasMountedRef = useRef(false);

  // 状态管理
  const [showSettings, setShowSettings] = useState(false);

  // 创建默认配置的辅助函数
  const createDefaultNodeData = useCallback(
    (existingData?: Partial<DeepResearchNodeData>): DeepResearchNodeData => {
      const defaultModel = activeModels.length > 0 ? activeModels[0] : null;

      return {
        nodeLabels: existingData?.nodeLabels || [],
        subMenuType: existingData?.subMenuType || null,
        content: existingData?.content || null,
        looped: existingData?.looped || false,
        query_id: existingData?.query_id || undefined,
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
          max_rounds: existingData?.extra_configs?.max_rounds ?? 3,
          llm_model:
            existingData?.extra_configs?.llm_model ||
            defaultModel?.id ||
            'gpt-4o',
          vector_config: {
            enabled:
              existingData?.extra_configs?.vector_config?.enabled ?? false,
            data_source:
              existingData?.extra_configs?.vector_config?.data_source || [],
            top_k: existingData?.extra_configs?.vector_config?.top_k ?? 5,
            threshold:
              existingData?.extra_configs?.vector_config?.threshold ?? 0.5,
          },
          web_config: {
            top_k: existingData?.extra_configs?.web_config?.top_k ?? 5,
            disable_content_filtering:
              existingData?.extra_configs?.web_config
                ?.disable_content_filtering ?? true,
            disable_quality_filtering:
              existingData?.extra_configs?.web_config
                ?.disable_quality_filtering ?? true,
          },
          perplexity_config: {
            model:
              existingData?.extra_configs?.perplexity_config?.model || 'sonar',
            sub_search_type:
              existingData?.extra_configs?.perplexity_config?.sub_search_type ||
              'perplexity',
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
                vector_config: {
                  ...currentData.extra_configs.vector_config,
                  ...(updates.extra_configs?.vector_config || {}),
                },
                web_config: {
                  ...currentData.extra_configs.web_config,
                  ...(updates.extra_configs?.web_config || {}),
                },
                perplexity_config: {
                  ...currentData.extra_configs.perplexity_config,
                  ...(updates.extra_configs?.perplexity_config || {}),
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
    currentData.extra_configs.max_rounds
  );
  const [vectorEnabled, setVectorEnabled] = useState<boolean>(() => {
    const currentData = getCurrentNodeData();
    return currentData.extra_configs.vector_config.enabled;
  });
  const [vectorTopK, setVectorTopK] = useState<number>(
    currentData.extra_configs.vector_config.top_k
  );
  const [vectorThreshold, setVectorThreshold] = useState<number>(
    currentData.extra_configs.vector_config.threshold
  );
  const [webTopK, setWebTopK] = useState<number>(
    currentData.extra_configs.web_config.top_k
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

  // 简化onChange处理 - vectorEnabled checkbox
  const handleVectorEnabledChange = useCallback((checked: boolean) => {
    setVectorEnabled(checked);
  }, []);

  // Refs for inputs
  const maxRoundsRef = useRef<HTMLInputElement>(null);
  const vectorTopKRef = useRef<HTMLInputElement>(null);
  const vectorThresholdRef = useRef<HTMLInputElement>(null);
  const webTopKRef = useRef<HTMLInputElement>(null);

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
          llm_model: newModelAndProvider.id,
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
            max_rounds: maxRounds,
            llm_model:
              selectedModelAndProvider?.id ||
              currentData.extra_configs.llm_model,
            vector_config: {
              enabled: vectorEnabled,
              data_source: vectorEnabled ? ['default'] : [],
              top_k: vectorTopK,
              threshold: vectorThreshold,
            },
            web_config: {
              ...currentData.extra_configs.web_config,
              top_k: webTopK,
            },
            perplexity_config: currentData.extra_configs.perplexity_config,
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
    vectorEnabled,
    vectorTopK,
    vectorThreshold,
    webTopK,
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
      getAuthHeaders,
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
      getAuthHeaders,
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
        targetNodeType: 'structured',
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

  // 添加停止函数
  const onStopExecution = useCallback(() => {
    console.log('Stop execution');
    setIsLoading(false);
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

      {/* Configuration Menu - 恢复原来的详细配置界面 */}
      {isMenuOpen && (
        <ul
          ref={menuRef}
          className='absolute top-[64px] text-white w-[448px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
          style={{
            borderColor: UI_COLORS.EDGENODE_BORDER_GREY,
          }}
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

          {/* Settings section */}
          <li className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Settings
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
              </div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className='text-[11px] text-[#6D7177] hover:text-white transition-colors'
              >
                {showSettings ? 'Hide' : 'Show'}
              </button>
            </div>

            {showSettings && (
              <div className='flex flex-col gap-3'>
                {/* Max Rounds */}
                <div className='flex flex-col gap-1'>
                  <label className='text-[11px] text-[#6D7177]'>
                    Max Research Rounds
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

                {/* Vector Search Settings */}
                <div className='flex flex-col gap-2'>
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      checked={vectorEnabled}
                      onChange={e =>
                        handleVectorEnabledChange(e.target.checked)
                      }
                      className='w-4 h-4'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                    <label className='text-[11px] text-[#6D7177]'>
                      Enable Vector Search
                    </label>
                  </div>

                  {vectorEnabled && (
                    <div className='flex flex-col gap-2 ml-6'>
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
                          className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
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
                            setVectorThreshold(
                              parseFloat(e.target.value) || 0.5
                            )
                          }
                          min='0'
                          max='1'
                          step='0.1'
                          className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
                          onFocus={onFocus}
                          onBlur={onBlur}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Web Search Settings */}
                <div className='flex flex-col gap-1'>
                  <label className='text-[11px] text-[#6D7177]'>
                    Web Search Results
                  </label>
                  <input
                    ref={webTopKRef}
                    type='number'
                    value={webTopK}
                    onChange={e => setWebTopK(parseInt(e.target.value) || 5)}
                    min='1'
                    max='20'
                    className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white focus:border-[#6D7177]/50 focus:outline-none'
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              </div>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}

export default DeepResearch;
