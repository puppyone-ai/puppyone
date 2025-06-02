'use client'
import { useCallback } from 'react';
import { OnNodeDrag, useReactFlow, type Node } from '@xyflow/react';
import useManageReactFlowUtils from './useManageReactFlowUtils';

// 获取节点在父节点内的相对位置
const getNodePositionInsideParent = (node: Partial<Node>, groupNode: Node) => {
  const position = node.position ?? { x: 0, y: 0 };
  const nodeWidth = node.width ?? 0;
  const nodeHeight = node.height ?? 0;
  const groupWidth = groupNode.width ?? 0;
  const groupHeight = groupNode.height ?? 0;

  if (position.x < groupNode.position.x) {
    position.x = 0;
  } else if (position.x + nodeWidth > groupNode.position.x + groupWidth) {
    position.x = groupWidth - nodeWidth;
  } else {
    position.x = position.x - groupNode.position.x;
  }

  if (position.y < groupNode.position.y) {
    position.y = 0;
  } else if (position.y + nodeHeight > groupNode.position.y + groupHeight) {
    position.y = groupHeight - nodeHeight;
  } else {
    position.y = position.y - groupNode.position.y;
  }

  return position;
};

// 排序节点，确保父节点在子节点之前渲染
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
      // 跳过组节点自身和已经有父节点的节点
      if (node.type === 'group' || node.parentId) {
        return;
      }

      // 获取与当前节点相交的组节点
      const intersections = getIntersectingNodes(node).filter(
        (n) => n.type === 'group'
      );
      const groupNode = intersections[0];

      // 当有相交并且节点还没有设置父节点时，将节点附加到新的父节点
      if (intersections.length && node.parentId !== groupNode?.id) {
        let nextNodes: Node[] = getNodes()
          .map((n) => {
            if (n.id === groupNode.id) {
              return {
                ...n,
                className: '',  // 清除高亮样式
              };
            } else if (n.id === node.id) {
              // 计算节点在父节点内的相对位置
              const position = getNodePositionInsideParent(n, groupNode) ?? {
                x: 0,
                y: 0,
              };

              return {
                ...n,
                position,
                parentId: groupNode.id,  // 设置父子关系
                extent: 'parent',        // 限制节点在父节点内移动
                data: {
                  ...n.data,
                  parentId: groupNode.id  // 在数据中也记录父节点ID
                }
              } as Node;
            }

            return n;
          });
        
        // 对节点进行排序，确保组节点在前
        nextNodes = nextNodes.sort((a, b) => {
          if (a.type === 'group' && b.type !== 'group') return -1;
          if (a.type !== 'group' && b.type === 'group') return 1;
          return 0;
        });
        
        setNodes(nextNodes);
      }
    },
    [getIntersectingNodes, getNodes, setNodes]
  );

  // 节点拖拽过程中处理函数
  const onNodeDrag: OnNodeDrag = useCallback(
    (_, node) => {
      // 跳过组节点自身和已经有父节点的节点
      if (node.type === 'group' || node.parentId) {
        return;
      }

      // 获取与当前节点相交的组节点
      const intersections = getIntersectingNodes(node).filter(
        (n) => n.type === 'group'
      );
      
      // 当相交时，高亮组节点
      const hasIntersection = intersections.length > 0 && 
                             node.parentId !== intersections[0]?.id;
      
      setNodes((nds) => {
        return nds.map((n) => {
          if (n.type === 'group') {
            // 高亮相交的组节点
            const isIntersecting = intersections.some(i => i.id === n.id);
            return {
              ...n,
              style: {
                ...n.style,
                borderColor: isIntersecting && hasIntersection ? '#9B7EDB' : '#555555',
                borderWidth: isIntersecting && hasIntersection ? '3px' : '2.5px',
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
  const { setNodes, getNodes, getNode } = useReactFlow();

  const detachNodes = useCallback(
    (ids: string[]) => {
      setNodes(
        getNodes().map((n) => {
          if (ids.includes(n.id) && n.parentId) {
            const parentNode = getNode(n.parentId);
            if (!parentNode) return n;

            return {
              ...n,
              position: {
                x: n.position.x + parentNode.position.x,
                y: n.position.y + parentNode.position.y,
              },
              parentId: undefined,
              extent: undefined,
              data: {
                ...n.data,
                parentId: undefined  // 清除数据中的父节点ID
              }
            };
          }
          return n;
        })
      );
    },
    [setNodes, getNodes, getNode]
  );

  return detachNodes;
} 