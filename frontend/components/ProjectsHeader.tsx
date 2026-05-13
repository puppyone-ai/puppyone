'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';

export type EditorType = 'table' | 'monaco';
export type ViewType = 'grid' | 'list' | 'explorer';

// Per-segment icon was removed in favor of a quiet, text-only
// address bar — the file tree carries the type-glyph information
// where it's actually functional. Keeping the segment type minimal.
export type BreadcrumbSegment = {
  label: string;
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
                color: '#666',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = '#eee';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#666';
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
                  <span style={{ margin: '0 8px', color: '#444' }}>/</span>
                )}
                {segment.href && !isLast ? (
                  <Link
                    href={segment.href}
                    style={{
                      ...pathStyle,
                      color: '#888',
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#888';
                    }}
                  >
                    {segment.label}
                  </Link>
                ) : (
                  <span
                    style={{
                      ...pathStyle,
                      color: isLast ? '#CDCDCD' : '#888',
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
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: '#0e0e0e',
  position: 'relative',
  zIndex: 1000,
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
  zIndex: 1001,
};

const pathStyle: CSSProperties = {
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: '#CDCDCD',
};
