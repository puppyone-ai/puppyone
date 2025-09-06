import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext';
import InputOutputDisplay from './components/InputOutputDisplay';
import { UI_COLORS } from '@/app/utils/colors';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { useAppSettings } from '@/app/components/states/AppSettingsContext';
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from './hook/runSingleEdgeNodeExecutor';

// 前端节点配置数据（原 ModifyConfigNodeData）
export type CopyNodeFrontendConfig = {
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

// 后端 API 请求数据（原 ModifyCopyEdgeJsonType）
export type CopyOperationApiPayload = {
  type: 'modify';
  data: {
    modify_type: 'deep_copy' | 'copy';
    content: string;
    extra_configs: {};
    inputs: { [key: string]: string };
    outputs: { [key: string]: string };
  };
};

type ModifyConfigNodeProps = NodeProps<Node<CopyNodeFrontendConfig>>;

function CopyEdgeNode({
  data: { subMenuType },
  isConnectable,
  id,
}: ModifyConfigNodeProps) {
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
  const [isMenuOpen, setIsMenuOpen] = useState(true);
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
        targetNodeType: 'text',
        context,
        // 可以选择不提供 constructJsonData，使用默认实现
      });
    } catch (error) {
      console.error('执行失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id, isLoading, createExecutionContext]);

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
      const menuWidth = 320; // matches w-[320px]
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
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
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

      {/* Main node button */}
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600] edge-node transition-colors gap-[4px]`}
        style={{
          borderColor: isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
          color: isHovered
            ? UI_COLORS.LINE_ACTIVE
            : UI_COLORS.EDGENODE_BORDER_GREY,
        }}
        title='Copy Node'
      >
        {/* Copy SVG icon */}
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='10'
          height='10'
          viewBox='0 0 12 12'
          fill='none'
        >
          <path
            d='M8 1H2C1.45 1 1 1.45 1 2V8'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
          <rect
            x='4'
            y='4'
            width='7'
            height='7'
            rx='1'
            stroke='currentColor'
            strokeWidth='1.5'
          />
        </svg>
        Copy
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

      {/* Configuration Menu (render via portal to avoid zoom scaling) */}
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
          {/* Title and Run button section */}
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
                    <path
                      d='M8 1H2C1.45 1 1 1.45 1 2V8'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                    />
                    <rect
                      x='4'
                      y='4'
                      width='7'
                      height='7'
                      rx='1'
                      stroke='#CDCDCD'
                      strokeWidth='1.5'
                    />
                  </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                  Copy
                </div>
              </div>
            </div>
            <div className='w-[57px] h-[26px]'>
              <button
                className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                onClick={handleDataSubmit}
                disabled={isLoading}
              >
                <span>
                  {isLoading ? (
                    <svg className='animate-spin h-4 w-4' viewBox='0 0 24 24'>
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
              supportedInputTypes={['text', 'structured']}
              supportedOutputTypes={['text', 'structured']}
              inputNodeCategory='blocknode'
              outputNodeCategory='blocknode'
            />
          </li>
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

export default CopyEdgeNode;
