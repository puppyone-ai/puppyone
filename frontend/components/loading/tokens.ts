/**
 * Shared design tokens for the unified loading system.
 *
 * Single source of truth for size & tone — every loader component in
 * `components/loading/` reads from here, so changing a value in one
 * place re-skins every spinner / dots / skeleton in the product.
 *
 * Keep this file pure-data (no React, no JSX, no DOM). The values are
 * also re-used by the demo route at `/dev/loading` to enumerate every
 * combination without manually re-listing them.
 */

/**
 * Two sizes only after the second-pass unification (2026-05-08, round 2).
 *
 * History:
 *   - Round 1 dropped `lg` (26px) because route-level `loading.tsx`
 *     fallbacks used `lg` while the in-page state that replaced them
 *     used `md` (18px), producing a visible "shrink" on every page
 *     load. We collapsed to `md` as the sole region-filling size.
 *   - Round 2 (this pass) drops `md` for the same family of reasons,
 *     plus a deliberate aesthetic shift: 18px reads as "loading dots
 *     in a dialog from 2014", which clashes with the dense, refined
 *     chrome the rest of the product moved to. `sm` (13px) sitting
 *     next to a 12px "Loading" label reads as one quiet inline unit
 *     — closer to Linear / Notion / Vercel and far less attention-
 *     stealing on the 4–10× per session a user sees one of these.
 *
 * Scale (final):
 *   xs (~ 9px)  — micro spinners inside buttons / table cells / row
 *                 actions (no label; the surrounding row says what's
 *                 loading).
 *   sm (~13px)  — every other loader. Region-filling page loaders,
 *                 panel placeholders, inline label followers, dialog
 *                 fillers, route-level Suspense fallbacks. ALL of
 *                 these now use the same 13px square + 12px label.
 *
 * Note: this means `<PageLoading />` (region-filling) and
 * `<InlineLoading />` (inline phrase) now produce visually identical
 * spinner+label glyphs; the only difference is the wrapper (centred
 * flex container vs plain inline-flex span).
 */
export type LoaderSize = 'xs' | 'sm';
export type LoaderTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

/**
 * Per-size geometry for `<PulseGrid />`.
 *  - `dot`    — width/height of one cell (px)
 *  - `gap`    — gap between cells (px)
 *  - `radius` — border-radius of one cell. Held at 0 for both sizes:
 *               crisp squares read as "data nodes" / "pixels in a
 *               grid", which is the visual metaphor we want for a
 *               file-system product. Soft corners drift toward the
 *               generic "loading dots" look every web app uses.
 *
 * Total visual size = `dot * 3 + gap * 2`:
 *   xs ≈ 9px, sm ≈ 13px
 */
export const PULSE_GRID_SIZE: Record<
  LoaderSize,
  { dot: number; gap: number; radius: number }
> = {
  xs: { dot: 2, gap: 1.5, radius: 0 },
  sm: { dot: 3, gap: 2, radius: 0 },
};

/**
 * Per-size geometry for `<Dots />` (3 horizontal dots, used inside
 * buttons where a 3×3 grid would be too tall).
 */
export const DOTS_SIZE: Record<LoaderSize, { dot: number; gap: number }> = {
  xs: { dot: 3, gap: 3 },
  sm: { dot: 4, gap: 4 },
};

/**
 * Tone palette: `rest` is the dot's quiescent colour, `active` is its
 * lit colour. Animations interpolate opacity (not colour) so we only
 * need one solid colour per dot — `active` — but `rest` is exposed as
 * a CSS variable so consumers can override the resting state if they
 * paint the loader on a non-var(--po-canvas) background.
 *
 * `neutral` is the default and should cover ~95% of usage. The other
 * tones are reserved for status-loaded contexts where the colour
 * itself communicates meaning (sync running, upload in progress, …).
 */
export const TONE_MAP: Record<LoaderTone, { rest: string; active: string }> = {
  neutral: { rest: 'var(--po-text-disabled)', active: 'var(--po-text-muted)' },
  success: { rest: 'color-mix(in srgb, var(--po-success) 18%, transparent)', active: 'var(--po-success)' },
  warning: { rest: 'color-mix(in srgb, var(--po-warning) 18%, transparent)', active: 'var(--po-warning)' },
  danger: { rest: 'color-mix(in srgb, var(--po-danger) 18%, transparent)', active: 'var(--po-danger)' },
  info: { rest: 'color-mix(in srgb, var(--po-info) 18%, transparent)', active: 'var(--po-info)' },
};

/**
 * Loader-size → companion text size (px).
 *
 * Used by `<PageLoading />` and `<InlineLoading />` so the "Loading…"
 * label visually matches the spinner sitting next to it. Picked so
 * label x-height ≈ spinner total height, i.e. the spinner and the
 * baseline of the text share an optical centreline.
 */
export const SIZE_TO_FONT: Record<LoaderSize, number> = {
  xs: 11,
  sm: 12,
};

export const ALL_SIZES: readonly LoaderSize[] = ['xs', 'sm'];
export const ALL_TONES: readonly LoaderTone[] = [
  'neutral',
  'success',
  'warning',
  'danger',
  'info',
];
