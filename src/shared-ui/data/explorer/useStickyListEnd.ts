import { useEffect, useLayoutEffect, type RefObject } from "react";
import { createExplorerMotionAnimation } from "./explorerMotionAnimation";
import {
  STICKY_LIST_END_FADE_THRESHOLDS,
  measureStickyListEndMotionOffset,
  resolveStickyListEndFade,
} from "./stickyListEndMotion";

/** How much of the tree is hidden beneath the pinned band (0..1), on the band. */
const FADE_PROPERTY = "--tree-list-end-fade";
/** The band's block size, on the scroll container, for `scroll-padding`. */
const BLOCK_SIZE_PROPERTY = "--tree-list-end-block-size";

/**
 * Behavior for a sticky Explorer list end. Pinning itself is pure CSS
 * (`position: sticky`); this hook only adds what CSS cannot express:
 * - FLIP motion that keeps the band with its rows across disclosure, even
 *   when the change pins or unpins it;
 * - a scroll-free fade driven by an IntersectionObserver on the sentinel;
 * - the band's measured size, published for the container's scroll-padding
 *   so focus and keyboard reveal never park a row beneath the band.
 */
export function useStickyListEnd({
  enabled,
  bandRef,
  sentinelRef,
  scrollRef,
  generation,
  flowOffsetY,
}: {
  enabled: boolean;
  bandRef: RefObject<HTMLElement>;
  sentinelRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  /** Motion-plan generation; changes once per disclosure commit. */
  generation: number;
  /** Previous minus next flow top of the band, as planned for the rows. */
  flowOffsetY: number;
}) {
  useStickyListEndMotion({ enabled, bandRef, sentinelRef, scrollRef, generation, flowOffsetY });
  useStickyListEndFade({ enabled, bandRef, sentinelRef, scrollRef });
  useStickyListEndScrollPadding({ enabled, bandRef, scrollRef });
}

function useStickyListEndMotion({
  enabled,
  bandRef,
  sentinelRef,
  scrollRef,
  generation,
  flowOffsetY,
}: {
  enabled: boolean;
  bandRef: RefObject<HTMLElement>;
  sentinelRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  generation: number;
  flowOffsetY: number;
}) {
  // Layout effect: FLIP must read the committed layout before the first paint.
  // Each disclosure commit (a new generation) cancels the previous run and
  // restarts from the planned positions, matching the rows' own motion
  // contract so the band never drifts away from its neighbours.
  useLayoutEffect(() => {
    const band = bandRef.current;
    const sentinel = sentinelRef.current;
    const scrollElement = scrollRef.current;
    if (!enabled || flowOffsetY === 0 || !band || !sentinel || !scrollElement) return undefined;
    if (typeof band.animate !== "function") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const offsetY = measureStickyListEndMotionOffset({ band, sentinel, scrollElement, flowOffsetY });
    if (Math.abs(offsetY) < 0.5) return undefined;
    const definition = createExplorerMotionAnimation({ instruction: { kind: "move", offsetY } });
    if (!definition) return undefined;
    const animation = band.animate(definition.keyframes, definition.options);
    return () => animation.cancel();
  }, [bandRef, enabled, flowOffsetY, generation, scrollRef, sentinelRef]);
}

function useStickyListEndFade({
  enabled,
  bandRef,
  sentinelRef,
  scrollRef,
}: {
  enabled: boolean;
  bandRef: RefObject<HTMLElement>;
  sentinelRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
}) {
  // Passive effect: the scroll container is an ancestor whose ref is attached
  // only after this subtree's layout effects have run on mount.
  useEffect(() => {
    const band = bandRef.current;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!enabled || !band || !sentinel || !root) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      band.style.setProperty(FADE_PROPERTY, resolveStickyListEndFade(entry.intersectionRatio).toFixed(3));
    }, { root, threshold: [...STICKY_LIST_END_FADE_THRESHOLDS] });
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      band.style.removeProperty(FADE_PROPERTY);
    };
  }, [bandRef, enabled, scrollRef, sentinelRef]);
}

function useStickyListEndScrollPadding({
  enabled,
  bandRef,
  scrollRef,
}: {
  enabled: boolean;
  bandRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
}) {
  useEffect(() => {
    const band = bandRef.current;
    const scrollElement = scrollRef.current;
    if (!enabled || !band || !scrollElement) return undefined;
    if (typeof ResizeObserver === "undefined") return undefined;

    // ResizeObserver delivers an initial observation, then one per size change.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const blockSize = entry?.borderBoxSize?.[0]?.blockSize ?? band.offsetHeight;
      scrollElement.style.setProperty(BLOCK_SIZE_PROPERTY, `${blockSize}px`);
    });
    observer.observe(band);

    return () => {
      observer.disconnect();
      scrollElement.style.removeProperty(BLOCK_SIZE_PROPERTY);
    };
  }, [bandRef, enabled, scrollRef]);
}
