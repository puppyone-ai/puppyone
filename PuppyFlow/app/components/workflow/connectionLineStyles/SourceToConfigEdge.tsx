import React, { useState, useEffect } from 'react';
import {
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  getBezierPath,
  useReactFlow,
  Position,
} from '@xyflow/react';

export default function SourceToConfigEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {
    strokeWidth: '4px',
    stroke: '#CDCDCD',
  },
  animated = true,
  markerEnd,
}: EdgeProps) {
  const { getNode } = useReactFlow();
  const defaultTargetPosition =
    sourcePosition === Position.Top
      ? Position.Bottom
      : sourcePosition === Position.Bottom
        ? Position.Top
        : sourcePosition === Position.Left
          ? Position.Right
          : Position.Left;

  const defaultSourceX =
    sourcePosition === Position.Left
      ? sourceX + 32
      : sourcePosition === Position.Right
        ? sourceX - 32
        : sourcePosition === Position.Top
          ? sourceX
          : sourceX;

  const defaultSourceY =
    sourcePosition === Position.Top
      ? sourceY + 32
      : sourcePosition === Position.Bottom
        ? sourceY - 32
        : sourcePosition === Position.Left
          ? sourceY
          : sourceY;

  const sourceNode = getNode(source);
  const targetNode = getNode(target);

  // let defaultTargetX
  // let defaultTargetY
  const defaultTargetWidth =
    targetNode?.type === 'load'
      ? 80
      : targetNode?.type === 'llm'
        ? 80
        : targetNode?.type === 'chunk'
          ? 80
          : targetNode?.type === 'search'
            ? 80
            : targetNode?.type === 'code'
              ? 80
              : targetNode?.type === 'generate'
                ? 80
                : targetNode?.type === 'embedding'
                  ? 80
                  : targetNode?.type === 'modify'
                    ? 80
                    : 80;

  const defaultTargetHeight =
    targetNode?.type === 'load'
      ? 48
      : targetNode?.type === 'llm'
        ? 48
        : targetNode?.type === 'chunk'
          ? 48
          : targetNode?.type === 'search'
            ? 48
            : targetNode?.type === 'code'
              ? 48
              : targetNode?.type === 'generate'
                ? 48
                : targetNode?.type === 'embedding'
                  ? 48
                  : targetNode?.type === 'modify'
                    ? 48
                    : 48;

  // resolving prob: targetNode possibly undefined!
  let targetWidth = targetNode?.measured?.width ?? defaultTargetWidth;
  let targetHeight = targetNode?.measured?.height ?? defaultTargetHeight;

  // console.log(targetWidth, targetHeight, targetNode?.type)
  // console.log(sourceNode?.measured?.width ?? 0, sourceNode?.measured?.height ?? 0, sourceNode?.position.x, sourceNode?.position.y)

  // initialize targetX, targetY
  // switch (defaultTargetPosition) {
  //   case Position.Top:
  //     defaultTargetX = sourceX;
  //     defaultTargetY = targetY;
  //     break
  //   case Position.Bottom:
  //     defaultTargetX = sourceX
  //     defaultTargetY = targetY + targetHeight;
  //     break;
  //   case Position.Left:
  //     defaultTargetX = targetX - targetWidth / 2 ;
  //     defaultTargetY = sourceY
  //     break;
  //   case Position.Right:
  //     defaultTargetX = targetX + targetWidth / 2;
  //     defaultTargetY = sourceY
  //     break;
  //   default:
  //     // 处理未定义的位置情况
  //     defaultTargetX = targetX
  //     defaultTargetY = targetY
  //     return;
  // }

  const getDefaultPosition = () => {
    switch (defaultTargetPosition) {
      case Position.Top:
        return {
          x: sourceX,
          y: targetY,
        };
      case Position.Bottom:
        return {
          x: sourceX,
          y: targetY + targetHeight,
        };
      case Position.Left:
        return {
          x: targetX - targetWidth / 2,
          y: sourceY,
        };
      case Position.Right:
        return {
          x: targetX + targetWidth / 2,
          y: sourceY,
        };
      default:
        return {
          x: targetX,
          y: targetY,
        };
    }
  };

  const defaultPosition = getDefaultPosition();

  // use States to manage targetX, targetY
  // const [dynamicTargetX, setDynamicTargetX] = useState(defaultTargetX)
  // const [dynamicTargetY, setDynamicTargetY] = useState(defaultTargetY)

  const [dynamicTargetX, setDynamicTargetX] = useState(defaultPosition.x);
  const [dynamicTargetY, setDynamicTargetY] = useState(defaultPosition.y);

  // dynamically update the targetX, targetY
  // useEffect(() => {

  // if (targetNode && targetNode.measured?.height && targetNode.measured.width) {

  //   let newTargetX, newTargetY

  //   switch (defaultTargetPosition) {
  //     case Position.Top:
  //       newTargetX = targetNode.position.x + targetNode.measured.width / 2
  //       newTargetY = targetNode.position.y
  //       break
  //     case Position.Bottom:
  //       newTargetX = targetNode.position.x + targetNode.measured.width / 2
  //       newTargetY = targetNode.position.y + targetNode.measured.height
  //       break
  //     case Position.Left:
  //       newTargetX = targetNode.position.x
  //       newTargetY = targetNode.position.y + targetNode.measured.height / 2
  //       break
  //     case Position.Right:
  //       newTargetX = targetNode.position.x + targetNode.measured.width
  //       newTargetY = targetNode.position.y + targetNode.measured.height / 2
  //       break
  //     default:
  //       // 处理未定义的位置情况
  //       newTargetX = targetX
  //       newTargetY = targetY
  //       return
  //   }

  //   setDynamicTargetX(newTargetX);
  //   setDynamicTargetY(newTargetY);
  // }
  // }, [getNode, targetNode?.position.x, sourceNode?.position.x, targetNode?.position.y, sourceNode?.position.y]);

  useEffect(() => {
    if (
      targetNode &&
      targetNode.measured?.height &&
      targetNode.measured.width
    ) {
      let newTargetX, newTargetY;

      switch (defaultTargetPosition) {
        case Position.Top:
          newTargetX = targetNode.position.x + targetNode.measured.width / 2;
          newTargetY = targetNode.position.y;
          break;
        case Position.Bottom:
          newTargetX = targetNode.position.x + targetNode.measured.width / 2;
          newTargetY = targetNode.position.y + targetNode.measured.height;
          break;
        case Position.Left:
          newTargetX = targetNode.position.x;
          newTargetY = targetNode.position.y + targetNode.measured.height / 2;
          break;
        case Position.Right:
          newTargetX = targetNode.position.x + targetNode.measured.width;
          newTargetY = targetNode.position.y + targetNode.measured.height / 2;
          break;
        default:
          newTargetX = targetX;
          newTargetY = targetY;
          return;
      }

      setDynamicTargetX(newTargetX);
      setDynamicTargetY(newTargetY);
    }
  }, [
    targetNode,
    defaultTargetPosition,
    targetX,
    targetY,
    targetNode?.position.x,
    targetNode?.position.y,
    targetNode?.measured?.width,
    targetNode?.measured?.height,
  ]);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: defaultSourceX,
    sourceY: defaultSourceY,
    sourcePosition,
    targetX: dynamicTargetX,
    targetY: dynamicTargetY,
    targetPosition: defaultTargetPosition,
    borderRadius: 50,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
    </>
  );
}
