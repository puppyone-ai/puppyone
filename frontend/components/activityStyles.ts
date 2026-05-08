import type { CSSProperties } from 'react';

/**
 * Activity-card design tokens.
 *
 * These power the floating widgets that live in the bottom-right corner
 * (Getting Started checklist, ETL task tray, future sync/export jobs).
 * Goals:
 *
 *  - Read as "floating UI on top of the workspace", not as a marketing
 *    popup. Frosted-glass surface with backdrop blur lets the page show
 *    through and grounds the panel in the dark theme.
 *  - Match the visual weight of the rest of the chrome — sidebar nav,
 *    `PanelShell` headers, breadcrumb. That means medium (500) weight
 *    titles, soft borders (~6% white), and reserved use of brand blue
 *    so accent moments still pop.
 *  - Stay narrow (280px) so the widget never dominates the canvas
 *    when it sits over the content rail in `/projects/.../data/...`.
 */
export const ACTIVITY_WIDTH = 280;
export const ACTIVITY_BG = 'rgba(22, 22, 26, 0.86)';
export const ACTIVITY_BORDER = '1px solid rgba(255,255,255,0.06)';
export const ACTIVITY_RADIUS = 12;
export const ACTIVITY_SHADOW =
  '0 16px 40px rgba(0,0,0,0.48), 0 1px 2px rgba(0,0,0,0.32)';
export const ACTIVITY_HEADER_HEIGHT = 44;
const ACTIVITY_BACKDROP = 'blur(28px) saturate(160%)';

export const activityCardStyle: CSSProperties = {
  width: ACTIVITY_WIDTH,
  background: ACTIVITY_BG,
  border: ACTIVITY_BORDER,
  borderRadius: ACTIVITY_RADIUS,
  boxShadow: ACTIVITY_SHADOW,
  overflow: 'hidden',
  color: '#e4e4e7',
  backdropFilter: ACTIVITY_BACKDROP,
  WebkitBackdropFilter: ACTIVITY_BACKDROP,
};

export const activityHeaderStyle: CSSProperties = {
  minHeight: ACTIVITY_HEADER_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 8px 10px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  boxSizing: 'border-box',
};

export const activityTitleStyle: CSSProperties = {
  color: '#fafafa',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '18px',
  letterSpacing: '-0.01em',
};

export const activitySubtleTextStyle: CSSProperties = {
  color: '#71717a',
  fontSize: 11,
  lineHeight: '16px',
  letterSpacing: '-0.005em',
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

