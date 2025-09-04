import React, { useCallback, useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';

// 定义两个常量数组来存储节点类型
const EDGE_NODE_TYPES = [
  'edgeMenu',
  'load',
  'chunk',
  'code',
  'generate',
  'llm',
  'search',
  'embedding',
  'modify',
  'choose',
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
  'deepresearch',
] as const;

const BLOCK_NODE_TYPES = [
  'text',
  'file',
  'weblink',
  'structured',
  'none',
] as const;

export default function useManageReactFlowUtils() {
  const [zoomOnScroll, setZoomOnScroll] = useState(true);
  const reactFlowInstance = useReactFlow();
  const { getEdges, getNode } = reactFlowInstance;

  const lockZoom = useCallback(() => {
    setZoomOnScroll(false);
  }, [reactFlowInstance]);

  const freeZoom = useCallback(() => {
    setZoomOnScroll(true);
  }, [reactFlowInstance]);

  // for edgeButtonNodes
  const getResultNodes = useCallback(
    (nodeId: string) => {
      return getEdges()
        .filter(
          edge =>
            edge.type === 'floating' &&
            edge.data?.connectionType === 'CTT' &&
            edge.source === nodeId
        )
        .map(edge => edge.target);
    },
    [reactFlowInstance]
  );

  // judge if the node is a node or ConfigNode
  const judgeNodeIsEdgeNode = useCallback((nodeId: string) => {
    const nodeType = getNode(nodeId)?.type;
    return EDGE_NODE_TYPES.includes(nodeType as any);
  }, []);

  return {
    zoomOnScroll,
    lockZoom,
    freeZoom,
    getResultNodes,
    judgeNodeIsEdgeNode,
    // 导出这些类型列表以供其他地方使用
    EDGE_NODE_TYPES,
    BLOCK_NODE_TYPES,
  };
}
