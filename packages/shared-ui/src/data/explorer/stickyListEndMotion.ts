/**
 * Geometry for a list end that rides after the last row while the tree fits
 * and pins to the scrollport bottom (CSS `position: sticky`) once it
 * overflows.
 *
 * The band is followed by an in-flow sentinel whose box ends exactly where the
 * band's natural (unpinned) box ends. The sentinel is never sticky or
 * transformed, so it reports the band's flow position without depending on
 * list padding or sibling structure, and an IntersectionObserver on it tells
 * how much content is hidden beneath the pinned band.
 */

/** Steps the fade in ~5% increments; IntersectionObserver reports exact ratios. */
export const STICKY_LIST_END_FADE_THRESHOLDS: readonly number[] = Object.freeze(
  Array.from({ length: 21 }, (_, index) => index / 20),
);

/**
 * Rows animate in content coordinates, so the band's previous flow position is
 * its next flow position plus the rows' height delta. Either side may be
 * clamped by the pin, which is what makes the band glide between the pinned
 * edge and the middle of the Sidebar with its rows instead of jumping ahead of
 * them. Pinned-to-pinned changes resolve to zero motion.
 */
export function resolveStickyListEndMotionOffset({
  flowTop,
  flowOffsetY,
  pinnedTop,
}: {
  /** Next natural top of the band, in scroll-content pixels. */
  flowTop: number;
  /** Previous flow top minus next flow top (positive when rows were removed). */
  flowOffsetY: number;
  /** Top the band occupies while pinned to the scrollport bottom. */
  pinnedTop: number;
}): number {
  const previousTop = Math.min(flowTop + flowOffsetY, pinnedTop);
  const nextTop = Math.min(flowTop, pinnedTop);
  return previousTop - nextTop;
}

/** Fully visible sentinel: nothing hidden. Fully clipped: a full fade. */
export function resolveStickyListEndFade(sentinelIntersectionRatio: number): number {
  return Math.min(1, Math.max(0, 1 - sentinelIntersectionRatio));
}

/** Measures committed layout before paint; transforms never affect the result. */
export function measureStickyListEndMotionOffset({
  band,
  sentinel,
  scrollElement,
  flowOffsetY,
}: {
  band: HTMLElement;
  sentinel: HTMLElement;
  scrollElement: HTMLElement;
  flowOffsetY: number;
}): number {
  const contentTop = scrollElement.getBoundingClientRect().top
    + scrollElement.clientTop
    - scrollElement.scrollTop;
  const flowBottom = sentinel.getBoundingClientRect().bottom - contentTop;
  const height = band.offsetHeight;
  return resolveStickyListEndMotionOffset({
    flowTop: flowBottom - height,
    flowOffsetY,
    pinnedTop: scrollElement.scrollTop + scrollElement.clientHeight - height,
  });
}
