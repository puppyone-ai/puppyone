'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import UserMenuPanel from '../UserMenuPanel';
import { type NodeInfo } from '../../lib/contentNodesApi';
import { ProjectSwitcher, type ProjectOption } from './ProjectSwitcher';

export type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
};

export type SidebarLayoutProps = {
  // Context Info
  title: string; // 'puppyone' or Project Name
  context: 'global' | 'project';

  // Project Switcher
  currentProjectId?: string | null;
  projects?: ProjectOption[];
  onSelectProject?: (projectId: string) => void;
  onGoHome?: () => void;

  // Navigation State
  activeView?: string;
  navItems: NavItem[];
  onNavigate: (viewId: string) => void;
  onBack?: () => void; // Only for project context

  // User Info
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;

  // Layout State
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
};

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;

export function SidebarLayout({
  title,
  context,
  currentProjectId,
  projects = [],
  onSelectProject,
  onGoHome,
  activeView,
  navItems,
  onNavigate,
  onBack,
  userInitial,
  userAvatarUrl,
  environmentLabel = 'Local Dev',
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
}: SidebarLayoutProps) {
  // 内部 collapsed 状态（非受控模式时使用）
  const [internalCollapsed, setInternalCollapsed] = useState(false);
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
      'flex h-8 w-8 items-center justify-center rounded-[5px] bg-transparent text-[#808080] transition-colors duration-150 hover:bg-white/8 hover:text-[#e2e8f0]',
      isActive && 'bg-white/10 text-[#e2e8f0]'
    );

  return (
    <aside
      ref={sidebarRef}
      className={clsx(
        'relative flex h-screen flex-shrink-0 flex-col bg-[#1c1c1c] border-r border-white/[0.08] font-sans text-sm',
        isResizing
          ? 'transition-none'
          : 'transition-[width] duration-200 ease-in-out'
      )}
      style={{ width: effectiveCollapsed ? 47 : sidebarWidth }}
    >
      {/* Header */}
      <div
        className={clsx(
          'box-border flex h-[48px] items-center border-b border-white/[0.1]',
          effectiveCollapsed
            ? 'justify-center px-0'
            : 'justify-between pl-2 pr-[9px]'
        )}
      >
        {effectiveCollapsed ? (
          <button
            type='button'
            className='group relative flex h-8 w-8 items-center justify-center rounded-[5px] transition-colors duration-150 hover:bg-white/8'
            onClick={() => handleCollapsedChange(false)}
            title='Expand sidebar'
            aria-label='Expand sidebar'
          >
            {/* 始终显示公司产品 logo */}
            <img
              className='block group-hover:hidden'
              src='/puppybase.svg'
              alt='puppyone'
              width={14}
              height={14}
            />

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
            {/* Project Switcher (Figma-style) */}
            {onSelectProject && onGoHome ? (
              <ProjectSwitcher
                currentProject={
                  currentProjectId
                    ? projects.find(p => p.id === currentProjectId) || {
                        id: currentProjectId,
                        name: title,
                      }
                    : null
                }
                projects={projects}
                onSelectProject={onSelectProject}
                onGoHome={onGoHome}
              />
            ) : (
              // Fallback: simple title display
              <div className='flex items-center gap-2 overflow-hidden px-2'>
                <img
                  src='/puppybase.svg'
                  alt='puppyone'
                  width={14}
                  height={14}
                  className='flex-shrink-0'
                />
                <span className='text-sm font-semibold tracking-[0.3px] text-[#ededed] truncate'>
                  {title}
                </span>
              </div>
            )}

            <button
              type='button'
              className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[5px] text-[#6b7280] transition-colors duration-150 hover:bg-white/8 hover:text-[#9ca3af]'
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
            {navItems.map(item => (
              <button
                key={item.id}
                type='button'
                className={navButtonClass(activeView === item.id)}
                onClick={() => onNavigate(item.id)}
              >
                <span className={navIconClass(activeView === item.id)}>
                  {item.icon}
                </span>

                <span className={navLabelClass(activeView === item.id)}>
                  {item.label}
                </span>

                {item.badge !== undefined && item.badge > 0 && (
                  <span className='ml-auto rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#6d7177]'>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className='flex-1 py-3'>
          <div className='flex flex-col items-center gap-2'>
            {navItems.map(item => (
              <button
                key={item.id}
                type='button'
                className={collapsedBtnClass(activeView === item.id)}
                onClick={() => onNavigate(item.id)}
                title={item.label}
                aria-label={item.label}
              >
                {/* Clone icon to adjust size for collapsed view if needed, or just use as is */}
                {React.isValidElement(item.icon)
                  ? React.cloneElement(item.icon, {
                      width: 18,
                      height: 18,
                    } as any)
                  : item.icon}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        className={clsx(
          'flex h-[47px] flex-shrink-0 items-center',
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
          className='flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#3a3a3a] text-[12px] font-semibold text-white transition-all duration-200 hover:scale-105 hover:bg-[#4a4a4a] hover:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
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
