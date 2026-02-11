'use client';
import { useCallback } from 'react';
import { OnNodeDrag, useReactFlow, type Node } from '@xyflow/react';

// 定义允许进入组的节点类型（只允许 block nodes）
const ALLOWED_NODE_TYPES = ['text', 'file', 'weblink', 'structured'];

export function useNodeDragHandlers() {
  const { getNodes, setNodes } = useReactFlow();

  // 完全移除拖拽过程中的计算
  const onNodeDrag: OnNodeDrag = useCallback(() => {
    // 拖拽过程中什么都不做
  }, []);

  // 拖拽结束时也不做任何计算
  const onNodeDragStop: OnNodeDrag = useCallback(() => {
    // 拖拽结束时什么都不做
  }, []);

  return {
    onNodeDrag,
    onNodeDragStop,
  };
}

// 组节点激活时的计算逻辑
export function useGroupNodeCalculation() {
  const { getNodes, setNodes, getNode } = useReactFlow();

  // 检查节点是否在组的范围内且是允许的类型
  const isNodeInsideGroup = useCallback((node: Node, groupNode: Node) => {
    // 首先检查节点类型是否被允许
    if (!ALLOWED_NODE_TYPES.includes(node.type || '')) {
      return false;
    }

    const nodeWidth = node.width || 200;
    const nodeHeight = node.height || 100;
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

  // 重新计算组内的节点 - 只在组激活时调用
  const recalculateGroupNodes = useCallback(
    (groupId: string) => {
      const currentGroupNode = getNode(groupId);
      if (!currentGroupNode) return;

      const allNodes = getNodes();
      let hasChanges = false;

      const updatedNodes = allNodes.map(node => {
        // 跳过组节点本身
        if (node.type === 'group' || node.id === groupId) {
          return node;
        }

        // 只处理允许的节点类型
        if (!ALLOWED_NODE_TYPES.includes(node.type || '')) {
          return node;
        }

        const shouldBeInGroup = isNodeInsideGroup(node, currentGroupNode);
        const groupIds = (node.data as any)?.groupIds || [];
        const currentlyInGroup = groupIds.includes(groupId);

        if (shouldBeInGroup && !currentlyInGroup) {
          // 节点应该在组内但目前不在 - 添加到 groupIds 数组
          hasChanges = true;
          return {
            ...node,
            data: {
              ...node.data,
              groupIds: [...groupIds, groupId],
            },
          };
        } else if (!shouldBeInGroup && currentlyInGroup) {
          // 节点不应该在组内但目前在 - 从 groupIds 数组中移除
          hasChanges = true;
          return {
            ...node,
            data: {
              ...node.data,
              groupIds: groupIds.filter((gid: string) => gid !== groupId),
            },
          };
        }

        return node;
      });

      if (hasChanges) {
        setNodes(updatedNodes);
        console.log(`🔄 Recalculated nodes for group ${groupId}`);
      }
    },
    [getNode, getNodes, setNodes, isNodeInsideGroup]
  );

  return {
    recalculateGroupNodes,
  };
}

// 从组节点中分离节点的功能
export function useDetachNodes() {
  const { setNodes, getNodes } = useReactFlow();

  const detachNodes = useCallback(
    (ids: string[]) => {
      setNodes(
        getNodes().map(n => {
          if (ids.includes(n.id)) {
            const groupIds = (n.data as any)?.groupIds;
            if (Array.isArray(groupIds) && groupIds.length > 0) {
              return {
                ...n,
                data: {
                  ...n.data,
                  groupIds: [], // 清空所有组关联
                },
              };
            }
          }
          return n;
        })
      );
    },
    [setNodes, getNodes]
  );

  // 从特定组中分离节点
  const detachNodesFromGroup = useCallback(
    (nodeIds: string[], groupId: string) => {
      setNodes(
        getNodes().map(n => {
          if (nodeIds.includes(n.id)) {
            const groupIds = (n.data as any)?.groupIds || [];
            if (Array.isArray(groupIds) && groupIds.includes(groupId)) {
              return {
                ...n,
                data: {
                  ...n.data,
                  groupIds: groupIds.filter((gid: string) => gid !== groupId),
                },
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
