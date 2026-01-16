'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import UserMenuPanel from './UserMenuPanel';

type UtilityNavItem = {
  id: string;
  label: string;
  path: string;
  isAvailable: boolean;
};

type ProjectsSidebarProps = {
  projects: ProjectInfo[];
  activeBaseId: string;
  expandedBaseIds: Set<string>;
  activeTableId: string;
  activeView?: string;
  onBaseClick: (projectId: string) => void;
  onTableClick: (projectId: string, tableId: string) => void;
  utilityNav: UtilityNavItem[];
  onUtilityNavClick: (path: string) => void;
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;
  onProjectsChange?: (projects: ProjectInfo[]) => void;
  loading?: boolean;
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  // Tools 数量，用于显示徽章
  toolsCount?: number;
};

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;

export function ProjectsSidebar({
  projects,
  activeView = 'projects',
  onUtilityNavClick,
  userInitial,
  userAvatarUrl,
  environmentLabel = 'Local Dev',
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
  toolsCount = 0,
}: ProjectsSidebarProps) {
  // 内部 collapsed 状态（非受控模式时使用）
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  // 如果外部传了 onCollapsedChange，使用受控模式；否则使用内部状态
  const isControlled = onCollapsedChange !== undefined;
  const effectiveCollapsed = isControlled ? isCollapsed : internalCollapsed;

  const handleCollapsedChange = (collapsed: boolean) => {
    if (isControlled) {
      onCollapsedChange?.(collapsed);
    } else {
      setInternalCollapsed(collapsed);
    }
  };

  const [isResizing, setIsResizing] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
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

  const navButtonClass = (isActive: boolean) =>
    clsx(
      'group flex h-7 w-full items-center gap-2 rounded-[5px] bg-transparent pl-[6px] pr-1 text-left transition-colors duration-150',
      isActive ? 'bg-[#2c2c2c]' : 'hover:bg-[#2c2c2c]'
    );

  const navIconClass = (isActive: boolean) =>
    clsx(
      'flex h-4 w-4 items-center justify-center transition-colors duration-150',
      isActive ? 'text-[#cdcdcd]' : 'text-[#6d7177] group-hover:text-[#cdcdcd]'
    );

  const navLabelClass = (isActive: boolean) =>
    clsx(
      'truncate text-sm transition-colors duration-150',
      isActive ? 'text-white' : 'text-[#9b9b9b] group-hover:text-[#f0efed]'
    );

  const collapsedBtnClass = (isActive: boolean) =>
    clsx(
      'flex h-7 w-7 items-center justify-center rounded-[5px] bg-transparent text-[#808080] transition-colors duration-150 hover:bg-white/8 hover:text-[#e2e8f0]',
      isActive && 'bg-white/10 text-[#e2e8f0]'
    );

  return (
    <aside
      ref={sidebarRef}
      className={clsx(
        'relative flex h-screen flex-shrink-0 flex-col bg-[#202020] font-sans text-sm',
        isResizing
          ? 'transition-none'
          : 'transition-[width] duration-200 ease-in-out'
      )}
      style={{ width: effectiveCollapsed ? 45 : sidebarWidth }}
    >
      {/* Header */}
      <div
        className={clsx(
          'box-border flex h-[54px] items-center',
          effectiveCollapsed
            ? 'justify-center px-0 pt-2'
            : 'justify-between pl-4 pr-[9px] pt-2'
        )}
      >
        {effectiveCollapsed ? (
          <button
            type='button'
            className='group relative flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors duration-150 hover:bg-white/8'
            onClick={() => handleCollapsedChange(false)}
            title='Expand sidebar'
            aria-label='Expand sidebar'
          >
            {/* Product logo - shows by default, hides on hover */}
            <img
              className='block group-hover:hidden'
              src='/puppybase.svg'
              alt='puppyone'
              width={14}
              height={14}
            />

            {/* Sidebar toggle icon - hidden by default, shows on hover */}
            <svg
              className='hidden text-[#9ca3af] group-hover:block'
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' />
              <line x1='9' y1='3' x2='9' y2='21' />
            </svg>
          </button>
        ) : (
          <>
            <div className='flex items-center gap-2'>
              <img src='/puppybase.svg' alt='puppyone' width={14} height={14} />
              <span className='text-sm font-semibold tracking-[0.3px] text-[#ededed]'>
                puppyone
              </span>
            </div>

            <button
              type='button'
              className='flex h-7 w-7 items-center justify-center rounded-[5px] text-[#6b7280] transition-colors duration-150 hover:bg-white/8 hover:text-[#9ca3af]'
              onClick={() => handleCollapsedChange(true)}
              title='Collapse sidebar'
              aria-label='Collapse sidebar'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' />
                <line x1='9' y1='3' x2='9' y2='21' />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Content / Collapsed Navigation */}
      {!effectiveCollapsed ? (
        <div className='flex-1 overflow-y-auto overflow-x-hidden'>
          <div className='flex flex-col gap-[2px] px-2 pb-2 pt-3'>
            {/* Projects */}
            <button
              type='button'
              className={navButtonClass(activeView === 'projects')}
              onClick={() => onUtilityNavClick('projects')}
            >
              <span className={navIconClass(activeView === 'projects')}>
                <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                  {/* Box Icon - Cube Style */}
                  <path
                    d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinejoin='round'
                  />
                  <path
                    d='M1 3.5L7 6.5L13 3.5'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinejoin='round'
                  />
                  <path
                    d='M7 6.5V13.5'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinejoin='round'
                  />
                </svg>
              </span>

              <span className={navLabelClass(activeView === 'projects')}>
                Projects
              </span>

              {projects.length > 0 && (
                <span className='ml-auto rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#6d7177]'>
                  {projects.length}
                </span>
              )}
            </button>

            {/* Tools & MCP */}
            <button
              type='button'
              className={navButtonClass(activeView === 'tools')}
              onClick={() => onUtilityNavClick('tools')}
            >
              <span className={navIconClass(activeView === 'tools')}>
                <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                  <path
                    d='M9 2.5h2.5V5M11.5 2.5L6 8M11 9v2.5a1.5 1.5 0 01-1.5 1.5H3.5A1.5 1.5 0 012 11.5V5.5A1.5 1.5 0 013.5 4H6'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </span>

              <span className={navLabelClass(activeView === 'tools')}>
                Tools &amp; MCP
              </span>

              {toolsCount > 0 && (
                <span className='ml-auto rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#6d7177]'>
                  {toolsCount}
                </span>
              )}
            </button>

            {/* Settings */}
            <button
              type='button'
              className={navButtonClass(activeView === 'settings')}
              onClick={() => onUtilityNavClick('settings')}
            >
              <span className={navIconClass(activeView === 'settings')}>
                <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                  <path
                    d='M7 1.75C7 1.75 7.6 1.75 7.6 2.65C7.6 3.15 8 3.55 8.5 3.55C9.4 3.55 10 3.2 10 3.2C10 3.2 10.5 3.6 10.9 4.1C11.3 4.6 11.3 4.6 11.3 4.6C11.3 4.6 10.75 5.15 10.75 6.05C10.75 7.35 11.85 7.9 11.85 7.9C11.85 7.9 11.6 8.65 11.35 9.15C11.1 9.65 11.1 9.65 11.1 9.65C11.1 9.65 10.2 9.5 9.3 10.4C8.4 11.3 8.7 12.35 8.7 12.35C8.7 12.35 8.1 12.35 7.5 12.35L6.45 12.35C5.85 12.35 5.25 12.35 5.25 12.35C5.25 12.35 5.55 11.3 4.65 10.4C3.75 9.5 2.85 9.65 2.85 9.65C2.85 9.65 2.85 9.65 2.6 9.15C2.35 8.65 2.1 7.9 2.1 7.9C2.1 7.9 3.2 7.35 3.2 6.05C3.2 5.15 2.65 4.6 2.65 4.6C2.65 4.6 2.65 4.6 3.05 4.1C3.45 3.6 3.95 3.2 3.95 3.2C3.95 3.2 4.55 3.55 5.45 3.55C5.95 3.55 6.35 3.15 6.35 2.65C6.35 1.75 6.95 1.75 6.95 1.75L7 1.75ZM7 5.25C5.9 5.25 5 6.15 5 7.25C5 8.35 5.9 9.25 7 9.25C8.1 9.25 9 8.35 9 7.25C9 6.15 8.1 5.25 7 5.25Z'
                    stroke='currentColor'
                    strokeWidth='1.2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </span>

              <span className={navLabelClass(activeView === 'settings')}>
                Settings
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className='flex-1 py-3'>
          <div className='flex flex-col items-center gap-2'>
            <button
              type='button'
              className={collapsedBtnClass(activeView === 'projects')}
              onClick={() => onUtilityNavClick('projects')}
              title='Projects'
              aria-label='Projects'
            >
              <svg width='16' height='16' viewBox='0 0 14 14' fill='none'>
                {/* Box Icon - Cube Style */}
                <path
                  d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinejoin='round'
                />
                <path
                  d='M1 3.5L7 6.5L13 3.5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinejoin='round'
                />
                <path
                  d='M7 6.5V13.5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinejoin='round'
                />
              </svg>
            </button>

            <button
              type='button'
              className={collapsedBtnClass(activeView === 'tools')}
              onClick={() => onUtilityNavClick('tools')}
              title='Tools & MCP'
              aria-label='Tools & MCP'
            >
              <svg width='18' height='18' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M9 2.5h2.5V5M11.5 2.5L6 8M11 9v2.5a1.5 1.5 0 01-1.5 1.5H3.5A1.5 1.5 0 012 11.5V5.5A1.5 1.5 0 013.5 4H6'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </button>

            <button
              type='button'
              className={collapsedBtnClass(activeView === 'settings')}
              onClick={() => onUtilityNavClick('settings')}
              title='Settings'
              aria-label='Settings'
            >
              <svg width='18' height='18' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 1.75C7 1.75 7.6 1.75 7.6 2.65C7.6 3.15 8 3.55 8.5 3.55C9.4 3.55 10 3.2 10 3.2C10 3.2 10.5 3.6 10.9 4.1C11.3 4.6 11.3 4.6 11.3 4.6C11.3 4.6 10.75 5.15 10.75 6.05C10.75 7.35 11.85 7.9 11.85 7.9C11.85 7.9 11.6 8.65 11.35 9.15C11.1 9.65 11.1 9.65 11.1 9.65C11.1 9.65 10.2 9.5 9.3 10.4C8.4 11.3 8.7 12.35 8.7 12.35C8.7 12.35 8.1 12.35 7.5 12.35L6.45 12.35C5.85 12.35 5.25 12.35 5.25 12.35C5.25 12.35 5.55 11.3 4.65 10.4C3.75 9.5 2.85 9.65 2.85 9.65C2.85 9.65 2.85 9.65 2.6 9.15C2.35 8.65 2.1 7.9 2.1 7.9C2.1 7.9 3.2 7.35 3.2 6.05C3.2 5.15 2.65 4.6 2.65 4.6C2.65 4.6 2.65 4.6 3.05 4.1C3.45 3.6 3.95 3.2 3.95 3.2C3.95 3.2 4.55 3.55 5.45 3.55C5.95 3.55 6.35 3.15 6.35 2.65C6.35 1.75 6.95 1.75 6.95 1.75L7 1.75ZM7 5.25C5.9 5.25 5 6.15 5 7.25C5 8.35 5.9 9.25 7 9.25C8.1 9.25 9 8.35 9 7.25C9 6.15 8.1 5.25 7 5.25Z'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        className={clsx(
          'flex h-[45px] flex-shrink-0 items-center',
          effectiveCollapsed ? 'justify-center px-3' : 'justify-between px-4'
        )}
      >
        {!effectiveCollapsed && (
          <span className='flex h-7 items-center rounded-[5px] bg-[#2a2a2a] px-2.5 text-sm text-[#808080]'>
            {environmentLabel}
          </span>
        )}

        <button
          type='button'
          className='flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#3a3a3a] text-[12px] font-semibold text-white transition-all duration-200 hover:scale-105 hover:bg-[#4a4a4a] hover:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
          onClick={() => setUserMenuOpen(true)}
          title='Account settings'
          aria-label='Account settings'
        >
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt='User avatar'
              referrerPolicy='no-referrer'
              className='h-full w-full object-cover'
            />
          ) : (
            userInitial
          )}
        </button>
      </div>

      {/* Resize Handle */}
      {!effectiveCollapsed && (
        <div
          className={clsx(
            'absolute top-0 right-[-2px] z-10 h-full w-1 cursor-col-resize',
            isResizing ? 'bg-white/10' : 'hover:bg-white/10'
          )}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-orientation='vertical'
        />
      )}

      {/* User Menu Panel */}
      <UserMenuPanel
        isOpen={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
      />
    </aside>
  );
}
