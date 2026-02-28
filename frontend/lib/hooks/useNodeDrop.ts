'use client';

import { useState, useCallback, useRef } from 'react';

export const NODE_DRAG_TYPE = 'application/x-puppyone-node';

export interface DraggedNode {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
}

interface UseNodeDropOptions {
  targetFolderId: string | null;
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  disabled?: boolean;
}

/**
 * Hook to make an element a drop target for node move operations.
 * Handles dragEnter/Over/Leave/Drop events and provides visual feedback state.
 * Designed to be extensible for future multi-select batch moves.
 */
export function useNodeDrop({ targetFolderId, onMoveNode, disabled }: UseNodeDropOptions) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dragCounter = useRef(0);
  const isActive = !disabled && !!onMoveNode;

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isActive || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDropTarget(true);
  }, [isActive]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isActive || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, [isActive]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isActive || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDropTarget(false);
    }
  }, [isActive]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    if (!isActive) return;

    const raw = e.dataTransfer.getData(NODE_DRAG_TYPE);
    if (!raw) return;

    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDropTarget(false);

    try {
      const node: DraggedNode = JSON.parse(raw);
      if (node.id === targetFolderId) return;
      if (node.parentId === targetFolderId) return;
      await onMoveNode!(node.id, targetFolderId, node.parentId);
    } catch (err) {
      console.error('[useNodeDrop] Move failed:', err);
    }
  }, [isActive, targetFolderId, onMoveNode]);

  return {
    isDropTarget: isActive ? isDropTarget : false,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
