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
        borderRadius: 40,
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
        borderRadius: 40,
      });

    return (
        <>
             <defs>
              {/* 默认箭头 */}
             <marker
                id="custom-arrow-default"
                viewBox="0 0 14 22"
                refX="11"
                refY="11"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M2 2L11 11L2 20"
                  fill="none"
                  stroke="#CDCDCD"
                  strokeWidth="4"
                />
              </marker>  
              {/* 选中箭头 */}
              <marker
                id="custom-arrow-selected"
                viewBox="0 0 14 22"
                refX="11"
                refY="11"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M2 2L11 11L2 20"
                  fill="none"
                  stroke="#FFA73D"
                  strokeWidth="4"
                />
              </marker>
          </defs>  
          <BaseEdge id={id} path={edgePath} markerEnd={`url(#custom-arrow-${selected ? "selected" : "default"})`} style={style}  />
        </>
      );
 }
}
 
export default FloatingEdge;

