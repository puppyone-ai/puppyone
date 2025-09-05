import React from 'react';
import {
  ConnectionLineComponentProps,
  getSmoothStepPath,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { UI_COLORS } from '../../../utils/colors';
import useManageReactFlowUtils from '../../hooks/useManageReactFlowUtils';

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
  const { judgeNodeIsEdgeNode } = useManageReactFlowUtils();

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

  const isSourceEdgeNode = sourceNodeId
    ? judgeNodeIsEdgeNode(sourceNodeId)
    : false;

  // 根据目标相对源节点中心的位置，动态选择源边并调整起点坐标
  let virtualSourceX = fromX;
  let virtualSourceY = fromY;
  let sourcePos: Position = fromHandle?.position ?? Position.Right;
  let targetPos: Position = Position.Left;

  const sourceNode = sourceNodeId ? getNode(sourceNodeId) : undefined;
  if (
    sourceNode &&
    typeof (sourceNode as any).width === 'number' &&
    typeof (sourceNode as any).height === 'number'
  ) {
    const centerX = sourceNode.position.x + (sourceNode as any).width / 2;
    const centerY = sourceNode.position.y + (sourceNode as any).height / 2;
    const dx = toX - centerX;
    const dy = toY - centerY;

    if (Math.abs(dx) > Math.abs(dy)) {
      sourcePos = dx >= 0 ? Position.Right : Position.Left;
      targetPos = dx >= 0 ? Position.Left : Position.Right;

      virtualSourceX = dx >= 0
        ? sourceNode.position.x + (sourceNode as any).width + 8
        : sourceNode.position.x - 8;

      virtualSourceY = centerY;
    } else {
      sourcePos = dy >= 0 ? Position.Bottom : Position.Top;
      targetPos = dy >= 0 ? Position.Top : Position.Bottom;
      virtualSourceX = centerX;

      virtualSourceY = dy >= 0
        ? sourceNode.position.y + (sourceNode as any).height + 8
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
          <rect
            x='3'
            y='3'
            width='74'
            height='42'
            rx='8'
            ry='8'
            fill='#181818'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
        </marker>
        {/* 提示连线箭头 */}
        <marker
          id='preview-arrow'
          viewBox='0 0 14 22'
          refX='11'
          refY='11'
          markerWidth='6'
          markerHeight='6'
          orient='auto'
        >
          <path
            d='M2 2L11 11L2 20'
            fill='none'
            stroke={UI_COLORS.LINE}
            strokeWidth='4'
          />
        </marker>
        {/* 边对齐的大块预览（用于 EdgeNode → BlockNode）：根据进入方向将参考点放在边上 */}
        <marker
          id='preview-large-block-left'
          viewBox='0 0 240 176'
          refX='2'
          refY='88'
          markerWidth='240'
          markerHeight='176'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect
            x='2'
            y='2'
            width='236'
            height='172'
            rx='16'
            ry='16'
            fill='transparent'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
        </marker>
        <marker
          id='preview-large-block-right'
          viewBox='0 0 240 176'
          refX='238'
          refY='88'
          markerWidth='240'
          markerHeight='176'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect
            x='2'
            y='2'
            width='236'
            height='172'
            rx='16'
            ry='16'
            fill='transparent'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
        </marker>
        <marker
          id='preview-large-block-top'
          viewBox='0 0 240 176'
          refX='120'
          refY='2'
          markerWidth='240'
          markerHeight='176'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect
            x='2'
            y='2'
            width='236'
            height='172'
            rx='16'
            ry='16'
            fill='transparent'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
        </marker>
        <marker
          id='preview-large-block-bottom'
          viewBox='0 0 240 176'
          refX='120'
          refY='174'
          markerWidth='240'
          markerHeight='176'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect
            x='2'
            y='2'
            width='236'
            height='172'
            rx='16'
            ry='16'
            fill='transparent'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
        </marker>
        {/* 预览大块标记：与 TextBlock 尺寸一致的轮廓 (240x176, r=16) */}
        <marker
          id='preview-large-block'
          viewBox='0 0 240 176'
          refX='120'
          refY='88'
          markerWidth='240'
          markerHeight='176'
          orient='0'
          markerUnits='userSpaceOnUse'
        >
          <rect
            x='2'
            y='2'
            width='236'
            height='172'
            rx='16'
            ry='16'
            fill='transparent'
            stroke={UI_COLORS.MAIN_DEEP_GREY}
            strokeWidth='2'
          />
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
        markerEnd={
          isSourceEdgeNode ? 'url(#preview-arrow)' : 'url(#preview-edge-block)'
        }
      />

      {/* EdgeNode → BlockNode：在终点处渲染大块轮廓，并让箭头对准该轮廓的边中心 */}
      {isSourceEdgeNode &&
        (() => {
          const BLOCK_W = 240;
          const BLOCK_H = 176;

          let blockX = toX - BLOCK_W / 2;
          let blockY = toY - BLOCK_H / 2;

          if (targetPos === Position.Left) {
            // 线连到大块左边中点
            blockX = toX;
            blockY = toY - BLOCK_H / 2;
          } else if (targetPos === Position.Right) {
            // 线连到大块右边中点
            blockX = toX - BLOCK_W;
            blockY = toY - BLOCK_H / 2;
          } else if (targetPos === Position.Top) {
            // 线连到大块上边中点
            blockX = toX - BLOCK_W / 2;
            blockY = toY;
          } else if (targetPos === Position.Bottom) {
            // 线连到大块下边中点
            blockX = toX - BLOCK_W / 2;
            blockY = toY - BLOCK_H;
          }

          return (
            <g>
              <rect
                x={blockX}
                y={blockY}
                width={BLOCK_W}
                height={BLOCK_H}
                rx={16}
                ry={16}
                fill='transparent'
                stroke={UI_COLORS.MAIN_DEEP_GREY}
                strokeWidth={2}
                opacity={0.95}
              />
            </g>
          );
        })()}

      {/* 进一步的“未来 Block”预览：在 EdgeMenu 预览块外侧再渲染一个 Block 轮廓 */}
      {!isSourceEdgeNode &&
        (() => {
          // 默认以文本块的外观来预览未来 Block（尺寸 240x176、圆角 16）
          const BLOCK_W = 240;
          const BLOCK_H = 176;
          const TILE_W = 80;
          const TILE_H = 48;
          const GAP = 96; // 磁贴与未来块之间的间距（再减 32px）

          let blockX = toX - BLOCK_W / 2;
          let blockY = toY - BLOCK_H / 2;

          if (targetPos === Position.Left) {
            blockX = toX + TILE_W / 2 + GAP;
            blockY = toY - BLOCK_H / 2;
          } else if (targetPos === Position.Right) {
            blockX = toX - TILE_W / 2 - GAP - BLOCK_W;
            blockY = toY - BLOCK_H / 2;
          } else if (targetPos === Position.Top) {
            blockX = toX - BLOCK_W / 2;
            blockY = toY + TILE_H / 2 + GAP;
          } else if (targetPos === Position.Bottom) {
            blockX = toX - BLOCK_W / 2;
            blockY = toY - TILE_H / 2 - GAP - BLOCK_H;
          }

          return (
            <g>
              {/* 外框 */}
              <rect
                x={blockX}
                y={blockY}
                width={BLOCK_W}
                height={BLOCK_H}
                rx={16}
                ry={16}
                fill='transparent'
                stroke={UI_COLORS.MAIN_DEEP_GREY}
                strokeWidth={2}
                opacity={0.95}
              />
              {/* 小方块与大方块之间的提示连线 */}
              {(() => {
                let startX = toX;
                let startY = toY;
                let endX = blockX + BLOCK_W / 2;
                let endY = blockY + BLOCK_H / 2;

                if (targetPos === Position.Left) {
                  // 从小方块右侧到大方块左侧中心
                  startX = toX + TILE_W / 2;
                  startY = toY;
                  endX = blockX;
                  endY = blockY + BLOCK_H / 2;
                } else if (targetPos === Position.Right) {
                  // 从小方块左侧到大方块右侧中心
                  startX = toX - TILE_W / 2;
                  startY = toY;
                  endX = blockX + BLOCK_W;
                  endY = blockY + BLOCK_H / 2;
                } else if (targetPos === Position.Top) {
                  // 从小方块下侧到大方块上侧中心
                  startX = toX;
                  startY = toY + TILE_H / 2;
                  endX = blockX + BLOCK_W / 2;
                  endY = blockY;
                } else if (targetPos === Position.Bottom) {
                  // 从小方块上侧到大方块下侧中心
                  startX = toX;
                  startY = toY - TILE_H / 2;
                  endX = blockX + BLOCK_W / 2;
                  endY = blockY + BLOCK_H;
                }

                return (
                  <path
                    d={`M ${startX} ${startY} L ${endX} ${endY}`}
                    stroke={UI_COLORS.LINE}
                    strokeWidth={2}
                    strokeDasharray='4 8'
                    markerEnd='url(#preview-arrow)'
                  />
                );
              })()}
            </g>
          );
        })()}
    </g>
  );
}
