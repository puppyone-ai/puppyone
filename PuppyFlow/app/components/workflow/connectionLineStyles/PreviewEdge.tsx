import React from 'react';
import {
  ConnectionLineComponentProps,
  getSmoothStepPath,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { UI_COLORS } from '../../../utils/colors';

export default function CustomConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  fromHandle,
  toHandle,
}: ConnectionLineComponentProps) {
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();
  const { getNode } = useReactFlow();

  // console.log(fromX, fromY, toX, toY, fromPosition, toPosition, fromHandle, toHandle, "you are generating connection line")

  // 判断是否正在拖动
  const isDragging = Math.abs(fromX - toX) > 10 || Math.abs(fromY - toY) > 10;

  if (!isDragging || isOnGeneratingNewNode) {
    return null; // 不渲染连接线
  }

  // 解析源节点 id（优先使用 nodeId，其次从 handle id 中剥离）
  const handleId = (fromHandle as any)?.id as string | undefined;
  const nodeIdFromHandle = (fromHandle as any)?.nodeId as string | undefined;
  let sourceNodeId: string | undefined = nodeIdFromHandle;
  if (!sourceNodeId && handleId) {
    const lastDash = handleId.lastIndexOf('-');
    if (lastDash > 0) sourceNodeId = handleId.slice(0, lastDash);
  }

  // 根据目标相对源节点中心的位置，动态选择源边并调整起点坐标
  let virtualSourceX = fromX;
  let virtualSourceY = fromY;
  let sourcePos: Position = fromHandle?.position ?? Position.Right;
  let targetPos: Position = Position.Left;

  const sourceNode = sourceNodeId ? getNode(sourceNodeId) : undefined;
  if (
    sourceNode &&
    (sourceNode as any).measured?.width &&
    (sourceNode as any).measured?.height
  ) {
    const measured = (sourceNode as any).measured;
    const centerX = sourceNode.position.x + measured.width / 2;
    const centerY = sourceNode.position.y + measured.height / 2;
    const dx = toX - centerX;
    const dy = toY - centerY;

    if (Math.abs(dx) > Math.abs(dy)) {
      sourcePos = dx >= 0 ? Position.Right : Position.Left;
      targetPos = dx >= 0 ? Position.Left : Position.Right;
      virtualSourceX = dx >= 0
        ? sourceNode.position.x + measured.width + 8
        : sourceNode.position.x - 8;
      virtualSourceY = centerY;
    } else {
      sourcePos = dy >= 0 ? Position.Bottom : Position.Top;
      targetPos = dy >= 0 ? Position.Top : Position.Bottom;
      virtualSourceX = centerX;
      virtualSourceY = dy >= 0
        ? sourceNode.position.y + measured.height + 8
        : sourceNode.position.y - 8;
    }
  } else {
    // 回退：无法取得节点尺寸时，仍根据相对位移切换方向
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) > Math.abs(dy)) {
      sourcePos = dx >= 0 ? Position.Right : Position.Left;
      targetPos = dx >= 0 ? Position.Left : Position.Right;
    } else {
      sourcePos = dy >= 0 ? Position.Bottom : Position.Top;
      targetPos = dy >= 0 ? Position.Top : Position.Bottom;
    }
  }

  // 使用平滑路径并保留橙色虚线动画样式
  const [path] = getSmoothStepPath({
    sourceX: virtualSourceX,
    sourceY: virtualSourceY,
    targetX: toX,
    targetY: toY,
    borderRadius: 50,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
  });

  return (
    <g>
      <defs>
        {/* 预览终点方块标记：与 EdgeMenu 节点按钮完全一致的尺寸与圆角 (80x48, r=8) */}
        <marker
          id='preview-edge-block'
          viewBox='0 0 80 48'
          refX='40'
          refY='24'
          markerWidth='80'
          markerHeight='48'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect x='1' y='1' width='78' height='46' rx='8' ry='8' fill='#181818' stroke={UI_COLORS.MAIN_DEEP_GREY} strokeWidth='2' />
        </marker>
      </defs>

      <path
        fill='none'
        stroke={UI_COLORS.LINE}
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeDasharray='4 8'
        style={{ animation: 'flow 6s linear infinite', strokeDashoffset: 0 }}
        d={path}
        markerEnd='url(#preview-edge-block)'
      />
    </g>
  );
}
