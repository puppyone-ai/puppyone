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
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import ReactDOM from 'react-dom';
import { useFileUpload, UploadedFile } from './hooks/useFileUpload';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';

export type FileNodeData = {
  content: string;
  label: string;
  isLoading: boolean;
  isWaitingForFlow: boolean;
  locked: boolean;
  isInput: boolean;
  isOutput: boolean;
  editable: boolean;
  fileType?: string;
};

type FileNodeProps = NodeProps<Node<FileNodeData>>;

// 优化点 1: 使用 React.memo 包裹组件，避免不必要的重渲染
const FileNode = React.memo<FileNodeProps>(
  ({
    data: {
      content,
      label,
      isLoading,
      isWaitingForFlow,
      locked,
      isInput,
      isOutput,
      editable,
    },
    type,
    isConnectable,
    id,
  }) => {
    const {
      activatedNode,
      isOnConnect,
      isOnGeneratingNewNode,
      setNodeUneditable,
      editNodeLabel,
      preventInactivateNode,
      allowInactivateNodeWhenClickOutside,
      activateNode,
      inactivateNode,
    } = useNodesPerFlowContext();

    const { getNode, setNodes } = useReactFlow();

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

    // 从节点加载初始文件
    const initialFiles = useMemo(() => {
      const node = getNode(id);
      return Array.isArray(node?.data?.content) ? node.data.content : [];
    }, [id, getNode]);

    // 优化点 6: 使用 useCallback 缓存文件变更处理函数
    const handleFilesChange = useCallback(
      (files: UploadedFile[]) => {
        setNodes(nodes =>
          nodes.map(node =>
            node.id === id
              ? { ...node, data: { ...node.data, content: files } }
              : node
          )
        );
      },
      [id, setNodes]
    );

    // 使用分离后的文件上传hook
    const {
      uploadedFiles,
      isOnUploading,
      inputRef,
      handleInputChange,
      handleFileDrop,
      handleDelete,
      resourceKey,
      versionId,
    } = useFileUpload({
      nodeId: id,
      initialFiles,
      onFilesChange: handleFilesChange,
    });

    // 使用新的获取连接节点的工具函数
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();

    // 获取连接的节点
    const sourceNodes = getSourceNodeIdWithLabel(id);
    const targetNodes = getTargetNodeIdWithLabel(id);

    // 根据连接节点动态确定 isInput 和 isOutput
    const dynamicIsInput = sourceNodes.length === 0 && targetNodes.length > 0;
    const dynamicIsOutput = targetNodes.length === 0 && sourceNodes.length > 0;

    // 使用已有属性或动态计算的值
    const effectiveIsInput = isInput || dynamicIsInput;
    const effectiveIsOutput = isOutput || dynamicIsOutput;

    // 优化点 4: 使用 useMemo 缓存边框颜色的计算逻辑
    const borderColor = useMemo(() => {
      if (isLoading) return 'border-[#FFA500]';
      if (isWaitingForFlow) return 'border-[#39bc66]';
      if (activatedNode?.id === id) return 'border-[#BF9A78]';
      if (nodeState.isHovered) return 'border-[#BF9A78]';
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
        `flex flex-col w-full h-full border-[1.5px] border-solid border-[1.5px] min-w-[240px] min-h-[176px] p-[8px] rounded-[16px] flex justify-start ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden file-block-node`,
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

    // 优化点 6: 使用 useCallback 缓存所有事件处理函数
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
      const curRef = componentRef.current;
      if (curRef && !curRef.classList.contains('nodrag')) {
        curRef.classList.add('nodrag');
      }
    }, [preventInactivateNode]);

    const onBlur = useCallback(() => {
      allowInactivateNodeWhenClickOutside();
      const curRef = componentRef.current;
      if (curRef) {
        curRef.classList.remove('nodrag');
      }
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

    const calculateMaxLabelContainerWidth = useCallback(() => {
      if (contentRef.current) {
        return `${contentRef.current.clientWidth - 48}px`;
      }
      return '100%';
    }, []);

    // 优化点 6: 缓存 renderTagLogo 函数
    const renderTagLogo = useCallback(
      () => (
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='group'
        >
          <path
            d='M4 6H10L12 8H20V18H4V6Z'
            className='fill-transparent stroke-[#9E7E5F] group-active:stroke-[#BF9A78]'
            strokeWidth='1.5'
          />
          <path
            d='M8 13.5H16'
            className='stroke-[#9E7E5F] group-active:stroke-[#BF9A78]'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
        </svg>
      ),
      []
    );

    // 优化点 6: 缓存文件点击处理函数
    const handleFileClick = useCallback(
      (file: UploadedFile, e: React.MouseEvent) => {
        e.stopPropagation();
        if (file.download_url) {
          window.open(file.download_url, '_blank');
        }
      },
      []
    );

    const handleFileDelete = useCallback(
      (file: UploadedFile, index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        handleDelete(file, index);
      },
      [handleDelete]
    );

    const handleUploadAreaClick = useCallback(
      (e: React.MouseEvent) => {
        if (e.currentTarget === e.target) {
          inputRef.current?.click();
        }
      },
      [inputRef]
    );

    const handleEmptyAreaClick = useCallback(() => {
      inputRef.current?.click();
    }, [inputRef]);

    // 管理labelContainer的宽度
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          !labelContainerRef.current?.contains(e.target as HTMLElement) &&
          !(e.target as HTMLElement).classList.contains('renameButton')
        ) {
          setNodeUneditable(id);
        }
      };

      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }, [id, setNodeUneditable]);

    // 自动聚焦，同时需要让cursor focus 到input 的最后一位
    useEffect(() => {
      if (editable && labelRef.current) {
        labelRef.current?.focus();
        const length = labelRef.current.value.length;
        labelRef.current.setSelectionRange(length, length);
      }
    }, [editable, id]);

    // 当生成 resourceKey 时，将 external 指针写入节点数据，便于后端识别
    useEffect(() => {
      if (resourceKey) {
        setNodes(nodes =>
          nodes.map(node =>
            node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    storage_class: 'external',
                    external_metadata: {
                      resource_key: resourceKey,
                      content_type: 'files',
                      version_id: versionId,
                    },
                  },
                }
              : node
          )
        );
      }
    }, [resourceKey, versionId, id, setNodes]);

    // 管理 label onchange
    useEffect(() => {
      const currentLabel = getNode(id)?.data?.label as string | undefined;
      if (
        currentLabel !== undefined &&
        currentLabel !== nodeState.nodeLabel &&
        !nodeState.isLocalEdit
      ) {
        setNodeState(prev => ({ ...prev, nodeLabel: currentLabel }));
        if (measureSpanRef.current) {
          measureSpanRef.current.textContent = currentLabel;
        }
      }
    }, [label, id, nodeState.isLocalEdit, nodeState.nodeLabel, getNode]);

    return (
      <div
        ref={componentRef}
        className={`relative w-full h-full min-w-[240px] min-h-[176px] ${
          isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {locked && (
          <div className='absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5'>
            <div className='px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black'>
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
                <rect x='4' y='7' width='8' height='6' rx='1' fill='currentColor' />
              </svg>
              <span>LOCKED</span>
            </div>
          </div>
        )}

        <div id={id} ref={contentRef} className={containerClassName}>
          {/* the top bar of a block */}
          <div
            ref={labelContainerRef}
            className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}
          >
            {/* top-left wrapper */}
            <div
              className='flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group'
              style={{
                maxWidth: calculateMaxLabelContainerWidth(),
              }}
            >
              <div className='min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]'>
                {renderTagLogo()}
              </div>

              {/* measure label width span */}
              <span
                ref={measureSpanRef}
                style={{
                  visibility: 'hidden',
                  position: 'absolute',
                  whiteSpace: 'pre',
                  fontSize: '12px',
                  lineHeight: '18px',
                  fontWeight: '700',
                  fontFamily: 'Plus Jakarta Sans',
                }}
              >
                {nodeState.nodeLabel}
              </span>

              {editable ? (
                <input
                  ref={labelRef}
                  autoFocus={editable}
                  className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate w-full text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]
                `}
                  value={nodeState.nodeLabel}
                  readOnly={!editable}
                  onChange={handleLabelChange}
                  onMouseDownCapture={onFocus}
                  onBlur={onBlur}
                />
              ) : (
                <span
                  className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate w-fit text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]
                `}
                >
                  {nodeState.nodeLabel}
                </span>
              )}
            </div>

            {/* top-right toolbar */}
            <div className='min-w-[24px] min-h-[24px] flex items-center justify-center'>
              <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
            </div>
          </div>

          <div
            className='flex flex-col w-full h-full rounded-[8px]               
        border-dashed border-[1px] border-gray-500
        hover:border-[#9E7E5F] active:border-[#9E7E5F]'
          >
            {/* 文件上传UI组件 */}
            <div
              className={`cursor-pointer h-full w-full px-[8px] py-[8px] mx-auto rounded-[8px] hover:bg-gray-800/40
             transition-all duration-200`}
              onDragOver={e => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.add(
                  'bg-gray-800/20',
                  'border-blue-400'
                );
              }}
              onDragLeave={e => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove(
                  'bg-gray-800/42',
                  'border-blue-400'
                );
              }}
              onDrop={handleFileDrop}
            >
              {/* Loading overlay */}
              {isOnUploading && (
                <div className='absolute inset-0 bg-gray-900/80 backdrop-blur-[2px] rounded-[8px] flex flex-col items-center justify-center z-10'>
                  <div className='relative flex items-center justify-center'>
                    {/* 背景圆环 */}
                    <svg
                      className='w-12 h-12 text-gray-700/50'
                      viewBox='0 0 44 44'
                    >
                      <circle
                        cx='22'
                        cy='22'
                        r='20'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                      />
                    </svg>

                    {/* 动态进度圆环 */}
                    <svg
                      className='absolute w-12 h-12 animate-[spin_2s_linear_infinite] text-[#9E7E5F]'
                      viewBox='0 0 44 44'
                    >
                      <circle
                        cx='22'
                        cy='22'
                        r='20'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeDasharray='16 84'
                      />
                    </svg>

                    {/* 中心上传图标 */}
                    <svg
                      className='absolute w-5 h-5 text-[#9E7E5F]'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={1.5}
                        d='M7 10l5-5 5 5M12 5v10'
                      />
                    </svg>
                  </div>
                  <div className='mt-4 flex flex-col items-center'>
                    <p className='text-[#9E7E5F] font-medium text-[13px]'>
                      Uploading
                    </p>
                    <p className='text-gray-500 text-[11px] mt-1'>
                      Please wait...
                    </p>
                  </div>
                </div>
              )}

              {uploadedFiles.length === 0 ? (
                <div
                  className='text-center py-[8px] flex flex-col items-center justify-center h-full w-full cursor-pointer'
                  onClick={handleEmptyAreaClick}
                >
                  {/* Upload Icon */}
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    className='h-8 w-8 mx-auto text-gray-400 group-hover:text-[#9E7E5F] transition-colors duration-300 mb-3'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                  >
                    {/* 文件轮廓 - 更锋利的角度 */}
                    <path
                      strokeLinecap='square'
                      strokeLinejoin='miter'
                      strokeWidth={1.2}
                      d='M8 3h6l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'
                    />
                    {/* 文件折角 - 更锋利的转角 */}
                    <path
                      strokeLinecap='butt'
                      strokeLinejoin='miter'
                      strokeWidth={1.2}
                      d='M14 3v4h4'
                    />
                    {/* 上传箭头 - 更细的线条 */}
                    <path
                      strokeLinecap='square'
                      strokeLinejoin='miter'
                      strokeWidth={1.2}
                      d='M12 15V10m0 0l-2.5 2.5M12 10l2.5 2.5'
                    />
                  </svg>

                  <p className='text-[12px] text-gray-500'>
                    Drag and drop files here, or
                  </p>
                  <p className='text-[12px] text-gray-500'>Click to upload</p>
                </div>
              ) : (
                <div
                  className='flex flex-col w-full gap-[8px] h-full'
                  onClick={handleUploadAreaClick}
                >
                  {uploadedFiles.map((file: UploadedFile, index: number) => (
                    <div
                      key={index}
                      className='bg-[#3C3B37] min-h-[32px] hover:bg-[#5A574F] text-[#CDCDCD] text-[14px] font-regular rounded-md pl-[12px] flex justify-between items-center'
                    >
                      <div
                        className='flex-1 py-2 cursor-pointer flex items-center'
                        onClick={e => handleFileClick(file, e)}
                      >
                        {/* 添加文件图标 */}
                        <svg
                          className='w-4 h-4 mr-2 text-gray-400 flex-shrink-0'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={1.5}
                            d='M8 3h6l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'
                          />
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={1.5}
                            d='M14 3v4h4'
                          />
                        </svg>

                        {/* 文件名 */}
                        <span className='truncate overflow-hidden text-ellipsis'>
                          {file.fileName?.replace(/^file_/, '') ||
                            file.task_id + '.' + file.fileType ||
                            'Unnamed file'}
                        </span>
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={e => handleFileDelete(file, index, e)}
                        className='text-gray-400 hover:text-red-400 w-[32px] h-[32px] flex items-center justify-center flex-shrink-0'
                      >
                        <svg
                          width='14'
                          height='14'
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
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 添加隐藏的文件输入框 */}
            {ReactDOM.createPortal(
              <input
                type='file'
                ref={inputRef}
                onChange={handleInputChange}
                onClick={e => e.stopPropagation()}
                accept='.json, .pdf, .txt, .docx, .csv, .xlsx, .markdown, .md, .mdx'
                multiple
                className='opacity-0 absolute top-0 left-0 w-full h-full cursor-pointer'
                style={{
                  position: 'fixed',
                  top: '-100%',
                  left: '-100%',
                  zIndex: 9999,
                }}
              />,
              document.body
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
              display: isLoading ? 'none' : 'flex',
            }}
          >
            <div
              style={{
                position: 'absolute',
                visibility: `${
                  activatedNode?.id === id ? 'visible' : 'hidden'
                }`,
                right: '8px',
                bottom: '8px',
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
                className='group active:group-[]:fill-[#BF9A78]'
              >
                <path
                  d='M10 5.99998H12V7.99998H10V5.99998Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
                <path
                  d='M10 2H12V4H10V2Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
                <path
                  d='M6 5.99998H8V7.99998H6V5.99998Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
                <path
                  d='M6 10H8V12H6V10Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
                <path
                  d='M2 10H4V12H2V10Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
                <path
                  d='M10 10H12V12H10V10Z'
                  className='fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]'
                />
              </svg>
            </div>
          </NodeResizeControl>

          {/* Handle components for ReactFlow */}
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

FileNode.displayName = 'FileNode';

export default FileNode;
