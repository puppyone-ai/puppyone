import type { CSSProperties } from 'react';

export const ACTIVITY_WIDTH = 300;
export const ACTIVITY_BG = '#1e1e22';
export const ACTIVITY_BORDER = '1px solid rgba(255,255,255,0.11)';
export const ACTIVITY_RADIUS = 10;
export const ACTIVITY_SHADOW = '0 8px 24px rgba(0,0,0,0.42)';
export const ACTIVITY_HEADER_HEIGHT = 44;

export const activityCardStyle: CSSProperties = {
  width: ACTIVITY_WIDTH,
  background: ACTIVITY_BG,
  border: ACTIVITY_BORDER,
  borderRadius: ACTIVITY_RADIUS,
  boxShadow: ACTIVITY_SHADOW,
  overflow: 'hidden',
  color: '#e4e4e7',
};

export const activityHeaderStyle: CSSProperties = {
  minHeight: ACTIVITY_HEADER_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 10px 8px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  boxSizing: 'border-box',
};

export const activityTitleStyle: CSSProperties = {
  color: '#f4f4f5',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: '18px',
};

export const activitySubtleTextStyle: CSSProperties = {
  color: '#71717a',
  fontSize: 11,
  lineHeight: '16px',
};

export const activityIconButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: '#71717a',
  cursor: 'pointer',
};

