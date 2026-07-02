'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export const NODE_DRAG_TYPE = 'application/x-puppyone-node';
const NODE_DRAG_PREVIEW_CLASS = 'puppyone-node-drag-preview';

export interface DraggedNode {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
}

export type NodeDropState = 'none' | 'valid' | 'invalid';

interface UseNodeDropOptions {
  targetFolderId: string | null;
  onMoveNode?: (nodeId: string, targetFolderId: string | null, sourceParentId?: string | null) => Promise<void>;
  disabled?: boolean;
  onHoverExpand?: () => void;
  hoverExpandDelayMs?: number;
}

interface NodeDropPolicy {
  allowed: boolean;
  reason?: string;
}

let activeNodeDrag: DraggedNode | null = null;

function normalizePath(path?: string | null): string {
  return (path ?? '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeParentId(parentId?: string | null): string | null {
  const clean = normalizePath(parentId);
  return clean || null;
}

function parseDraggedNode(raw: string): DraggedNode | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedNode>;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    if (typeof parsed.name !== 'string' || typeof parsed.type !== 'string') return null;
    return {
      id: normalizePath(parsed.id),
      name: parsed.name,
      type: parsed.type,
      parentId: normalizeParentId(parsed.parentId),
    };
  } catch {
    return null;
  }
}

function readDraggedNode(event: React.DragEvent): DraggedNode | null {
  return activeNodeDrag ?? parseDraggedNode(event.dataTransfer.getData(NODE_DRAG_TYPE));
}

function isDescendantPath(parentPath: string, maybeChildPath: string): boolean {
  const parent = normalizePath(parentPath);
  const child = normalizePath(maybeChildPath);
  return Boolean(parent && child.startsWith(`${parent}/`));
}

export function getNodeDropPolicy(
  node: DraggedNode | null,
  targetFolderId: string | null,
): NodeDropPolicy {
  if (!node) return { allowed: false, reason: 'No item is being dragged' };

  const sourceId = normalizePath(node.id);
  const sourceParentId = normalizeParentId(node.parentId);
  const targetId = normalizeParentId(targetFolderId);

  if (!sourceId) return { allowed: false, reason: 'Invalid item' };
  if (sourceId === targetId) {
    return { allowed: false, reason: 'Cannot move an item into itself' };
  }
  if (targetId && isDescendantPath(sourceId, targetId)) {
    return { allowed: false, reason: 'Cannot move a folder into its own subtree' };
  }
  if (sourceParentId === targetId) {
    return { allowed: false, reason: 'Already in this folder' };
  }

  return { allowed: true };
}

function ensureDragPreviewStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('puppyone-node-drag-preview-style')) return;

  const style = document.createElement('style');
  style.id = 'puppyone-node-drag-preview-style';
  style.textContent = `
    .${NODE_DRAG_PREVIEW_CLASS} {
      position: fixed;
      top: -1000px;
      left: -1000px;
      z-index: -1;
      display: flex;
      align-items: center;
      max-width: 260px;
      height: 28px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--po-border-strong);
      background: var(--po-panel-raised);
      color: var(--po-text);
      box-shadow: 0 10px 26px var(--po-shadow);
      font: 600 12px/1 var(--po-font-sans);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function setNodeDragPreview(event: React.DragEvent, label: string): void {
  if (typeof document === 'undefined' || !event.dataTransfer.setDragImage) return;

  ensureDragPreviewStyle();
  const preview = document.createElement('div');
  preview.className = NODE_DRAG_PREVIEW_CLASS;
  preview.textContent = label;
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, 14);
  window.setTimeout(() => preview.remove(), 0);
}

export function beginNodeDrag(event: React.DragEvent, node: DraggedNode): void {
  const dragNode: DraggedNode = {
    id: normalizePath(node.id),
    name: node.name,
    type: node.type,
    parentId: normalizeParentId(node.parentId),
  };

  activeNodeDrag = dragNode;
  event.dataTransfer.setData(NODE_DRAG_TYPE, JSON.stringify(dragNode));
  event.dataTransfer.setData('text/plain', dragNode.name);
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.dropEffect = 'move';
  setNodeDragPreview(event, dragNode.name);
}

export function endNodeDrag(): void {
  activeNodeDrag = null;
}

/**
 * Hook to make an element a drop target for node move operations.
 * Handles dragEnter/Over/Leave/Drop events and provides visual feedback state.
 * Designed to be extensible for future multi-select batch moves.
 */
export function useNodeDrop({
  targetFolderId,
  onMoveNode,
  disabled,
  onHoverExpand,
  hoverExpandDelayMs = 650,
}: UseNodeDropOptions) {
  const [dropState, setDropState] = useState<NodeDropState>('none');
  const [dropReason, setDropReason] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const hoverExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = !disabled && !!onMoveNode;

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimer.current) {
      clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = null;
    }
  }, []);

  const resetDropState = useCallback(() => {
    dragCounter.current = 0;
    clearHoverExpandTimer();
    setDropState('none');
    setDropReason(null);
  }, [clearHoverExpandTimer]);

  useEffect(() => {
    if (dropState === 'none') return;
    window.addEventListener('dragend', resetDropState);
    window.addEventListener('drop', resetDropState);
    return () => {
      window.removeEventListener('dragend', resetDropState);
      window.removeEventListener('drop', resetDropState);
    };
  }, [dropState, resetDropState]);

  const inspectDrop = useCallback((e: React.DragEvent): NodeDropPolicy | null => {
    if (!isActive || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return null;
    return getNodeDropPolicy(readDraggedNode(e), targetFolderId);
  }, [isActive, targetFolderId]);

  const applyDropPolicy = useCallback((policy: NodeDropPolicy | null) => {
    if (!policy) return;
    setDropState(policy.allowed ? 'valid' : 'invalid');
    setDropReason(policy.reason ?? null);

    if (policy.allowed && onHoverExpand && !hoverExpandTimer.current) {
      hoverExpandTimer.current = setTimeout(() => {
        hoverExpandTimer.current = null;
        onHoverExpand();
      }, hoverExpandDelayMs);
    }
    if (!policy.allowed) clearHoverExpandTimer();
  }, [clearHoverExpandTimer, hoverExpandDelayMs, onHoverExpand]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    const policy = inspectDrop(e);
    if (!policy) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    applyDropPolicy(policy);
  }, [applyDropPolicy, inspectDrop]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    const policy = inspectDrop(e);
    if (!policy) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = policy.allowed ? 'move' : 'none';
    applyDropPolicy(policy);
  }, [applyDropPolicy, inspectDrop]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isActive || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      resetDropState();
    }
  }, [isActive, resetDropState]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    if (!isActive) return;

    const node = readDraggedNode(e);
    if (!node) return;

    e.preventDefault();
    e.stopPropagation();
    resetDropState();

    try {
      const policy = getNodeDropPolicy(node, targetFolderId);
      if (!policy.allowed) return;
      await onMoveNode!(node.id, targetFolderId, node.parentId);
    } catch (err) {
      console.error('[useNodeDrop] Move failed:', err);
    }
  }, [isActive, onMoveNode, resetDropState, targetFolderId]);

  return {
    dropState: isActive ? dropState : 'none',
    dropReason: isActive ? dropReason : null,
    isDropTarget: isActive ? dropState === 'valid' : false,
    isInvalidDropTarget: isActive ? dropState === 'invalid' : false,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
