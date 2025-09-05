import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import InputOutputDisplay from './components/InputOutputDisplay';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

export type SearchConfigNodeData = {
  nodeLabels?: { label: string; id: string }[];
  subMenuType: string | null;
  top_k: number | undefined;
  content: string | null;
  looped: boolean | undefined;
  query_id: { id: string; label: string } | undefined;
  vector_db: { id: string; label: string } | undefined;
  extra_configs: {
    model:
      | 'llama-3.1-sonar-small-128k-online'
      | 'llama-3.1-sonar-large-128k-online'
      | 'llama-3.1-sonar-huge-128k-online'
      | undefined;
    threshold: number | undefined;
  };
};

type SearchConfigNodeProps = NodeProps<Node<SearchConfigNodeData>>;

const SearchGoogle: React.FC<SearchConfigNodeProps> = React.memo(
  ({ data, isConnectable, id }) => {
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
    const {} = useAppSettings();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 状态管理
    const [showSettings, setShowSettings] = useState(false);

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [top_k, setTop_k] = useState<number | undefined>(
      () => (getNode(id)?.data as SearchConfigNodeData)?.top_k ?? 5
    );
    const topkRef = useRef<HTMLInputElement>(null);

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

    // 状态同步到 ReactFlow - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          const node = getNode(id);
          if (node) {
            setNodes(prevNodes =>
              prevNodes.map(n => {
                if (n.id === id) {
                  // 确保 node.data 存在并且是对象类型
                  const nodeData =
                    typeof n.data === 'object' && n.data !== null ? n.data : {};

                  return {
                    ...n,
                    data: {
                      ...nodeData,
                      top_k: top_k,
                    },
                  };
                }
                return n;
              })
            );
          }
        });
      }
    }, [id, setNodes, top_k, isOnGeneratingNewNode]);

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

    // 执行函数 - 使用 useCallback 缓存
    const onDataSubmit = useCallback(() => {
      handleDataSubmit();
    }, [handleDataSubmit]);

    // 添加停止函数 - 使用 useCallback 缓存
    const onStopExecution = useCallback(() => {
      console.log('Stop execution');
      setIsLoading(false);
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
          onClick={isLoading ? onStopExecution : handleDataSubmit}
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
          {/* Google icon */}
          <FontAwesomeIcon icon={faGoogle} className='w-[10px] h-[10px]' />
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>Google</span>
          </div>

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

        {/* Configuration Menu */}
        {isMenuOpen && (
          <ul
            ref={menuRef}
            className={`absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg`}
            style={{
              borderColor: UI_COLORS.EDGENODE_BORDER_GREY,
            }}
          >
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
              <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                  <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <FontAwesomeIcon
                      icon={faGoogle}
                      className='text-main-grey w-[14px] h-[14px]'
                    />
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    Google
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

            <li>
              <InputOutputDisplay
                parentId={id}
                getNode={getNode}
                getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                supportedInputTypes={['text']}
                supportedOutputTypes={['structured']}
                inputNodeCategory='blocknode'
                outputNodeCategory='blocknode'
              />
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Settings
                </label>
                <div className='w-2 h-2 rounded-full bg-[#6D7177]'></div>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className='ml-auto text-[12px] font-medium text-[#6D7177] hover:text-[#CDCDCD] transition-colors flex items-center gap-1'
                >
                  {showSettings ? 'Hide' : 'Show'}
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
                    viewBox='0 0 24 24'
                  >
                    <path
                      fill='none'
                      stroke='currentColor'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M19 9l-7 7-7-7'
                    />
                  </svg>
                </button>
              </div>
              {showSettings && (
                <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                  <div className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                      <label className='text-[12px] font-medium text-[#6D7177]'>
                        Result Number
                      </label>
                    </div>
                    <input
                      ref={topkRef}
                      value={top_k}
                      onChange={() => {
                        if (topkRef.current) {
                          setTop_k(
                            topkRef.current.value === ''
                              ? undefined
                              : Number(topkRef.current.value)
                          );
                        }
                      }}
                      type='number'
                      className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                      autoComplete='off'
                      required
                      onMouseDownCapture={onFocus}
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

SearchGoogle.displayName = 'SearchGoogle';
export default SearchGoogle;
