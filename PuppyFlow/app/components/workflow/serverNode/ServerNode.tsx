'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React, { useState, useCallback, useMemo } from 'react'
import { UI_COLORS } from '@/app/utils/colors'

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
  const { setNodes } = useReactFlow()

  const onDataSubmit = useCallback(() => {
    console.log('Server node clicked:', id)
    // 這裡可以添加實際的處理邏輯
  }, [id])

  const handleStyle = useMemo(() => ({
    width: '12px',
    height: '12px',
    backgroundColor: '#4B5563',
    border: '1px solid #6B7280',
    borderRadius: '50%',
    zIndex: 50,
    opacity: isHovered ? 1 : 0,
    transition: 'opacity 0.2s ease-in-out',
  }), [isHovered])

  return (
    <div className='relative p-[3px] w-[144px] h-[144px]'>
      {/* 简化的主容器 - 直接用 flex 布局 */}
      <div
        className={`w-full h-full rounded-[16px] border-[1px] bg-[#181818] flex flex-col justify-center items-center gap-4 p-4 font-plus-jakarta-sans transition-all duration-200`}
        style={{
          borderColor: isHovered ? '#444444' : '#333333',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
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
          className={`w-[90px] h-[40px] rounded-[10px] border-[1px] border-[#39BC66] bg-transparent flex items-center justify-center gap-[6px] transition-all duration-200 hover:bg-main-green hover:border-main-green`}
          onClick={onDataSubmit}
          onMouseEnter={() => setIsRunButtonHovered(true)}
          onMouseLeave={() => setIsRunButtonHovered(false)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 7L3 13V1L12 7Z" fill={isRunButtonHovered ? "#000" : "#39BC66"}/>
          </svg>
          
          <span className={`text-[11px] font-[500] transition-colors ${
            isRunButtonHovered ? "text-[#000]" : "text-[#39BC66]"
          }`}>
            Run
          </span>
        </button>
      </div>

      {/* Source handles - 位置调整到外侧 */}
      <Handle
        id={`${id}-source-a`}
        type="source"
        position={Position.Top}
        style={{
          ...handleStyle,
          top: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-b`}
        type="source"
        position={Position.Right}
        style={{
          ...handleStyle,
          right: '-6px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-c`}
        type="source"
        position={Position.Bottom}
        style={{
          ...handleStyle,
          bottom: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-source-d`}
        type="source"
        position={Position.Left}
        style={{
          ...handleStyle,
          left: '-6px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        isConnectable={isConnectable}
      />

      {/* Target handles - 保持透明但位置调整 */}
      <Handle
        id={`${id}-target-a`}
        type="target"
        position={Position.Top}
        className="!w-[16px] !h-[16px] !bg-transparent !border-none"
        style={{
          top: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-b`}
        type="target"
        position={Position.Right}
        className="!w-[16px] !h-[16px] !bg-transparent !border-none"
        style={{
          right: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-c`}
        type="target"
        position={Position.Bottom}
        className="!w-[16px] !h-[16px] !bg-transparent !border-none"
        style={{
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        isConnectable={isConnectable}
      />
      
      <Handle
        id={`${id}-target-d`}
        type="target"
        position={Position.Left}
        className="!w-[16px] !h-[16px] !bg-transparent !border-none"
        style={{
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        isConnectable={isConnectable}
      />
    </div>
  )
}

export default ServerNode