import { getBezierPath, useInternalNode, EdgeProps, getSmoothStepPath, BaseEdge, Position } from '@xyflow/react';
import { getEdgeParams } from '../../hooks/useFloatingEdgeUtils';
 
function FloatingEdge({ id, 
    source, 
    target, 
    markerEnd, 
    selected,
    data = {
        connectionType: "STC"
    },
    style = {
        strokeWidth: "4px",
        stroke: "#CDCDCD",
        fill:"transparent"
  } }:EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
 
  if (!sourceNode || !targetNode) {
    return null;
  }
 
  let { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );
 

  
  if (data.connectionType === "STC") {

    const [edgePath] = getSmoothStepPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: sourcePos,
        targetPosition: targetPos,
        targetX: tx,
        targetY: ty,
        borderRadius: 50,
      });

    return (
       
    <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style}  />
  );
 }
 else if (data.connectionType === "CTT") {

    // recalculate edgePath targetX and targetY for MarkerEnd arrow (10px)
    switch (targetPos) {
        case (Position.Left):
            tx -= 10
            break
        case (Position.Right):
            tx += 10
            break
        case (Position.Top):
            ty -= 10
            break
        case (Position.Bottom):
            ty += 10
            break
    }

    const [edgePath] = getSmoothStepPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: sourcePos,
        targetPosition: targetPos,
        targetX: tx,
        targetY: ty,
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
          <BaseEdge id={id} path={edgePath} markerEnd={`url(#custom-arrow-${selected ? "selected" : "default"})`} style={style}  />
        </>
      );
 }
}
 
export default FloatingEdge;

