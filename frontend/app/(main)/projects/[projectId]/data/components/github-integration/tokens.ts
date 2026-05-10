/**
 * Local design tokens for the Integrations page. Mirrors the ``T``
 * object in ``settings/page.tsx`` and ``access/lib/tokens.ts`` so this
 * surface reads as the same family.
 */
export const T = {
  bg: '#0e0e0e',
  border: 'rgba(255,255,255,0.08)',
  cardBg: 'rgba(255,255,255,0.02)',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardBorderStrong: 'rgba(255,255,255,0.12)',
  text1: '#fafafa',
  text2: '#a1a1aa',
  text3: '#52525b',
  text4: '#27272a',
  accent: '#3b82f6',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  fontSans:
    'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono:
    'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;
