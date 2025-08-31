import React, { useState } from 'react';
import {
  getBezierPath,
  useInternalNode,
  EdgeProps,
  getSmoothStepPath,
  BaseEdge,
  Position,
} from '@xyflow/react';
import { getEdgeParams } from '../../hooks/useFloatingEdgeUtils';
import { UI_COLORS } from '../../../utils/colors';

function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  selected,
  data = {
    connectionType: 'STC',
  },
  style = {
    strokeWidth: '4px',
    stroke: UI_COLORS.LINE,
    fill: 'transparent',
  },
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // apply selected style (moved from global css): orange, dashed, animated
  const appliedStyle = selected
    ? {
        ...style,
        stroke: '#FFA73D',
        strokeDasharray: '8 8',
        animation: 'flow 6s linear infinite',
      }
    : style;

  // hover: flowing white dashed line
  const [isHovered, setIsHovered] = useState(false);
  // Priority: selected > hover. Only apply hover style when not selected
  const finalStyle = selected
    ? appliedStyle
    : isHovered
      ? {
          ...appliedStyle,
          stroke: UI_COLORS.LINE,
          strokeDasharray: '8 8',
          animation: 'flow 6s linear infinite',
        }
      : appliedStyle;

  if (!sourceNode || !targetNode) {
    return null;
  }

  let { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode
  );

  if (data.connectionType === 'STC') {
    const [edgePath] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      targetX: tx,
      targetY: ty,
      borderRadius: 40,
    });

    return (
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={finalStyle} />
      </g>
    );
  } else if (data.connectionType === 'CTT') {
    // recalculate edgePath targetX and targetY for MarkerEnd arrow (10px)
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

    const [edgePath] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      targetX: tx,
      targetY: ty,
      borderRadius: 40,
    });

    return (
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <defs>
          {/* 默认箭头 */}
          <marker
            id='custom-arrow-default'
            viewBox='0 0 14 22'
            refX='11'
            refY='11'
            markerWidth='6'
            markerHeight='6'
            orient='auto-start-reverse'
          >
            <path
              d='M2 2L11 11L2 20'
              fill='none'
              stroke={UI_COLORS.LINE}
              strokeWidth='4'
            />
          </marker>
          {/* 选中箭头 */}
          <marker
            id='custom-arrow-selected'
            viewBox='0 0 14 22'
            refX='11'
            refY='11'
            markerWidth='6'
            markerHeight='6'
            orient='auto-start-reverse'
          >
            <path
              d='M2 2L11 11L2 20'
              fill='none'
              stroke={UI_COLORS.LINE}
              strokeWidth='4'
            />
          </marker>
        </defs>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={`url(#custom-arrow-${selected ? 'selected' : 'default'})`}
          style={finalStyle}
        />
      </g>
    );
  }
}

export default FloatingEdge;
