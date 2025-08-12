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
import { nanoid } from 'nanoid';
import PromptEditor, { PromptMessage } from '../../components/promptEditor';
import {
  useAppSettings,
  Model,
} from '@/app/components/states/AppSettingsContext';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

export type LLMConfigNodeData = {
  looped: boolean | undefined;
  content: string | null;
  modelAndProvider:
    | {
        id: string;
        name: string;
        provider: string;
        isLocal: boolean;
      }
    | undefined;
  structured_output: boolean | undefined;
  base_url: string | undefined;
  max_tokens: number | undefined;
};

type LLMConfigNodeProps = NodeProps<Node<LLMConfigNodeData>>;

// Add types for the prompt structure
export type PromptNode = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface LLMEdgeJsonType {
  type: 'llm';
  data: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    chat_histories: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[];
    model: string;
    base_url: string;
    max_tokens: number;
    temperature: number;
    inputs: { [key: string]: string };
    structured_output: boolean;
    outputs: { [key: string]: string };
  };
}

export type ConstructedLLMJsonData = {
  blocks: { [key: string]: any };
  edges: { [key: string]: LLMEdgeJsonType };
};

const LLM: React.FC<LLMConfigNodeProps> = React.memo(
  ({ isConnectable, id }) => {
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

    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const { getAuthHeaders } = useAppSettings();

    // 使用 AppSettingsContext
    const { availableModels, isLocalDeployment } = useAppSettings();

    // 获取可用的激活模型列表 - 只显示 LLM 类型的模型 - 使用 useMemo 缓存
    const activeModels = useMemo(() => {
      return availableModels.filter(m => m.active && m.type == 'llm');
    }, [availableModels]);

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 更新状态管理 - 使用完整的模型对象而不是字符串 - 优化初始化
    const [selectedModelAndProvider, setSelectedModelAndProvider] =
      useState<Model | null>(() => {
        // 首先尝试获取节点已有的模型值
        const nodeData = getNode(id)?.data as LLMConfigNodeData;
        const nodeModelAndProvider = nodeData?.modelAndProvider;
        if (nodeModelAndProvider) {
          // 如果节点有保存的模型信息，尝试在可用模型中找到匹配的
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

        // 如果节点没有模型值，则使用第一个可用的激活 LLM 模型
        return activeModels.length > 0 ? activeModels[0] : null;
      });

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

    // 自定义渲染模型选项的函数 - 使用 useCallback 缓存
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

    // 自定义显示选择的模型的函数 - 使用 useCallback 缓存
    const mapModelToDisplay = useCallback((model: Model | null) => {
      if (!model) return 'Select a model';
      return `${model.name} (${model.provider})`;
    }, []);

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [baseUrl, setBaseUrl] = useState<string>(
      () => (getNode(id)?.data as LLMConfigNodeData)?.base_url ?? ''
    );
    const [isStructured_output, setStructured_output] = useState<boolean>(
      () => (getNode(id)?.data as LLMConfigNodeData)?.structured_output ?? false
    );
    const [showSettings, setShowSettings] = useState(false);
    const [maxTokens, setMaxTokens] = useState<number>(
      () => (getNode(id)?.data?.max_tokens as number) || 4096
    );

    // 在 LLMConfigMenu 组件中，增强 sourceNodeLabels 状态以包含类型信息
    const [sourceNodeLabels, setSourceNodeLabels] = useState<
      { label: string; type: string }[]
    >([]);

    // 使用useRef来存储最新的消息内容，避免不必要的渲染
    const messagesRef = useRef<PromptMessage[]>([]);

    // 初始化 parsedMessages，直接用节点数据 - 优化初始化
    const [parsedMessages, setParsedMessages] = useState<PromptMessage[]>(
      () => {
        // 获取当前节点的输入节点
        const sourceNodes = getSourceNodeIdWithLabel(id);
        const firstInputNode = sourceNodes[0];

        // 构建默认消息
        const defaultMessages = [
          { role: 'system', content: 'You are an AI' },
          {
            role: 'user',
            content: firstInputNode
              ? `Answer the question: {{${firstInputNode.label}}}`
              : 'Answer the question',
          },
        ];

        // 如果节点已有数据，使用节点数据，否则使用默认消息
        return (
          (getNode(id)?.data?.content as PromptMessage[]) || defaultMessages
        );
      }
    );

    // 创建执行上下文 - 使用 useCallback 缓存
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

    // 使用执行函数的 handleDataSubmit - 使用 useCallback 缓存
    const handleDataSubmit = useCallback(async () => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const context = createExecutionContext();
        // 根据 structured_output 设置动态设置 targetNodeType
        const targetNodeType = isStructured_output ? 'structured' : 'text';
        await runSingleEdgeNode({
          parentId: id,
          targetNodeType,
          context,
          // 可以选择不提供 constructJsonData，使用默认实现
        });
      } catch (error) {
        console.error('执行失败:', error);
      } finally {
        setIsLoading(false);
      }
    }, [id, isLoading, createExecutionContext, isStructured_output]);

    // 处理 PromptEditor 的变更 - 使用 useCallback 缓存
    const handleMessagesChange = useCallback(
      (updatedMessages: PromptMessage[]) => {
        // 只有在非生成新节点状态时才处理变更
        if (isOnGeneratingNewNode) return;

        messagesRef.current = updatedMessages;
        setParsedMessages(updatedMessages);
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return {
                ...node,
                data: { ...node.data, content: updatedMessages },
              };
            }
            return node;
          })
        );
      },
      [id, setNodes, isOnGeneratingNewNode]
    );

    // 监听来源节点变化，自动更新提示内容
    const lastNodeWithLabel = useRef<string | undefined>(undefined);

    // 准备变量列表用于高亮显示 - 使用 useMemo 缓存
    const variables = useMemo(() => {
      return sourceNodeLabels.map(label => ({
        name: label.label,
        type: label.type,
      }));
    }, [sourceNodeLabels]);

    // 修改数据提交处理 - 使用 useCallback 缓存
    const onDataSubmit = useCallback(() => {
      // 使用当前消息引用，过滤掉助手消息
      const filteredMessages = messagesRef.current.filter(
        msg => msg.role !== 'assistant'
      );

      // 调用执行逻辑
      handleDataSubmit();
    }, [handleDataSubmit]);

    // 状态同步逻辑 - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      // 只有在非生成新节点状态时才进行状态同步
      if (
        !isOnGeneratingNewNode &&
        selectedModelAndProvider &&
        hasMountedRef.current
      ) {
        // 使用 requestAnimationFrame 确保状态同步在节点创建完成后执行
        requestAnimationFrame(() => {
          onModelAndProviderChange(selectedModelAndProvider);
        });
      }
    }, [selectedModelAndProvider, isOnGeneratingNewNode]);

    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          onBaseUrlChange(baseUrl);
        });
      }
    }, [baseUrl, isOnGeneratingNewNode]);

    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          onStructuredOutputChange(isStructured_output);
        });
      }
    }, [isStructured_output, isOnGeneratingNewNode]);

    // 添加 useEffect 来监听 maxTokens 的变化
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          onMaxTokensChange(maxTokens);
        });
      }
    }, [maxTokens, isOnGeneratingNewNode]);

    // 初始化sourceNodeLabels - 使用延迟初始化提高性能
    useEffect(() => {
      // 跳过初始挂载以提高性能
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        // 延迟初始化
        requestAnimationFrame(() => {
          // 只有在非生成新节点状态时才进行初始化
          if (!isOnGeneratingNewNode) {
            const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(
              id,
              'blocknode'
            );
            // 收集标签和类型
            const labelsWithTypes = sourceNodeIdWithLabelGroup.map(node => {
              const nodeInfo = getNode(node.id);
              const nodeType = nodeInfo?.type || 'text'; // 默认为 text
              return {
                label: node.label,
                type: nodeType,
              };
            });
            setSourceNodeLabels(labelsWithTypes);
          }
        });
      }
    }, []); // 移除依赖以避免重复执行

    // 更新sourceNodeLabels - 使用 useCallback 缓存
    const updateSourceNodeLabels = useCallback(() => {
      // 只有在非生成新节点状态时才更新
      if (isOnGeneratingNewNode) return;

      const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(
        id,
        'blocknode'
      );
      // 收集标签和类型
      const labelsWithTypes = sourceNodeIdWithLabelGroup.map(node => {
        const nodeInfo = getNode(node.id);
        const nodeType = nodeInfo?.type || 'text';
        return {
          label: node.label,
          type: nodeType,
        };
      });

      // 检查是否有实际变化
      const currentLabels = JSON.stringify(labelsWithTypes);
      const prevLabels = JSON.stringify(sourceNodeLabels);
      if (currentLabels !== prevLabels) {
        setSourceNodeLabels(labelsWithTypes);
      }
    }, [
      id,
      getSourceNodeIdWithLabel,
      getNode,
      sourceNodeLabels,
      isOnGeneratingNewNode,
    ]);

    // 组件初始化 - 优化初始化逻辑
    useEffect(() => {
      // 只有在非生成新节点状态时才进行初始化
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        clearAll();
        activateEdge(id);

        // 延迟初始化内容，避免在节点创建过程中干扰状态
        requestAnimationFrame(() => {
          // 检查并初始化内容
          const nodeData = getNode(id)?.data;
          const currentContent = nodeData?.content;

          // 调试输出，查看初始状态
          console.log(
            'Initial node content:',
            currentContent,
            typeof currentContent
          );

          // 如果内容不存在或格式不正确，则初始化
          if (
            !currentContent ||
            typeof currentContent === 'string' ||
            !Array.isArray(currentContent)
          ) {
            console.log('Setting initial content:', parsedMessages);
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.id === id) {
                  return {
                    ...node,
                    data: { ...node.data, content: parsedMessages },
                  };
                }
                return node;
              })
            );
          }
        });
      }

      return () => {
        if (activatedEdge === id) {
          clearEdgeActivation();
        }
      };
    }, [isOnGeneratingNewNode]); // 添加 isOnGeneratingNewNode 作为依赖

    // UI 交互函数 - 使用 useCallback 缓存
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

    // 更新数据同步函数 - 使用 useCallback 缓存
    const onModelAndProviderChange = useCallback(
      (newModelAndProvider: Model) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return {
                ...node,
                data: {
                  ...node.data,
                  modelAndProvider: {
                    id: newModelAndProvider.id,
                    name: newModelAndProvider.name,
                    provider: newModelAndProvider.provider || 'Unknown',
                    isLocal: newModelAndProvider.isLocal || false,
                  },
                },
              };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onBaseUrlChange = useCallback(
      (newBaseUrl: string) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return { ...node, data: { ...node.data, base_url: newBaseUrl } };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    const onStructuredOutputChange = useCallback(
      (newStructuredOutput: boolean) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return {
                ...node,
                data: { ...node.data, structured_output: newStructuredOutput },
              };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    // 添加 onMaxTokensChange 函数 - 使用 useCallback 缓存
    const onMaxTokensChange = useCallback(
      (newMaxTokens: number) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return {
                ...node,
                data: { ...node.data, max_tokens: newMaxTokens },
              };
            }
            return node;
          })
        );
      },
      [id, setNodes]
    );

    // 在组件顶部定义共享样式 - 使用 useMemo 缓存
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

    const [isHovered, setIsHovered] = useState(false);
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);

    // 添加停止函数 - 使用 useCallback 缓存
    const onStopExecution = useCallback(() => {
      console.log('Stop execution');
      setIsLoading(false);
      // 暂时可以留空，或者调用相应的停止API
    }, []);

    // 缓存按钮样式 - 使用 useMemo 缓存
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
          {/* LLM SVG icon */}
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='12'
            height='12'
            viewBox='0 0 14 14'
            fill='none'
          >
            <g clipPath='url(#clip0_3289_923)'>
              <mask
                id='mask0_3289_923'
                style={{ maskType: 'luminance' }}
                maskUnits='userSpaceOnUse'
                x='0'
                y='0'
                width='14'
                height='14'
              >
                <path d='M14 0H0V14H14V0Z' fill='white' />
              </mask>
              <g mask='url(#mask0_3289_923)'>
                <path
                  d='M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164ZM4.84408 7.50494L3.66546 6.82463C3.65277 6.8185 3.64446 6.80625 3.64271 6.79225V3.53769C3.64358 2.08869 4.81915 0.914439 6.26815 0.915314C6.88108 0.915314 7.47433 1.13056 7.94552 1.52256C7.92408 1.53394 7.88733 1.5545 7.86283 1.56938L5.07508 3.17938C4.93246 3.26031 4.84496 3.41169 4.84583 3.57575L4.84408 7.50406V7.50494ZM5.48415 6.12506L7.00008 5.24963L8.51602 6.12463V7.87506L7.00008 8.75006L5.48415 7.87506V6.12506Z'
                  fill='currentColor'
                />
              </g>
            </g>
            <defs>
              <clipPath id='clip0_3289_923'>
                <rect width='14' height='14' fill='white' />
              </clipPath>
            </defs>
          </svg>
          LLM
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
                      xmlns='http://www.w3.org/2000/svg'
                      width='12'
                      height='12'
                      viewBox='0 0 14 14'
                      fill='none'
                    >
                      <g clipPath='url(#clip0_3289_923)'>
                        <mask
                          id='mask0_3289_923'
                          style={{ maskType: 'luminance' }}
                          maskUnits='userSpaceOnUse'
                          x='0'
                          y='0'
                          width='14'
                          height='14'
                        >
                          <path d='M14 0H0V14H14V0Z' fill='white' />
                        </mask>
                        <g mask='url(#mask0_3289_923)'>
                          <path
                            d='M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164ZM4.84408 7.50494L3.66546 6.82463C3.65277 6.8185 3.64446 6.80625 3.64271 6.79225V3.53769C3.64358 2.08869 4.81915 0.914439 6.26815 0.915314C6.88108 0.915314 7.47433 1.13056 7.94552 1.52256C7.92408 1.53394 7.88733 1.5545 7.86283 1.56938L5.07508 3.17938C4.93246 3.26031 4.84496 3.41169 4.84583 3.57575L4.84408 7.50406V7.50494ZM5.48415 6.12506L7.00008 5.24963L8.51602 6.12463V7.87506L7.00008 8.75006L5.48415 7.87506V6.12506Z'
                            fill='#CDCDCD'
                          />
                        </g>
                      </g>
                      <defs>
                        <clipPath id='clip0_3289_923'>
                          <rect width='14' height='14' fill='white' />
                        </clipPath>
                      </defs>
                    </svg>
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    LLM
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
                supportedOutputTypes={['text', 'structured']}
                inputNodeCategory='blocknode'
                outputNodeCategory='blocknode'
                onUpdate={updateSourceNodeLabels}
              />
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Messages
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <PromptEditor
                messages={parsedMessages}
                variables={variables}
                onChange={handleMessagesChange}
                onFocus={onFocus}
                onBlur={onBlur}
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

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Output type
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <PuppyDropdown
                  options={['text', 'structured text']}
                  selectedValue={
                    isStructured_output ? 'structured text' : 'text'
                  }
                  onSelect={(value: string) => {
                    setStructured_output(value === 'structured text');
                    onBlur && onBlur();
                  }}
                  buttonHeight='32px'
                  buttonBgColor='transparent'
                  menuBgColor='#1A1A1A'
                  listWidth='100%'
                  containerClassnames='w-full'
                  onFocus={onFocus}
                />
              </div>
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
                  {/* Base URL */}
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Base URL (optional)
                    </label>
                    <input
                      type='text'
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder='https://api.example.com/v1'
                      className='h-[28px] px-2 bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[4px] text-[12px] text-white placeholder-[#6D7177] focus:border-[#6D7177]/50 focus:outline-none'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>

                  {/* Max Tokens */}
                  <div className='flex flex-col gap-1'>
                    <label className='text-[11px] text-[#6D7177]'>
                      Max Tokens
                    </label>
                    <input
                      type='number'
                      value={maxTokens}
                      onChange={e =>
                        setMaxTokens(parseInt(e.target.value) || 4096)
                      }
                      min='1'
                      max='32000'
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
);
LLM.displayName = 'LLM';
export default LLM;
