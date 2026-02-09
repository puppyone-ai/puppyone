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
  isCollapsed?: boolean;
};

export function ProjectSwitcher({
  currentProject,
  projects,
  onSelectProject,
  onGoHome,
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

  return (
    <div className='relative flex-1 min-w-0'>
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type='button'
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
          'hover:bg-white/5',
          isOpen && 'bg-white/5'
        )}
      >
        {/* Icon */}
        {isInProject ? (
          // Project cube icon
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#a78bfa'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            className='flex-shrink-0'
          >
            <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
            <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
            <line x1='12' y1='22.08' x2='12' y2='12' />
          </svg>
        ) : (
          // Logo for home
          <img
            src='/puppybase.svg'
            alt='puppyone'
            width={14}
            height={14}
            className='flex-shrink-0'
          />
        )}

        {/* Name */}
        <span className='truncate text-sm font-semibold tracking-[0.3px] text-[#ededed]'>
          {displayName}
        </span>

        {/* Chevron */}
        <svg
          width='12'
          height='12'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          className={clsx(
            'ml-auto flex-shrink-0 text-[#666] transition-transform duration-150',
            isOpen && 'rotate-180'
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
                src='/puppybase.svg'
                alt='puppyone'
                width={14}
                height={14}
                className='flex-shrink-0'
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
                    {/* Project icon */}
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='#a78bfa'
                      strokeWidth='2'
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
