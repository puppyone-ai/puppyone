'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import type { ProjectInfo } from '../lib/projectsApi';
import { useExplorerRootNodes } from '../lib/hooks/useData';

type ContextSidebarProps = {
  project: ProjectInfo | null; // Current active project. If null, we might be at root.
  allProjects?: ProjectInfo[]; // For root view if needed, or sidebar switching
  activeTableId: string;
  onTableSelect: (tableId: string) => void;
  onBackToProjects?: () => void;
  className?: string;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
};

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;

export function ContextSidebar({
  project,
  allProjects = [],
  activeTableId,
  onTableSelect,
  onBackToProjects,
  className,
  sidebarWidth = MIN_SIDEBAR_WIDTH,
  onSidebarWidthChange,
}: ContextSidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const { rootNodes } = useExplorerRootNodes(project?.id ?? '');

  // Resize logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const clampedWidth = Math.min(
        Math.max(newWidth, MIN_SIDEBAR_WIDTH),
        MAX_SIDEBAR_WIDTH
      );
      onSidebarWidthChange?.(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onSidebarWidthChange]);

  // If no project is selected, we might want to show the list of projects (Root context)
  // But user said "user already clicked into project", so we assume project is present or handle the case.
  const isRoot = !project;

  return (
    <aside
      className={clsx(
        'relative flex h-full flex-col bg-[var(--po-sidebar)] border-r border-[var(--po-divider)] font-sans text-sm',
        className
      )}
      style={{ width: sidebarWidth }}
    >
      {/* Header / Breadcrumb-ish */}
      <div className='flex h-[45px] items-center px-4 border-b border-[var(--po-divider)] bg-[var(--po-sidebar)] shrink-0'>
        {isRoot ? (
          <div className='flex items-center gap-2 font-medium text-[var(--po-text)]'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
            Projects
          </div>
        ) : (
          <button
            onClick={onBackToProjects}
            className='flex h-[30px] min-w-0 items-center gap-2 font-medium text-[var(--po-text)] hover:text-[var(--po-text)] transition-colors truncate'
            title='Back to Projects'
          >
            <div className='p-1 rounded hover:bg-[var(--po-hover)] transition-colors'>
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M19 12H5M12 19l-7-7 7-7' />
              </svg>
            </div>
            <span className='truncate'>{project.name}</span>
          </button>
        )}
      </div>

      {/* Content Tree */}
      <div className='flex-1 overflow-y-auto py-2'>
        {isRoot ? (
          // Root: List of Projects
          <div className='flex flex-col gap-[1px] px-2'>
            {allProjects.map(p => (
              <button
                key={p.id}
                className={clsx(
                  'group flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors duration-150',
                  'text-[var(--po-text-muted)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)]'
                )}
                onClick={() => onBackToProjects?.()} // In real usage this would navigate to project
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  className='opacity-70 group-hover:opacity-100'
                >
                  <path d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z' />
                </svg>
                <span className='truncate text-[13px]'>{p.name}</span>
              </button>
            ))}
          </div>
        ) : (
          // Project Context: List of Tables/Folders
          <div className='flex flex-col gap-[1px] px-2'>
            <div className='px-2 py-1.5 text-[11px] font-semibold text-[var(--po-text-subtle)] uppercase tracking-wider'>
              Contexts
            </div>
            {rootNodes.length > 0 ? (
              rootNodes.map(node => {
                const nodeId = node.path || node.id;
                const isActive = String(nodeId) === activeTableId;
                return (
                  <button
                    key={nodeId}
                    className={clsx(
                      'group flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left transition-colors duration-150',
                      isActive
                        ? 'bg-[var(--po-selected)] text-[var(--po-text)]'
                        : 'text-[var(--po-text-muted)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)]'
                    )}
                    onClick={() => onTableSelect(String(nodeId))}
                  >
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      className={clsx(
                        isActive
                          ? 'opacity-100'
                          : 'opacity-70 group-hover:opacity-100'
                      )}
                    >
                      {node.type === 'folder' ? (
                        <path d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z' />
                      ) : (
                        <>
                          <rect x='3' y='3' width='18' height='18' rx='2' />
                          <path d='M3 9h18M9 21V9' />
                        </>
                      )}
                    </svg>
                    <span className='truncate text-[13px]'>{node.name}</span>
                  </button>
                );
              })
            ) : (
              <div className='px-2 py-2 text-[12px] text-[var(--po-text-disabled)] italic'>
                No contexts yet.
              </div>
            )}

            {/* Add Button */}
            <button
              className='mt-2 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[var(--po-text-subtle)] hover:text-[var(--po-text-muted)] hover:bg-[var(--po-hover)] transition-colors'
              onClick={() => {}} // Hook this up if needed
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M12 5v14M5 12h14' />
              </svg>
              <span className='text-[12px]'>New Context</span>
            </button>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className={clsx(
          'absolute top-0 right-[-2px] z-10 h-full w-1 cursor-col-resize',
          isResizing ? 'bg-[var(--po-control-hover)]' : 'hover:bg-[var(--po-control-hover)]'
        )}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
