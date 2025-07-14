'use client'
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { NodeProps, Handle, Position, Node, NodeResizeControl, NodeToolbar, useReactFlow } from '@xyflow/react';
import { useDetachNodes } from '../../hooks/useNodeDragHandlers';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { useRunGroupNodeLogic } from '../edgesNode/edgeNodesNew/hook/useRunGroupNodeLogic';

export type GroupNodeData = {
  label: string;
  backgroundColor?: string;
  [key: string]: unknown;
}

type GroupNodeProps = NodeProps<Node<GroupNodeData>>

// Notion风格的暗色系颜色配置
const BACKGROUND_COLORS = [
  { name: 'Default', value: 'transparent', preview: '#2A2B2D' },
  { name: 'Gray', value: 'rgba(55, 53, 47, 0.12)', preview: '#37352F' },
  { name: 'Brown', value: 'rgba(68, 42, 30, 0.12)', preview: '#442A1E' },
  { name: 'Red', value: 'rgba(93, 23, 21, 0.12)', preview: '#5D1715' },
  { name: 'Orange', value: 'rgba(73, 41, 14, 0.12)', preview: '#49290E' },
  { name: 'Green', value: 'rgba(28, 56, 41, 0.12)', preview: '#1C3829' },
  { name: 'Blue', value: 'rgba(24, 51, 71, 0.12)', preview: '#183347' },
  { name: 'Purple', value: 'rgba(60, 45, 73, 0.12)', preview: '#3C2D49' },
  { name: 'Pink', value: 'rgba(69, 39, 60, 0.12)', preview: '#45273C' },
];

function GroupNode({ data, id }: GroupNodeProps) {
  const componentRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { getNodes, deleteElements, setNodes, getNode, getEdges, setEdges } = useReactFlow();
  const { detachNodes, detachNodesFromGroup } = useDetachNodes();
  const { activatedNode } = useNodesPerFlowContext();
  const [isHovered, setIsHovered] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // 使用新的GroupNode运行逻辑
  const { isLoading, handleDataSubmit } = useRunGroupNodeLogic({
    groupNodeId: id
  });

  // 获取此组内的所有子节点
  const childNodes = getNodes().filter(node => {
    const groupIds = (node.data as any)?.groupIds;
    return Array.isArray(groupIds) && groupIds.includes(id);
  });

  // 检查当前节点是否被激活
  const isActivated = activatedNode?.id === id;

  // 获取当前背景颜色
  const currentBackgroundColor = data.backgroundColor || 'transparent';

  // 更新节点背景颜色
  const updateBackgroundColor = useCallback((color: string) => {
    setNodes(nodes => nodes.map(node => 
      node.id === id 
        ? { ...node, data: { ...node.data, backgroundColor: color } }
        : node
    ));
    setShowColorPicker(false);
  }, [id, setNodes]);

  // 计算边框颜色
  const getBorderColor = () => {
    if (isLoading) {
      return '#39BC66'; // 运行时绿色
    } else if (isActivated) {
      return '#888888'; // 激活时
    } else if (isHovered) {
      return '#888888'; // hover时灰色
    } else {
      return '#666666'; // 默认颜色
    }
  };

  // 计算边框宽度
  const getBorderWidth = () => {
    if (isLoading) {
      return '3px'; // 运行时固定为3px
    } else if (isActivated) {
      return '2px';
    } else if (isHovered) {
      return '2px';
    } else {
      return '1px';
    }
  };

  // 检查节点是否在组的范围内
  const isNodeInsideGroup = useCallback((node: Node, groupNode: Node) => {
    const nodeWidth = node.width || 200; // 默认节点宽度
    const nodeHeight = node.height || 100; // 默认节点高度
    const groupWidth = groupNode.width || 240;
    const groupHeight = groupNode.height || 176;

    // 节点中心点
    const nodeCenterX = node.position.x + nodeWidth / 2;
    const nodeCenterY = node.position.y + nodeHeight / 2;

    // 组的边界
    const groupLeft = groupNode.position.x;
    const groupRight = groupNode.position.x + groupWidth;
    const groupTop = groupNode.position.y;
    const groupBottom = groupNode.position.y + groupHeight;

    // 检查节点中心点是否在组内
    return (
      nodeCenterX >= groupLeft &&
      nodeCenterX <= groupRight &&
      nodeCenterY >= groupTop &&
      nodeCenterY <= groupBottom
    );
  }, []);

  // 重新计算组内的节点
  const recalculateGroupNodes = useCallback(() => {
    const currentGroupNode = getNode(id);
    if (!currentGroupNode) return;

    const allNodes = getNodes();
    let hasChanges = false;
    
    const updatedNodes = allNodes.map(node => {
      if (node.type === 'group' || node.id === id) {
        return node;
      }

      const shouldBeInGroup = isNodeInsideGroup(node, currentGroupNode);
      const groupIds = (node.data as any)?.groupIds || [];
      const currentlyInGroup = groupIds.includes(id);

      if (shouldBeInGroup && !currentlyInGroup) {
        // 节点应该在组内但目前不在 - 添加到 groupIds 数组
        hasChanges = true;
        return {
          ...node,
          data: {
            ...node.data,
            groupIds: [...groupIds, id]
          }
        };
      } else if (!shouldBeInGroup && currentlyInGroup) {
        // 节点不应该在组内但目前在 - 从 groupIds 数组中移除
        hasChanges = true;
        return {
          ...node,
          data: {
            ...node.data,
            groupIds: groupIds.filter((gid: string) => gid !== id)
          }
        };
      }

      return node;
    });

    if (hasChanges) {
      setNodes(updatedNodes);
      console.log(`🔄 Recalculated nodes for group ${id}`);
    }
  }, [id, getNode, getNodes, setNodes, isNodeInsideGroup]);

  // 处理组点击事件
  const handleGroupClick = useCallback((e: React.MouseEvent) => {
    // 只有直接点击组容器时才触发重新计算
    if (e.target === e.currentTarget) {
      recalculateGroupNodes();
    }
  }, [recalculateGroupNodes]);

  // 处理调整大小结束事件
  const handleResizeEnd = useCallback(() => {
    // 延迟一点执行，确保 ReactFlow 已经更新了节点的尺寸
    setTimeout(() => {
      recalculateGroupNodes();
    }, 100);
  }, [recalculateGroupNodes]);

  // 删除组节点及其所有子节点
  const onDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);

  // 分离组内所有子节点（从所有组中完全分离）
  const onDetachAll = useCallback(() => {
    const childIds = childNodes.map(node => node.id);
    detachNodes(childIds);
  }, [detachNodes, childNodes]);

  // 仅从当前组分离（保留其他组关联）
  const onDetachFromThisGroup = useCallback(() => {
    const childIds = childNodes.map(node => node.id);
    detachNodesFromGroup(childIds, id);
  }, [detachNodesFromGroup, childNodes, id]);

  // 运行组的逻辑
  const onRunGroup = useCallback(async () => {
    console.log('Running group:', id);
    await handleDataSubmit();
  }, [id, handleDataSubmit]);

  // 获取当前颜色的显示名称
  const getCurrentColorName = () => {
    const currentColor = BACKGROUND_COLORS.find(color => color.value === currentBackgroundColor);
    return currentColor?.name || 'Custom';
  };

  return (
    <div
      ref={componentRef}
      className="relative w-full h-full  min-w-[240px] min-h-[176px] cursor-default"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 添加呼吸动画的样式 */}
      <style jsx>{`
        @keyframes groupBreathe {
          0% {
            border-color: rgba(57, 188, 102, 0.2);
          }
          50% {
            border-color: rgba(57, 188, 102, 1);
          }
          100% {
            border-color: rgba(57, 188, 102, 0.2);
          }
        }
        
        .group-breathing {
          animation: groupBreathe 2s ease-in-out infinite;
          border-width: 3px !important;
        }
      `}</style>

      {/* NodeToolbar 必须在节点内部，使用 isVisible 控制显示 */}
      <NodeToolbar 
        isVisible={isActivated || isHovered}
        position={Position.Top} 
        offset={10} 
        className="nodrag"
      >
        <div className="flex items-center gap-3">
          {/* 按钮组 */}
          <div className="flex gap-2 bg-[#181818] border border-[#333333] rounded-md p-1.5 shadow-lg">
            <button
              onClick={onRunGroup}
              disabled={isLoading}
              className={`px-2 py-1 text-xs bg-[#2A2B2D] hover:bg-[#39BC66] text-white rounded flex items-center gap-1.5 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
            >
              {isLoading ? (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5V19L19 12L8 5Z" fill="currentColor" />
                </svg>
              )}
              {isLoading ? 'Running...' : 'Run'}
            </button>
            
            {/* 分隔符 */}
            <div className="w-px h-6 bg-[#555555]"></div>
            
            {/* 颜色选择器按钮 */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="px-2 py-1 h-6 text-xs bg-[#2A2B2D] hover:bg-[#3A3B3D] text-white rounded flex items-center gap-1.5 transition-colors"
                title={`Background: ${getCurrentColorName()}`}
              >
                <div 
                  className="w-3 h-3 rounded border border-[#555555]"
                  style={{ backgroundColor: currentBackgroundColor === 'transparent' ? '#2A2B2D' : currentBackgroundColor }}
                ></div>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* 颜色选择器面板 */}
              {showColorPicker && (
                <div className="absolute top-full left-0 mt-1 bg-[#181818] border border-[#333333] rounded-md p-2 shadow-lg z-50 min-w-[180px]">
                  <div className="grid grid-cols-5 gap-1.5">
                    {BACKGROUND_COLORS.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => updateBackgroundColor(color.value)}
                        className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                          currentBackgroundColor === color.value 
                            ? 'border-[#60A5FA] ring-1 ring-[#60A5FA] ring-opacity-50' 
                            : 'border-[#444444] hover:border-[#666666]'
                        }`}
                        style={{ 
                          backgroundColor: color.value === 'transparent' ? '#2A2B2D' : color.preview 
                        }}
                        title={color.name}
                      >
                        {color.value === 'transparent' && (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-3 h-0.5 bg-[#888888] rotate-45"></div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={onDetachAll}
              className="px-2 py-1 text-xs bg-[#2A2B2D] hover:bg-[#3A3B3D] text-white rounded flex items-center justify-center transition-colors"
              style={{ display: childNodes.length ? 'flex' : 'none' }}
              title="Detach All"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 14L4 9L9 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 20V13C20 11.9391 19.5786 10.9217 18.8284 10.1716C18.0783 9.42143 17.0609 9 16 9H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs bg-[#2A2B2D] hover:bg-[#E53E3E] text-white rounded flex items-center justify-center transition-colors"
              title="Delete"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z" stroke="currentColor" fill="none" strokeWidth="2" />
                <path d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" stroke="currentColor" fill="none" strokeWidth="2" />
              </svg>
            </button>
          </div>

          {/* Group 标签 - 移到工具栏框外面右侧 */}
          <div className="flex items-center gap-2">
            <span className="font-[600] text-[11px] leading-[16px] font-plus-jakarta-sans text-[#6D7177]">
              {`Group ${data.label}`}
            </span>
            {/* 子节点数量指示器 */}
            {childNodes.length > 0 && (
              <div className="text-[9px] text-[#6D7177] bg-[#2A2B2D] px-1.5 py-0.5 rounded">
                {childNodes.length} {childNodes.length === 1 ? 'node' : 'nodes'}
              </div>
            )}
          </div>
        </div>
      </NodeToolbar>

      <div
        ref={contentRef}
        id={id}
        className={`w-full h-full min-w-[240px] min-h-[176px] rounded-[24px] overflow-hidden nodrag transition-colors ${
          isLoading ? 'group-breathing' : ''
        }`}
        style={{
          borderRadius: '16px',
          borderWidth: getBorderWidth(),
          borderStyle: 'solid',
          backgroundColor: currentBackgroundColor,
          borderColor: getBorderColor(),
        }}
        onClick={handleGroupClick}
      >
        {/* 子节点指示 - 在空白时显示提示 */}
        {childNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[#6D7177] text-sm opacity-50 nodrag">
            Drag nodes here
          </div>
        )}

        {/* 调整手柄在节点被激活或hover时显示 */}
        {(isActivated || isHovered) && (
          <>
            {/* 右侧中间调整手柄 */}
            <NodeResizeControl
              position="right"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                right: "0px",
                top: "50%",
                transform: "translateY(-50%)",
                cursor: 'e-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "12px",
                  height: "32px",
                }}
              >
                <div className="w-1 h-6 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 底部中间调整手柄 */}
            <NodeResizeControl
              position="bottom"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                bottom: "0px",
                left: "50%",
                transform: "translateX(-50%)",
                cursor: 's-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "32px",
                  height: "12px",
                }}
              >
                <div className="w-6 h-1 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 左侧中间调整手柄 */}
            <NodeResizeControl
              position="left"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                left: "0px",
                top: "50%",
                transform: "translateY(-50%)",
                cursor: 'w-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "12px",
                  height: "32px",
                }}
              >
                <div className="w-1 h-6 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 顶部中间调整手柄 */}
            <NodeResizeControl
              position="top"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                top: "0px",
                left: "50%",
                transform: "translateX(-50%)",
                cursor: 'n-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "32px",
                  height: "12px",
                }}
              >
                <div className="w-6 h-1 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 角落调整手柄 */}
            {/* 右下角调整手柄 */}
            <NodeResizeControl
              position="bottom-right"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                right: "0px",
                bottom: "0px",
                cursor: 'se-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "8px",
                  bottom: "8px",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "16px",
                  height: "16px",
                }}
              >
                <div className="w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 左下角调整手柄 */}
            <NodeResizeControl
              position="bottom-left"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                left: "0px",
                bottom: "0px",
                cursor: 'sw-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "8px",
                  bottom: "8px",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "16px",
                  height: "16px",
                }}
              >
                <div className="w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 右上角调整手柄 */}
            <NodeResizeControl
              position="top-right"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                right: "0px",
                top: "0px",
                cursor: 'ne-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "8px",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "16px",
                  height: "16px",
                }}
              >
                <div className="w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>

            {/* 左上角调整手柄 */}
            <NodeResizeControl
              position="top-left"
              minWidth={240}
              minHeight={176}
              onResizeEnd={handleResizeEnd}
              style={{
                position: 'absolute',
                left: "0px",
                top: "0px",
                cursor: 'nw-resize',
                background: 'transparent',
                border: 'none'
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "8px",
                  top: "8px",
                  display: "flex",
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  zIndex: "200000",
                  width: "16px",
                  height: "16px",
                }}
              >
                <div className="w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-colors"></div>
              </div>
            </NodeResizeControl>
          </>
        )}
      </div>
    </div>
  );
}

export default GroupNode;
