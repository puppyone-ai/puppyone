'use client';

import {
  NodeProps,
  Node,
  Handle,
  Position,
  useReactFlow,
  NodeResizeControl,
} from '@xyflow/react';
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import WhiteBallHandle from '../handles/WhiteBallHandle';
import NodeToolBar from './nodeTopRightBar/NodeTopRightBar';
import TextEditor from '../../tableComponent/TextEditor';
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon';
import dynamic from 'next/dynamic';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';

// 定义节点数据类型
export type TextBlockNodeData = {
  content: string;
  label: string;
  isLoading: boolean;
  isWaitingForFlow: boolean;
  locked: boolean;
  isInput: boolean;
  isOutput: boolean;
  editable: boolean;
  inputEdgeNodeID: string[];
  outputEdgeNodeID: string[];
};

type TextBlockNodeProps = NodeProps<Node<TextBlockNodeData>>;

// 动态加载组件以进行代码分割
const TextEditorBlockNote = dynamic(
  () => import('../../tableComponent/TextEditorBlockNote'),
  { ssr: false }
);

// 优化点 1: 使用 React.memo 包裹组件，避免不必要的重渲染
const TextBlockNode = React.memo<TextBlockNodeProps>(
  ({
    isConnectable,
    id,
    type,
    data: {
      content,
      label,
      isLoading,
      isWaitingForFlow,
      locked,
      editable,
      isInput,
      isOutput,
    },
  }) => {
    const { getNode, setNodes } = useReactFlow();
    const {
      activatedNode,
      isOnConnect,
      isOnGeneratingNewNode,
      setNodeUneditable,
      editNodeLabel,
      preventInactivateNode,
      allowInactivateNodeWhenClickOutside,
      manageNodeasInput,
      manageNodeasOutput,
      manageNodeasLocked,
      activateNode,
    } = useNodesPerFlowContext();
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();

    // 优化点 2: 将多个相关的 state 合并，减少 state 更新的复杂性
    const [nodeState, setNodeState] = useState({
      isTargetHandleTouched: false,
      nodeLabel: label ?? id,
      isLocalEdit: false,
      isHovered: false,
    });

    // 使用 refs 来引用 DOM 元素，避免因引用变化导致重渲染
    const componentRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const labelRef = useRef<HTMLInputElement | null>(null);
    const labelContainerRef = useRef<HTMLDivElement | null>(null);
    const measureSpanRef = useRef<HTMLSpanElement | null>(null);
    // 优化点 3: 使用 ref 标记初始渲染，用于延迟计算
    const hasMountedRef = useRef(false);

    const sourceNodes = getSourceNodeIdWithLabel(id);
    const targetNodes = getTargetNodeIdWithLabel(id);

    // 优化点 4: 使用 useMemo 缓存边框颜色的计算逻辑
    const borderColor = useMemo(() => {
      if (isLoading) return 'border-[#FFA500]';
      if (isWaitingForFlow) return 'border-[#39bc66]';
      if (activatedNode?.id === id) return 'border-main-blue';
      if (nodeState.isHovered) return 'border-main-blue';
      return isOnConnect && nodeState.isTargetHandleTouched
        ? 'border-main-orange'
        : 'border-main-deep-grey';
    }, [
      isLoading,
      isWaitingForFlow,
      activatedNode?.id,
      id,
      nodeState.isHovered,
      isOnConnect,
      nodeState.isTargetHandleTouched,
    ]);

    // 优化点 4: 使用 useMemo 缓存整个容器的 className 字符串
    const containerClassName = useMemo(
      () =>
        `w-full h-full border-[1.5px] min-w-[240px] min-h-[176px] rounded-[16px] px-[8px] pt-[8px] pb-[4px] ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden flex flex-col text-block-node`,
      [borderColor]
    );

    // 优化点 4 & 5: 使用 useMemo 缓存 Handle 的样式对象，避免内联样式导致重渲染
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
        zIndex: !isOnConnect ? -1 : 1,
      }),
      [isOnConnect]
    );

    // 优化点 6: 使用 useCallback 缓存所有事件处理函数和内部函数
    const handleMouseEnter = useCallback(() => {
      setNodeState(prev => ({ ...prev, isHovered: true }));
      activateNode(id);
    }, [activateNode, id]);

    const handleMouseLeave = useCallback(() => {
      setNodeState(prev => ({ ...prev, isHovered: false }));
    }, []);

    const handleTargetHandleMouseEnter = useCallback(() => {
      setNodeState(prev => ({ ...prev, isTargetHandleTouched: true }));
    }, []);

    const handleTargetHandleMouseLeave = useCallback(() => {
      setNodeState(prev => ({ ...prev, isTargetHandleTouched: false }));
    }, []);

    const onFocus = useCallback(() => {
      preventInactivateNode();
      componentRef.current?.classList.add('nodrag');
    }, [preventInactivateNode]);

    const onBlur = useCallback(() => {
      allowInactivateNodeWhenClickOutside();
      componentRef.current?.classList.remove('nodrag');
      if (nodeState.isLocalEdit) {
        editNodeLabel(id, nodeState.nodeLabel);
        setNodeState(prev => ({ ...prev, isLocalEdit: false }));
      }
    }, [
      allowInactivateNodeWhenClickOutside,
      editNodeLabel,
      id,
      nodeState.isLocalEdit,
      nodeState.nodeLabel,
    ]);

    const handleLabelChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setNodeState(prev => ({
          ...prev,
          isLocalEdit: true,
          nodeLabel: e.target.value,
        }));
      },
      []
    );

    const preventNodeDrag = useCallback(() => {
      componentRef.current?.classList.add('nodrag');
    }, []);

    const allowNodeDrag = useCallback(() => {
      componentRef.current?.classList.remove('nodrag');
    }, []);

    const toggleNodeInput = useCallback(
      () => manageNodeasInput(id),
      [manageNodeasInput, id]
    );
    const toggleNodeOutput = useCallback(
      () => manageNodeasOutput(id),
      [manageNodeasOutput, id]
    );
    const toggleNodeLocked = useCallback(
      () => manageNodeasLocked(id),
      [manageNodeasLocked, id]
    );

    const updateNodeContent = useCallback(
      (newValue: string) => {
        setNodes(prevNodes =>
          prevNodes.map(node =>
            node.id === id
              ? { ...node, data: { ...node.data, content: newValue } }
              : node
          )
        );
      },
      [id, setNodes]
    );

    const calculateMaxLabelContainerWidth = useCallback(() => {
      return contentRef.current
        ? `${contentRef.current.clientWidth - 48}px`
        : '100%';
    }, []);

    const renderTagLogo = useCallback(
      () => (
        <svg
          width='20'
          height='24'
          viewBox='0 0 20 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='group'
        >
          <path
            d='M3 8H17'
            className='stroke-[#A4C8F0] group-active:stroke-[#4599DF]'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
          <path
            d='M3 12H15'
            className='stroke-[#A4C8F0] group-active:stroke-[#4599DF]'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
          <path
            d='M3 16H13'
            className='stroke-[#A4C8F0] group-active:stroke-[#4599DF]'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
        </svg>
      ),
      []
    );

    // 优化点 3: 借鉴 table-node.tsx，延迟初始渲染时的副作用
    useEffect(() => {
      const checkAndSetNodeRole = () => {
        const isAutoDetectInput =
          sourceNodes.length === 0 && targetNodes.length > 0;
        const isAutoDetectOutput =
          targetNodes.length === 0 && sourceNodes.length > 0;

        if (isAutoDetectInput && !isInput) {
          manageNodeasInput(id);
        } else if (isAutoDetectOutput && !isOutput) {
          manageNodeasOutput(id);
        } else if (
          !isAutoDetectInput &&
          !isAutoDetectOutput &&
          (isInput || isOutput)
        ) {
          if (isInput) manageNodeasInput(id);
          if (isOutput) manageNodeasOutput(id);
        }
      };

      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        requestAnimationFrame(checkAndSetNodeRole);
      } else {
        checkAndSetNodeRole();
      }
    }, [
      sourceNodes.length,
      targetNodes.length,
      isInput,
      isOutput,
      id,
      manageNodeasInput,
      manageNodeasOutput,
    ]);

    // useEffect(() => {
    //   console.log('sourceNodes长度', sourceNodes.length);
    //   console.log('targetNodes长度', targetNodes.length);
    // }, [
    //   sourceNodes.length,
    //   targetNodes.length,
    //   isInput,
    //   isOutput,
    //   id,
    //   manageNodeasInput,
    //   manageNodeasOutput,
    // ]);

    // 管理外部点击事件
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          !labelContainerRef.current?.contains(e.target as HTMLElement) &&
          !(e.target as HTMLElement).classList.contains('renameButton')
        ) {
          setNodeUneditable(id);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }, [id, setNodeUneditable]);

    // 自动聚焦
    useEffect(() => {
      if (editable && labelRef.current) {
        labelRef.current.focus();
        const length = labelRef.current.value.length;
        labelRef.current.setSelectionRange(length, length);
      }
    }, [editable]);

    // 同步外部 label 变化
    useEffect(() => {
      const currentLabel = getNode(id)?.data?.label;
      if (
        currentLabel !== undefined &&
        currentLabel !== nodeState.nodeLabel &&
        !nodeState.isLocalEdit
      ) {
        // 确保 currentLabel 是字符串类型
        const labelString =
          typeof currentLabel === 'string'
            ? currentLabel
            : String(currentLabel);
        setNodeState(prev => ({ ...prev, nodeLabel: labelString }));
        if (measureSpanRef.current) {
          measureSpanRef.current.textContent = labelString;
        }
      }
    }, [label, id, getNode, nodeState.isLocalEdit, nodeState.nodeLabel]);

    return (
      <div
        ref={componentRef}
        className={`relative w-full h-full min-w-[240px] min-h-[176px] ${
          isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Tags for input, output, locked states */}
        <div className='absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5'>
          {isInput && (
            <div
              className='px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black cursor-pointer'
              onClick={toggleNodeInput}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect
                  x='16'
                  y='7'
                  width='3'
                  height='12'
                  rx='1'
                  fill='currentColor'
                />
                <path
                  d='M5 13H14'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                />
                <path
                  d='M10 9L14 13L10 17'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              <span>INPUT</span>
            </div>
          )}
          {isOutput && (
            <div
              className='px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black cursor-pointer'
              onClick={toggleNodeOutput}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect
                  x='7'
                  y='7'
                  width='3'
                  height='12'
                  rx='1'
                  fill='currentColor'
                />
                <path
                  d='M12 13H21'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                />
                <path
                  d='M17 9L21 13L17 17'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              <span>OUTPUT</span>
            </div>
          )}
          {locked && (
            <div
              className='px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black cursor-pointer'
              onClick={toggleNodeLocked}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 16 16'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                />
                <rect
                  x='4'
                  y='7'
                  width='8'
                  height='6'
                  rx='1'
                  fill='currentColor'
                />
              </svg>
              <span>LOCKED</span>
            </div>
          )}
        </div>

        {/* Main node body */}
        <div ref={contentRef} id={id} className={containerClassName}>
          <div
            ref={labelContainerRef}
            className='h-[24px] w-full rounded-[4px] flex items-center justify-between mb-2'
          >
            <div
              className='flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group'
              style={{ maxWidth: calculateMaxLabelContainerWidth() }}
            >
              <div className='min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'>
                {renderTagLogo()}
              </div>
              <span
                ref={measureSpanRef}
                className='invisible absolute whitespace-pre text-[12px] font-bold font-plus-jakarta-sans leading-[18px]'
              >
                {nodeState.nodeLabel}
              </span>
              {editable ? (
                <input
                  ref={labelRef}
                  autoFocus
                  className='flex items-center justify-start font-[600] text-[12px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none truncate w-full text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'
                  value={nodeState.nodeLabel}
                  readOnly={!editable}
                  onChange={handleLabelChange}
                  onMouseDownCapture={onFocus}
                  onBlur={onBlur}
                />
              ) : (
                <span className='flex items-center justify-start font-[600] text-[12px] leading-[18px] font-plus-jakarta-sans truncate w-fit text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'>
                  {nodeState.nodeLabel}
                </span>
              )}
            </div>
            <div className='min-w-[24px] min-h-[24px] flex items-center justify-center'>
              <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
            </div>
          </div>

          <div className='pl-[8px] flex-1 relative'>
            {isLoading ? (
              <SkeletonLoadingIcon />
            ) : (
              <TextEditor
                preventParentDrag={preventNodeDrag}
                allowParentDrag={allowNodeDrag}
                widthStyle={0}
                heightStyle={0}
                placeholder='Text'
                value={content || ''}
                onChange={updateNodeContent}
              />
            )}
          </div>

          <NodeResizeControl
            minWidth={240}
            minHeight={176}
            style={{
              position: 'absolute',
              right: '0px',
              bottom: '0px',
              cursor: 'se-resize',
              background: 'transparent',
              border: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                visibility: `${
                  activatedNode?.id === id ? 'visible' : 'hidden'
                }`,
                right: '0px',
                bottom: '0px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '26px',
                height: '26px',
              }}
            >
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                className='group active:group-[]:fill-[#4599DF]'
              >
                <path
                  d='M10 5.99998H12V7.99998H10V5.99998Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
                <path
                  d='M10 2H12V4H10V2Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
                <path
                  d='M6 5.99998H8V7.99998H6V5.99998Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
                <path
                  d='M6 10H8V12H6V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
                <path
                  d='M2 10H4V12H2V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
                <path
                  d='M10 10H12V12H10V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]'
                />
              </svg>
            </div>
          </NodeResizeControl>

          {/* Source Handles */}
          <WhiteBallHandle
            id={`${id}-a`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Top}
          />
          <WhiteBallHandle
            id={`${id}-b`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}
          />
          <WhiteBallHandle
            id={`${id}-c`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Bottom}
          />
          <WhiteBallHandle
            id={`${id}-d`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Left}
          />

          {/* Target Handles */}
          {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(
            (pos, index) => (
              <Handle
                key={pos}
                id={`${id}-${String.fromCharCode(97 + index)}`}
                type='target'
                position={pos}
                style={handleStyle}
                isConnectable={isConnectable}
                onMouseEnter={handleTargetHandleMouseEnter}
                onMouseLeave={handleTargetHandleMouseLeave}
              />
            )
          )}
        </div>
      </div>
    );
  }
);

TextBlockNode.displayName = 'TextBlockNode';

export default TextBlockNode;
