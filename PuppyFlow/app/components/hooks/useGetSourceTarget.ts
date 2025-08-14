import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

type NodeCategory =
  | 'blocknode'
  | 'edgenode'
  | 'servernode'
  | 'groupnode'
  | 'all';

function useGetSourceTarget() {
  const { getEdges, getNode } = useReactFlow();

  // 定义节点类型分类
  const nodeTypeCategories = {
    blocknode: ['text', 'file', 'weblink', 'structured'],
    edgenode: [
      'copy',
      'chunkingByLength',
      'chunkingByCharacter',
      'chunkingAuto',
      'retrieving',
      'convert2text',
      'convert2structured',
      'editText',
      'editStructured',
      'searchGoogle',
      'searchPerplexity',
      'llmnew',
      'ifelse',
      'generate',
      'load',
      'deepresearch',
    ],
    servernode: ['server'],
    groupnode: ['group'],
  };

  // 根据类别过滤节点
  const filterNodesByCategory = useCallback(
    (nodeIds: string[], category: NodeCategory) => {
      if (category === 'all') return nodeIds;

      const allowedTypes = nodeTypeCategories[category];
      return nodeIds.filter(nodeId => {
        const node = getNode(nodeId);
        return node && allowedTypes.includes(node.type || '');
      });
    },
    [getNode]
  );

  const getSourceNodeIdWithLabel = useCallback(
    (parentId: string, category: NodeCategory = 'all') => {
      const sourceNodeIds = getEdges()
        .filter(edge => edge.target === parentId)
        .map(edge => edge.source);

      const filteredNodeIds = filterNodesByCategory(sourceNodeIds, category);

      return filteredNodeIds
        .map(childnodeid => ({
          id: childnodeid,
          label:
            (getNode(childnodeid)?.data?.label as string | undefined) ??
            childnodeid,
        }))
        .sort((a, b) => Number(a.id) - Number(b.id));
    },
    [getEdges, getNode, filterNodesByCategory]
  );

  const getTargetNodeIdWithLabel = useCallback(
    (parentId: string, category: NodeCategory = 'all') => {
      const targetNodeIds = getEdges()
        .filter(edge => edge.source === parentId)
        .map(edge => edge.target);

      const filteredNodeIds = filterNodesByCategory(targetNodeIds, category);

      return filteredNodeIds
        .map(childnodeid => ({
          id: childnodeid,
          label:
            (getNode(childnodeid)?.data?.label as string | undefined) ??
            childnodeid,
        }))
        .sort((a, b) => Number(a.id) - Number(b.id));
    },
    [getEdges, getNode, filterNodesByCategory]
  );

  return {
    getSourceNodeIdWithLabel,
    getTargetNodeIdWithLabel,
  };
}

export default useGetSourceTarget;
