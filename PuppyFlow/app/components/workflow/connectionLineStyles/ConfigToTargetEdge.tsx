import React, { useState, useEffect } from 'react';
import {
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  getBezierPath,
  useReactFlow,
  Position,
  MarkerType
} from '@xyflow/react';

export const markerEnd = {
  type: MarkerType.ArrowClosed,
  width: 8,
  height: 20,
  color: "#CDCDCD",
  strokeWidth: 0.1, 
}

export default function ConfigToTargetEdge ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style = {
    strokeWidth: "4px",
    stroke: "#CDCDCD",
  },
  animated = true,
  markerEnd,
}: EdgeProps) {

  

  const defaultTargetPosition = Position.Top

  // const sourceNode = getNode(source)
  // const targetNode = getNode(target)

  const newTargetX = targetX
  const newTargetY = targetY + 29

  
  // const defaultTargetWidth = 256

  // resolving prob: targetNode possibly undefined!
  // let targetWidth = targetNode?.measured?.width ?? defaultTargetWidth
  // let targetHeight = targetNode?.measured?.height ?? 24
  // const defaultTargetX = sourceX
  // const defaultTargetY = targetY + 6


// use States to manage targetX, targetY
// const [dynamicTargetX, setDynamicTargetX] = useState(defaultTargetX)
// const [dynamicTargetY, setDynamicTargetY] = useState(defaultTargetY)

// dynamically update the targetX, targetY
// useEffect(() => {

// if (targetNode && targetNode.measured?.height && targetNode.measured.width) {

//   const newTargetX = targetNode.position.x + targetNode.measured.width / 2
//   const newTargetY = targetNode.position.y + 6

//   setDynamicTargetX(newTargetX);
//   setDynamicTargetY(newTargetY);
// }
// }, [getNode, targetNode?.position.x, sourceNode?.position.x, targetNode?.position.y, sourceNode?.position.y, targetNode?.measured?.height, targetNode?.measured?.width]);
  


  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY - 16,
    sourcePosition,
    targetX: newTargetX,
    targetY: newTargetY,
    targetPosition: defaultTargetPosition,
    borderRadius: 50,
  });

  return (
    <>
      
      
         <defs>
          {/* 默认箭头 */}
         <marker
            id="custom-arrow-default"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            {/* 自定义箭头形状 */}
            <path
              // d="M 0 0 L 10 5 L 0 10 L 3 5 Z"
              d="M 0 0 L 7 5 L 0 10 L 1 5 Z"
              fill="#CDCDCD"
              // stroke="#CDCDCD"
              // 或者使用三角形箭头
              // d="M 0 0 L 10 5 L 0 10 z"
            />
      
          </marker>  
          {/* 选中箭头 */}
          <marker
          id="custom-arrow-selected"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 7 5 L 0 10 L 1 5 Z"
            fill="#FFA73D"
            stroke="#FFA73D"
          />
        </marker>

          
      </defs>  
      <BaseEdge path={edgePath} markerEnd={`url(#custom-arrow-${selected ? "selected" : "default"})`} style={style}  />
    </>
  );
}


