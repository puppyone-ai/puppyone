'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import UserMenuPanel from '../UserMenuPanel';
import { type NodeInfo } from '../../lib/contentTreeApi';
import { ProjectSwitcher, type ProjectOption } from './ProjectSwitcher';
import { getEnvironmentLabel } from '../../lib/env';
import { SkeletonBlock } from '../loading';

export type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  badgeLoading?: boolean;
  groupEnd?: boolean;
};

export type SidebarLayoutProps = {
  // Context Info
  title: string; // 'puppyone' or Project Name
  titleLoading?: boolean;
  context: 'global' | 'project';

  // Project Switcher
  currentProjectId?: string | null;
  projects?: ProjectOption[];
  projectsLoading?: boolean;
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
  userIdentityLoading?: boolean;
  environmentLabel?: string;
  /**
   * Reserved hook for re-opening the getting-started guide. The
   * footer used to expose this as a "?" button next to the avatar,
   * but the affordance was retired (low-traffic action that paid
   * rent on every page load). Kept on the type so existing call
   * sites — `AppSidebar` and `(main)/layout.tsx` — keep compiling
   * without churn. Intentionally unused inside this component.
   */
  onOpenGuide?: () => void;

  // Optional project stats line — when in a project context the footer
  // can show commit freshness instead of the generic env chip. Falls
  // back to env when undefined.
  projectStats?: {
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
const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;
const SIDEBAR_IDENTITY_CHIP_SIZE = 18;
const SIDEBAR_NAV_ICON_SIZE = 15;
const COLLAPSED_RAIL_INSET = 7.5;

// Brand blue — single source of truth for the workspace identity
// chip (both the expanded ProjectSwitcher chip and the collapsed
// sidebar chip). Picked to read as PuppyOne's primary accent against
// the #121212 / #181818 sidebar surfaces. Keep this in sync with
// `BRAND_BLUE` in `ProjectSwitcher.tsx`.
const BRAND_BLUE = '#4599DF';

export function SidebarLayout({
  title,
  titleLoading = false,
  context,
  currentProjectId,
  projects = [],
  projectsLoading = false,
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
  userIdentityLoading = false,
  environmentLabel,
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
  // `onOpenGuide` is accepted for backward compat (see prop docs)
  // but no longer rendered in the footer.
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
  // Active rows use the same quiet neutral selected surface as the
  // file tree. Keep `bg-transparent` out of the base class: Tailwind's
  // generated order can otherwise let it override the selected bg.
  const navButtonClass = (isActive: boolean) =>
    clsx(
      'group relative flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] transition-colors duration-150',
      isActive
        ? 'bg-[var(--po-selected)] font-medium'
        : 'bg-transparent font-medium hover:bg-[var(--po-hover)]'
    );

  const navIconClass = (isActive: boolean) =>
    clsx(
      'flex h-[15px] w-[15px] items-center justify-center transition-colors duration-150',
      isActive ? 'text-[var(--po-text)]' : 'text-[var(--po-text-muted)] group-hover:text-[var(--po-text)]'
    );

  const navLabelClass = (isActive: boolean) =>
    clsx(
      'truncate transition-colors duration-150',
      isActive ? 'text-[var(--po-text)]' : 'text-[var(--po-text-muted)] group-hover:text-[var(--po-text)]'
    );

  const collapsedBtnClass = (isActive: boolean) =>
    clsx(
      'flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--po-text-muted)] transition-colors duration-150 hover:bg-[var(--po-hover)] hover:text-[var(--po-text)]',
      isActive ? 'bg-[var(--po-selected)] text-[var(--po-text)]' : 'bg-transparent'
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
        background: 'var(--po-sidebar)',
        borderRight: '1px solid var(--po-divider)',
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
          effectiveCollapsed ? 'justify-start' : ''
        )}
        style={{
          height: 46,
          flexShrink: 0,
          borderBottom: '1px solid var(--po-divider)',
          boxSizing: 'border-box',
          paddingLeft: effectiveCollapsed ? COLLAPSED_RAIL_INSET : undefined,
        }}
      >
        {effectiveCollapsed ? (
          // Collapsed identity chip — one grammar across project AND
          // org/global view: the brand-blue 18×18 chip carrying the
          // workspace's first letter. Earlier we forked between the
          // chip (project) and a puppyone-logo image (global), but
          // the two glyphs have very different visual mass (flat
          // letter vs detailed illustration), so the rail "changed
          // shape" when the user navigated home → project. Letter is
          // the first character of whatever title is in scope (project
          // name when in a project, org name when in /home / /team /
          // /billing / /settings). On hover the chip morphs into the
          // "expand sidebar" affordance — same hover-to-reveal pattern
          // used by the collapse button on the right.
          // Geometry locked to the collapsed nav rail below it:
          //   hit area : h-8 w-8 (32×32) — same as `collapsedBtnClass`
          //   chip     : 18×18 — same as ProjectSwitcher's expanded chip
          //   hover icon: 15×15 — same as the expanded nav SVGs
          <button
            type='button'
            className='group flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors duration-150 hover:bg-[var(--po-hover)]'
            onClick={() => handleCollapsedChange(false)}
            title={t('expand')}
            aria-label={t('expand')}
          >
            <span className='block group-hover:hidden'>
              {titleLoading ? (
                <SkeletonBlock width={SIDEBAR_IDENTITY_CHIP_SIZE} height={SIDEBAR_IDENTITY_CHIP_SIZE} radius={5} />
              ) : (
                <span
                  aria-hidden
                  className='flex items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-[var(--po-text-inverse)]'
                  style={{
                    width: SIDEBAR_IDENTITY_CHIP_SIZE,
                    height: SIDEBAR_IDENTITY_CHIP_SIZE,
                    background: BRAND_BLUE,
                    fontFamily: 'var(--po-font-sans)',
                    letterSpacing: 0,
                  }}
                >
                  {(title?.[0] || 'P').toUpperCase()}
                </span>
              )}
            </span>
            <svg
              className='hidden text-[var(--po-text-muted)] group-hover:block'
              width={SIDEBAR_NAV_ICON_SIZE}
              height={SIDEBAR_NAV_ICON_SIZE}
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
                projectsLoading={projectsLoading}
                onSelectProject={onSelectProject}
                onGoHome={onGoHome}
                onHoverProject={onHoverProject}
                identityLoading={titleLoading}
                // When `currentProjectId` is null we're in /home /
                // /team / /billing / /settings — the `title` prop is
                // the org name. Pass it down so the trigger glyph
                // shows the org's first letter (rather than the
                // generic 'P' fallback) and so the "Go to
                // organization" dropdown row labels match.
                globalLabel={!currentProjectId ? title : undefined}
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
                <span className='truncate text-[12.5px] font-medium text-[var(--po-text)]'>
                  {titleLoading ? <SkeletonBlock width={96} height={11} radius={3} /> : title}
                </span>
              </div>
            )}

            {/* Collapse toggle — dedicated 30×30 slot at the right.
                Always rendered (so layout is stable + control is
                discoverable via keyboard), but visually fades in on
                header hover to keep the rest state quiet. */}
            <button
              type='button'
              onClick={() => handleCollapsedChange(true)}
              title={t('collapse')}
              aria-label={t('collapse')}
              className='flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[5px] text-[var(--po-text-subtle)] opacity-0 transition-opacity duration-150 hover:bg-[var(--po-hover)] hover:text-[var(--po-text)] group-hover/header:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--po-focus-ring)]'
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
                    <span className={navIconClass(isActive)}>{item.icon}</span>

                    <span className={navLabelClass(isActive)}>{item.label}</span>

                    {item.badgeLoading ? (
                      <SkeletonBlock width={18} height={10} radius={3} className='ml-auto' />
                    ) : item.badge !== undefined && item.badge > 0 && (
                      <span className='ml-auto rounded bg-[var(--po-control)] px-1.5 py-0.5 text-[10px] text-[var(--po-text-subtle)]'>
                        {item.badge}
                      </span>
                    )}
                  </button>
                  {item.groupEnd && (
                    <div className='my-1.5 mx-1 border-t border-[var(--po-divider)]' />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        // Collapsed nav keeps the same row rhythm as expanded nav:
        // 32px button height with 1px row gaps. The rail used to use
        // a larger vertical gap, which made collapsed rows feel bigger
        // than expanded rows even when the icons matched.
        <div
          className='flex-1 pt-2 pb-2'
          style={{ paddingLeft: COLLAPSED_RAIL_INSET }}
        >
          <div className='flex flex-col items-start gap-px'>
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
                  <span className='flex h-[18px] w-[18px] items-center justify-center'>
                    {React.isValidElement(item.icon)
                      ? React.cloneElement(item.icon, {
                          width: SIDEBAR_NAV_ICON_SIZE,
                          height: SIDEBAR_NAV_ICON_SIZE,
                        } as any)
                      : item.icon}
                  </span>
                </button>
                {item.groupEnd && (
                  <div className='w-5 border-t border-[var(--po-divider)]' />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Footer — 46px to match the header (and every page-level
          header across /(main)). Hairline divider on top using the
          same 0.08 alpha as every other border.
          Layout: a two-zone strip.
            • LEFT  — compact workspace stats. Commit count is enough
              context here; status dots belong elsewhere, not in the
              persistent sidebar chrome.
            • RIGHT — 24×24 ghost guide button + 24×24 avatar (the
              earlier 24/22 mismatch was part of why the corner felt
              uneven). 8px gap between them, padding bumped to 14px so
              the two zones have actual breathing room. */}
      <div
        className={clsx(
          'flex h-[46px] flex-shrink-0 items-center',
          effectiveCollapsed ? 'justify-start' : 'justify-between gap-3 px-3.5'
        )}
        style={{
          borderTop: '1px solid var(--po-divider)',
          paddingLeft: effectiveCollapsed ? COLLAPSED_RAIL_INSET + 4 : undefined,
        }}
      >
        {!effectiveCollapsed && (
          <div className='flex min-w-0 flex-1 flex-col justify-center'>
            {projectStats && typeof projectStats.commitCount === 'number' ? (
              <span
                className='truncate text-[12px] leading-[1.2] text-[var(--po-text-muted)]'
                title={`${projectStats.commitCount} commit${projectStats.commitCount === 1 ? '' : 's'}`}
              >
                {projectStats.commitCount} commit{projectStats.commitCount === 1 ? '' : 's'}
              </span>
            ) : (
              // No-project fallback: a single env chip. Kept as one
              // line; vertically centred via the wrapping flex column.
              <span
                className='inline-flex h-[22px] w-fit items-center rounded-[4px] bg-[var(--po-control)] px-2 text-[10px] tracking-[0.04em] text-[var(--po-text-disabled)]'
                style={{ fontFamily: 'var(--po-font-sans)' }}
              >
                {resolvedEnvLabel}
              </span>
            )}
          </div>
        )}

        <div className='flex flex-shrink-0 items-center'>
          {/* Footer right zone — just the user avatar.
              We used to render a "?" guide button next to the avatar
              that opened the getting-started checklist, but it took
              up dedicated visual real-estate for an action almost no
              returning user invokes. The checklist is still
              reachable from the onboarding flow / user menu, so the
              affordance hasn't disappeared — it just stopped paying
              rent in the chrome that's seen on every page load.
              The `onOpenGuide` prop is still accepted for backward
              compat with existing call sites; it's intentionally
              unused here. */}
          <button
            type='button'
            className='flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--po-control)] text-[11px] font-semibold text-[var(--po-text)] transition-all duration-200 hover:bg-[var(--po-selected)] hover:shadow-[0_0_0_2px_var(--po-hover)]'
            onClick={() => setUserMenuOpen(true)}
            title={t('accountSettings')}
            aria-label={t('accountSettings')}
          >
            {userIdentityLoading ? (
              <SkeletonBlock width={14} height={14} radius={7} />
            ) : userAvatarUrl ? (
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
            isResizing ? 'bg-[var(--po-active)]' : 'hover:bg-[var(--po-active)]'
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
