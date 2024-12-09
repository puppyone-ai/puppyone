import React, { useCallback, useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';

export default function useManageReactFlowUtils() {
  const [zoomOnScroll, setZoomOnScroll] = useState(true);
  const reactFlowInstance = useReactFlow();
  const {getEdges} = reactFlowInstance


  const lockZoom = useCallback(() => {
    setZoomOnScroll(false)
  }, [reactFlowInstance]);

  const freeZoom = useCallback(() => {
    setZoomOnScroll(true)
    
  }, [reactFlowInstance]);


  // for edgeButtonNodes
  const getResultNodes = useCallback((nodeId: string) => {
    return getEdges().filter(edge => edge.type === "CTT" && edge.source === nodeId).map(edge => edge.target)
  }, [reactFlowInstance])
 


  return {
    zoomOnScroll,
    lockZoom,
    freeZoom,
    getResultNodes
  };
}


