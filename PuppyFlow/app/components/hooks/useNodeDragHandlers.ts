'use client'
import { useCallback } from 'react';
import { OnNodeDrag, useReactFlow, type Node } from '@xyflow/react';
import useManageReactFlowUtils from './useManageReactFlowUtils';

// 排序节点，确保组节点在前面渲染
const sortNodes = (a: Node, b: Node): number => {
  if (a.type === b.type) {
    return 0;
  }
  return a.type === 'group' ? -1 : 1;
};

export function useNodeDragHandlers() {
  const { getIntersectingNodes, getNodes, setNodes } = useReactFlow();
  const { judgeNodeIsEdgeNode } = useManageReactFlowUtils();

  // 节点拖拽结束时处理函数
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, node) => {
      // 跳过组节点自身
      if (node.type === 'group') {
        return;
      }

      // 获取与当前节点相交的组节点
      const intersections = getIntersectingNodes(node).filter(
        (n) => n.type === 'group'
      );

      if (intersections.length > 0) {
        let nextNodes: Node[] = getNodes().map((n) => {
          if (n.id === node.id) {
            const currentGroupIds = (n.data as any)?.groupIds || [];
            const newGroupIds = [...new Set([...currentGroupIds, ...intersections.map(g => g.id)])];
            
            return {
              ...n,
              data: {
                ...n.data,
                groupIds: newGroupIds
              }
            } as Node;
          }
          
          // 清除所有组节点的高亮样式
          if (n.type === 'group') {
            return {
              ...n,
              className: '',
            };
          }

          return n;
        });
        
        nextNodes = nextNodes.sort(sortNodes);
        setNodes(nextNodes);
      }
    },
    [getIntersectingNodes, getNodes, setNodes]
  );

  // 节点拖拽过程中处理函数
  const onNodeDrag: OnNodeDrag = useCallback(
    (_, node) => {
      // 跳过组节点自身
      if (node.type === 'group') {
        return;
      }

      // 获取与当前节点相交的组节点
      const intersections = getIntersectingNodes(node).filter(
        (n) => n.type === 'group'
      );
      
      // 检查是否有新的相交组（不在当前 groupIds 中）
      const currentGroupIds = (node.data as any)?.groupIds || [];
      const hasNewIntersection = intersections.some(g => !currentGroupIds.includes(g.id));
      
      setNodes((nds) => {
        return nds.map((n) => {
          if (n.type === 'group') {
            // 高亮新相交的组节点
            const isNewIntersecting = intersections.some(i => i.id === n.id) && 
                                    !currentGroupIds.includes(n.id);
            return {
              ...n,
              style: {
                ...n.style,
                borderColor: isNewIntersecting && hasNewIntersection ? '#9B7EDB' : '#555555',
                borderWidth: isNewIntersecting && hasNewIntersection ? '3px' : '2.5px',
              },
            };
          }
          return n;
        });
      });
    },
    [getIntersectingNodes, setNodes]
  );

  return {
    onNodeDragStop,
    onNodeDrag,
  };
}

// 从组节点中分离节点的功能
export function useDetachNodes() {
  const { setNodes, getNodes } = useReactFlow();

  const detachNodes = useCallback(
    (ids: string[]) => {
      setNodes(
        getNodes().map((n) => {
          if (ids.includes(n.id)) {
            const groupIds = (n.data as any)?.groupIds;
            if (Array.isArray(groupIds) && groupIds.length > 0) {
              return {
                ...n,
                data: {
                  ...n.data,
                  groupIds: [] // 清空所有组关联
                }
              };
            }
          }
          return n;
        })
      );
    },
    [setNodes, getNodes]
  );

  // 新增：从特定组中分离节点
  const detachNodesFromGroup = useCallback(
    (nodeIds: string[], groupId: string) => {
      setNodes(
        getNodes().map((n) => {
          if (nodeIds.includes(n.id)) {
            const groupIds = (n.data as any)?.groupIds || [];
            if (Array.isArray(groupIds) && groupIds.includes(groupId)) {
              return {
                ...n,
                data: {
                  ...n.data,
                  groupIds: groupIds.filter((gid: string) => gid !== groupId)
                }
              };
            }
          }
          return n;
        })
      );
    },
    [setNodes, getNodes]
  );

  return { detachNodes, detachNodesFromGroup };
} 