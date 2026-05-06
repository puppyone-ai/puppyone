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

// Brand blue — single source of truth for the workspace identity
// chip (both the expanded ProjectSwitcher chip and the collapsed
// sidebar chip). Picked to read as PuppyOne's primary accent against
// the #121212 / #181818 sidebar surfaces. Keep this in sync with
// `BRAND_BLUE` in `ProjectSwitcher.tsx`.
const BRAND_BLUE = '#4599DF';

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
      isActive ? 'text-[#fafafa]' : 'text-[#a1a1aa] group-hover:text-[#fafafa]'
    );

  const navLabelClass = (isActive: boolean) =>
    clsx(
      'truncate transition-colors duration-150',
      isActive ? 'text-[#fafafa]' : 'text-[#a1a1aa] group-hover:text-[#fafafa]'
    );

  const collapsedBtnClass = (isActive: boolean) =>
    clsx(
      'flex h-8 w-8 items-center justify-center rounded-[6px] bg-transparent text-[#a1a1aa] transition-colors duration-150 hover:bg-white/[0.06] hover:text-[#fafafa]',
      isActive && 'bg-white/[0.06] text-[#fafafa]'
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
        // Mirrors the showcase AppShell's sidebar surface
        // (rgba(255,255,255,0.015) over #0e0e0e ≈ #121212). A very
        // small +4 lift above the content canvas is enough to read
        // as a distinct surface once the 1px border is in place;
        // larger deltas tilt the rail toward "panel-on-panel" and
        // away from the quiet Notion / Linear feel we want.
        background: '#121212',
        // Same 0.08 hairline used everywhere in the showcase
        // (T.border). Keeping all dividers at one alpha keeps the
        // grid consistent across sidebar / header / cards.
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header — 46px row, borderBottom 0.08. Aligns with every
          page-level header across /(main) (Context / Access / History /
          Settings / etc.) so the top band reads as one continuous
          strip across sidebar + main pane.
          Layout is a single flex row so the workspace switcher and the
          collapse toggle each get their own slot and never overlap.
          The collapse button always reserves its slot so the workspace
          name truncates predictably — no layout shift between
          rest/hover states, and the two controls are spatially
          distinct rather than stacked. */}
      <div
        className={clsx(
          'group/header flex items-center',
          effectiveCollapsed && 'justify-center'
        )}
        style={{
          height: 46,
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          boxSizing: 'border-box',
        }}
      >
        {effectiveCollapsed ? (
          // Collapsed identity chip — context-aware:
          //   • In a project: the cyan brand-blue chip with the
          //     workspace's first letter (mirrors the expanded
          //     trigger glyph 1:1 so collapsing doesn't change
          //     identity).
          //   • In org/global view: the puppyone brand mark.
          // On hover the chip morphs into the "expand sidebar"
          // affordance (panel-open icon) — same hover-to-reveal
          // pattern used by the collapse button on the right.
          <button
            type='button'
            className='group flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors duration-150 hover:bg-white/[0.06]'
            onClick={() => handleCollapsedChange(false)}
            title={t('expand')}
            aria-label={t('expand')}
          >
            <span className='block group-hover:hidden'>
              {context === 'project' ? (
                <span
                  aria-hidden
                  className='flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[11px] font-bold uppercase text-white'
                  style={{
                    background: BRAND_BLUE,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                    letterSpacing: 0,
                  }}
                >
                  {(title?.[0] || '?').toUpperCase()}
                </span>
              ) : (
                <img
                  src='/puppyone-logo.svg'
                  alt=''
                  width={22}
                  height={22}
                  className='rounded-[4px]'
                />
              )}
            </span>
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
          <div className='flex h-full w-full items-center gap-1 pl-2 pr-1'>
            {/* Workspace switcher — flexible slot, truncates first */}
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
              <div className='flex min-w-0 flex-1 items-center gap-2 px-1'>
                <img
                  src='/puppyone-logo.svg'
                  alt='puppyone'
                  width={18}
                  height={18}
                  className='flex-shrink-0 rounded-[4px]'
                />
                <span className='truncate text-[12.5px] font-medium text-[#fafafa]'>
                  {title}
                </span>
              </div>
            )}

            {/* Collapse toggle — dedicated 28×28 slot at the right.
                Always rendered (so layout is stable + control is
                discoverable via keyboard), but visually fades in on
                header hover to keep the rest state quiet. */}
            <button
              type='button'
              onClick={() => handleCollapsedChange(true)}
              title={t('collapse')}
              aria-label={t('collapse')}
              className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] text-[#6b7280] opacity-0 transition-opacity duration-150 hover:bg-white/[0.06] hover:text-[#fafafa] group-hover/header:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20'
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
          </div>
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
                    {/* Accent bar — flush against the panel's left
                        edge. Cyan #22d3ee + cyan glow, lifted directly
                        from the showcase's T.live token so the active
                        marker reads as the same "live state" indicator
                        as the footer pulse dot and the diff overlays.
                        The bar inset is 5px top/bottom (showcase
                        AppShell uses `top:5,bottom:5` exactly). */}
                    {isActive && (
                      <span
                        aria-hidden
                        className='pointer-events-none absolute left-0 top-[5px] bottom-[5px] w-[2px] rounded-[1px]'
                        style={{
                          background: '#22d3ee',
                          boxShadow: '0 0 6px rgba(34,211,238,0.4)',
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

      {/* Footer — 46px to match the header (and every page-level
          header across /(main)). Hairline divider on top using the
          same 0.08 alpha as every other border. Footer carries the
          workspace stats line (shortId · N commits) which doubles as
          a "live" indicator via the pulsing dot. */}
      <div
        className={clsx(
          'flex h-[46px] flex-shrink-0 items-center',
          effectiveCollapsed ? 'justify-center px-2' : 'justify-between px-3'
        )}
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        {!effectiveCollapsed && (
          projectStats ? (
            // In a project: show shortId · commits (mirrors the
            // showcase AppShell footer pixel-for-pixel — mono font,
            // 10px size, #52525b text, #27272a separator dot, and
            // a 6×6 cyan pulse dot anchored to T.live).
            <span
              className='flex items-center gap-[6px] text-[10px] tracking-[0.04em] text-[#52525b]'
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              title={`${resolvedEnvLabel} · ${projectStats.shortId}`}
            >
              <span
                className='flex-shrink-0 rounded-full'
                style={{
                  width: 6,
                  height: 6,
                  background: '#22d3ee',
                  boxShadow: '0 0 8px #22d3ee',
                }}
              />
              <span>{projectStats.shortId}</span>
              {typeof projectStats.commitCount === 'number' && (
                <>
                  <span className='text-[#27272a]'>·</span>
                  <span>{projectStats.commitCount} commits</span>
                </>
              )}
            </span>
          ) : (
            <span
              className='flex h-[22px] items-center rounded-[4px] bg-white/[0.04] px-2 text-[10px] tracking-[0.04em] text-[#52525b]'
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
