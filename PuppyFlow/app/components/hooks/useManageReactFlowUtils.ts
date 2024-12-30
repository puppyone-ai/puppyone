import React, { useCallback, useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';

export default function useManageReactFlowUtils() {
  const [zoomOnScroll, setZoomOnScroll] = useState(true);
  const reactFlowInstance = useReactFlow();
  const {getEdges, getNode} = reactFlowInstance


  const lockZoom = useCallback(() => {
    setZoomOnScroll(false)
  }, [reactFlowInstance]);

  const freeZoom = useCallback(() => {
    setZoomOnScroll(true)
    
  }, [reactFlowInstance]);


  // for edgeButtonNodes
  const getResultNodes = useCallback((nodeId: string) => {
    return getEdges().filter(edge => edge.type === "floating" && edge.data?.connectionType === "CTT" && edge.source === nodeId).map(edge => edge.target)
  }, [reactFlowInstance])

  // judge if the node is a node or ConfigNode
  const judgeNodeIsEdgeNode = useCallback((nodeId: string) => {
    const nodeType = getNode(nodeId)?.type
    return nodeType === 'load' || nodeType === 'chunk' || nodeType === 'code' || nodeType === 'generate' || nodeType === 'llm' || nodeType === 'search' || nodeType === 'embedding' || nodeType === 'modify' || nodeType === 'choose'
  }, [])
 


  return {
    zoomOnScroll,
    lockZoom,
    freeZoom,
    getResultNodes,
    judgeNodeIsEdgeNode
  };
}


