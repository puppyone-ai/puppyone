import React from 'react';
import {
  BaseEdge,
  EdgeProps,
  getStraightPath,
  useInternalNode,
  Position,
} from '@xyflow/react';
import { getEdgeParams } from '../../hooks/useFloatingEdgeUtils';

export default function ServerDashedEdge({
  id,
  source,
  target,
  markerEnd,
  selected,
  data = {
    connectionType: "STC"
  },
  style = {},
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  // 使用 getEdgeParams 動態計算連接點，就像 FloatingEdge 一樣
  let { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );

  // 定義虛線樣式
  const dashedStyle = {
    strokeWidth: '2px',           // 非常細的線
    stroke: '#6B7280',            // 低調的灰色
    strokeDasharray: '4 4',       // 虛線模式：4px實線，4px間隔
    fill: 'none',
    opacity: 0.6,                 // 降低透明度讓它更低調
    ...style,
  };

  if (data.connectionType === "STC") {
    // 使用直線路徑，沒有彎曲
    const [edgePath] = getStraightPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
    });

    return (
      <BaseEdge 
        id={id} 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={dashedStyle} 
      />
    );
  } else if (data.connectionType === "CTT") {
    // 為 MarkerEnd 箭頭調整目標位置 (10px)
    switch (targetPos) {
      case Position.Left:
        tx -= 10;
        break;
      case Position.Right:
        tx += 10;
        break;
      case Position.Top:
        ty -= 10;
        break;
      case Position.Bottom:
        ty += 10;
        break;
    }

    // 使用直線路徑
    const [edgePath] = getStraightPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
    });

    return (
      <>
        <defs>
          {/* 默認箭頭 */}
          <marker
            id="server-arrow-default"
            viewBox="0 0 14 22"
            refX="11"
            refY="11"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path
              d="M2 2L11 11L2 20"
              fill="none"
              stroke="#6B7280"
              strokeWidth="1"
            />
          </marker>
          {/* 選中箭頭 */}
          <marker
            id="server-arrow-selected"
            viewBox="0 0 14 22"
            refX="11"
            refY="11"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path
              d="M2 2L11 11L2 20"
              fill="none"
              stroke="#6B7280"
              strokeWidth="1"
            />
          </marker>
        </defs>
        <BaseEdge 
          id={id} 
          path={edgePath} 
          markerEnd={`url(#server-arrow-${selected ? "selected" : "default"})`} 
          style={dashedStyle} 
        />
      </>
    );
  }

  return null;
}