# Frontend Design Skill

Linear-style dark UI. Dense, minimal, flat (no shadows, no gradients).

---

## Theme Colors

### Backgrounds (outermost → innermost)
- `#0a0a0a` — root, code blocks
- `#0d0d0d` — app shell, nav bar
- `#111` — panels, dialogs
- `#141414` — cards, info boxes
- `#1a1a1a` — hover states, list items

### Borders
- `rgba(255,255,255,0.06)` — subtle card border
- `#2a2a2a` — standard border
- `#222` — dividers
- `#333` — focus / stronger border

### Text
- `#ededed` — primary
- `#a3a3a3` — secondary
- `#737373` — tertiary / labels
- `#525252` — muted / hints

### Semantic
- `#4ade80` — green (success, active, copied)
- `#ef4444` — red (danger, delete, error)
- `#f59e0b` — amber (warning, highlight)

---

## Typography

| Size | Uses | Weight | Usage |
|------|------|--------|-------|
| 12 | ★★★ | 500 | Default body, buttons, code, hints |
| 13 | ★★★ | 500 | Secondary body, list items, labels |
| 11 | ★★★ | 600 | Section labels (uppercase + letter-spacing) |
| 14 | ★★ | 500 | Component titles, primary labels |
| 16 | ★★ | 500/600 | Page headings, prominent titles |
| 10 | ★ | 400 | Timestamps, badges, micro text |

---

## Buttons

**Primary** — `h: 28, padding: 0 12px, radius: 6, bg: #ededed, color: #000, fontSize: 12, fontWeight: 500`

**Icon button** — `bg: transparent, color: #666 → #ededed on hover, padding: 6, radius: 4`

**Danger hover** — icon buttons that delete/disconnect use `color: #ef4444` on hover only, `#666` at rest.

---

## Sizing

| Element | Value |
|---------|-------|
| Nav / header bar | h: 48 |
| Row item | h: 32 |
| Bot avatar (square) | 32 × 32 |
| Small button / tag | h: 26 |
| Border radius (dialog) | 12 |
| Border radius (card) | 10 |
| Border radius (input/button) | 6 |
| Border radius (small) | 4 |

---

## Rules

- Inline styles over CSS classes (project convention)
- React inline style numbers: no `px` suffix — `{ fontSize: 12 }` not `{ fontSize: '12px' }`
- Hover via `onMouseEnter` / `onMouseLeave`
- Transition: `0.15s` for color, `0.12s` for opacity — never exceed `0.2s`
- No red at rest — danger color only on hover
