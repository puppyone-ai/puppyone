'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import UserMenuPanel from '../UserMenuPanel';
import { type NodeInfo } from '../../lib/contentTreeApi';
import { ProjectSwitcher, type ProjectOption } from './ProjectSwitcher';
import { getEnvironmentLabel } from '../../lib/env';

export type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  groupEnd?: boolean;
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
  onHoverNavItem?: (viewId: string) => void; // prefetch on hover
  onHoverProject?: (projectId: string) => void; // prefetch on hover
  onBack?: () => void; // Only for project context

  // User Info
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;
  onOpenGuide?: () => void; // Open getting-started guide

  // Optional project stats line — when in a project context the footer
  // can show `[• shortId · N commits]` (showcase parity) instead of the
  // generic env chip. Falls back to env when undefined.
  projectStats?: {
    shortId: string;
    commitCount?: number;
  };

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
  onHoverNavItem,
  onHoverProject,
  onBack,
  userInitial,
  userAvatarUrl,
  environmentLabel,
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
  onOpenGuide,
  projectStats,
}: SidebarLayoutProps) {
  const t = useTranslations('sidebar');
  const resolvedEnvLabel = environmentLabel ?? getEnvironmentLabel();

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

  // Sidebar nav row — 32px tall, 13px sans, 10px x-padding, 10px gap.
  // Active rows get an elevated bg + an accent bar drawn from the row
  // (rendered separately as an absolutely-positioned span so it sits
  // flush against the panel's left edge).
  const navButtonClass = (isActive: boolean) =>
    clsx(
      'group relative flex h-8 w-full items-center gap-2.5 rounded-[6px] bg-transparent px-2.5 text-left text-[13px] transition-colors duration-150',
      isActive
        ? 'bg-white/[0.06] font-medium'
        : 'hover:bg-white/[0.03] font-normal'
    );

  const navIconClass = (isActive: boolean) =>
    clsx(
      'flex h-[15px] w-[15px] items-center justify-center transition-colors duration-150',
      isActive ? 'text-[#ededed]' : 'text-[#6d7177] group-hover:text-[#ededed]'
    );

  const navLabelClass = (isActive: boolean) =>
    clsx(
      'truncate transition-colors duration-150',
      isActive ? 'text-[#ededed]' : 'text-[#a1a1aa] group-hover:text-[#ededed]'
    );

  const collapsedBtnClass = (isActive: boolean) =>
    clsx(
      'flex h-8 w-8 items-center justify-center rounded-[6px] bg-transparent text-[#808080] transition-colors duration-150 hover:bg-white/[0.06] hover:text-[#ededed]',
      isActive && 'bg-white/[0.06] text-[#ededed]'
    );

  return (
    <aside
      ref={sidebarRef}
      className={clsx(
        'relative flex h-screen flex-shrink-0 flex-col font-sans text-sm',
        isResizing
          ? 'transition-none'
          : 'transition-[width] duration-200 ease-in-out'
      )}
      style={{
        width: effectiveCollapsed ? 47 : sidebarWidth,
        // Sidebar shares the base panel color of <main>. With identical
        // base colors, every alpha hairline (header bottom, footer top,
        // sidebar/content vertical divider) renders the same shade
        // across the boundary, so the lines read as continuous.
        background: '#0e0e0e',
        // The vertical line between sidebar and content lives here on
        // the sidebar's right edge — replaces the per-page `borderLeft`
        // we used to draw inside each page. Single source of truth.
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header — 40px, flush to top. The bottom hairline matches every
          page-level header so the divider reads as a single continuous
          line that runs across sidebar → content. Inline style keeps
          the value identical to ProjectsHeader / ExplorerSidebar. */}
      <div
        className={clsx(
          'box-border flex h-10 flex-shrink-0 items-center group/header',
          effectiveCollapsed
            ? 'justify-center px-0'
            : 'justify-between px-3'
        )}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        {effectiveCollapsed ? (
          <button
            type='button'
            className='group relative flex h-8 w-8 items-center justify-center rounded-[5px] transition-colors duration-150 hover:bg-white/8'
            onClick={() => handleCollapsedChange(false)}
            title={t('expand')}
            aria-label={t('expand')}
          >
            <img
              className='block group-hover:hidden rounded-[4px]'
              src='/puppyone-logo.svg'
              alt='puppyone'
              width={20}
              height={20}
            />
            <svg
              className='hidden text-[#9ca3af] group-hover:block'
              width='16'
              height='16'
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
                onHoverProject={onHoverProject}
              />
            ) : (
              // Fallback: simple title display
              <div className='flex items-center gap-2 overflow-hidden px-2'>
                <img
                  src='/puppyone-logo.svg'
                  alt='puppyone'
                  width={20}
                  height={20}
                  className='flex-shrink-0 rounded-[4px]'
                />
                <span className='text-sm font-semibold tracking-[0.3px] text-[#ededed] truncate'>
                  {title}
                </span>
              </div>
            )}

            <button
              type='button'
              className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] text-[#6b7280] opacity-0 transition-[opacity,colors,background] duration-150 group-hover/header:opacity-100 hover:bg-white/[0.06] hover:text-[#ededed]'
              onClick={() => handleCollapsedChange(true)}
              title={t('collapse')}
              aria-label={t('collapse')}
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
          <div className='flex flex-col gap-px px-1.5 py-2'>
            {navItems.map(item => {
              const isActive = activeView === item.id;
              return (
                <React.Fragment key={item.id}>
                  <button
                    type='button'
                    className={navButtonClass(isActive)}
                    onClick={() => onNavigate(item.id)}
                    onMouseEnter={() => onHoverNavItem?.(item.id)}
                  >
                    {/* Accent bar — flush against the panel's left edge.
                        Uses a small purple accent + soft glow to mark the
                        active surface, matching the showcase. */}
                    {isActive && (
                      <span
                        aria-hidden
                        className='pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-[1px]'
                        style={{
                          background: '#a78bfa',
                          boxShadow: '0 0 6px rgba(167,139,250,0.45)',
                        }}
                      />
                    )}

                    <span className={navIconClass(isActive)}>{item.icon}</span>

                    <span className={navLabelClass(isActive)}>{item.label}</span>

                    {item.badge !== undefined && item.badge > 0 && (
                      <span className='ml-auto rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#6d7177]'>
                        {item.badge}
                      </span>
                    )}
                  </button>
                  {item.groupEnd && (
                    <div className='my-1.5 mx-1 border-t border-white/[0.06]' />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div className='flex-1 pt-1 pb-3'>
          <div className='flex flex-col items-center gap-2'>
            {navItems.map(item => (
              <React.Fragment key={item.id}>
                <button
                  type='button'
                  className={collapsedBtnClass(activeView === item.id)}
                  onClick={() => onNavigate(item.id)}
                  onMouseEnter={() => onHoverNavItem?.(item.id)}
                  title={item.label}
                  aria-label={item.label}
                >
                  {React.isValidElement(item.icon)
                    ? React.cloneElement(item.icon, {
                        width: 18,
                        height: 18,
                      } as any)
                    : item.icon}
                </button>
                {item.groupEnd && (
                  <div className='w-5 border-t border-white/[0.06]' />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Footer — 40px, hairline divider on top, smaller env chip,
          tighter avatar so the bar reads as a quiet status line
          rather than a heavy CTA bar. */}
      <div
        className={clsx(
          'flex h-10 flex-shrink-0 items-center',
          effectiveCollapsed ? 'justify-center px-2' : 'justify-between px-3'
        )}
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        {!effectiveCollapsed && (
          projectStats ? (
            // In a project: show shortId · commits (matches the
            // showcase footer). The pulse dot signals "live state".
            <span
              className='flex items-center gap-2 text-[10px] tracking-[0.04em] text-[#808080]'
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              title={`${resolvedEnvLabel} · ${projectStats.shortId}`}
            >
              <span
                className='flex-shrink-0 rounded-full'
                style={{
                  width: 6,
                  height: 6,
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34,197,94,0.55)',
                }}
              />
              <span>{projectStats.shortId}</span>
              {typeof projectStats.commitCount === 'number' && (
                <>
                  <span className='text-[#3f3f46]'>·</span>
                  <span>{projectStats.commitCount} commits</span>
                </>
              )}
            </span>
          ) : (
            <span
              className='flex h-[22px] items-center rounded-[4px] bg-white/[0.04] px-2 text-[10px] tracking-[0.04em] text-[#808080]'
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {resolvedEnvLabel}
            </span>
          )
        )}

        <div className='flex items-center gap-1'>
          {/* Guide button */}
          {onOpenGuide && !effectiveCollapsed && (
            <button
              type='button'
              onClick={onOpenGuide}
              title={t('guide')}
              aria-label={t('guide')}
              className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[#555] transition-colors hover:bg-white/[0.06] hover:text-[#a1a1aa]'
            >
              <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
                <circle cx='12' cy='12' r='10' />
                <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
                <line x1='12' y1='17' x2='12.01' y2='17' />
              </svg>
            </button>
          )}

          <button
            type='button'
            className='flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#3a3a3a] text-[10px] font-semibold text-white transition-all duration-200 hover:bg-[#4a4a4a] hover:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
            onClick={() => setUserMenuOpen(true)}
            title={t('accountSettings')}
            aria-label={t('accountSettings')}
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
