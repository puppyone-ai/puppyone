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
import { PuppyDropdown } from '../../../misc/PuppyDropDown';
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
    retMode?: string;
    configNum?: number;
  };
};

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>;

const EditText: React.FC<ModifyConfigNodeProps> = React.memo(
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

    // 常量定义 - 使用 useMemo 缓存
    const modeConstants = useMemo(
      () => ({
        RET_ALL: 'return all',
        RET_FN: 'return first n',
        RET_LN: 'return last n',
        EX_FN: 'exclude first n',
        EX_LN: 'exclude last n',
      }),
      []
    );

    const { RET_ALL, RET_FN, RET_LN, EX_FN, EX_LN } = modeConstants;

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [textContent, setTextContent] = useState(
      () => (getNode(id)?.data as ModifyConfigNodeData)?.content || ''
    );

    const [retMode, setRetMode] = useState(() =>
      typeof (getNode(id)?.data?.extra_configs as any)?.retMode === 'string'
        ? (getNode(id)?.data?.extra_configs as any)?.retMode
        : RET_ALL
    );

    const [configNum, setConfigNum] = useState<number>(() =>
      typeof (getNode(id)?.data?.extra_configs as any)?.configNum === 'number'
        ? (getNode(id)?.data?.extra_configs as any)?.configNum
        : 100
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
          targetNodeType: 'text',
          context,
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

    // 状态同步逻辑 - 使用 requestAnimationFrame 延迟执行，避免在节点创建时干扰
    useEffect(() => {
      if (!isOnGeneratingNewNode && hasMountedRef.current) {
        requestAnimationFrame(() => {
          const node = getNode(id);
          if (node) {
            setNodes(prevNodes =>
              prevNodes.map(n => {
                if (n.id === id) {
                  // 确保 n.data 存在并且是对象类型
                  const nodeData =
                    typeof n.data === 'object' && n.data !== null ? n.data : {};

                  // 确保 extra_configs 存在并且是对象类型
                  const existingExtraConfigs =
                    typeof nodeData.extra_configs === 'object' &&
                    nodeData.extra_configs !== null
                      ? nodeData.extra_configs
                      : {};

                  return {
                    ...n,
                    data: {
                      ...nodeData,
                      content: textContent,
                      extra_configs: {
                        ...existingExtraConfigs,
                        retMode: retMode,
                        configNum: configNum,
                      },
                    },
                  };
                }
                return n;
              })
            );
          }
        });
      }
    }, [textContent, retMode, configNum, isOnGeneratingNewNode]);

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

    // 执行函数 - 使用 useCallback 缓存
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
              <svg width='6' height='8' viewBox='0 0 8 10' fill='none'>
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
          className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
          style={mainButtonStyle}
        >
          {/* Edit Text SVG icon */}
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            viewBox='0 0 12 12'
            fill='none'
          >
            <path d='M2 10H10' stroke='currentColor' strokeWidth='1.5' />
            <path
              d='M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5'
              stroke='currentColor'
              strokeWidth='1.5'
            />
          </svg>
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>Edit</span>
            <span>Text</span>
          </div>

          {/* Source Handles */}
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

          {/* Target Handles */}
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
            className='absolute top-[64px] text-white w-[448px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
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
                      width='12'
                      height='12'
                      viewBox='0 0 12 12'
                      fill='none'
                    >
                      <path d='M2 10H10' stroke='#CDCDCD' strokeWidth='1.5' />
                      <path
                        d='M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5'
                        stroke='#CDCDCD'
                        strokeWidth='1.5'
                      />
                    </svg>
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    Edit Text
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
                      <svg width='8' height='10' viewBox='0 0 8 10' fill='none'>
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
                supportedOutputTypes={['text']}
                inputNodeCategory='blocknode'
                outputNodeCategory='blocknode'
              />
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Return Text
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <div className='bg-[#252525] rounded-[8px] p-3 border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <textarea
                  value={textContent}
                  onChange={e => {
                    setTextContent(e.target.value);
                  }}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  placeholder={`use {{}} and id to reference input content 
example: hello, {{parent_nodeid}}`}
                  className='w-full h-[140px] bg-transparent text-[#CDCDCD] text-[12px] resize-none outline-none p-1'
                />
              </div>
            </li>

            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Return Mode
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <PuppyDropdown
                  options={[RET_ALL, RET_FN, RET_LN, EX_FN, EX_LN]}
                  onSelect={(option: string) => {
                    setRetMode(option);
                  }}
                  selectedValue={retMode}
                  listWidth={'200px'}
                  containerClassnames='w-full'
                />

                {retMode !== RET_ALL && (
                  <div className='flex items-center gap-2'>
                    <input
                      value={configNum}
                      onChange={e => {
                        setConfigNum(parseInt(e.target.value));
                      }}
                      className='w-[80px] h-[32px] px-3 bg-[#252525] rounded-[6px] 
                                                    border-[1px] border-[#6D7177]/30 
                                                    text-[12px] text-[#CDCDCD] 
                                                    hover:border-[#6D7177]/50 transition-colors'
                      type='number'
                      onMouseDownCapture={onFocus}
                      onBlur={onBlur}
                    />
                    <span className='text-[12px] text-[#CDCDCD]'>
                      {retMode.includes('first') || retMode.includes('last')
                        ? 'items'
                        : 'characters'}
                    </span>
                  </div>
                )}
              </div>
            </li>
          </ul>
        )}
      </div>
    );
  }
);

EditText.displayName = 'EditText';
export default EditText;
