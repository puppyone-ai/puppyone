import React from 'react';
import { ConnectionLineComponentProps, getSmoothStepPath, Position } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';

export default function CustomConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, fromHandle, toHandle }: ConnectionLineComponentProps) {

    const {isOnGeneratingNewNode} = useNodesPerFlowContext()
  const targetPosition = fromHandle?.position === Position.Right ? Position.Left : 
    fromHandle?.position === Position.Top ? Position.Bottom : 
    fromHandle?.position === Position.Bottom ? Position.Top : Position.Right

    // console.log(fromX, fromY, toX, toY, fromPosition, toPosition, fromHandle, toHandle, "you are generating connection line")

    // 判断是否正在拖动
  const isDragging = Math.abs(fromX - toX) > 10 || Math.abs(fromY - toY) > 10;

  if (!isDragging || isOnGeneratingNewNode ) {
    return null; // 不渲染连接线
  }

  // 使用 React Flow 的 getSmoothStepPath 函数
  const [path] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    borderRadius: 50,
    sourcePosition: fromHandle?.position,
    targetPosition: targetPosition,

  });

  return (
    <g>
      <path
        fill="none"
        stroke="#FFA73D"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        d={path}
      />
        </g>
    );
};