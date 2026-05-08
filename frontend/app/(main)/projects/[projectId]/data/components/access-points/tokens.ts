/**
 * Visual tokens shared across the access-points feature.
 *
 * Re-exported from a single module so a future move to CSS variables /
 * Tailwind theme extension is one diff away. Component files reference
 * these by name; do NOT inline raw hex values back into JSX.
 */

export const COLOR_FG = '#e4e4e7';
export const COLOR_FG_MUTED = '#a1a1aa';
export const COLOR_FG_DIM = '#71717a';

export const COLOR_BORDER = 'rgba(255,255,255,0.06)';
export const COLOR_BORDER_HOVER = 'rgba(255,255,255,0.12)';

export const COLOR_BG_CARD = 'rgba(255,255,255,0.02)';
export const COLOR_BG_HOVER = 'rgba(255,255,255,0.06)';
export const COLOR_BG_SUNKEN = 'rgba(0,0,0,0.28)';
export const COLOR_BG_DASHED = 'rgba(255,255,255,0.015)';

export const COLOR_DANGER = '#f87171';
export const COLOR_DANGER_FAINT = '#fca5a5';
export const COLOR_DANGER_BG = 'rgba(248,113,113,0.12)';
export const COLOR_DANGER_BORDER = 'rgba(248,113,113,0.3)';

export const COLOR_SUCCESS = '#34d399';
export const COLOR_SUCCESS_BORDER = 'rgba(52,211,153,0.6)';

export const COLOR_ACCENT = '#67e8f9';
export const COLOR_ACCENT_TEXT_BRIGHT = '#a5f3fc';
export const COLOR_ACCENT_BG_FAINT = 'rgba(34,211,238,0.05)';
export const COLOR_ACCENT_BG = 'rgba(34,211,238,0.10)';
export const COLOR_ACCENT_BORDER = 'rgba(34,211,238,0.28)';
export const COLOR_ACCENT_BORDER_BRIGHT = 'rgba(34,211,238,0.30)';

export const FONT_MONO =
  "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace";

export const PANEL_BG = '#0e0e0e';
