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
  // all handles are from type source, that's why we use handleBounds.source here
  if (!node.internals.handleBounds?.source) return [0, 0];
  const handle = node.internals.handleBounds.source.find(
    h => h.position === handlePosition
  );

  if (!handle) return [0, 0];
  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;

  // this is a tiny detail to make the markerEnd of an edge visible.
  // The handle position that gets calculated has the origin top-left, so depending which side we are using, we add a little offset
  // when the handlePosition is Position.Right for example, we need to add an offset as big as the handle itself in order to get the correct position
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

  // get HandleCoordsByPosition
  let x = node.internals.positionAbsolute.x + handle.x + offsetX;
  let y = node.internals.positionAbsolute.y + handle.y + offsetY;

  // get IntersectionPointCoordsByPosition , must connect to Node border
  switch (handlePosition) {
    case Position.Left:
      x += 8 + handle.width; // 16 is the distance between handle and Node
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

function getNodeCenter(node: InternalNode) {
  if (!node.measured || !node.measured.width || !node.measured.height)
    return { x: 0, y: 0 };

  return {
    x: node.internals.positionAbsolute.x + node.measured.width / 2,
    y: node.internals.positionAbsolute.y + node.measured.height / 2,
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
