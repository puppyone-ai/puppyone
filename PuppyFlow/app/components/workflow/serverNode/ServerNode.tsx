'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React, { useState, useCallback, useMemo } from 'react'
import { UI_COLORS } from '@/app/utils/colors'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { useRunServerNodeLogic } from '../edgesNode/edgeNodesNew/hook/useRunServerNodeLogic'

export type ServerNodeData = {
  content: string,
  label: string,
  isHovered?: boolean,
}

type ServerNodeProps = NodeProps<Node<ServerNodeData>>

function ServerNode({ isConnectable, id, data: { content, label } }: ServerNodeProps) {
  const [nodeLabel] = useState(label ?? id)
  const [isHovered, setIsHovered] = useState(false)
  const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
  const { setNodes, getNode } = useReactFlow()
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()

  // 使用新的ServerNode运行逻辑
  const { isLoading, handleDataSubmit } = useRunServerNodeLogic({
    serverNodeId: id
  })

  // Get connected nodes
  const sourceNodes = getSourceNodeIdWithLabel(id)
  const targetNodes = getTargetNodeIdWithLabel(id)

  // 修改onDataSubmit来使用新的逻辑
  const onDataSubmit = useCallback(async () => {
    console.log('Server node clicked:', id)
    await handleDataSubmit()
  }, [id, handleDataSubmit])

  // Target handle样式 - 覆盖整个节点区域
  const targetHandleStyle = useMemo(() => ({
    position: "absolute" as const,
    width: "calc(100%)",
    height: "calc(100%)",
    top: "0",
    left: "0",
    borderRadius: "0",
    transform: "translate(0px, 0px)",
    background: "transparent",
    border: "3px solid transparent",
    zIndex: -1,
  }), [])

  const displayConnectedNodes = () => {
    if (sourceNodes.length === 0 && targetNodes.length === 0) return null;

    return (
      <div className="absolute left-0 -bottom-[2px] transform translate-y-full w-full flex flex-col gap-2 z-10">
        {/* Source Nodes */}
        {sourceNodes.length > 0 && (
          <div className="w-full bg-transparent rounded-lg p-1.5 shadow-lg overflow-visible">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Source
            </div>
            <div className="flex flex-wrap gap-1.5 overflow-visible">
              {sourceNodes.map(node => {
                const nodeInfo = getNode(node.id)
                const nodeType = nodeInfo?.type || 'unknown'
                return (
                  <button
                    key={`${node.id}-${id}-source`}
                    onClick={() => {
                      navigator.clipboard.writeText(`{{${node.label}}}`);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                             text-gray-300 hover:bg-[#252525] hover:text-white transition-colors whitespace-nowrap"
                  >
                    <span className="text-[10px] opacity-60">{nodeType}</span>
                    <span className="whitespace-nowrap">{node.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Target Nodes */}
        {targetNodes.length > 0 && (
          <div className="w-full bg-transparent rounded-lg p-1.5 shadow-lg overflow-visible">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Target
            </div>
            <div className="flex flex-wrap gap-1.5 overflow-visible">
              {targetNodes.map(node => {
                const nodeInfo = getNode(node.id)
                const nodeType = nodeInfo?.type || 'unknown'
                return (
                  <button
                    key={`${node.id}-${id}-target`}
                    onClick={() => {
                      navigator.clipboard.writeText(`{{${node.label}}}`);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                             text-gray-300 hover:bg-[#252525] hover:text-white transition-colors whitespace-nowrap"
                  >
                    <span className="text-[10px] opacity-60">{nodeType}</span>
                    <span className="whitespace-nowrap">{node.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div 
      className='relative p-[3px] w-[144px] h-[144px]'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 简化的主容器 - 直接用 flex 布局 */}
      <div
        className={`w-full h-full rounded-[16px] border-[2px] bg-[#181818] flex flex-col justify-center items-center gap-4 p-4 font-plus-jakarta-sans transition-all duration-200`}
        style={{
          borderColor: isHovered ? 'rgba(107, 114, 128, 0.8)' : 'rgba(107, 114, 128, 0.6)',
          borderStyle: 'dashed',
        }}
      >
        {/* Label - 顶部 */}
        <div 
          className="text-[10px] font-[400] text-center opacity-60 transition-colors duration-200"
          style={{
            color: isHovered ? '#9CA3AF' : '#6B7280',
            letterSpacing: '0.3px',
          }}
        >
          {nodeLabel}
        </div>

        {/* Run button - 中间 */}
        <button
          className={`w-[90px] h-[40px] rounded-[10px] border-[1px] border-[#39BC66] bg-transparent flex items-center justify-center gap-[6px] transition-all duration-200 hover:bg-main-green hover:border-main-green ${
            isLoading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          onClick={onDataSubmit}
          onMouseEnter={() => setIsRunButtonHovered(true)}
          onMouseLeave={() => setIsRunButtonHovered(false)}
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-[#39BC66] border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 7L3 13V1L12 7Z" fill={isRunButtonHovered ? "#000" : "#39BC66"}/>
            </svg>
          )}
          
          <span className={`text-[11px] font-[500] transition-colors ${
            isRunButtonHovered ? "text-[#000]" : "text-[#39BC66]"
          }`}>
            {isLoading ? "Running..." : "Run"}
          </span>
        </button>
      </div>

      {/* Source handles - 使用 edgeSrcHandle 类放在节点外部，根据节点hover状态控制显示 */}
      <Handle
        id={`${id}-source-a`}
        type="source"
        position={Position.Top}
        className="edgeSrcHandle handle-with-icon handle-top"
        style={{
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out',
          width: '12px',
          height: '12px',
          backgroundColor: 'transparent',
          border: '1px solid #6B7280',
          borderRadius: '50%',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-b`}
        type="source"
        position={Position.Right}
        className="edgeSrcHandle handle-with-icon handle-right"
        style={{
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out',
          width: '12px',
          height: '12px',
          backgroundColor: 'transparent',
          border: '1px solid #6B7280',
          borderRadius: '50%',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-c`}
        type="source"
        position={Position.Bottom}
        className="edgeSrcHandle handle-with-icon handle-bottom"
        style={{
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out',
          width: '12px',
          height: '12px',
          backgroundColor: 'transparent',
          border: '1px solid #6B7280',
          borderRadius: '50%',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-d`}
        type="source"
        position={Position.Left}
        className="edgeSrcHandle handle-with-icon handle-left"
        style={{
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out',
          width: '12px',
          height: '12px',
          backgroundColor: 'transparent',
          border: '1px solid #6B7280',
          borderRadius: '50%',
        }}
        isConnectable={isConnectable}
      />

      {/* Target handles - 覆盖整个节点区域 */}
      <Handle
        id={`${id}-target-a`}
        type="target"
        position={Position.Top}
        style={targetHandleStyle}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-b`}
        type="target"
        position={Position.Right}
        style={targetHandleStyle}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-c`}
        type="target"
        position={Position.Bottom}
        style={targetHandleStyle}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-d`}
        type="target"
        position={Position.Left}
        style={targetHandleStyle}
        isConnectable={isConnectable}
      />

      {/* 连接节点显示 */}
      {isHovered && displayConnectedNodes()}
    </div>
  )
}

export default ServerNode