import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext';
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

// 前端节点配置数据
export type ChunkingConfigNodeData = {
  looped: boolean | undefined;
  subMenuType: string | null;
  sub_chunking_mode: 'size' | 'tokenizer' | undefined;
  content: string | null;
  extra_configs: {
    model: 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4o-mini' | undefined;
    chunk_size: number | undefined;
    overlap: number | undefined;
    handle_half_word: boolean | undefined;
  };
};

type ChunkingByLengthProps = NodeProps<Node<ChunkingConfigNodeData>>;

function ChunkingByLength({
  data: { subMenuType },
  isConnectable,
  id,
}: ChunkingByLengthProps) {
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);
  const portalAnchorRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();

  // 获取所有需要的依赖
  const { streamResult, reportError, resetLoadingUI } = useJsonConstructUtils();
  const {} = useAppSettings();

  // 状态管理
  const [subChunkMode, setSubChunkMode] = useState<'size' | 'tokenizer'>(
    (getNode(id)?.data as ChunkingConfigNodeData)?.sub_chunking_mode ?? 'size'
  );
  const [chunkSize, setChunkSize] = useState<number | undefined>(
    (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs?.chunk_size ??
      200
  );
  const [overlap, setOverlap] = useState<number | undefined>(
    (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs?.overlap ?? 20
  );
  const [handleHalfWord, setHandleHalfWord] = useState(
    (getNode(id)?.data as ChunkingConfigNodeData)?.extra_configs
      ?.handle_half_word ?? false
  );

  // 添加展开/收起状态
  const [showSettings, setShowSettings] = useState(false);

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

  // 更新节点数据
  useEffect(() => {
    const node = getNode(id);
    if (node) {
      const nodeData = node.data as ChunkingConfigNodeData;
      const newData = {
        ...nodeData,
        sub_chunking_mode: subChunkMode,
        extra_configs: {
          ...nodeData.extra_configs,
          chunk_size: chunkSize,
          overlap: overlap,
          handle_half_word: handleHalfWord,
        },
      };
      node.data = newData;
    }
  }, [subChunkMode, chunkSize, overlap, handleHalfWord]);

  // 初始化和清理
  useEffect(() => {
    console.log(getInternalNode(id));

    if (!isOnGeneratingNewNode) {
      clearAll();
      activateEdge(id);
    }

    return () => {
      if (activatedEdge === id) {
        clearEdgeActivation();
      }
    };
  }, []);

  // 在组件顶部定义共享样式
  const handleStyle = {
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
  };

  // Use a fixed-position portal so the menu does not scale with ReactFlow zoom
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
      const menuWidth = 320;
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
        style={{
          backgroundColor: isRunButtonHovered ? '#39BC66' : '#181818',
          borderColor: isRunButtonHovered
            ? '#39BC66'
            : UI_COLORS.EDGENODE_BORDER_GREY,
          color: isRunButtonHovered ? '#000' : UI_COLORS.EDGENODE_BORDER_GREY,
        }}
        onClick={handleDataSubmit}
        disabled={isLoading}
        onMouseEnter={() => setIsRunButtonHovered(true)}
        onMouseLeave={() => setIsRunButtonHovered(false)}
      >
        <span>
          {isLoading ? (
            <svg className='animate-spin h-3 w-3' viewBox='0 0 24 24'>
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
              ></circle>
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
              ></path>
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
        <span>{isLoading ? '' : 'Run'}</span>
      </button>

      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
        style={{
          borderColor: isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
          color: isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
        }}
      >
        {/* Chunking By Length SVG icon */}
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='10'
          height='10'
          viewBox='0 0 16 10'
          fill='none'
        >
          <path stroke='currentColor' d='m10 3 2 2-2 2M6 3 4 5l2 2M4 5h7.5' />
          <path stroke='currentColor' strokeWidth='1.5' d='M1 10V0m14 10V0' />
        </svg>
        <div className='flex flex-col items-center justify-center leading-tight text-[9px]'>
          <span>Chunk</span>
          <span>Length</span>
        </div>

        {/* Source handles */}
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

      {/* Configuration Menu - render in a body-level fixed portal to avoid zoom scaling */}
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
              className='text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg'
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
                        width='16'
                        height='10'
                        fill='none'
                        viewBox='0 0 16 10'
                      >
                        <path
                          stroke='#CDCDCD'
                          d='m10 3 2 2-2 2M6 3 4 5l2 2M4 5h7.5'
                        />
                        <path
                          stroke='#CDCDCD'
                          strokeWidth='1.5'
                          d='M1 10V0m14 10V0'
                        />
                      </svg>
                    </div>
                    <div className='flex items-center justify-center text-[14px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                      Chunk By length
                    </div>
                  </div>
                </div>
                <div className='flex flex-row gap-[8px] items-center justify-between'>
                  <button
                    className='w-[57px] h-[24px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                    onClick={handleDataSubmit}
                    disabled={isLoading}
                  >
                    <span>
                      {isLoading ? (
                        <svg
                          className='animate-spin h-4 w-4'
                          viewBox='0 0 24 24'
                        >
                          <circle
                            className='opacity-25'
                            cx='12'
                            cy='12'
                            r='10'
                            stroke='currentColor'
                            strokeWidth='4'
                          ></circle>
                          <path
                            className='opacity-75'
                            fill='currentColor'
                            d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                          ></path>
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
                    <span>{isLoading ? '' : 'Run'}</span>
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
                  supportedInputTypes={['text']}
                  supportedOutputTypes={['structured']}
                  inputNodeCategory='blocknode'
                  outputNodeCategory='blocknode'
                />
              </li>

              <li className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <label className='text-[12px] font-semibold text-[#6D7177]'>
                    Mode
                  </label>
                  <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                </div>
                <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                  <PuppyDropdown
                    options={['size']}
                    selectedValue={subChunkMode}
                    onSelect={(value: string) => {
                      setSubChunkMode(value as 'size' | 'tokenizer');
                    }}
                    buttonHeight='32px'
                    buttonBgColor='transparent'
                    menuBgColor='#1A1A1A'
                    listWidth='100%'
                    containerClassnames='w-full'
                    mapValueTodisplay={(v: string) =>
                      v === 'size' ? 'by size' : v
                    }
                  />
                </div>
              </li>

              <li className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <label className='text-[12px] font-semibold text-[#6D7177]'>
                      Settings
                    </label>
                    <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
                  </div>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className='text-[12px] text-[#6D7177] hover:text-[#39BC66] transition-colors flex items-center gap-1'
                  >
                    {showSettings ? 'Hide' : 'Show'}
                    <svg
                      className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`}
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 9l-7 7-7-7'
                      />
                    </svg>
                  </button>
                </div>

                {showSettings && (
                  <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                    <div className='flex flex-col gap-1'>
                      <label className='text-[12px] text-[#6D7177]'>
                        Chunk Size
                      </label>
                      <input
                        value={chunkSize}
                        onChange={e =>
                          setChunkSize(
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value)
                          )
                        }
                        type='number'
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 text-[12px] text-[#CDCDCD] hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                      />
                    </div>
                    <div className='flex flex-col gap-1'>
                      <label className='text-[12px] text-[#6D7177]'>
                        Overlap
                      </label>
                      <input
                        value={overlap}
                        onChange={e =>
                          setOverlap(
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value)
                          )
                        }
                        type='number'
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 text-[12px] text-[#CDCDCD] hover:border-[#6D7177]/50 focus:border-[#39BC66] transition-colors'
                      />
                    </div>
                    <div className='flex flex-col gap-1'>
                      <label className='text-[12px] text-[#6D7177]'>
                        Handle Half Word
                      </label>
                      <select
                        value={handleHalfWord ? 'True' : 'False'}
                        onChange={e =>
                          setHandleHalfWord(e.target.value === 'True')
                        }
                        className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 text-[12px] text-[#CDCDCD] appearance-none cursor-pointer hover:border-[#6D7177]/50 transition-colors'
                      >
                        <option value='True'>True</option>
                        <option value='False'>False</option>
                      </select>
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

export default ChunkingByLength;
