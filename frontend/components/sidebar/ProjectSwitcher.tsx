'use client';

import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { APP_Z_INDEX } from '@/lib/zIndex';
import { SkeletonBlock } from '@/components/loading';

// Brand blue — same constant as `BRAND_BLUE` in SidebarLayout.tsx.
// Used for every workspace identity chip so the project's "color"
// stays constant from collapsed sidebar → expanded trigger → dropdown
// rows. Keep the two definitions in sync.
const BRAND_BLUE = '#4599DF';

export type ProjectOption = {
  id: string;
  name: string;
};

export type ProjectSwitcherProps = {
  currentProject: ProjectOption | null; // null = Home/Organization view
  projects: ProjectOption[];
  projectsLoading?: boolean;
  onSelectProject: (projectId: string) => void;
  onGoHome: () => void;
  onHoverProject?: (projectId: string) => void;
  isCollapsed?: boolean;
  // Display label to use for the trigger when `currentProject` is null
  // (i.e. we're at /home or another /(main) page outside any project).
  // Typically the org name; falls back to "puppyone" when undefined so
  // the switcher still has something to render in unauthenticated /
  // pre-org states. Used both for the row text and for the first-letter
  // glyph so org view renders the same blue letter-chip as project view.
  globalLabel?: string;
  identityLoading?: boolean;
};

export function ProjectSwitcher({
  currentProject,
  projects,
  projectsLoading = false,
  onSelectProject,
  onGoHome,
  onHoverProject,
  isCollapsed = false,
  globalLabel,
  identityLoading = false,
}: ProjectSwitcherProps) {
  const t = useTranslations('sidebar');
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(220, rect.width),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (isCollapsed) {
    // Collapsed state - just show logo that expands sidebar
    return null;
  }

  const displayName = currentProject?.name ?? globalLabel ?? 'puppyone';
  const isInProject = currentProject !== null;

  // First-letter glyph for the chip — uppercase, single character.
  // Resolution order: project name → org / global label → 'P'. Same
  // letter is used in both the trigger and the dropdown's
  // "go to organization" row when no project is selected, so the
  // identity glyph stays visually constant across surfaces. Mirrors
  // the showcase AppShell which renders e.g. "A" for
  // "Acme Finance Team".
  const firstLetter = (
    currentProject?.name?.[0] ||
    globalLabel?.[0] ||
    'P'
  ).toUpperCase();

  return (
    <div className='relative flex-1 min-w-0'>
      {/* Trigger Button — uses the exact same row metrics as the
          dropdown rows below and the SidebarLayout nav rows (13px
          text / gap-2.5 / h-8 / rounded-[5px] / white/[0.03] hover /
          white/[0.06] active). One row spec for the whole sidebar so
          everything reads as the same scale. */}
      <button
        ref={buttonRef}
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex h-8 w-full items-center gap-2.5 rounded-[5px] px-2 transition-colors duration-150',
          isOpen ? 'bg-[var(--po-selected)]' : 'hover:bg-[var(--po-hover)]'
        )}
      >
        {/* Identity glyph — 18×18 brand-blue chip carrying the
            workspace's first letter. Same chip in both project and
            org/global view so the rail looks identical across
            navigation; the only thing that changes is the letter
            inside (project initial vs. org initial). The dropdown
            rows below reuse the same chip spec so the active
            workspace stays visually constant from trigger → menu. */}
        {identityLoading ? (
          <SkeletonBlock width={18} height={18} radius={5} className='flex-shrink-0' />
        ) : (
          <span
            aria-hidden
            className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-[var(--po-text-inverse)]'
            style={{
              background: BRAND_BLUE,
              fontFamily: 'var(--po-font-sans)',
              letterSpacing: 0,
            }}
          >
            {firstLetter}
          </span>
        )}

        <span className='flex-1 truncate text-left text-[13px] font-medium text-[var(--po-text)]'>
          {identityLoading ? (
            <SkeletonBlock width="65%" height={10} radius={3} />
          ) : (
            displayName
          )}
        </span>

        {/* Chevron — only revealed on header hover or while the
            dropdown is open. Keeps the rest state quiet (just the
            workspace name + glyph), and shows the affordance exactly
            when the user is reaching for it. Mirrors the collapse
            button's hover-to-reveal behavior so the two header
            controls feel like one coordinated set. */}
        <svg
          width='10'
          height='10'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden
          className={clsx(
            'flex-shrink-0 text-[var(--po-text-disabled)] transition-[transform,opacity,colors] duration-150',
            isOpen
              ? 'rotate-180 opacity-100 text-[var(--po-text-muted)]'
              : 'opacity-0 group-hover/header:opacity-100 group-hover/header:text-[var(--po-text-muted)]'
          )}
        >
          <polyline points='6 9 12 15 18 9' />
        </svg>
      </button>

      {/* Dropdown Menu — follows the sidebar design system 1:1 so the
          panel reads as a continuation of the sidebar rather than a
          separate widget:
            • Border alpha matches the sidebar (var(--po-border))
            • Row height / typography / hover / active states are
              identical to the SidebarLayout nav rows (32px h-8,
              13px text, gap-2.5, white/[0.03] hover, white/[0.06]
              active, var(--po-text-muted) → var(--po-text) text ramp)
            • Project rows reuse the same cyan→blue first-letter chip
              from the trigger button so the "active workspace"
              identity glyph stays visually constant. */}
      {isOpen && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className='overflow-hidden rounded-md bg-[var(--po-overlay)] shadow-xl'
          style={{
            position: 'fixed',
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuPosition.width,
            border: '1px solid var(--po-border)',
            boxShadow: '0 18px 46px var(--po-shadow)',
            zIndex: APP_Z_INDEX.popover,
          }}
        >
          {/* Go to organization — action-oriented label rather than
              echoing the org name (which would visually collide with
              project rows). The org-initial letter chip + the
              verb-led label make it unambiguous that this navigates
              *out* of any project context, back to the org view.
              Uses the same blue letter-chip spec as the project rows
              below so the dropdown reads as one consistent set
              (rather than mixing a detailed logo glyph with flat
              letter chips). */}
          <div className='p-1' style={{ borderBottom: '1px solid var(--po-border-subtle)' }}>
            <button
              type='button'
              onClick={() => {
                onGoHome();
                setIsOpen(false);
              }}
              className={dropdownRowClass(!isInProject)}
            >
              {identityLoading && !currentProject ? (
                <SkeletonBlock width={18} height={18} radius={5} className='flex-shrink-0' />
              ) : (
                <span
                  aria-hidden
                  className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-[var(--po-text-inverse)]'
                  style={{
                    background: BRAND_BLUE,
                    fontFamily: 'var(--po-font-sans)',
                    letterSpacing: 0,
                  }}
                >
                  {(globalLabel?.[0] || 'P').toUpperCase()}
                </span>
              )}
              <span className={dropdownLabelClass(!isInProject)}>
                {t('goToOrganization')}
              </span>
              {!isInProject && <CheckIcon />}
            </button>
          </div>

          {/* Projects Section — section header is sentence case
              ("Projects", not "PROJECTS") so it reads as a normal
              label rather than an all-caps banner. Slightly larger
              (11px) and untracked since proper case doesn't need
              extra letterspacing for legibility. */}
          <div className='p-1'>
            <div className='px-2 pt-1.5 pb-1 text-[11px] font-medium text-[var(--po-text-subtle)]'>
              {t('projects')}
            </div>
            <div className='max-h-[240px] overflow-y-auto'>
              {(identityLoading || projectsLoading) && projects.length === 0 ? (
                <div className='flex flex-col gap-2 px-2 py-2'>
                  <SkeletonBlock width="70%" height={10} radius={3} />
                  <SkeletonBlock width="52%" height={10} radius={3} />
                </div>
              ) : projects.length === 0 ? (
                <div className='px-2 py-3 text-center text-[12px] text-[var(--po-text-subtle)]'>
                  {t('noProjects')}
                </div>
              ) : (
                projects.map(project => {
                  const isActive = currentProject?.id === project.id;
                  return (
                    <button
                      key={project.id}
                      type='button'
                      onMouseEnter={() => onHoverProject?.(project.id)}
                      onClick={() => {
                        onSelectProject(project.id);
                        setIsOpen(false);
                      }}
                      className={dropdownRowClass(isActive)}
                    >
                      <span
                        aria-hidden
                        className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-[var(--po-text-inverse)]'
                        style={{
                          background: BRAND_BLUE,
                          fontFamily:
                            'var(--po-font-sans)',
                        }}
                      >
                        {(project.name?.[0] || '?').toUpperCase()}
                      </span>
                      <span className={dropdownLabelClass(isActive)}>
                        {project.name}
                      </span>
                      {isActive && <CheckIcon />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
        , document.body
      )}
    </div>
  );
}

// Shared row class — mirrors `navButtonClass` in SidebarLayout so the
// dropdown rows visually rhyme with the nav rows underneath.
function dropdownRowClass(isActive: boolean) {
  return clsx(
    'flex h-8 w-full items-center gap-2.5 rounded-[5px] px-2 text-left transition-colors duration-150',
    isActive ? 'bg-[var(--po-selected)]' : 'hover:bg-[var(--po-hover)]'
  );
}

function dropdownLabelClass(isActive: boolean) {
  return clsx(
    'flex-1 truncate text-[13px]',
    isActive ? 'font-medium text-[var(--po-text)]' : 'font-medium text-[var(--po-text-muted)]'
  );
}

function CheckIcon() {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='var(--po-accent)'
      strokeWidth='2.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      className='flex-shrink-0'
      aria-hidden
    >
      <polyline points='20 6 9 17 4 12' />
    </svg>
  );
}
