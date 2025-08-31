'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Handle, NodeProps, Node, Position, useReactFlow } from '@xyflow/react';
import EdgeMenu1 from '../edgeNodesCreatingMenu/EdgeSelectorMenu';

export type EdgeMenuTempNodeData = {
  sourceNodeId: string;
  sourceNodeType?: string;
  tempEdgeId?: string;
};

type EdgeMenuTempNodeProps = NodeProps<Node<EdgeMenuTempNodeData>>;

const EdgeMenuNode: React.FC<EdgeMenuTempNodeProps> = ({ id, data, isConnectable }) => {
  const { getNode, setNodes, setEdges } = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sourceType = useMemo(() => {
    return data?.sourceNodeType || getNode(data?.sourceNodeId)?.type || 'text';
  }, [data?.sourceNodeId, data?.sourceNodeType, getNode]);

  const removeSelf = useCallback(() => {
    const nodeId = id;
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    setNodes(prev => prev.filter(n => n.id !== nodeId));
  }, [id, setEdges, setNodes]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as HTMLElement)) {
        removeSelf();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [removeSelf]);

  const handlePick = useCallback(
    (edgeType: string, subMenuType?: string | null) => {
      // transform current node into selected edge node type
      setNodes(prev =>
        prev.map(n =>
          n.id === id
            ? {
                ...n,
                type: edgeType,
                data: { ...n.data, subMenuType: subMenuType ?? null },
              }
            : n
        )
      );
    },
    [id, setNodes]
  );

  const menuDims = useMemo(() => {
    const width = 196;
    const height = sourceType === 'text' ? 386 : sourceType === 'structured' ? 432 : 152;
    return { width, height };
  }, [sourceType]);

  return (
    <div ref={containerRef} className='relative' style={{ width: `${menuDims.width}px`, height: `${menuDims.height}px` }}>
      {/* Invisible source handles to satisfy floating edge geometry */}
      <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
      <Handle
        id={`${id}-b`}
        className='edgeSrcHandle handle-with-icon handle-right'
        type='source'
        position={Position.Right}
        style={{ right: '-12px', top: '10px' }}
      />
      <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
      <Handle
        id={`${id}-d`}
        className='edgeSrcHandle handle-with-icon handle-left'
        type='source'
        position={Position.Left}
        style={{ left: '-12px', top: '10px' }}
      />

      {/* Also add large target handles so this temp node can accept incoming edges if needed */}
      {/* Make side target handles near the top edge to match visual attachment */}
      <Handle
        id={`${id}-t-top`}
        type='target'
        position={Position.Top}
        style={{ opacity: 0, border: 'none', background: 'transparent' }}
        isConnectable={isConnectable}
      />
      <Handle
        id={`${id}-t-right`}
        type='target'
        position={Position.Right}
        style={{ opacity: 0, border: 'none', background: 'transparent', right: '-12px', top: '10px' }}
        isConnectable={isConnectable}
      />
      <Handle
        id={`${id}-t-bottom`}
        type='target'
        position={Position.Bottom}
        style={{ opacity: 0, border: 'none', background: 'transparent' }}
        isConnectable={isConnectable}
      />
      <Handle
        id={`${id}-t-left`}
        type='target'
        position={Position.Left}
        style={{ opacity: 0, border: 'none', background: 'transparent', left: '-12px', top: '10px' }}
        isConnectable={isConnectable}
      />

      {/* Render the existing menu in floating mode pinned to this node's origin */}
      <EdgeMenu1
        nodeType={sourceType}
        position={Position.Right}
        sourceNodeId={data?.sourceNodeId}
        handleId={undefined}
        mode='floating'
        onPick={handlePick}
      />
    </div>
  );
};

export default EdgeMenuNode;


