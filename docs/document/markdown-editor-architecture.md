# Markdown Editor Architecture

This document records the architecture and layout invariants for the PuppyOne
Markdown editor. Update it with any change that affects Markdown editing,
preview rendering, CodeMirror decorations, cursor placement, or editor layout.

## Runtime Shape

- Markdown files are raw text documents. The persisted source is the Markdown
  string, not a rendered HTML document.
- The shared editor implementation lives under `frontend/shared-ui`.
- The desktop editor uses the generated copy under `desktop/vendor/shared-ui`.
  Do not edit the desktop copy directly; sync from `frontend/shared-ui`.
- The Markdown viewer has two modes:
  - `Live view`: one editable CodeMirror document with syntax-aware
    decorations and widgets.
  - `Source code`: raw Markdown source editing.
- `Live view` is not a second editable DOM tree. It must not maintain a
  separate HTML preview over or beside CodeMirror.

## CodeMirror Ownership

CodeMirror owns:

- the document model
- the selection
- mouse coordinate mapping
- scroll position
- line wrapping
- height measurement

Do not add custom click-to-position logic with `elementFromPoint`,
manual `Range` math, or external DOM pointer mapping. Cursor placement must go
through CodeMirror's native `posAtCoords` / `coordsAtPos` flow.

## Live Preview Decorations

Live preview renders Markdown syntax through CodeMirror decorations:

- Inline Markdown markers may be hidden with inline replacement decorations.
- Task/list markers may be inline widgets.
- Horizontal rules, fenced code blocks, and Markdown tables may be block
  replacement widgets.
- Source text remains the only persistence format. Widgets write back by
  dispatching CodeMirror transactions against the underlying Markdown ranges.

## Cursor Offset Root Cause

In June 2026, the desktop Markdown editor had a cursor-placement bug where
clicking a visible line placed the caret several lines below the click. The
root cause was block widget layout, not Electron, scaling, fonts, or pointer
events.

The previous live preview CSS gave block widgets vertical margins, for example:

```css
.cm-md-hr-widget {
  height: 1px;
  margin: 18px 0;
}
```

`Decoration.replace({ block: true })` participates in CodeMirror's height map.
CodeMirror measures the block widget itself, but vertical margins on block
widgets are outside the measured box. The DOM was pushed down by the margins
while CodeMirror's height map was not. `posAtCoords` then mapped click
coordinates to lower document positions.

The bug was cumulative. Each horizontal rule added `18px + 18px = 36px` of
untracked vertical offset. A document with four horizontal rules showed about
`144px` of cursor offset after the fourth rule.

## Layout Invariants

These rules are mandatory for all Markdown live-preview widgets:

- A CodeMirror block widget root must not use vertical `margin`.
- Visual spacing around a block widget must be represented inside the measured
  box, using `height`, `padding`, or an inner wrapper.
- Do not use hover/focus/click states that change the block widget's measured
  height unless the widget calls `view.requestMeasure()` after the change.
- Do not allow user-resizable widget DOM, such as `textarea { resize: vertical }`,
  unless CodeMirror is notified with `view.requestMeasure()`.
- Images or other async-loading content that can change measured height must
  call `view.requestMeasure()` on load and error.
- Prefer fixed or content-stable widget geometry for rendered blocks.

Current expected patterns:

- Horizontal rule widget: root has `margin: 0` and a fixed measured height; the
  1px rule is drawn inside that box.
- Code block widget: root has `margin: 0`; vertical spacing is root `padding`;
  visual background lives in an inner panel.
- Table widget: root has `margin: 0`; vertical spacing is root `padding`.
- Empty code-language controls may change opacity, but must not collapse or
  expand height on hover/focus.

## Regression Checks

Before merging Markdown live-preview layout changes:

- Use a Markdown fixture with headings, multiple horizontal rules, fenced code
  blocks, tables, images, lists, Chinese text, and long wrapped paragraphs.
- For visible text lines after every block widget, sample a point inside the
  line's DOM rect and call `view.posAtCoords({ x, y })`.
- Convert the returned position back with `view.state.doc.lineAt(pos)`.
- The returned line must be the clicked line.
- Compare `view.lineBlockAt(line.from)` screen position to the line DOM rect.
  Any delta must stay constant across the document; it must not grow after
  horizontal rules, code blocks, tables, or images.
- Verify all block widget roots have `margin-top: 0px` and
  `margin-bottom: 0px`.

Also run:

```bash
node scripts/sync-desktop-shared-ui.mjs
node scripts/check-desktop-shared-ui-sync.mjs
cd desktop && npx tsc --noEmit
cd desktop && npm run build
```
