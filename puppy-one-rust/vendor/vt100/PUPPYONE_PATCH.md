# vt100 0.15.2, patched for PuppyOne

This is the crates.io release of `vt100` 0.15.2 with two additions, used
through `[patch.crates-io]` in `puppy-one-rust/Cargo.toml`. Nothing else
differs from the published source; every change is marked `PUPPYONE PATCH`.

## OSC 8 hyperlinks

The product's terminal (xterm.js with a `linkHandler`) opens the targets of
OSC 8 hyperlinks (`ESC ] 8 ; params ; URI ST text ESC ] 8 ; ; ST`); vt100
ignored the sequence, so only plain-text URLs were links.

- `Attrs` gains `link`: an index into a per-screen table of targets (plus
  one; 0 for none). Text written while a link is open carries it, like a
  colour; erased cells never do, and SGR resets leave the link open.
- `Screen::hyperlink(row, col)` resolves a visible cell's target;
  `Cell::hyperlink_id` reads the raw id.
- The table keeps up to 65 536 distinct targets of at most 2 048 bytes;
  beyond either, text is written without a link.

## Row places in the whole output

`Screen::scrolled_rows()` counts the rows the main screen ever moved into
its scrollback, dropped ones included, and survives a reset (RIS). With
`scrollback()` it gives each visible row a place that stays put as output
scrolls, so a selection can span the scrollback and survive scrolling.

Verified by the terminal tests in `src/features/terminal` (hyperlinks,
selection across the scrollback).
