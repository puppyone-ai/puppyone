/**
 * Design tokens shared across the access page modules.
 *
 * Lifted out of the original 2478-line `page.tsx` so colour / font
 * changes have a single source of truth. Kept inline in this file
 * (i.e. plain object, not a runtime Context) because the page does
 * not need theme-switching — these are layout primitives, not user
 * preference.
 */

export const T = {
  bg: '#0e0e0e',
  border: 'rgba(255,255,255,0.08)',
  cardBg: 'rgba(255,255,255,0.02)',
  cardBorder: 'rgba(255,255,255,0.06)',

  text1: '#fafafa',
  text2: '#a1a1aa',
  text3: '#52525b',
  text4: '#27272a',

  fontSans: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// Two button sizes only. Section-level ghost actions (Edit Scope, View
// all, Copy connect) all share `GhostButton`; primary actions on the
// Identity row (Pause/Resume, More) share `PrimaryGhostButton`. Both
// pull from the same neutral palette (transparent → rgba(255,255,255,
// 0.06) on hover), so we no longer have three different sizes / fonts
// / colors competing for attention on the same screen.
export const BTN_RADIUS = 6;

// PromptBlock — a copyable block that previews the AI-agent prompt
// the user can paste into ChatGPT / Claude. Height is fixed so the
// surface doesn't jump when the prompt changes; the bottom 64px
// fades to PROMPT_BG so long prompts don't appear visually clipped.
export const PROMPT_BLOCK_HEIGHT = 140;
export const PROMPT_BG = 'rgba(0,0,0,0.28)';

// Geometry mirrors `ExplorerTreeRow` exactly — every dimension here is
// the same one the data-view sidebar uses, so the mount-point preview
// and the live tree feel like the same control. Folder/file glyphs at
// 16px, rows at 30px, depth-1 indent at 16px, elbow stem at x=16,
// hook at y=15, hook width 8. Don't drift these without updating
// `ExplorerTreeRow` too.
export const TREE_ROW_HEIGHT = 30;
export const TREE_INDENT = 16;
export const TREE_ICON_SIZE = 16;
export const TREE_LINE_COLOR = '#27272a';

// Cap on rows shown in the scope's file-tree preview before we
// collapse to "+N more" — see `nodesToPreview` in lib/format.ts.
export const SCOPE_ROWS_LIMIT = 4;
