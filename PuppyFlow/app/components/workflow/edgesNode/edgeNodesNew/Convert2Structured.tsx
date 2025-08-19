import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { PuppyDropdown } from '../../../misc/PuppyDropDown';
import InputOutputDisplay from './components/InputOutputDisplay';
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
    index?: number | undefined;
    key?: string | undefined;
    params?: {
      path: (string | number)[];
    };
    list_separator?: string[];
    dict_key?: string;
    length_separator?: number;
  };
  execMode: string | null;
};

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>;

const Convert2Structured: React.FC<ModifyConfigNodeProps> = React.memo(
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
    const [showDelimiterInput, setShowDelimiterInput] = useState(false);
    const newDelimiterRef = useRef<HTMLInputElement>(null);

    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const { getAuthHeaders } = useAppSettings();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 常量定义 - 使用 useMemo 缓存
    const modeConstants = useMemo(
      () => ({
        INTO_DICT_TYPE: 'wrap into dict',
        INTO_LIST_TYPE: 'wrap into list',
        JSON_TYPE: 'JSON',
        BY_LEN_TYPE: 'split by length',
        BY_CHAR_TYPE: 'split by character',
      }),
      []
    );

    const {
      INTO_DICT_TYPE,
      INTO_LIST_TYPE,
      JSON_TYPE,
      BY_LEN_TYPE,
      BY_CHAR_TYPE,
    } = modeConstants;

    // 添加 commonDelimiters 常量定义 - 使用 useMemo 缓存
    const commonDelimiters = useMemo(
      () => [
        { label: 'Comma (,)', value: ',' },
        { label: 'Semicolon (;)', value: ';' },
        { label: 'Enter (\\n)', value: '\n' },
        { label: 'Tab (\\t)', value: '\t' },
        { label: 'Space', value: ' ' },
        { label: 'Period (.)', value: '.' },
        { label: 'Pipe (|)', value: '|' },
        { label: 'Dash (-)', value: '-' },
      ],
      []
    );

    // 优化状态初始化 - 使用函数形式避免重复计算
    const [execMode, setExecMode] = useState(
      () => (getNode(id)?.data as any)?.execMode || JSON_TYPE
    );

    const [wrapInto, setWrapInto] = useState(() =>
      typeof (getNode(id)?.data?.extra_configs as any)?.dict_key === 'string'
        ? (getNode(id)?.data?.extra_configs as any)?.dict_key
        : ''
    );

    const [deliminator, setDeliminator] = useState(() =>
      typeof (getNode(id)?.data?.extra_configs as any)?.list_separator ===
      'string'
        ? (getNode(id)?.data?.extra_configs as any)?.list_separator
        : `[",",";",".","\\n"]`
    );

    const [bylen, setBylen] = useState<number>(() =>
      typeof (getNode(id)?.data?.extra_configs as any)?.length_separator ===
      'number'
        ? (getNode(id)?.data?.extra_configs as any)?.length_separator
        : 10
    );

    // 优化 delimiters 状态初始化 - 使用 useMemo 缓存解析逻辑
    const [delimiters, setDelimiters] = useState<string[]>(() => {
      try {
        const parsedDeliminator = JSON.parse(deliminator);
        return Array.isArray(parsedDeliminator)
          ? parsedDeliminator
          : [',', ';', '.', '\n'];
      } catch (e) {
        return [',', ';', '.', '\n'];
      }
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
        await runSingleEdgeNode({
          parentId: id,
          targetNodeType: 'structured',
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
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      execMode: execMode,
                      extra_configs: {
                        ...(n.data?.extra_configs || {}),
                        list_separator: deliminator,
                        dict_key: wrapInto,
                        length_separator: bylen,
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
    }, [execMode, deliminator, bylen, wrapInto, isOnGeneratingNewNode]);

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

    // 当显示输入框时，自动聚焦
    useEffect(() => {
      if (showDelimiterInput && newDelimiterRef.current) {
        newDelimiterRef.current.focus();
      }
    }, [showDelimiterInput]);

    // 处理自定义分隔符输入 - 使用 useCallback 缓存
    const handleCustomDelimiterInput = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.currentTarget.value) {
          addDelimiter(e.currentTarget.value);
          e.currentTarget.value = '';
          setShowDelimiterInput(false);
        } else if (e.key === 'Escape') {
          setShowDelimiterInput(false);
        }
      },
      []
    );

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

    // 添加新的分隔符 - 使用 useCallback 缓存
    const addDelimiter = useCallback(
      (value: string) => {
        if (value && !delimiters.includes(value)) {
          const newDelimiters = [...delimiters, value];
          setDelimiters(newDelimiters);
          setDeliminator(JSON.stringify(newDelimiters));
        }
      },
      [delimiters]
    );

    // 删除分隔符 - 使用 useCallback 缓存
    const removeDelimiter = useCallback(
      (index: number) => {
        const newDelimiters = delimiters.filter((_, i) => i !== index);
        setDelimiters(newDelimiters);
        setDeliminator(JSON.stringify(newDelimiters));
      },
      [delimiters]
    );

    // 特殊字符的显示映射 - 使用 useCallback 缓存
    const delimiterDisplay = useCallback((delimiter: string) => {
      switch (delimiter) {
        case '\n':
          return (
            <span className='flex items-center gap-1'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M6 5L3 8L6 11'
                  stroke='currentColor'
                  strokeWidth='0.583333'
                />
                <path
                  d='M3 8H11V3'
                  stroke='currentColor'
                  strokeWidth='0.583333'
                />
              </svg>
              <span className='text-[10px]'>Enter</span>
            </span>
          );
        case '\t':
          return 'Tab';
        case ' ':
          return 'Space';
        default:
          return delimiter;
      }
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
          {/* Convert to Structured SVG icon */}
          <svg width='10' height='10' viewBox='0 0 14 14' fill='none'>
            <path d='M12 2L2 12' stroke='currentColor' strokeWidth='1.5' />
            <path d='M12 2L8 2' stroke='currentColor' strokeWidth='1.5' />
            <path d='M12 2L12 6' stroke='currentColor' strokeWidth='1.5' />
            <path d='M2 12L6 12' stroke='currentColor' strokeWidth='1.5' />
            <path d='M2 12L2 8' stroke='currentColor' strokeWidth='1.5' />
          </svg>
          <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
            <span>Convert</span>
            <span>Struct</span>
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
            className='absolute top-[64px] text-white w-[384px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg'
            style={{
              borderColor: UI_COLORS.EDGENODE_BORDER_GREY,
            }}
          >
            <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
              <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                  <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                      <path d='M12 2L2 12' stroke='#CDCDCD' strokeWidth='1.5' />
                      <path d='M12 2L8 2' stroke='#CDCDCD' strokeWidth='1.5' />
                      <path d='M12 2L12 6' stroke='#CDCDCD' strokeWidth='1.5' />
                      <path d='M2 12L6 12' stroke='#CDCDCD' strokeWidth='1.5' />
                      <path d='M2 12L2 8' stroke='#CDCDCD' strokeWidth='1.5' />
                    </svg>
                  </div>
                  <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    Convert to Structured
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
                supportedOutputTypes={['structured']}
                inputNodeCategory='blocknode'
                outputNodeCategory='blocknode'
              />
            </li>

            {/* Mode selector menu */}
            <li className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>
                  Mode
                </label>
                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
              </div>
              <div className='flex gap-2 bg-[#252525] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                <PuppyDropdown
                  options={[
                    INTO_DICT_TYPE,
                    INTO_LIST_TYPE,
                    JSON_TYPE,
                    BY_LEN_TYPE,
                    BY_CHAR_TYPE,
                  ]}
                  onSelect={(option: string) => {
                    setExecMode(option);
                  }}
                  selectedValue={execMode}
                  listWidth={'200px'}
                />
              </div>
            </li>

            {execMode === INTO_DICT_TYPE && (
              <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <label className='text-[12px] font-medium text-[#6D7177]'>
                    Key
                  </label>
                  <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <input
                  value={wrapInto}
                  onChange={e => setWrapInto(e.target.value)}
                  type='string'
                  className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                  autoComplete='off'
                  onMouseDownCapture={onFocus}
                  onBlur={onBlur}
                />
              </li>
            )}

            {execMode === BY_CHAR_TYPE && (
              <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <label className='text-[12px] font-medium text-[#6D7177]'>
                    Delimiters
                  </label>
                  <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='bg-[#1E1E1E] rounded-[8px] p-[5px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                  <div className='flex flex-wrap gap-2 items-center'>
                    {delimiters.map((delimiter, index) => (
                      <div
                        key={index}
                        className='flex items-center bg-[#252525] rounded-md 
                                                        border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 
                                                        transition-colors group'
                      >
                        <span className='text-[10px] text-[#FF9B4D] px-2 py-1'>
                          {delimiterDisplay(delimiter)}
                        </span>
                        <button
                          onClick={() => removeDelimiter(index)}
                          className='text-[#6D7177] hover:text-[#ff6b6b] transition-colors 
                                                            px-1 py-1 opacity-0 group-hover:opacity-100'
                        >
                          <svg
                            width='10'
                            height='10'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                          >
                            <line x1='18' y1='6' x2='6' y2='18'></line>
                            <line x1='6' y1='6' x2='18' y2='18'></line>
                          </svg>
                        </button>
                      </div>
                    ))}

                    {showDelimiterInput ? (
                      <div className='h-[24px] bg-[#252525] rounded-md border border-[#FF9B4D]/30 flex items-center'>
                        <input
                          ref={newDelimiterRef}
                          type='text'
                          placeholder='Type...'
                          className='w-[80px] h-full bg-transparent border-none outline-none px-2 text-[10px] text-[#CDCDCD]'
                          onKeyDown={handleCustomDelimiterInput}
                          onBlur={() => setShowDelimiterInput(false)}
                          onFocus={onFocus}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDelimiterInput(true)}
                        className='w-[24px] h-[24px] flex items-center justify-center rounded-md bg-[#252525] border border-[#6D7177]/30 text-[#6D7177] hover:border-[#6D7177]/50 hover:bg-[#252525]/80 transition-colors'
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
                    )}
                  </div>
                </div>

                <div className='mt-1'>
                  <div className='text-[10px] text-[#6D7177] mb-2'>
                    Common delimiters:
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {commonDelimiters.map(delimiter => (
                      <button
                        key={delimiter.value}
                        onClick={() => addDelimiter(delimiter.value)}
                        className={`px-2 py-1 rounded-md text-[10px] transition-colors ${
                          delimiters.includes(delimiter.value)
                            ? 'bg-[#252525] text-[#CDCDCD] border border-[#6D7177]/50'
                            : 'bg-[#1E1E1E] text-[#6D7177] border border-[#6D7177]/30 hover:bg-[#252525] hover:text-[#CDCDCD]'
                        }`}
                      >
                        {delimiter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            )}

            {execMode === BY_LEN_TYPE && (
              <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <label className='text-[12px] font-medium text-[#6D7177]'>
                    Length
                  </label>
                  <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <input
                  value={bylen}
                  onChange={e => setBylen(parseInt(e.target.value))}
                  type='number'
                  className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                            text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                            hover:border-[#6D7177]/50 transition-colors'
                  autoComplete='off'
                  onMouseDownCapture={onFocus}
                  onBlur={onBlur}
                />
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
);

Convert2Structured.displayName = 'Convert2Structured';
export default Convert2Structured;
