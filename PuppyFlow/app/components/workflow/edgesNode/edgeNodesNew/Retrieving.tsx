import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from 'react';
import InputOutputDisplay from './components/InputOutputDisplay';
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

// 首先定义一个索引项接口 - 移到组件外部
interface IndexingItem {
  type: string;
  status: string;
  index_name: string;
  collection_configs?: {
    collection_name: string;
    // 其他配置...
  };
  // 其他属性...
}

// 添加一个简化版的索引项接口
interface SimplifiedIndexItem {
  index_name: string;
  collection_configs?: {
    collection_name: string;
    // 其他配置...
  };
}

export type RetrievingConfigNodeData = {
  dataSource?: {
    id: string;
    label: string;
    index_item?: SimplifiedIndexItem;
  }[];
  subMenuType: string | null;
  top_k: number | undefined;
  content: string | null;
  query_id: { id: string; label: string } | undefined;
  structuredWithVectorIndexing: string[];
  extra_configs: {
    model:
      | 'llama-3.1-sonar-small-128k-online'
      | 'llama-3.1-sonar-large-128k-online'
      | 'llama-3.1-sonar-huge-128k-online'
      | undefined;
    threshold: number | undefined;
  };
};

type RetrievingConfigNodeProps = NodeProps<Node<RetrievingConfigNodeData>>;

const Retrieving: React.FC<RetrievingConfigNodeProps> = memo(
  ({ isConnectable, id }: RetrievingConfigNodeProps) => {
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
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const { } = useAppSettings();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [query, setQuery] = useState<{ id: string; label: string }>(
      () =>
        (getNode(id)?.data as RetrievingConfigNodeData)?.query_id ?? {
          id: '',
          label: '',
        }
    );

    const [top_k, setTop_k] = useState<number | undefined>(
      () => (getNode(id)?.data as RetrievingConfigNodeData)?.top_k ?? 5
    );

    const [threshold, setThreshold] = useState<number | undefined>(
      () =>
        (getNode(id)?.data as RetrievingConfigNodeData)?.extra_configs
          ?.threshold ?? 0.7
    );

    const [showSettings, setShowSettings] = useState(false);

    const [dataSource, setDataSource] = useState<
      { label: string; id: string; index_item?: SimplifiedIndexItem }[]
    >(() => (getNode(id)?.data as RetrievingConfigNodeData)?.dataSource ?? []);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Refs
    const queryRef = useRef<HTMLSelectElement>(null);
    const thresholdRef = useRef<HTMLInputElement>(null);
    const topkRef = useRef<HTMLInputElement>(null);

    // 接着定义一个新的 ref 用于存储扁平化的索引项列表 - 使用 useMemo 缓存
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
    }, [getSourceNodeIdWithLabel(id), getNode]);

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

    // 使用执行函数的 handleDataSubmit - 使用 useCallback 缓存
    const handleDataSubmit = useCallback(async () => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const context = createExecutionContext();
        await runSingleEdgeNode({
          parentId: id,
          targetNodeType: 'structured',
          context,
          // 可以选择不提供 constructJsonData，使用默认实现
        });
      } catch (error) {
        console.error('执行失败:', error);
      } finally {
        setIsLoading(false);
      }
    }, [id, isLoading, createExecutionContext]);

    // 辅助函数 - 使用 useCallback 缓存
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

    // 数据同步函数 - 使用 useCallback 缓存
    const onQueryChange = useCallback(
      (newQuery: { id: string; label: string }) => {
        if (!isOnGeneratingNewNode && hasMountedRef.current) {
          requestAnimationFrame(() => {
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.id === id) {
                  return {
                    ...node,
                    data: { ...node.data, query_id: newQuery },
                  };
                }
                return node;
              })
            );
          });
        }
      },
      [id, setNodes, isOnGeneratingNewNode]
    );

    const onTopKChange = useCallback(
      (newTopK: number | undefined) => {
        if (!isOnGeneratingNewNode && hasMountedRef.current) {
          requestAnimationFrame(() => {
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.id === id) {
                  return { ...node, data: { ...node.data, top_k: newTopK } };
                }
                return node;
              })
            );
          });
        }
      },
      [id, setNodes, isOnGeneratingNewNode]
    );

    const onThresholdChange = useCallback(
      (newThreshold: number | undefined) => {
        if (!isOnGeneratingNewNode && hasMountedRef.current) {
          requestAnimationFrame(() => {
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.id === id) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      extra_configs: {
                        ...(node.data as RetrievingConfigNodeData)
                          .extra_configs,
                        threshold: newThreshold,
                      },
                    },
                  };
                }
                return node;
              })
            );
          });
        }
      },
      [id, setNodes, isOnGeneratingNewNode]
    );

    // Node标签管理 - 使用 useCallback 缓存
    const updateDataSourceInParent = useCallback(
      (
        dataSource: {
          label: string;
          id: string;
          index_item?: SimplifiedIndexItem;
        }[]
      ) => {
        if (!isOnGeneratingNewNode && hasMountedRef.current) {
          requestAnimationFrame(() => {
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.id === id) {
                  return {
                    ...node,
                    data: { ...node.data, dataSource: dataSource },
                  };
                }
                return node;
              })
            );
          });
        }
      },
      [id, setNodes, isOnGeneratingNewNode]
    );

    // 修改 addNodeLabel 函数 - 使用 useCallback 缓存
    const addNodeLabel = useCallback(
      (option: {
        nodeId: string;
        nodeLabel: string;
        indexItem: IndexingItem;
      }) => {
        // 使用连入的 JSON Block 的 nodeId 作为 id
        const nodeId = option.nodeId;

        // 检查是否已经添加了相同 nodeId 的数据源
        if (!dataSource.some(item => item.id === nodeId)) {
          const simplifiedIndexItem: SimplifiedIndexItem = {
            index_name: option.indexItem.index_name,
            collection_configs: option.indexItem.collection_configs,
          };

          const newItem = {
            id: nodeId, // 使用原始的 nodeId
            label: option.nodeLabel,
            index_item: simplifiedIndexItem, // 改为index_item
          };

          const newDataSource = [...dataSource, newItem];
          setDataSource(newDataSource);
          updateDataSourceInParent(newDataSource);
        }
      },
      [dataSource, updateDataSourceInParent]
    );

    const removeNodeLabel = useCallback(
      (index: number) => {
        const newDataSource = [...dataSource];
        newDataSource.splice(index, 1);
        setDataSource(newDataSource);
        updateDataSourceInParent(newDataSource);
      },
      [dataSource, updateDataSourceInParent]
    );

    // UI助手函数 - 使用 useCallback 和 useMemo 缓存
    const queryOptions = useMemo(() => {
      return getSourceNodeIdWithLabel(id)
        .filter(node => {
          const nodeInfo = getNode(node.id);
          return nodeInfo?.type === 'text';
        })
        .map(q => ({
          id: q.id,
          label: q.label,
        }));
    }, [getSourceNodeIdWithLabel(id), getNode]);

    // 状态同步逻辑 - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        onQueryChange(query);
      }
    }, [query, onQueryChange, isOnGeneratingNewNode]);

    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        onTopKChange(top_k);
      }
    }, [top_k, onTopKChange, isOnGeneratingNewNode]);

    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        onThresholdChange(threshold);
      }
    }, [threshold, onThresholdChange, isOnGeneratingNewNode]);

    // 组件初始化
    useEffect(() => {
      hasMountedRef.current = true;
    }, []);

    useEffect(() => {
      if (hasMountedRef.current && !isOnGeneratingNewNode) {
        clearAll();
        activateEdge(id);
      }

      return () => {
        if (activatedEdge === id) {
          clearEdgeActivation();
        }
      };
    }, [isOnGeneratingNewNode]);

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

    // 修改 onDataSubmit 函数 - 使用 useCallback 缓存
    const onDataSubmit = useCallback(() => {
      handleDataSubmit();
    }, [handleDataSubmit]);

    // 添加停止函数 - 使用 useCallback 缓存
    const onStopExecution = useCallback(() => {
      console.log('Stop execution');
      setIsLoading(false);
    }, []);

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
      <div className='p-[3px] w-[80px] h-[48px] relative'>
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

        <button
          onClick={onClickButton}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
          style={mainButtonStyle}
        >
          {/* Retrieve SVG icon */}
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            fill='none'
            viewBox='0 0 14 14'
          >
            <path
              fill='currentColor'
              d='m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z'
            />
            <path stroke='currentColor' strokeWidth='1.5' d='M7 9V2' />
            <path fill='currentColor' d='M7 0 4.69 4h4.62L7 0Z' />
            <path stroke='currentColor' strokeWidth='1.5' d='m7 9-5 3.5' />
            <path
              fill='currentColor'
              d='m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z'
            />
            <path stroke='currentColor' strokeWidth='1.5' d='m7 9 5 3.5' />
          </svg>
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>Retrieve</span>
          </div>

          {/* ... existing handles remain the same ... */}
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

        {/* Configuration Menu (integrated directly) */}
        {isMenuOpen && (
          <ul
            ref={menuRef}
            className='absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
            style={{
              borderColor: UI_COLORS.EDGENODE_BORDER_GREY,
            }}
          >
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
              <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                  <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      width='14'
                      height='14'
                      fill='none'
                      viewBox='0 0 14 14'
                    >
                      <path
                        fill='#CDCDCD'
                        d='m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z'
                      />
                      <path stroke='#CDCDCD' strokeWidth='1.5' d='M7 9V2' />
                      <path fill='#CDCDCD' d='M7 0 4.69 4h4.62L7 0Z' />
                      <path stroke='#CDCDCD' strokeWidth='1.5' d='m7 9-5 3.5' />
                      <path
                        fill='#CDCDCD'
                        d='m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z'
                      />
                      <path stroke='#CDCDCD' strokeWidth='1.5' d='m7 9 5 3.5' />
                    </svg>
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    Retrieve by Vector
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

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Query
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <PuppyDropdown
                  options={queryOptions}
                  selectedValue={
                    query.id ? { id: query.id, label: query.label } : null
                  }
                  onSelect={(value: { id: string; label: string }) => {
                    setQuery({ id: value.id, label: value.label });
                  }}
                  buttonHeight='32px'
                  buttonBgColor='transparent'
                  menuBgColor='#1A1A1A'
                  listWidth='100%'
                  containerClassnames='w-full'
                  mapValueTodisplay={(value: any) =>
                    value && value.label ? (
                      <span className='text-[#3B9BFF] text-[12px] font-medium'>{`{{${value.label}}}`}</span>
                    ) : (
                      <span className='text-[#6D7177] text-[12px]'>
                        Select a query
                      </span>
                    )
                  }
                  renderOption={(option: { id: string; label: string }) => (
                    <div className='text-[#3B9BFF] text-[12px] font-medium'>{`{{${option.label}}}`}</div>
                  )}
                />
              </div>
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Indexed Structured Data
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>

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
                          {flattenedIndexItems.map((item, index) => (
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
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Top K
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <input
                ref={topkRef}
                value={top_k || ''}
                onChange={e => setTop_k(Number(e.target.value) || undefined)}
                type='number'
                min='1'
                max='100'
                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                        text-[#CDCDCD] text-[12px] font-medium appearance-none 
                                        hover:border-[#6D7177]/50 transition-colors'
                autoComplete='off'
                onMouseDownCapture={onFocus}
                onBlur={onBlur}
              />
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Threshold
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <input
                ref={thresholdRef}
                value={threshold || ''}
                onChange={e =>
                  setThreshold(Number(e.target.value) || undefined)
                }
                type='number'
                min='0'
                max='1'
                step='0.1'
                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                        text-[#CDCDCD] text-[12px] font-medium appearance-none 
                                        hover:border-[#6D7177]/50 transition-colors'
                autoComplete='off'
                onMouseDownCapture={onFocus}
                onBlur={onBlur}
              />
            </li>

            {/* Settings toggle */}
            <li className='flex items-center justify-between'>
              <label className='text-[13px] font-semibold text-[#6D7177]'>
                Advanced Settings
              </label>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`w-[40px] h-[20px] rounded-full border transition-colors ${
                  showSettings
                    ? 'bg-[#39BC66] border-[#39BC66]'
                    : 'bg-[#252525] border-[#6D7177]/30'
                }`}
              >
                <div
                  className={`w-[16px] h-[16px] bg-white rounded-full transition-transform ${
                    showSettings ? 'translate-x-[22px]' : 'translate-x-[2px]'
                  }`}
                />
              </button>
            </li>

            {showSettings && (
              <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <label className='text-[13px] font-semibold text-[#6D7177]'>
                    Model
                  </label>
                </div>
                <div className='flex gap-2 bg-[#252525] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                  <PuppyDropdown
                    options={[
                      'llama-3.1-sonar-small-128k-online',
                      'llama-3.1-sonar-large-128k-online',
                      'llama-3.1-sonar-huge-128k-online',
                    ]}
                    onSelect={(option: string) => {
                      // Handle model selection if needed
                      console.log('Selected model:', option);
                    }}
                    selectedValue={'llama-3.1-sonar-small-128k-online'}
                    listWidth={'200px'}
                  />
                </div>
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
);

Retrieving.displayName = 'Retrieving';
export default Retrieving;
