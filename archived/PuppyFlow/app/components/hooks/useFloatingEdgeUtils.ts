import { Position, Node, InternalNode } from '@xyflow/react';

// returns the position (top,right,bottom or right) passed node compared to
function getParams(nodeA: InternalNode, nodeB: InternalNode) {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const horizontalDiff = Math.abs(centerA.x - centerB.x);
  const verticalDiff = Math.abs(centerA.y - centerB.y);

  let position;

  // when the horizontal difference between the nodes is bigger, we use Position.Left or Position.Right for the handle
  if (horizontalDiff > verticalDiff) {
    position = centerA.x > centerB.x ? Position.Left : Position.Right;
  } else {
    // here the vertical difference between the nodes is bigger, so we use Position.Top or Position.Bottom for the handle
    position = centerA.y > centerB.y ? Position.Top : Position.Bottom;
  }

  const [x, y] = getIntersectionPointCoordsByPosition(nodeA, position);
  return [x, y, position];
}

function getIntersectionPointCoordsByPosition(
  node: InternalNode,
  handlePosition: Position
) {
  // Prefer actual handle bounds when available
  if (node.internals.handleBounds?.source) {
    const handle = node.internals.handleBounds.source.find(
      h => h.position === handlePosition
    );

    if (handle) {
      let offsetX = handle.width / 2;
      let offsetY = handle.height / 2;
      switch (handlePosition) {
        case Position.Left:
          offsetX = 0;
          break;
        case Position.Right:
          offsetX = handle.width;
          break;
        case Position.Top:
          offsetY = 0;
          break;
        case Position.Bottom:
          offsetY = handle.height;
          break;
      }

      let x = node.internals.positionAbsolute.x + handle.x + offsetX;
      let y = node.internals.positionAbsolute.y + handle.y + offsetY;

      // tiny visual offset to move to node border rather than handle center
      switch (handlePosition) {
        case Position.Left:
          x += 8 + handle.width;
          break;
        case Position.Right:
          x -= 8 + handle.width;
          break;
        case Position.Top:
          y += 8 + handle.height;
          break;
        case Position.Bottom:
          y -= 8 + handle.height;
          break;
      }

      return [x, y];
    }
  }

  // Fallback when handle bounds are not yet ready: derive from width/height
  const width = (node as any)?.width as number | undefined;
  const height = (node as any)?.height as number | undefined;
  const pos = node.internals.positionAbsolute;
  if (!width || !height) return [pos.x, pos.y];

  switch (handlePosition) {
    case Position.Left:
      return [pos.x, pos.y + height / 2];
    case Position.Right:
      return [pos.x + width, pos.y + height / 2];
    case Position.Top:
      return [pos.x + width / 2, pos.y];
    case Position.Bottom:
      return [pos.x + width / 2, pos.y + height];
  }

  return [pos.x, pos.y];
}

function getNodeCenter(node: InternalNode) {
  const width = (node as any)?.width;
  const height = (node as any)?.height;
  if (!width || !height) return { x: 0, y: 0 };

  return {
    x: node.internals.positionAbsolute.x + (width as number) / 2,
    y: node.internals.positionAbsolute.y + (height as number) / 2,
  };
}

// returns the parameters (sx, sy, tx, ty, sourcePos, targetPos) you need to create an edge
export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const [sx, sy, sourcePos] = getParams(source, target);
  const [tx, ty, targetPos] = getParams(target, source);

  return {
    sx: sx as number,
    sy: sy as number,
    tx: tx as number,
    ty: ty as number,
    sourcePos: sourcePos as Position,
    targetPos: targetPos as Position,
  };
}
