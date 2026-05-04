'use client';

import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

export type ProjectOption = {
  id: string;
  name: string;
};

export type ProjectSwitcherProps = {
  currentProject: ProjectOption | null; // null = Home/Organization view
  projects: ProjectOption[];
  onSelectProject: (projectId: string) => void;
  onGoHome: () => void;
  onHoverProject?: (projectId: string) => void;
  isCollapsed?: boolean;
};

export function ProjectSwitcher({
  currentProject,
  projects,
  onSelectProject,
  onGoHome,
  onHoverProject,
  isCollapsed = false,
}: ProjectSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const displayName = currentProject ? currentProject.name : 'puppyone';
  const isInProject = currentProject !== null;

  // First-letter glyph for the chip — uppercase, single character.
  // Mirrors the showcase AppShell which renders e.g. "A" for
  // "Acme Finance Team".
  const firstLetter = (currentProject?.name?.[0] || 'P').toUpperCase();

  return (
    <div className='relative flex-1 min-w-0'>
      {/* Trigger Button — single-line workspace switcher matching the
          showcase AppShell exactly. Gap 8, padding 0 (the parent
          header already supplies 12px horizontal). The whole row is
          the click target; chevron on the right is decorative. */}
      <button
        ref={buttonRef}
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'group flex w-full items-center gap-2 rounded-[5px] px-1 py-1 transition-colors',
          'hover:bg-white/[0.04]',
          isOpen && 'bg-white/[0.05]'
        )}
      >
        {/* Identity glyph — 18×18.
            • Project view: cyan→blue gradient chip with the workspace's
              first letter, lifted pixel-for-pixel from the showcase
              AppShell (`linear-gradient(135deg, #22d3ee 0%, #2563eb
              100%)`, 5px radius, 10px mono uppercase, #0a0a0a text).
            • Home / global view: the puppyone brand mark — a chip
              with "P" would read as just another project, so we keep
              the proper logo here. */}
        {isInProject ? (
          <span
            aria-hidden
            className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-[#0a0a0a]'
            style={{
              background: 'linear-gradient(135deg, #22d3ee 0%, #2563eb 100%)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 0,
            }}
          >
            {firstLetter}
          </span>
        ) : (
          <img
            src='/puppyone-logo.svg'
            alt='puppyone'
            width={18}
            height={18}
            className='flex-shrink-0 rounded-[4px]'
          />
        )}

        {/* Workspace name — 12.5px / weight 500 / #fafafa. Showcase
            uses T.text1 = #fafafa here; we matched that exactly so
            the workspace label sits at the same lightness as the
            "active" nav row text underneath. */}
        <span className='flex-1 truncate text-left text-[12.5px] font-medium text-[#fafafa]'>
          {displayName}
        </span>

        {/* Chevron — 10×10 single down-caret matching the showcase.
            Color #52525b (T.text3). On hover it lifts to T.text2 so
            the row clearly reads as actionable. */}
        <svg
          width='10'
          height='10'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          className={clsx(
            'flex-shrink-0 text-[#52525b] transition-colors duration-150 group-hover:text-[#a1a1aa]',
            isOpen && 'rotate-180 text-[#a1a1aa]'
          )}
        >
          <polyline points='6 9 12 15 18 9' />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className={clsx(
            'absolute left-0 top-full z-50 mt-1 w-[220px] overflow-hidden rounded-lg',
            'border border-[#2a2a2a] bg-[#1a1a1a] shadow-xl shadow-black/40'
          )}
        >
          {/* Home Option */}
          <div className='p-1 border-b border-[#2a2a2a]'>
            <button
              type='button'
              onClick={() => {
                onGoHome();
                setIsOpen(false);
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                'hover:bg-white/5',
                !isInProject && 'bg-white/8'
              )}
            >
              <img
                src='/puppyone-logo.svg'
                alt='puppyone'
                width={20}
                height={20}
                className='flex-shrink-0 rounded-[4px]'
              />
              <div className='flex-1 min-w-0'>
                <div className='text-sm font-medium text-[#ededed] truncate'>
                  puppyone
                </div>
                <div className='text-[11px] text-[#666]'>Organization Home</div>
              </div>
              {!isInProject && (
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='#34d399'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  className='flex-shrink-0'
                >
                  <polyline points='20 6 9 17 4 12' />
                </svg>
              )}
            </button>
          </div>

          {/* Projects Section */}
          <div className='p-1'>
            <div className='px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#555]'>
              Projects
            </div>
            <div className='max-h-[240px] overflow-y-auto'>
              {projects.length === 0 ? (
                <div className='px-2.5 py-3 text-xs text-[#555] text-center'>
                  No projects yet
                </div>
              ) : (
                projects.map(project => (
                  <button
                    key={project.id}
                    type='button'
                    onMouseEnter={() => onHoverProject?.(project.id)}
                    onClick={() => {
                      onSelectProject(project.id);
                      setIsOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                      'hover:bg-white/5',
                      currentProject?.id === project.id && 'bg-white/8'
                    )}
                  >
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='#9ca3af'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      className='flex-shrink-0'
                    >
                      <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
                      <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
                      <line x1='12' y1='22.08' x2='12' y2='12' />
                    </svg>

                    <span className='flex-1 truncate text-sm text-[#ccc]'>
                      {project.name}
                    </span>

                    {currentProject?.id === project.id && (
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='#34d399'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        className='flex-shrink-0'
                      >
                        <polyline points='20 6 9 17 4 12' />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
