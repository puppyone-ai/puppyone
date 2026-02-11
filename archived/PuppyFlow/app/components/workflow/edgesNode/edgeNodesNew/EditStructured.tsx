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
import { PuppyDropdown } from '../../../misc/PuppyDropDown';
import { nanoid } from 'nanoid';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

export type ModifyConfigNodeData = {
  subMenuType: string | null;
  content: string | null;
  looped: boolean | undefined;
  content_type: 'list' | 'dict' | null;
  extra_configs: {
    index: number | undefined;
    key: string | undefined;
    params: {
      path: (string | number)[];
    };
  };
};

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>;

// PathNode type for tree structure
type PathNode = {
  id: string;
  key: string; // "key" or "num"
  value: string;
  children: PathNode[];
};

const EditStructured: React.FC<ModifyConfigNodeProps> = React.memo(
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
    const { getNode, getInternalNode, setNodes, setEdges } = useReactFlow();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const menuRef = useRef<HTMLUListElement>(null);
    const portalAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuContainerRef = useRef<HTMLDivElement | null>(null);

    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const {} = useAppSettings();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 常量定义 - 使用 useMemo 缓存
    const modeConstants = useMemo(
      () => ({
        MODIFY_GET_TYPE: 'get',
        MODIFY_DEL_TYPE: 'delete',
        MODIFY_REPL_TYPE: 'replace',
        MODIFY_GET_ALL_KEYS: 'get_keys',
        MODIFY_GET_ALL_VAL: 'get_values',
      }),
      []
    );

    const {
      MODIFY_GET_TYPE,
      MODIFY_DEL_TYPE,
      MODIFY_REPL_TYPE,
      MODIFY_GET_ALL_KEYS,
      MODIFY_GET_ALL_VAL,
    } = modeConstants;

    // 首先定义 getConfigDataa 函数，避免在使用前访问错误 - 使用 useCallback 缓存
    const getConfigDataa = useCallback(
      (): Array<{ key: string; value: string }> =>
        (getNode(id)?.data.getConfigData as Array<{
          key: string;
          value: string;
        }>) || [
          {
            key: 'key',
            value: '',
          },
        ],
      [getNode, id]
    );

    // 辅助函数 - 设置配置数据 - 使用 useCallback 缓存
    const setGetConfigDataa = useCallback(
      (
        resolveData: (
          data: { key: string; value: string }[]
        ) => { key: string; value: string }[]
      ) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id === id) {
              return {
                ...node,
                data: {
                  ...node.data,
                  getConfigData: resolveData(getConfigDataa()),
                },
              };
            }
            return node;
          })
        );
      },
      [setNodes, id, getConfigDataa]
    );

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [execMode, setExecMode] = useState(
      () => (getNode(id)?.data.type as string) || MODIFY_GET_TYPE
    );

    const [paramv, setParamv] = useState('');

    // Add this new state for tree path structure - 现在可以安全使用 getConfigDataa
    const [pathTree, setPathTree] = useState<PathNode[]>(() => {
      // Try to convert existing flat path to tree structure if available
      const existingData = getConfigDataa();
      if (existingData && existingData.length > 0) {
        // Create a simple tree with the existing path items
        const rootNode: PathNode = {
          id: nanoid(6),
          key: existingData[0]?.key || 'key',
          value: existingData[0]?.value || '',
          children: [],
        };

        let currentNode = rootNode;
        for (let i = 1; i < existingData.length; i++) {
          const item = existingData[i];
          if (item) {
            const newNode: PathNode = {
              id: nanoid(6),
              key: item.key || 'key',
              value: item.value || '',
              children: [],
            };
            currentNode.children.push(newNode);
            currentNode = newNode;
          }
        }

        return [rootNode];
      }

      // Default empty tree with one root node
      return [
        {
          id: nanoid(6),
          key: 'key',
          value: '',
          children: [],
        },
      ];
    });

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
      console.log(getInternalNode(id));

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
        const menuWidth = 416; // matches w-[416px]
        const left = Math.max(
          8,
          Math.min(rect.left, window.innerWidth - menuWidth - 8)
        );
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

    // 状态同步到 ReactFlow - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          setNodes(prevNodes =>
            prevNodes.map(node => {
              if (node.id === id) {
                return { ...node, data: { ...node.data, type: execMode } };
              }
              return node;
            })
          );
        });
      }
    }, [execMode, isOnGeneratingNewNode]);

    // Function to flatten the tree structure into a path array - 使用 useCallback 缓存
    const flattenPathTree = useCallback(
      (nodes: PathNode[]): { key: string; value: string }[] => {
        const result: { key: string; value: string }[] = [];

        const traverse = (node: PathNode) => {
          result.push({ key: node.key, value: node.value });
          if (node.children.length > 0) {
            traverse(node.children[0]); // We only follow the first child in each level
          }
        };

        if (nodes.length > 0) {
          traverse(nodes[0]);
        }

        return result;
      },
      []
    );

    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          const flatPath = flattenPathTree(pathTree);
          setGetConfigDataa(() => flatPath);
        });
      }
    }, [pathTree, flattenPathTree, setGetConfigDataa, isOnGeneratingNewNode]);

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

    // 修改提交函数，增加数据保存逻辑 - 使用 useCallback 缓存
    const onDataSubmit = useCallback(() => {
      const flatPath = flattenPathTree(pathTree);

      // 先保存当前状态到节点数据
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                type: execMode,
                getConfigData: flatPath,
                paramv: paramv,
              },
            };
          }
          return node;
        })
      );

      // 然后调用通用处理函数
      handleDataSubmit();
    }, [
      flattenPathTree,
      pathTree,
      setNodes,
      id,
      execMode,
      paramv,
      handleDataSubmit,
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
          {/* Edit Structured SVG icon */}
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            viewBox='0 0 14 14'
            fill='none'
          >
            <path
              d='M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z'
              stroke='currentColor'
              strokeWidth='1.5'
            />
            <path
              d='M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5'
              stroke='currentColor'
              strokeWidth='1.5'
            />
          </svg>
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>Edit</span>
            <span>Struct</span>
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

        {/* Invisible fixed-position anchor to tether the portal menu to this node */}
        <div
          ref={portalAnchorRef}
          className='absolute left-0 top-full h-0 w-0'
        />

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
                className='text-white w-[416px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
                style={{ borderColor: UI_COLORS.EDGENODE_BORDER_GREY }}
                onWheelCapture={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
                onTouchMoveCapture={e => e.stopPropagation()}
                onTouchMove={e => e.stopPropagation()}
              >
                <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                  <div className='flex flex-row gap-[12px]'>
                    <div className='flex flex-row gap-[8px] justify-center items-center'>
                      <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg
                          xmlns='http://www.w3.org/2000/svg'
                          width='14'
                          height='14'
                          viewBox='0 0 14 14'
                          fill='none'
                        >
                          <path
                            d='M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z'
                            stroke='#CDCDCD'
                            strokeWidth='1.5'
                          />
                          <path
                            d='M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5'
                            stroke='#CDCDCD'
                            strokeWidth='1.5'
                          />
                        </svg>
                      </div>
                      <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                        Edit Structured
                      </div>
                    </div>
                  </div>
                  <div className='flex flex-row gap-[8px] items-center justify-center'>
                    <button
                      className='w-[57px] h-[26px] rounded-[8px] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                      style={{
                        backgroundColor: isLoading ? '#FFA73D' : '#39BC66',
                      }}
                      onClick={isLoading ? onStopExecution : onDataSubmit}
                      disabled={false}
                    >
                      <span>
                        {isLoading ? (
                          <svg
                            width='8'
                            height='8'
                            viewBox='0 0 8 8'
                            fill='none'
                          >
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
                    supportedInputTypes={['structured']}
                    supportedOutputTypes={['structured']}
                  />
                </li>

                {/* Mode Selection */}
                <li className='flex flex-col gap-[8px]'>
                  <label className='text-[12px] font-semibold text-[#6D7177]'>
                    Mode
                  </label>
                  <div className='flex flex-row gap-[8px]'>
                    <PuppyDropdown
                      options={[
                        MODIFY_GET_TYPE,
                        MODIFY_DEL_TYPE,
                        MODIFY_REPL_TYPE,
                        MODIFY_GET_ALL_KEYS,
                        MODIFY_GET_ALL_VAL,
                      ]}
                      onSelect={(option: string) => {
                        setExecMode(option);
                      }}
                      selectedValue={execMode}
                      optionBadge={false}
                      listWidth='200px'
                      buttonHeight='32px'
                      buttonBgColor='#252525'
                      containerClassnames='w-full'
                      showDropdownIcon={true}
                    />
                  </div>
                </li>

                {/* Path Configuration */}
                {(execMode === MODIFY_GET_TYPE ||
                  execMode === MODIFY_DEL_TYPE ||
                  execMode === MODIFY_REPL_TYPE) && (
                  <li className='flex flex-col gap-[8px]'>
                    <label className='text-[12px] font-semibold text-[#6D7177]'>
                      Path
                    </label>
                    <div className='flex flex-col gap-[4px] p-[8px] bg-[#252525] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                      {pathTree.map((node, index) => (
                        <PathTreeComponent
                          key={node.id}
                          node={node}
                          onUpdate={updatedNode => {
                            setPathTree([updatedNode]);
                          }}
                          onFocus={onFocus}
                          onBlur={onBlur}
                        />
                      ))}
                    </div>
                  </li>
                )}

                {/* Replace Value Input */}
                {execMode === MODIFY_REPL_TYPE && (
                  <li className='flex flex-col gap-[8px]'>
                    <label className='text-[12px] font-semibold text-[#6D7177]'>
                      Replace Value
                    </label>
                    <input
                      type='text'
                      value={paramv}
                      onChange={e => setParamv(e.target.value)}
                      className='w-full h-[32px] px-[12px] bg-[#252525] border-[1px] border-[#6D7177]/30 rounded-[8px] text-[#CDCDCD] text-[12px] placeholder-[#6D7177] outline-none focus:border-[#6D7177]/50'
                      placeholder='Enter replacement value...'
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </li>
                )}
              </ul>
            </div>,
            document.body
          )}
      </div>
    );
  }
);

// PathTreeComponent 组件 - 使用 React.memo 优化
const PathTreeComponent: React.FC<{
  node: PathNode;
  onUpdate: (node: PathNode) => void;
  onFocus: () => void;
  onBlur: () => void;
}> = React.memo(({ node, onUpdate, onFocus, onBlur }) => {
  const updateNode = useCallback(
    (updates: Partial<PathNode>) => {
      onUpdate({ ...node, ...updates });
    },
    [node, onUpdate]
  );

  const updateChild = useCallback(
    (childIndex: number, updatedChild: PathNode) => {
      const newChildren = [...node.children];
      newChildren[childIndex] = updatedChild;
      updateNode({ children: newChildren });
    },
    [node.children, updateNode]
  );

  const addChild = useCallback(() => {
    const newChild: PathNode = {
      id: nanoid(6),
      key: 'key',
      value: '',
      children: [],
    };
    updateNode({ children: [...node.children, newChild] });
  }, [node.children, updateNode]);

  const removeChild = useCallback(
    (childIndex: number) => {
      const newChildren = node.children.filter((_, i) => i !== childIndex);
      updateNode({ children: newChildren });
    },
    [node.children, updateNode]
  );

  return (
    <div className='flex flex-col gap-[4px]'>
      <div className='flex gap-[8px] items-center'>
        <PuppyDropdown
          options={['key', 'num']}
          onSelect={(option: string) => updateNode({ key: option })}
          selectedValue={node.key}
          optionBadge={false}
          listWidth='80px'
          buttonHeight='28px'
          buttonBgColor='#1A1A1A'
          containerClassnames='w-[80px]'
          showDropdownIcon={true}
        />
        <input
          type='text'
          value={node.value}
          onChange={e => updateNode({ value: e.target.value })}
          className='flex-1 h-[28px] px-[8px] bg-[#1A1A1A] border-[1px] border-[#6D7177]/30 rounded-[6px] text-[#CDCDCD] text-[11px] placeholder-[#6D7177] outline-none focus:border-[#6D7177]/50'
          placeholder={node.key === 'key' ? 'Enter key...' : 'Enter index...'}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <button
          onClick={addChild}
          className='w-[28px] h-[28px] flex items-center justify-center text-[#6D7177] hover:text-[#CDCDCD] border border-[#6D7177]/30 hover:border-[#6D7177]/50 rounded-[6px] bg-[#1A1A1A] hover:bg-[#252525] transition-colors'
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
          >
            <path d='M12 5v14M5 12h14' strokeWidth='2' strokeLinecap='round' />
          </svg>
        </button>
        {node.children.length > 0 && (
          <button
            onClick={() => removeChild(node.children.length - 1)}
            className='w-[28px] h-[28px] flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] border border-[#6D7177]/30 hover:border-[#ff4d4d]/50 rounded-[6px] bg-[#1A1A1A] hover:bg-[#252525] transition-colors'
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
            >
              <path
                d='M18 6L6 18M6 6l12 12'
                strokeWidth='2'
                strokeLinecap='round'
              />
            </svg>
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <div className='ml-[16px] border-l-[1px] border-[#6D7177]/30 pl-[8px]'>
          {node.children.map((child, index) => (
            <PathTreeComponent
              key={child.id}
              node={child}
              onUpdate={updatedChild => updateChild(index, updatedChild)}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          ))}
        </div>
      )}
    </div>
  );
});

PathTreeComponent.displayName = 'PathTreeComponent';
EditStructured.displayName = 'EditStructured';

export default EditStructured;
