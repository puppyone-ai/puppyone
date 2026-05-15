'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { APP_Z_INDEX } from '@/lib/zIndex';
import { CHROME_LABEL_TYPOGRAPHY } from '@/lib/uiTypography';

export type EditorType = 'table' | 'monaco';
export type ViewType = 'grid' | 'list' | 'explorer';

// Per-segment icon was removed in favor of a quiet, text-only
// address bar — the file tree carries the type-glyph information
// where it's actually functional. Keeping the segment type minimal.
export type BreadcrumbSegment = {
  label: ReactNode;
  href?: string;
};

type ProjectsHeaderProps = {
  pathSegments: BreadcrumbSegment[];
  projectId: string | null;
  onProjectsRefresh?: () => void;
  onBack?: () => void;
  accessPointCount?: number;
  actionSlot?: ReactNode;
};

export function ProjectsHeader({
  pathSegments,
  onBack,
  actionSlot,
}: ProjectsHeaderProps) {

  return (
    <header style={headerStyle}>
      {/* LEFT SIDE: Back + Breadcrumbs */}
      <div style={headerLeftStyle}>
        {onBack && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <button
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 32,
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--po-text-subtle)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--po-hover)';
                e.currentTarget.style.color = 'var(--po-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--po-text-subtle)';
              }}
              title='Back to Home'
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M19 12H5' />
                <path d='M12 19l-7-7 7-7' />
              </svg>
            </button>
          </div>
        )}

        {/* Breadcrumbs */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
          {pathSegments.map((segment, index) => {
            const isLast = index === pathSegments.length - 1;
            return (
              <div
                key={index}
                style={{ display: 'flex', alignItems: 'center' }}
              >
                {index > 0 && (
                  <span style={{ margin: '0 8px', color: 'var(--po-text-disabled)' }}>/</span>
                )}
                {segment.href && !isLast ? (
                  <Link
                    href={segment.href}
                    style={{
                      ...pathStyle,
                      color: 'var(--po-text-muted)',
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--po-text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--po-text-muted)';
                    }}
                  >
                    {segment.label}
                  </Link>
                ) : (
                  <span
                    style={{
                      ...pathStyle,
                      color: isLast ? 'var(--po-text)' : 'var(--po-text-muted)',
                    }}
                  >
                    {segment.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {actionSlot && (
        <div style={headerActionStyle}>
          {actionSlot}
        </div>
      )}
    </header>
  );
}

// Styles
const headerStyle: CSSProperties = {
  height: 46,
  paddingLeft: 16,
  paddingRight: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid var(--po-divider)',
  background: 'var(--po-header)',
  position: 'relative',
  zIndex: APP_Z_INDEX.chrome,
  overflow: 'visible',
};

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  overflow: 'hidden',
};

const headerActionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexShrink: 0,
  marginLeft: 16,
  position: 'relative',
  zIndex: APP_Z_INDEX.chromeRaised,
};

const pathStyle: CSSProperties = {
  ...CHROME_LABEL_TYPOGRAPHY,
  color: 'var(--po-text)',
};
