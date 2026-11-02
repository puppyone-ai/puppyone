import { useLayoutEffect, useState, type RefObject } from "react";

const DEFAULT_SCROLLABLE_CLASS = "is-scrollable";
const DEFAULT_OVERFLOW_THRESHOLD = 1;
export type ScrollableStateOptions = {
  revision?: unknown;
  threshold?: number;
};

export type ScrollEdgeStateOptions = ScrollableStateOptions & {
  fadeDistance?: number;
};

export type ScrollableDescendantClassOptions = ScrollableStateOptions & {
  className?: string;
  selector: string;
};

export type ScrollEdgeState = {
  atBottom: boolean;
  atTop: boolean;
  bottomFade: number;
  scrollable: boolean;
  topFade: number;
};

export function hasVerticalOverflow(element: HTMLElement, threshold = DEFAULT_OVERFLOW_THRESHOLD) {
  return element.scrollHeight - element.clientHeight > threshold;
}

export function useScrollableState<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  options: ScrollableStateOptions = {},
) {
  const { revision, threshold = DEFAULT_OVERFLOW_THRESHOLD } = options;
  const [scrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const element = elementRef.current;
    if (!element) return undefined;

    let frameId: number | null = null;

    const updateScrollableState = () => {
      frameId = null;
      const nextScrollable = hasVerticalOverflow(element, threshold);
      setScrollable((current) => (current === nextScrollable ? current : nextScrollable));
    };

    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateScrollableState);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(element);
    if (element.firstElementChild) resizeObserver?.observe(element.firstElementChild);

    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(element, { characterData: true, childList: true, subtree: true });

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [elementRef, revision, threshold]);

  return scrollable;
}

export function useScrollEdgeState<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  options: ScrollEdgeStateOptions = {},
) {
  const {
    fadeDistance = 24,
    revision,
    threshold = DEFAULT_OVERFLOW_THRESHOLD,
  } = options;
  const [edgeState, setEdgeState] = useState<ScrollEdgeState>({
    atBottom: true,
    atTop: true,
    bottomFade: 0,
    scrollable: false,
    topFade: 0,
  });

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const element = elementRef.current;
    if (!element) return undefined;

    let frameId: number | null = null;

    const updateEdgeState = () => {
      frameId = null;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const scrollTop = clampNumber(element.scrollTop, 0, maxScrollTop);
      const scrollable = maxScrollTop > threshold;
      const nextState: ScrollEdgeState = {
        atBottom: !scrollable || maxScrollTop - scrollTop <= threshold,
        atTop: !scrollable || scrollTop <= threshold,
        bottomFade: scrollable ? clampNumber((maxScrollTop - scrollTop) / fadeDistance, 0, 1) : 0,
        scrollable,
        topFade: scrollable ? clampNumber(scrollTop / fadeDistance, 0, 1) : 0,
      };

      setEdgeState((current) => (
        current.atBottom === nextState.atBottom
        && current.atTop === nextState.atTop
        && current.scrollable === nextState.scrollable
        && Math.abs(current.bottomFade - nextState.bottomFade) < 0.01
        && Math.abs(current.topFade - nextState.topFade) < 0.01
          ? current
          : nextState
      ));
    };

    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateEdgeState);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(element);
    if (element.firstElementChild) resizeObserver?.observe(element.firstElementChild);

    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(element, { characterData: true, childList: true, subtree: true });

    scheduleUpdate();
    element.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      element.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [elementRef, fadeDistance, revision, threshold]);

  return edgeState;
}

export function useScrollableDescendantClasses<T extends HTMLElement>(
  rootRef: RefObject<T | null>,
  options: ScrollableDescendantClassOptions,
) {
  const {
    className = DEFAULT_SCROLLABLE_CLASS,
    revision,
    selector,
    threshold = DEFAULT_OVERFLOW_THRESHOLD,
  } = options;

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const root = rootRef.current;
    if (!root) return undefined;

    const observed = new Set<HTMLElement>();
    let frameId: number | null = null;

    const updateContainer = (container: HTMLElement) => {
      container.classList.toggle(className, hasVerticalOverflow(container, threshold));
    };

    const updateAll = () => {
      root.querySelectorAll<HTMLElement>(selector).forEach(updateContainer);
    };

    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateAll();
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target instanceof HTMLElement) updateContainer(entry.target);
        });
      });

    const observeCurrentContainers = () => {
      observed.forEach((container) => {
        if (root.contains(container)) return;
        resizeObserver?.unobserve(container);
        container.classList.remove(className);
        observed.delete(container);
      });

      root.querySelectorAll<HTMLElement>(selector).forEach((container) => {
        if (!observed.has(container)) {
          observed.add(container);
          resizeObserver?.observe(container);
        }
        updateContainer(container);
      });
    };

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
        observeCurrentContainers();
        scheduleUpdate();
      });

    observeCurrentContainers();
    scheduleUpdate();
    mutationObserver?.observe(root, { characterData: true, childList: true, subtree: true });

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observed.forEach((container) => {
        container.classList.remove(className);
      });
    };
  }, [className, revision, rootRef, selector, threshold]);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
