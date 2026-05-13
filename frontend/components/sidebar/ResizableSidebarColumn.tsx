'use client';

/**
 * ResizableSidebarColumn — drop-in wrapper that turns any inner page
 * sidebar into a column the user can drag to resize, with the same
 * affordance + visual rhythm as the outer `SidebarLayout` rail.
 *
 * Why a wrapper (vs. baking resize into each sidebar):
 *
 *   1. The page-level sidebars (`ExplorerSidebar`, `ScopeSidebar`,
 *      history timeline column, …) all want the *same* behaviour:
 *        • a 4px hot-zone on the right edge that lights up on hover,
 *        • mouse-down → live drag → mouse-up to commit,
 *        • clamping to a [min, max] range so the layout can't break,
 *        • persistence to localStorage keyed by the page so each
 *          column remembers its own width across sessions.
 *      Implementing that five times once per sidebar would drift —
 *      one component is the right shape.
 *
 *   2. The sidebars themselves stay layout-agnostic: they fill 100%
 *      of whatever column owns their width, just like the contents
 *      of a Linear / Notion / GitHub side rail. The wrapper owns the
 *      width state; the child owns its content.
 *
 * Visual contract — matches `SidebarLayout`'s outer rail handle pixel
 * for pixel: `right: -2px`, `width: 4px`, `bg-white/10` on hover/drag.
 * That way users get one consistent affordance whether they're
 * resizing the global rail or any inner column.
 */

import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

// `useLayoutEffect` warns when called on the server. The lazy-init
// path below means we *never* need to read localStorage in a layout
// effect on the server — but we still want the layout-effect timing
// on the client (fires before paint, so the "mounted" flag flips
// before the user could possibly see the un-animated state). Falling
// back to `useEffect` on the server keeps Next happy. Standard
// idiom across the React ecosystem (radix, framer-motion, …).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type ResizableSidebarColumnProps = {
  /**
   * Stable id used for localStorage persistence. Pages that mount
   * the same sidebar in multiple contexts should pass distinct keys
   * (e.g. `explorer-sidebar:data`, `explorer-sidebar:history`) so a
   * preferred width on one page doesn't leak into another.
   */
  storageKey: string;

  /** Initial width in px, used before localStorage hydrates. */
  defaultWidth?: number;
  /** Lower bound — narrower than this and the tree starts to clip. */
  minWidth?: number;
  /** Upper bound — wider than this and the rail dominates the view. */
  maxWidth?: number;

  /** Optional fully-controlled mode (skips localStorage entirely). */
  width?: number;
  onWidthChange?: (width: number) => void;

  /** Pass-through to the outer wrapper element. */
  className?: string;
  style?: CSSProperties;

  children: ReactNode;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

// Synchronous read of the saved width during render. Returns null when
// localStorage is unavailable (SSR, private mode, sandboxed iframe)
// or the key is unset / corrupt. Caller decides the fallback.
function readPersistedWidth(
  storageKey: string,
  minWidth: number,
  maxWidth: number
): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`sidebar-width:${storageKey}`);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return null;
    return clamp(parsed, minWidth, maxWidth);
  } catch {
    return null;
  }
}

export function ResizableSidebarColumn({
  storageKey,
  defaultWidth = 200,
  minWidth = 200,
  maxWidth = 480,
  width: controlledWidth,
  onWidthChange,
  className,
  style,
  children,
}: ResizableSidebarColumnProps) {
  const isControlled = controlledWidth !== undefined;

  // Width state — uncontrolled mode only.
  //
  // Initialised LAZILY from localStorage so that on every client-side
  // remount (the dominant case: navigating between data / access /
  // history) the very first paint already shows the user's saved
  // width. The previous implementation defaulted to `defaultWidth`
  // and then snapped via a `useEffect`, which combined with the
  // 150ms width transition produced a visible "grow → settle" drift
  // on every page load.
  //
  // SSR caveat: on the very first server render `window` is undefined
  // so `readPersistedWidth` returns null and we fall back to
  // `defaultWidth`. The client then hydrates with the saved width,
  // which would be a hydration mismatch on the `style.width` value.
  // That's harmless for content (no DOM structure changes) and
  // we further mute it visually by suppressing the `transition` on
  // the very first mount (see `isReady` below) — the snap is instant,
  // not animated.
  const [internalWidth, setInternalWidth] = useState<number>(() =>
    isControlled
      ? defaultWidth
      : readPersistedWidth(storageKey, minWidth, maxWidth) ?? defaultWidth
  );
  const width = isControlled ? controlledWidth! : internalWidth;

  const [isResizing, setIsResizing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // `isReady` flips true after the first commit, gating the width
  // transition. Until then the column renders with `transition:none`
  // so the (rare) SSR-to-hydration width snap is instantaneous —
  // user never sees an animation between defaults and saved widths.
  const [isReady, setIsReady] = useState(false);
  useIsomorphicLayoutEffect(() => {
    // Belt-and-suspenders: if the SSR path rendered `defaultWidth`
    // but localStorage actually has a saved value, snap to it
    // synchronously before paint. Skipped when we already lazy-
    // initialised correctly (the common case post-hydration).
    if (!isControlled) {
      const saved = readPersistedWidth(storageKey, minWidth, maxWidth);
      if (saved !== null && saved !== internalWidth) {
        setInternalWidth(saved);
      }
    }
    setIsReady(true);
    // We intentionally only run this once on mount — re-running on
    // every storageKey change would re-fire the snap during
    // controlled-mode parents that never hit the localStorage path
    // anyway. Storage key is treated as a stable identifier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next, minWidth, maxWidth);
      if (isControlled) {
        onWidthChange?.(clamped);
        return;
      }
      setInternalWidth(clamped);
      try {
        window.localStorage.setItem(
          `sidebar-width:${storageKey}`,
          String(Math.round(clamped))
        );
      } catch {
        // ignore — see hydrate comment.
      }
    },
    [isControlled, onWidthChange, storageKey, minWidth, maxWidth]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Drag loop — global mouse listeners only while the user is
  // actively resizing. Setting `cursor` + `userSelect` on <body>
  // (rather than per-element) keeps the col-resize cursor sticky
  // even when the pointer briefly leaves the handle, and prevents
  // accidental text selection across the rest of the page.
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      commitWidth(e.clientX - rect.left);
    };
    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isResizing, commitWidth]);

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        'relative flex flex-shrink-0 flex-col',
        // Width transition is OFF in two cases:
        //   1. Initial mount — until `isReady` flips true after the
        //      first commit, the column might still be reconciling
        //      between SSR-rendered defaultWidth and the saved width.
        //      Animating that snap was the source of the visible
        //      "grow then shrink" drift the user reported.
        //   2. Active drag — width changes 1:1 with the pointer; a
        //      transition would lag the cursor and feel laggy.
        // Otherwise (post-mount, idle) we keep the smooth transition
        // for any future programmatic / keyboard width changes.
        !isReady || isResizing
          ? 'transition-none'
          : 'transition-[width] duration-150 ease-out',
        className
      )}
      style={{ width, minWidth: 0, ...style }}
    >
      {children}

      {/* Resize handle — geometry mirrors the outer SidebarLayout's
          handle exactly: 4px wide, anchored 2px past the right edge
          so the hit area straddles the column's border-right. Higher
          z-index than typical sidebar content but below modals. */}
      <div
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize sidebar'
        onMouseDown={handleMouseDown}
        className={clsx(
          'absolute top-0 right-[-2px] z-20 h-full w-1 cursor-col-resize',
          isResizing ? 'bg-white/10' : 'hover:bg-white/10'
        )}
      />
    </div>
  );
}
