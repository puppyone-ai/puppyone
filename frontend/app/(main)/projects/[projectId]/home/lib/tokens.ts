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
  // Page bg matches the surface painted by `(main)/layout.tsx` (var(--po-canvas)),
  // so this page sits flush inside the rounded main pane and visually
  // aligns with /access /data /history /monitor /settings.
  bg: 'var(--po-canvas)',
  surface: 'var(--po-panel)',
  border: 'var(--po-border)',
  borderH: 'var(--po-border-strong)',
  rowHover: 'var(--po-hover)',
  rowAttached: 'var(--po-control)', // even more subtle than hover

  // Active highlight when an AP is hovered: tints every row in the AP's
  // scope (the AP's `path` + all descendants).  Cyan-tinted bg keeps the
  // single-accent rule; the 2px left bar makes the affiliation unmistakable
  // even when many rows light up at once (e.g. filesystem at root).
  rowHighlight: 'color-mix(in srgb, var(--po-accent) 8%, transparent)',
  // Stronger tint reserved for the scope ROOT — the row that the AP is
  // actually pinned to (its `path`).  Bumping just this one row makes the
  // root visually pop out of the otherwise-uniform cyan band, so users can
  // see "this AP is anchored here" at a glance instead of inferring it
  // from the structural elbow alone.  ~2x the descendant alpha hits the
  // sweet spot: clearly distinct, still a tint (not a slab).
  rowHighlightRoot: 'color-mix(in srgb, var(--po-accent) 16%, transparent)',
  rowHighlightAccent: 'var(--po-accent)',  // == T.live, named for intent

  // Card surface — matches `ProviderRow` in
  // `data/components/SyncConfigPanel.tsx` so AP cards on Home and provider
  // rows in the access drawer read as the same component visually.
  cardBg: 'var(--po-panel)',
  cardBgH: 'var(--po-hover)',
  cardBorder: 'var(--po-border-subtle)',
  cardBorderH: 'var(--po-border-strong)',

  // Section card surface — the Home page's primary modules (Data,
  // History, Access Points, Topology) need to read as discrete
  // framed panels.  Pixel-borrowed from the OLD GitHub-style page
  // where each card was DARKER than the page surface (a "pressed
  // in" treatment, not "lifted out") — the dark interior + visible
  // border makes each module read as a recessed panel inset into
  // the page rather than a floating chip on top of it.
  //
  // 0.4 black ≈ #080808 over the var(--po-canvas) page bg.  Tuned by eye
  // against the reference: clearly darker than the surround, but
  // not so dark that the card disappears into pure void.
  //
  // `sectionBorder` is the INK; the actual stroke width is set per
  // card to 2px (vs the AP-row whisper of 1px).  2px + 0.18 ink
  // gives the unambiguously THICK card frame the GitHub reference
  // uses — 1px at any opacity reads as "hairline" and the card
  // visually melts into the page.
  //
  // `sectionRadius` lives here so all section cards round at the
  // same corner.  12px (vs the previous 8px) — the larger radius
  // makes the dark interior read as a proper "panel" shape rather
  // than a hard rectangle dropped into the page.
  //
  // Splitting these off as separate tokens (rather than overloading
  // `cardBorder`/`cardBg`) keeps the AP-row card style untouched —
  // that surface still wants the whisper.
  sectionBg: 'var(--po-panel)',
  sectionBorder: 'var(--po-border-strong)',
  sectionRadius: 12,

  // Header strip lift over the section card body.  The OLD
  // GitHub-style page rendered each card as TWO surfaces stacked:
  // a slightly elevated header strip on top of the darker body,
  // with a hairline divider between.  Stacking the surfaces (vs.
  // a single uniform card with one bold rule) is what gives the
  // "this is a framed module with a labelled top" read; without
  // the lift the header just looks like a heading floating in the
  // body.
  //
  // 0.03 white over the 0.4-black body lifts the strip ~6 RGB on
  // the page bg — present to the eye, not loud enough to compete
  // with the section border.  Tuned by squinting at the reference
  // screenshot — anything > 0.05 starts reading as a "tab" rather
  // than a "header".
  sectionHeaderBg: 'var(--po-hover)',

  // Hairline divider between the header strip and the body.  1px
  // (vs the 2px outer section border) — the divider lives INSIDE
  // a frame that already exists, so it should read quieter than
  // the frame.  0.08 ink intentionally matches `T.border` (the
  // app-wide 1px standard) so this divider belongs to the same
  // visual family as every other 1px rule on the page.
  sectionDivider: 'var(--po-border)',

  text1: 'var(--po-text)',   // titles, key numbers
  text2: 'var(--po-text-muted)',   // body
  text3: 'var(--po-text-disabled)',   // captions, section labels
  text4: 'var(--po-filetree-rail)',   // nearly-invisible, dividers
  treeGuide: 'var(--po-tree-guide)',
  textMono: 'var(--po-text-subtle)',

  live: 'var(--po-accent)',    // accent signal
  liveSoft: 'color-mix(in srgb, var(--po-accent) 18%, transparent)',
  err: 'var(--po-danger)',
  warn: 'var(--po-warning)',

  fontSans: 'var(--po-font-sans)',
  fontMono: 'var(--po-font-mono)',

  ease: 'cubic-bezier(0.16, 1, 0.3, 1)', // out-expo-ish, used for everything
} as const;
