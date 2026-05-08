/**
 * PuppyOne unified loading system.
 *
 * Public surface — all loaders flow through this barrel so refactors
 * stay backwards-compatible (file moves only need to update one
 * export here, not every call-site).
 *
 * Quick guide for picking the right loader:
 *
 *   ┌─────────────────────────────┬──────────────────────────────┐
 *   │ Where it lives              │ Use                          │
 *   ├─────────────────────────────┼──────────────────────────────┤
 *   │ Inside a button             │ <Dots size="xs" />           │
 *   │ Next to a single line       │ <InlineLoading />            │
 *   │ "Loading…" replacement      │ <InlineLoading />            │
 *   │ Centred in a panel/card     │ <PageLoading variant="fill"/>│
 *   │ Whole page                  │ <PageLoading />              │
 *   │ Predictable layout coming   │ <Skeleton.Editor /> etc.     │
 *   └─────────────────────────────┴──────────────────────────────┘
 *
 * Size scale: `xs` (~9px) for in-button / in-cell, `sm` (~13px) for
 * everything else. There is no `md` or `lg` — both were retired to
 * keep all "loader occupies a region" surfaces at the same visual
 * weight (round-1: lg→md on 2026-05-08; round-2: md→sm same day).
 *
 * For animation flavour & colour overrides see the props on each
 * component; defaults are tuned to the dark, grey-scale chrome that
 * dominates PuppyOne, so most usage should pass NO props.
 */

export { PulseGrid } from './PulseGrid';
export type { PulseGridProps } from './PulseGrid';

export { Dots } from './Dots';
export type { DotsProps } from './Dots';

export { InlineLoading } from './InlineLoading';
export type { InlineLoadingProps } from './InlineLoading';

export { PageLoading } from './PageLoading';
export type { PageLoadingProps } from './PageLoading';

export {
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  SkeletonList,
  SkeletonCard,
  SkeletonEditor,
  SkeletonDashboard,
} from './Skeleton';

export {
  ALL_SIZES,
  ALL_TONES,
  PULSE_GRID_SIZE,
  DOTS_SIZE,
  SIZE_TO_FONT,
  TONE_MAP,
} from './tokens';
export type { LoaderSize, LoaderTone } from './tokens';
