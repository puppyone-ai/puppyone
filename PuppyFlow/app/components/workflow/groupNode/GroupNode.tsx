'use client'
import React, { useRef, useCallback } from 'react';
import { NodeProps, Handle, Position, Node, NodeResizeControl, NodeToolbar, useReactFlow } from '@xyflow/react';
import { useDetachNodes } from '../../hooks/useNodeDragHandlers';

export type GroupNodeData = {
  label: string;
  [key: string]: unknown;
}

type GroupNodeProps = NodeProps<Node<GroupNodeData>>

function GroupNode({ data, id }: GroupNodeProps) {
  const componentRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { getNodes, deleteElements } = useReactFlow();
  const detachNodes = useDetachNodes();
  
  // 获取此组内的所有子节点
  const childNodes = getNodes().filter(node => node.parentId === id);
  
  // 删除组节点及其所有子节点
  const onDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);
  
  // 分离组内所有子节点
  const onDetachAll = useCallback(() => {
    const childIds = childNodes.map(node => node.id);
    detachNodes(childIds);
  }, [detachNodes, childNodes]);
  
  return (
    <div ref={componentRef} className="relative w-full h-full min-w-[240px] min-h-[176px] cursor-default">
      {/* 工具栏始终显示 */}
      <NodeToolbar position={Position.Top} offset={10} className="nodrag">
        <div className="flex gap-2 bg-[#181818] border border-[#333333] rounded-md p-1.5 shadow-lg">
          <button 
            onClick={onDetachAll}
            className="px-2 py-1 text-xs bg-[#2A2B2D] hover:bg-[#3A3B3D] text-white rounded flex items-center gap-1.5 transition-colors"
            style={{ display: childNodes.length ? 'flex' : 'none' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 14L4 9L9 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 20V13C20 11.9391 19.5786 10.9217 18.8284 10.1716C18.0783 9.42143 17.0609 9 16 9H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Detach All
          </button>
          <button 
            onClick={onDelete}
            className="px-2 py-1 text-xs bg-[#2A2B2D] hover:bg-[#E53E3E] text-white rounded flex items-center gap-1.5 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z" stroke="currentColor" fill="none" strokeWidth="2"/>
              <path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" stroke="currentColor" fill="none" strokeWidth="2"/>
            </svg>
            Delete
          </button>
        </div>
      </NodeToolbar>
      
      <div 
        ref={contentRef} 
        id={id}
        className="w-full h-full min-w-[240px] min-h-[176px] border-[2.5px] border-dashed rounded-[24px] overflow-hidden"
        style={{ 
          borderRadius: '24px', 
          borderWidth: '2.5px', 
          borderStyle: 'dashed',
          backgroundColor: 'rgba(37, 37, 37, 0.2)',  // 深灰色半透明背景            // 轻微模糊效果
          borderColor: '#555555',
          boxShadow: 'inset 0 0 30px rgba(0, 0, 0, 0.15)'  // 内阴影增加深度感
        }}
      >
        {/* 顶部标签栏 - 始终显示 */}
        <div className="h-[24px] w-full pt-[8px] px-[12px] flex items-center justify-between">
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group">
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-white">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4C2 2.89543 2.89543 2 4 2V2V4H2V4Z" fill="#6D7177"/>
                <rect x="7" y="2" width="2" height="2" fill="#6D7177"/>
                <path d="M12 2V2C13.1046 2 14 2.89543 14 4V4H12V2Z" fill="#6D7177"/>
                <path d="M12 7H14V9H12V7Z" fill="#6D7177"/>
                <path d="M12 12H14V12C14 13.1046 13.1046 14 12 14V14V12Z" fill="#6D7177"/>
                <rect x="7" y="12" width="2" height="2" fill="#6D7177"/>
                <path d="M2 12H4V14V14C2.89543 14 2 13.1046 2 12V12Z" fill="#6D7177"/>
                <rect x="2" y="7" width="2" height="2" fill="#6D7177"/>
              </svg>
            </div>
            <span className="font-[600] text-[12px] leading-[18px] font-plus-jakarta-sans text-[#6D7177] group-hover:text-[#CDCDCD]">
              {`Group ${data.label}`}
            </span>
          </div>
          
          {/* 子节点数量指示器 */}
          {childNodes.length > 0 && (
            <div className="text-[10px] text-[#6D7177]">
              {childNodes.length} {childNodes.length === 1 ? 'node' : 'nodes'}
            </div>
          )}
        </div>
        
        {/* 子节点指示 - 在空白时显示提示 */}
        {childNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[#6D7177] text-sm opacity-50">
            Drag nodes here
          </div>
        )}
      </div>

      <NodeResizeControl
        minWidth={240}
        minHeight={176}
        style={{
          position: 'absolute', 
          right: "0px", 
          bottom: "0px", 
          cursor: 'se-resize',
          background: 'transparent',
          border: 'none',
        }}
      >
        <div
          style={{
            position: "absolute",
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
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#9B7EDB]">
            <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
          </svg>
        </div>
      </NodeResizeControl>
    </div>
  );
}

export default GroupNode;
