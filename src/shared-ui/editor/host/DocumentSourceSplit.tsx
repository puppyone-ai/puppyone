"use client";

import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { usePaneResizeDrag } from "../../primitives/usePaneResizeDrag";

const DEFAULT_SOURCE_SHARE = 0.5;
const MIN_SOURCE_SHARE = 0.2;
const MAX_SOURCE_SHARE = 0.8;
const KEYBOARD_STEP = 0.025;

const clampShare = (share: number) => Math.min(MAX_SOURCE_SHARE, Math.max(MIN_SOURCE_SHARE, share));

/**
 * A document's page with its source in a panel beside it, at the end of the
 * line. The page keeps its place in the tree whether or not the panel shows,
 * so opening the source never reloads the page. The divider drags, steps with
 * the arrow keys, and goes back to halves on a double-click.
 */
export function DocumentSourceSplit({ page, source }: Readonly<{
  page: ReactNode;
  /** The source panel's content; null while the panel is closed. */
  source: ReactNode | null;
}>) {
  const { t } = useLocalization();
  const rootRef = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(DEFAULT_SOURCE_SHARE);
  const [resizing, setResizing] = useState(false);
  const beginResize = usePaneResizeDrag({
    bodyClassName: "document-source-split-resizing",
    onDragActiveChange: setResizing,
    onDragStart: useCallback((event: PointerEvent<HTMLElement>) => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0) return null;
      const startShare = share;
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      return {
        onMove: ({ clientX }) => {
          const fromEnd = rtl ? clientX - bounds.left : bounds.right - clientX;
          setShare(clampShare(fromEnd / bounds.width));
        },
        onCancel: () => setShare(startShare),
      };
    }, [share]),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const towardEnd = (event.key === "ArrowRight") !== (getComputedStyle(event.currentTarget).direction === "rtl");
    setShare((current) => clampShare(current + (towardEnd ? -KEYBOARD_STEP : KEYBOARD_STEP)));
  };
  return (
    <div
      ref={rootRef}
      className="document-source-split"
      data-source-open={source ? "true" : undefined}
      style={{ "--document-source-share": String(share) } as CSSProperties}
    >
      <div className="document-source-split__page">{page}</div>
      {source && <>
        <div
          className="document-source-split__divider"
          role="separator"
          tabIndex={0}
          aria-label={t("editor.controls.resizeSource")}
          aria-orientation="vertical"
          aria-valuemin={MIN_SOURCE_SHARE * 100}
          aria-valuemax={MAX_SOURCE_SHARE * 100}
          aria-valuenow={Math.round(share * 100)}
          data-resizing={resizing ? "true" : undefined}
          onPointerDown={beginResize}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setShare(DEFAULT_SOURCE_SHARE)}
        />
        <div className="document-source-split__source">{source}</div>
      </>}
    </div>
  );
}
