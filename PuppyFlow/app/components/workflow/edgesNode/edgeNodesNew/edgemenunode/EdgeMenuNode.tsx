'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeProps, Node, Position, useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { UI_COLORS } from '@/app/utils/colors';
import EdgeTypeMenu from './EdgeTypeMenu';

export type EdgeMenuTempNodeData = {
  sourceNodeId: string;
  sourceNodeType?: string;
  tempEdgeId?: string;
};

type EdgeMenuTempNodeProps = NodeProps<Node<EdgeMenuTempNodeData>>;

function ShellHandles({
  id,
  handleStyle,
  isConnectable,
  setIsTargetHandleTouched,
  setIsHovered,
}: {
  id: string;
  handleStyle: React.CSSProperties;
  isConnectable: boolean | undefined;
  setIsTargetHandleTouched: React.Dispatch<React.SetStateAction<boolean>>;
  setIsHovered: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600] edge-node transition-colors gap-[4px]`}
      style={{
        borderColor: UI_COLORS.MAIN_DEEP_GREY,
        color: UI_COLORS.MAIN_DEEP_GREY,
      }}
      title='Edge Node'
    >
      {/* Source handles */}
      <Handle
        id={`${id}-a`}
        className='edgeSrcHandle handle-with-icon handle-top'
        type='source'
        position={Position.Top}
        isConnectable={false}
      />
      <Handle
        id={`${id}-b`}
        className='edgeSrcHandle handle-with-icon handle-right'
        type='source'
        position={Position.Right}
        isConnectable={false}
      />
      <Handle
        id={`${id}-c`}
        className='edgeSrcHandle handle-with-icon handle-bottom'
        type='source'
        position={Position.Bottom}
        isConnectable={false}
      />
      <Handle
        id={`${id}-d`}
        className='edgeSrcHandle handle-with-icon handle-left'
        type='source'
        position={Position.Left}
        isConnectable={false}
      />
      {/* Target handles */}
      <Handle
        id={`${id}-a`}
        type='target'
        position={Position.Top}
        style={handleStyle}
        isConnectable={isConnectable}
        onMouseEnter={() => setIsTargetHandleTouched(true)}
        onMouseLeave={() => setIsTargetHandleTouched(false)}
      />
      <Handle
        id={`${id}-b`}
        type='target'
        position={Position.Right}
        style={handleStyle}
        isConnectable={isConnectable}
        onMouseEnter={() => setIsTargetHandleTouched(true)}
        onMouseLeave={() => setIsTargetHandleTouched(false)}
      />
      <Handle
        id={`${id}-c`}
        type='target'
        position={Position.Bottom}
        style={handleStyle}
        isConnectable={isConnectable}
        onMouseEnter={() => setIsTargetHandleTouched(true)}
        onMouseLeave={() => setIsTargetHandleTouched(false)}
      />
      <Handle
        id={`${id}-d`}
        type='target'
        position={Position.Left}
        style={handleStyle}
        isConnectable={isConnectable}
        onMouseEnter={() => setIsTargetHandleTouched(true)}
        onMouseLeave={() => setIsTargetHandleTouched(false)}
      />
    </button>
  );
}

const EdgeMenuNode: React.FC<EdgeMenuTempNodeProps> = ({ id, data, isConnectable }) => {
  const { getNode, setNodes, setEdges } = useReactFlow();
  const { isOnConnect } = useNodesPerFlowContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const portalAnchorRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [, setIsTargetHandleTouched] = useState(false);

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

  const handleStyle = useMemo(() => ({
    position: 'absolute' as const,
    width: 'calc(100%)',
    height: 'calc(100%)',
    top: '0',
    left: '0',
    borderRadius: '0',
    transform: 'translate(0px, 0px)',
    background: 'transparent',
    border: '3px solid transparent',
    zIndex: !isOnConnect ? '-1' : '1',
  }), [isOnConnect]);

  return (
    <div ref={containerRef} className='p-[3px] w-[80px] h-[48px] relative'>
      <ShellHandles
        id={id}
        handleStyle={handleStyle}
        isConnectable={isConnectable}
        setIsTargetHandleTouched={setIsTargetHandleTouched}
        setIsHovered={setIsHovered}
      />
      {/* Invisible fixed-position anchor to tether the portal menu to this node */}
      <div ref={portalAnchorRef} className='absolute left-0 top-full h-0 w-0' />

      <EdgeTypeMenu
        sourceType={sourceType}
        onPick={handlePick}
        onRequestClose={removeSelf}
        anchorRef={portalAnchorRef}
      />
    </div>
  );
};

export default EdgeMenuNode;
