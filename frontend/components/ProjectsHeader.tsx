'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';

export type EditorType = 'treeline-virtual' | 'monaco' | 'table';
export type ViewType = 'grid' | 'list' | 'column';

export type BreadcrumbSegment = {
  label: string;
  href?: string;
  icon?: React.ReactNode;
};

// Agent controls are now in AgentRailVertical

type ProjectsHeaderProps = {
  pathSegments: BreadcrumbSegment[];
  projectId: string | null;
  onProjectsRefresh?: () => void;
  onBack?: () => void;
  accessPointCount?: number;
};

export function ProjectsHeader({
  pathSegments,
  onBack,
}: ProjectsHeaderProps) {
  // Agent controls have moved to AgentRailVertical

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
        <div style={{ display: 'flex', alignItems: 'center' }}>
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#888';
                    }}
                  >
                    {segment.icon && (
                      <span
                        style={{
                          display: 'flex',
                          color: 'inherit',
                          opacity: 0.8,
                        }}
                      >
                        {segment.icon}
                      </span>
                    )}
                    {segment.label}
                  </Link>
                ) : (
                  <span
                    style={{
                      ...pathStyle,
                      color: isLast ? '#CDCDCD' : '#888',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {segment.icon && (
                      <span
                        style={{
                          display: 'flex',
                          color: 'inherit',
                          opacity: 0.8,
                        }}
                      >
                        {segment.icon}
                      </span>
                    )}
                    {segment.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agent controls moved to AgentRailVertical */}
    </header>
  );
}

// Styles
const headerStyle: CSSProperties = {
  height: 48,
  paddingLeft: 16,
  paddingRight: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: '#141414',
  position: 'relative',
  zIndex: 10,
};

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const pathStyle: CSSProperties = {
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 14,
  fontWeight: 500,
  color: '#CDCDCD',
};
