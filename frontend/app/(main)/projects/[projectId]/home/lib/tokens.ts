// ================= Design Tokens =================
// Vercel-派 monochromatic palette. White carries the brand; cyan is reserved
// for "live data" signals only (active status dot, sparkline stroke,
// topology line on hover). Provider logos remain the only saturated color
// in the page so they pop against the neutral surface.
//
// Local to /home for now. If a second page wants this same look we'll
// promote it (likely to `tailwind.config.cjs theme.extend`) — but until
// there's a concrete second consumer, keeping it co-located avoids
// premature abstraction.

export const T = {
  // Page bg matches the surface painted by `(main)/layout.tsx` (#0e0e0e),
  // so this page sits flush inside the rounded main pane and visually
  // aligns with /access /data /history /monitor /settings.
  bg: '#0e0e0e',
  surface: '#161618',
  border: 'rgba(255,255,255,0.08)',
  borderH: 'rgba(255,255,255,0.16)',
  rowHover: 'rgba(255,255,255,0.025)',
  rowAttached: 'rgba(255,255,255,0.015)', // even more subtle than hover

  // Active highlight when an AP is hovered: tints every row in the AP's
  // scope (the AP's `path` + all descendants).  Cyan-tinted bg keeps the
  // single-accent rule; the 2px left bar makes the affiliation unmistakable
  // even when many rows light up at once (e.g. filesystem at root).
  rowHighlight: 'rgba(34,211,238,0.06)',
  rowHighlightAccent: '#22d3ee',  // == T.live, named for intent

  // Card surface — matches `ProviderRow` in
  // `data/components/SyncConfigPanel.tsx` so AP cards on Home and provider
  // rows in the access drawer read as the same component visually.
  cardBg: 'rgba(255,255,255,0.02)',
  cardBgH: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardBorderH: 'rgba(255,255,255,0.12)',

  text1: '#fafafa',   // titles, key numbers
  text2: '#a1a1aa',   // body
  text3: '#52525b',   // captions, section labels
  text4: '#27272a',   // nearly-invisible, dividers
  textMono: '#71717a',

  live: '#22d3ee',    // cyan, the only chromatic accent
  liveSoft: 'rgba(34,211,238,0.16)',
  err: '#ef4444',
  warn: '#eab308',

  fontSans: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',

  ease: 'cubic-bezier(0.16, 1, 0.3, 1)', // out-expo-ish, used for everything
} as const;
