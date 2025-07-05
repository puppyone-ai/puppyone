'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React, { useState, useCallback, useEffect } from 'react'
import { UI_COLORS } from '@/app/utils/colors'

export type ServerTextBlockNodeData = {
  content: string,
  label: string,
  isHovered?: boolean,
}

type ServerTextBlockNodeProps = NodeProps<Node<ServerTextBlockNodeData>>

function ServerNode({ isConnectable, id, data: { content, label } }: ServerTextBlockNodeProps) {
  const [nodeLabel] = useState(label ?? id)
  const [isHovered, setIsHovered] = useState(false)
  const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
  const { setNodes } = useReactFlow()

  const onDataSubmit = useCallback(() => {
    console.log('Server node clicked:', id)
    // 這裡可以添加實際的處理邏輯
  }, [id])

  // 當 hover 狀態改變時，更新 node data
  useEffect(() => {
    setNodes((nodes) => 
      nodes.map((node) => 
        node.id === id 
          ? { ...node, data: { ...node.data, isHovered } }
          : node
      )
    )
  }, [isHovered, id, setNodes])

  // 默認隱藏的 handle 樣式
  const handleStyle = {
    width: '12px',
    height: '12px',
    backgroundColor: '#4B5563',
    border: '1px solid #6B7280',
    borderRadius: '50%',
    zIndex: 50,
    opacity: 0,  // 默認完全透明
    transition: 'opacity 0.2s ease-in-out',
  }

  return (
    <div className='relative p-[3px] w-[160px] h-[120px]'>
      {/* Main server node */}
      <div
        className="w-full h-full"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className={`w-full h-full rounded-[16px] border-[1px] bg-[#181818] flex flex-col font-plus-jakarta-sans transition-all duration-200 relative overflow-visible`}
          style={{
            borderColor: isHovered ? '#444444' : '#333333',
          }}
        >
          {/* Label at top */}
          <div 
            className="text-[10px] font-[400] text-center px-3 pt-3 transition-colors duration-200 opacity-60"
            style={{
              color: isHovered ? '#9CA3AF' : '#6B7280',
              letterSpacing: '0.3px',
            }}
          >
            {nodeLabel}
          </div>

          {/* 調整空間讓 Run 按鈕稍微往上 */}
          <div className="flex-1 flex items-center justify-center pb-2">
            {/* Run button in center - 調小寬度 */}
            <button
              className={`w-[90px] h-[40px] rounded-[10px] border-[1px] border-[#39BC66] bg-[rgba(217,217,217, 0)] flex flex-row items-center justify-center gap-[6px] transition-all duration-200 hover:bg-main-green hover:border-main-green`}
              onClick={onDataSubmit}
              onMouseEnter={() => setIsRunButtonHovered(true)}
              onMouseLeave={() => setIsRunButtonHovered(false)}
            >
              {/* 播放圖標 - 調整尺寸適配風格 */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="transition-[fill]">
                <path className="transition-[fill]" d="M12 7L3 13V1L12 7Z" fill={isRunButtonHovered ? "#000" : "#39BC66"}/>
              </svg>
              
              <div className={`text-[11px] font-[500] leading-normal transition-colors ${
                isRunButtonHovered ? "text-[#000]" : "text-[#39BC66]"
              }`}>
                Run
              </div>
            </button>
          </div>
        </div>

        {/* Source handles - 默認隱藏，hover 時顯示 */}
        <Handle
          id={`${id}-a`}
          type="source"
          position={Position.Top}
          style={handleStyle}
          isConnectable={isConnectable}
          className="hover:!opacity-100"
        />
        
        <Handle
          id={`${id}-b`}
          type="source"
          position={Position.Right}
          style={handleStyle}
          isConnectable={isConnectable}
          className="hover:!opacity-100"
        />
        
        <Handle
          id={`${id}-c`}
          type="source"
          position={Position.Bottom}
          style={handleStyle}
          isConnectable={isConnectable}
          className="hover:!opacity-100"
        />
        
        <Handle
          id={`${id}-d`}
          type="source"
          position={Position.Left}
          style={handleStyle}
          isConnectable={isConnectable}
          className="hover:!opacity-100"
        />

        {/* Target handles (透明，用於接收連接) */}
        <Handle
          id={`${id}-a`}
          type="target"
          position={Position.Top}
          className="!w-[16px] !h-[16px] !bg-transparent !border-none"
          isConnectable={isConnectable}
        />
        
        <Handle
          id={`${id}-b`}
          type="target"
          position={Position.Right}
          className="!w-[16px] !h-[16px] !bg-transparent !border-none"
          isConnectable={isConnectable}
        />
        
        <Handle
          id={`${id}-c`}
          type="target"
          position={Position.Bottom}
          className="!w-[16px] !h-[16px] !bg-transparent !border-none"
          isConnectable={isConnectable}
        />
        
        <Handle
          id={`${id}-d`}
          type="target"
          position={Position.Left}
          className="!w-[16px] !h-[16px] !bg-transparent !border-none"
          isConnectable={isConnectable}
        />
      </div>
    </div>
  )
}

export default ServerNode