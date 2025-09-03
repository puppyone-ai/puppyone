import { useCallback } from 'react';
import { Edge, Node, Position, addEdge, useReactFlow, Connection } from '@xyflow/react';
import { nanoid } from 'nanoid';
import useManageReactFlowUtils from './useManageReactFlowUtils';

type ScreenPoint = { x: number; y: number };

export default function useConnectSpawn() {
  const { screenToFlowPosition, getNode } = useReactFlow();
  const { judgeNodeIsEdgeNode } = useManageReactFlowUtils();

  const computeBlockAlignedPosition = useCallback(
    (sourceId: string, screenPoint: ScreenPoint) => {
      const point = screenToFlowPosition(screenPoint);
      const sourceNode = getNode(sourceId);

      const BLOCK_W = 240;
      const BLOCK_H = 176;
      let blockX = point.x - BLOCK_W / 2;
      let blockY = point.y - BLOCK_H / 2;

      if (sourceNode && typeof (sourceNode as any).width === 'number' && typeof (sourceNode as any).height === 'number') {
        const centerX = sourceNode.position.x + (sourceNode as any).width / 2;
        const centerY = sourceNode.position.y + (sourceNode as any).height / 2;
        const dx = point.x - centerX;
        const dy = point.y - centerY;

        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx >= 0) {
            blockX = point.x;
            blockY = point.y - BLOCK_H / 2;
          } else {
            blockX = point.x - BLOCK_W;
            blockY = point.y - BLOCK_H / 2;
          }
        } else {
          if (dy >= 0) {
            blockX = point.x - BLOCK_W / 2;
            blockY = point.y;
          } else {
            blockX = point.x - BLOCK_W / 2;
            blockY = point.y - BLOCK_H;
          }
        }
      }

      return { x: blockX, y: blockY };
    },
    [screenToFlowPosition, getNode]
  );

  const spawnOnConnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      connectStart: { nodeId: string | null; handleType: 'target' | 'source' | null },
      setNodes: (updater: (prev: Node[]) => Node[]) => void,
      setEdges: (updater: (prev: Edge[]) => Edge[]) => void,
      markerEnd: any
    ) => {
      if (!connectStart.nodeId || connectStart.handleType !== 'source') return;

      const isMouse = (event as MouseEvent).clientX !== undefined;
      const screenPoint = {
        x: isMouse ? (event as MouseEvent).clientX : (event as TouchEvent).changedTouches[0].clientX,
        y: isMouse ? (event as MouseEvent).clientY : (event as TouchEvent).changedTouches[0].clientY,
      };

      const sourceId = connectStart.nodeId as string;
      const sourceIsEdgeNode = judgeNodeIsEdgeNode(sourceId);

      if (sourceIsEdgeNode) {
        // Create Text Block
        const pos = computeBlockAlignedPosition(sourceId, screenPoint);
        const newNodeId = nanoid(6);
        const newTextNode: Node = {
          id: newNodeId,
          type: 'text',
          position: pos,
          data: {
            content: '',
            label: newNodeId,
            isLoading: false,
            isWaitingForFlow: false,
            locked: false,
            isInput: false,
            isOutput: false,
            editable: false,
          },
          width: 240,
          height: 176,
        } as any;

        setNodes(prev => prev.concat(newTextNode));
        setEdges(prev =>
          addEdge(
            {
              id: nanoid(6),
              source: sourceId,
              target: newNodeId,
              type: 'floating',
              data: { connectionType: 'CTT' },
              markerEnd,
            } as any,
            prev
          )
        );
      } else {
        // Create EdgeMenu
        const point = screenToFlowPosition(screenPoint);
        const newNodeId = nanoid(6);
        const sourceNode = getNode(sourceId);
        const newNode: Node = {
          id: newNodeId,
          type: 'edgeMenu',
          position: { x: point.x - 40, y: point.y - 24 },
          data: {
            sourceNodeId: sourceId,
            sourceNodeType: sourceNode?.type || 'text',
          },
        } as any;

        setNodes(prev => prev.concat(newNode));
        setEdges(prev =>
          addEdge(
            {
              id: nanoid(6),
              source: sourceId,
              target: newNodeId,
              type: 'floating',
              data: { connectionType: 'STC' },
            } as any,
            prev
          )
        );
      }
    },
    [judgeNodeIsEdgeNode, screenToFlowPosition, getNode, computeBlockAlignedPosition]
  );

  const handleBlockToBlockConnect = useCallback(
    (
      connection: Connection,
      setNodes: (updater: (prev: Node[]) => Node[]) => void,
      setEdges: (updater: (prev: Edge[]) => Edge[]) => void,
      markerEnd: any
    ): boolean => {
      const sourceId = connection.source as string;
      const targetId = connection.target as string;
      if (!sourceId || !targetId) return false;

      const sourceIsEdge = judgeNodeIsEdgeNode(sourceId);
      const targetIsEdge = judgeNodeIsEdgeNode(targetId);
      if (sourceIsEdge || targetIsEdge) return false; // not block->block

      const source = getNode(sourceId);
      const target = getNode(targetId);
      if (!source || !target) return false;

      const sW = (source as any).width ?? 240;
      const sH = (source as any).height ?? 176;
      const tW = (target as any).width ?? 240;
      const tH = (target as any).height ?? 176;

      const sCX = source.position.x + sW / 2;
      const sCY = source.position.y + sH / 2;
      const tCX = target.position.x + tW / 2;
      const tCY = target.position.y + tH / 2;

      const midX = (sCX + tCX) / 2;
      const midY = (sCY + tCY) / 2;

      const newNodeId = nanoid(6);
      const edgeMenuNode: Node = {
        id: newNodeId,
        type: 'edgeMenu',
        position: { x: midX - 40, y: midY - 24 },
        data: {
          sourceNodeId: sourceId,
          sourceNodeType: source.type || 'text',
        },
      } as any;

      setNodes(prev => prev.concat(edgeMenuNode));

      // connect source block -> edgeMenu (STC)
      setEdges(prev =>
        addEdge(
          {
            id: nanoid(6),
            source: sourceId,
            target: newNodeId,
            type: 'floating',
            data: { connectionType: 'STC' },
          } as any,
          prev
        )
      );

      // connect edgeMenu -> target block (CTT) with arrow
      setEdges(prev =>
        addEdge(
          {
            id: nanoid(6),
            source: newNodeId,
            target: targetId,
            type: 'floating',
            data: { connectionType: 'CTT' },
            markerEnd,
          } as any,
          prev
        )
      );

      return true;
    },
    [judgeNodeIsEdgeNode, getNode]
  );

  return { spawnOnConnectEnd, handleBlockToBlockConnect };
}


