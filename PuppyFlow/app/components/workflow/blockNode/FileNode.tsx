'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React, { useRef, useEffect, useState, useContext } from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from './nodeTopRightBar/NodeTopRightBar'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import ReactDOM from 'react-dom'
import { useFileUpload, UploadedFile } from './hooks/useFileUpload'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'

export type FileNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  fileType?: string,
}

type FileNodeProps = NodeProps<Node<FileNodeData>>

function FileNode({ data: { content, label, isLoading, locked, isInput, isOutput, editable }, type, isConnectable, id }: FileNodeProps) {
  const { activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside } = useNodesPerFlowContext()
  const { getNode, setNodes } = useReactFlow()
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false)
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")

  // 从节点加载初始文件
  const initialFiles = React.useMemo(() => {
    const node = getNode(id);
    return Array.isArray(node?.data?.content) ? node.data.content : [];
  }, [id, getNode]);

  // 文件变更时同步到节点
  const handleFilesChange = React.useCallback((files: UploadedFile[]) => {
    setNodes(nodes => nodes.map(node => 
      node.id === id ? { ...node, data: { ...node.data, content: files } } : node
    ));
  }, [id, setNodes]);

  // 使用分离后的文件上传hook
  const {
    uploadedFiles, 
    isOnUploading, 
    inputRef,
    handleInputChange,
    handleFileDrop,
    handleDelete
  } = useFileUpload({
    nodeId: id,
    initialFiles,
    onFilesChange: handleFilesChange
  });

  // 添加获取连接节点的工具函数
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()

  // 获取连接的节点
  const sourceNodes = getSourceNodeIdWithLabel(id)
  const targetNodes = getTargetNodeIdWithLabel(id)

  // 根据连接节点动态确定 isInput 和 isOutput
  const dynamicIsInput = sourceNodes.length === 0 && targetNodes.length > 0
  const dynamicIsOutput = targetNodes.length === 0 && sourceNodes.length > 0

  // 使用已有属性或动态计算的值
  const effectiveIsInput = isInput || dynamicIsInput
  const effectiveIsOutput = isOutput || dynamicIsOutput

  useEffect(() => {
    if (activatedNode?.id === id) {
      setBorderColor("border-[#BF9A78]");
    } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched, locked, effectiveIsInput, effectiveIsOutput, id])

  // 管理labelContainer的宽度
  useEffect(() => {
    const onLabelContainerBlur = () => {
      if (labelContainerRef.current) {
        setNodeUneditable(id)
      }
    }

    if (labelContainerRef.current) {
      document.addEventListener("click", (e: MouseEvent) => {
        if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
          onLabelContainerBlur()
        }
      })
    }

    return () => {
      if (labelContainerRef.current) {
        document.removeEventListener("click", (e: MouseEvent) => {
          if (!labelContainerRef.current?.contains(e.target as HTMLElement)) {
            onLabelContainerBlur()
          }
        })
      }
    }
  }, [])

  // 自动聚焦，同时需要让cursor focus 到input 的最后一位
  useEffect(() => {
    if (editable && labelRef.current) {
      labelRef.current?.focus();
      const length = labelRef.current.value.length;
      labelRef.current.setSelectionRange(length, length);
    }
  }, [editable, id]);

  // 管理 label onchange， 注意：若是当前的workflow中已经存在同样的id，那么不回重新对于这个node进行initialized，那么此时label就是改变了也不会rendering 最新的值，所以我们必须要通过这个useEffect来确保label的值是最新的，同时需要update measureSpanRef 中需要被测量的内容
  useEffect(() => {
    const currentLabel = getNode(id)?.data?.label as string | undefined
    if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {
      setNodeLabel(currentLabel)
      if (measureSpanRef.current) {
        measureSpanRef.current.textContent = currentLabel
      }
    }
  }, [label, id, isLocalEdit, getNode])

  const onFocus = () => {
    preventInactivateNode()
    const curRef = componentRef.current
    if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag")
    }
  }

  const onBlur = () => {
    allowInactivateNodeWhenClickOutside()
    const curRef = componentRef.current
    if (curRef) {
      curRef.classList.remove("nodrag")
    }
    if (isLocalEdit) {
      editNodeLabel(id, nodeLabel)
      setIsLocalEdit(false)
    }
  }

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M4 6H10L12 8H20V18H4V6Z" className="fill-transparent stroke-[#9E7E5F] group-active:stroke-[#BF9A78]" strokeWidth="1.5" />
        <path d="M8 13.5H16" className="stroke-[#9E7E5F] group-active:stroke-[#BF9A78]" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }

  // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
  const calculateMaxLabelContainerWidth = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 48}px`
    }
    return '100%'
  }

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      <div className="absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5">
        {effectiveIsInput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="16" y="7" width="3" height="12" rx="1" fill="currentColor" />
              <path d="M5 13H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M10 9L14 13L10 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>INPUT</span>
          </div>
        )}

        {effectiveIsOutput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="7" y="7" width="3" height="12" rx="1" fill="currentColor" />
              <path d="M12 13H21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M17 9L21 13L17 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>OUTPUT</span>
          </div>
        )}

        {locked && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="4" y="7" width="8" height="6" rx="1" fill="currentColor" />
            </svg>
            <span>LOCKED</span>
          </div>
        )}
      </div>

      <div id={id} ref={contentRef}
        className={`flex flex-col w-full h-full border-[1.5px] border-solid border-[1.5px] min-w-[240px] min-h-[176px] p-[8px] rounded-[16px] flex justify-start ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden file-block-node`}>

        {/* the top bar of a block */}
        <div ref={labelContainerRef}
          className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}>

          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: calculateMaxLabelContainerWidth(),
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]">
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
              }}>
              {nodeLabel}
            </span>

            {editable ? (
              <input ref={labelRef}
                autoFocus={editable}
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate w-full text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#BF9A78]
                `}
                value={nodeLabel}
                readOnly={!editable}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
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
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[24px] min-h-[24px] flex items-center justify-center">
            <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
          </div>
        </div>

        <div className="flex flex-col w-full h-full rounded-[8px]               
        border-dashed border-[1px] border-gray-500
        hover:border-[#9E7E5F] active:border-[#9E7E5F]">
          
          {/* 文件上传UI组件 */}
          <div
            className={`cursor-pointer h-full w-full px-[8px] py-[8px] mx-auto rounded-[8px] hover:bg-gray-800/40
             transition-all duration-200`}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.add('bg-gray-800/20', 'border-blue-400');
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('bg-gray-800/42', 'border-blue-400');
            }}
            onDrop={handleFileDrop}
          >
            {/* Loading overlay */}
            {isOnUploading && (
                <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-[2px] rounded-[8px] flex flex-col items-center justify-center z-10">
                    <div className="relative flex items-center justify-center">
                        {/* 背景圆环 */}
                        <svg className="w-12 h-12 text-gray-700/50" viewBox="0 0 44 44">
                            <circle 
                                cx="22" 
                                cy="22" 
                                r="20" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2"
                            />
                        </svg>
                        
                        {/* 动态进度圆环 */}
                        <svg className="absolute w-12 h-12 animate-[spin_2s_linear_infinite] text-[#9E7E5F]" viewBox="0 0 44 44">
                            <circle 
                                cx="22" 
                                cy="22" 
                                r="20" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray="16 84"
                            />
                        </svg>
                        
                        {/* 中心上传图标 */}
                        <svg 
                            className="absolute w-5 h-5 text-[#9E7E5F]" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor"
                        >
                            <path 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                                strokeWidth={1.5}
                                d="M7 10l5-5 5 5M12 5v10"
                            />
                        </svg>
                    </div>
                    <div className="mt-4 flex flex-col items-center">
                        <p className="text-[#9E7E5F] font-medium text-[13px]">Uploading</p>
                        <p className="text-gray-500 text-[11px] mt-1">Please wait...</p>
                    </div>
                </div>
            )}

            {uploadedFiles.length === 0 ? (
                <div 
                    className="text-center py-[8px] flex flex-col items-center justify-center h-full w-full cursor-pointer"
                    onClick={() => inputRef.current?.click()}
                >
                    {/* Upload Icon */}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-8 w-8 mx-auto text-gray-400 group-hover:text-[#9E7E5F] transition-colors duration-300 mb-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                    >
                        {/* 文件轮廓 - 更锋利的角度 */}
                        <path
                            strokeLinecap="square"
                            strokeLinejoin="miter"
                            strokeWidth={1.2}
                            d="M8 3h6l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                        />
                        {/* 文件折角 - 更锋利的转角 */}
                        <path
                            strokeLinecap="butt"
                            strokeLinejoin="miter"
                            strokeWidth={1.2}
                            d="M14 3v4h4"
                        />
                        {/* 上传箭头 - 更细的线条 */}
                        <path
                            strokeLinecap="square"
                            strokeLinejoin="miter"
                            strokeWidth={1.2}
                            d="M12 15V10m0 0l-2.5 2.5M12 10l2.5 2.5"
                        />
                    </svg>

                    <p className="text-[12px] text-gray-500">Drag and drop files here, or</p>
                    <p className="text-[12px] text-gray-500">Click to upload</p>
                </div>
            ) : (
                <div 
                    className="flex flex-col w-full gap-[8px] h-full"
                    onClick={(e) => {
                        // 确保只有点击空白区域时触发
                        if (e.currentTarget === e.target) {
                            inputRef.current?.click();
                        }
                    }}
                >
                    {uploadedFiles.map((file: UploadedFile, index: number) => (
                        <div
                            key={index}
                            className="bg-[#3C3B37] min-h-[32px] hover:bg-[#5A574F] text-[#CDCDCD] text-[14px] font-regular rounded-md pl-[12px] flex justify-between items-center"
                        >
                            <div 
                                className="flex-1 py-2 cursor-pointer flex items-center"
                                onClick={(e) => {
                                    e.stopPropagation(); // 防止触发父元素的点击事件
                                    // 检查download_url是否存在
                                    if (file.download_url) {
                                        // 在新窗口中打开下载链接
                                        window.open(file.download_url, '_blank');
                                    }
                                }}
                            >
                                {/* 添加文件图标 */}
                                <svg 
                                    className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor"
                                >
                                    <path 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        strokeWidth={1.5}
                                        d="M8 3h6l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                                    />
                                    <path 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        strokeWidth={1.5}
                                        d="M14 3v4h4"
                                    />
                                </svg>
                                
                                {/* 文件名 */}
                                <span className="truncate overflow-hidden text-ellipsis">
                                    {file.fileName?.replace(/^file_/, '') || file.task_id + '.' + file.fileType || 'Unnamed file'}
                                </span>
                            </div>
                            
                            {/* 删除按钮 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation(); // 防止触发文件的点击事件
                                    handleDelete(file, index);
                                }}
                                className="text-gray-400 hover:text-red-400 w-[32px] h-[32px] flex items-center justify-center flex-shrink-0"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
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
                type="file"
                ref={inputRef}
                onChange={handleInputChange}
                onClick={(e) => e.stopPropagation()}
                accept=".json, .pdf, .txt, .docx, .csv, .xlsx, .markdown, .md, .mdx"
                multiple
                className="opacity-0 absolute top-0 left-0 w-full h-full cursor-pointer"
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
            position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize',
            background: 'transparent',
            border: 'none',
            display: isLoading ? "none" : "flex"
          }}
        >
          <div
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "8px",
              bottom: "8px",
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width: "26px",
              height: "26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#BF9A78]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#9E7E5F] group-hover:fill-[#CDCDCD] group-active:fill-[#BF9A78]" />
            </svg>
          </div>
        </NodeResizeControl>

        {/* Handle components for ReactFlow */}
        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
          isConnectable={isConnectable} position={Position.Top} />
        <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Right} />
        <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable} position={Position.Bottom} />
        <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Left} />
        <Handle
          id={`${id}-a`}
          type="target"
          position={Position.Top}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-b`}
          type="target"
          position={Position.Right}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-c`}
          type="target"
          position={Position.Bottom}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-d`}
          type="target"
          position={Position.Left}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
      </div>
    </div>
  )
}

export default FileNode