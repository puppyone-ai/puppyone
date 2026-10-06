import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type Rect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;
type AnchoredOverlayPlacement = "above" | "below";
type AnchoredOverlayPlacementPreference = "auto" | AnchoredOverlayPlacement;

export type AnchoredOverlayPositionInput = {
  anchor: Rect;
  boundary: Rect;
  viewportWidth: number;
  viewportHeight: number;
  overlayHeight: number;
  preferredWidth?: number;
  preferredMaxHeight?: number;
  gap?: number;
  margin?: number;
  alignment?: "start" | "center" | "end";
  placementPreference?: AnchoredOverlayPlacementPreference;
};

export type AnchoredOverlayPosition = {
  left: number;
  top: number;
  width: number;
  maxWidth: number;
  maxHeight: number;
  placement: AnchoredOverlayPlacement;
};

export function resolveAnchoredOverlayPosition({
  anchor,
  boundary,
  viewportWidth,
  viewportHeight,
  overlayHeight,
  preferredWidth = 320,
  preferredMaxHeight = 360,
  gap = 8,
  margin = 12,
  alignment = "start",
  placementPreference = "auto",
}: AnchoredOverlayPositionInput): AnchoredOverlayPosition {
  const boundaryHasArea = boundary.width > 0 && boundary.height > 0;
  const boundaryLeft = boundaryHasArea ? boundary.left : 0;
  const boundaryRight = boundaryHasArea ? boundary.right : viewportWidth;
  const boundaryTop = boundaryHasArea ? boundary.top : 0;
  const boundaryBottom = boundaryHasArea ? boundary.bottom : viewportHeight;
  const safeLeft = Math.max(margin, boundaryLeft + margin);
  const safeRight = Math.min(viewportWidth - margin, boundaryRight - margin);
  const safeTop = Math.max(margin, boundaryTop + margin);
  const safeBottom = Math.min(viewportHeight - margin, boundaryBottom - margin);
  const availableWidth = Math.max(1, safeRight - safeLeft);
  const width = Math.min(preferredWidth, availableWidth);
  const preferredLeft = alignment === "center"
    ? anchor.left + (anchor.width - width) / 2
    : alignment === "end"
      ? anchor.right - width
      : anchor.left;
  const left = clamp(preferredLeft, safeLeft, Math.max(safeLeft, safeRight - width));
  const spaceAbove = Math.max(0, anchor.top - gap - safeTop);
  const spaceBelow = Math.max(0, safeBottom - anchor.bottom - gap);
  const measuredHeight = overlayHeight > 0 ? overlayHeight : preferredMaxHeight;
  const placement = resolvePlacement(
    placementPreference,
    spaceAbove,
    spaceBelow,
    Math.min(measuredHeight, preferredMaxHeight),
  );
  const availableHeight = placement === "above" ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(1, Math.min(preferredMaxHeight, availableHeight));
  const renderedHeight = Math.min(measuredHeight, maxHeight);
  const top = placement === "above"
    ? Math.max(safeTop, anchor.top - gap - renderedHeight)
    : placementPreference === "below"
      ? anchor.bottom + gap
      : Math.min(anchor.bottom + gap, safeBottom - renderedHeight);

  return { left, top, width, maxWidth: availableWidth, maxHeight, placement };
}

type UseAnchoredOverlayPositionOptions = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  boundarySelector?: string;
  preferredWidth?: number;
  preferredMaxHeight?: number;
  widthMode?: "fixed" | "content";
  gap?: number;
  margin?: number;
  alignment?: "start" | "center" | "end";
  placementPreference?: AnchoredOverlayPlacementPreference;
};

export function useAnchoredOverlayPosition({
  open,
  anchorRef,
  boundarySelector,
  preferredWidth = 320,
  preferredMaxHeight = 360,
  widthMode = "fixed",
  gap = 8,
  margin = 12,
  alignment = "start",
  placementPreference = "auto",
}: UseAnchoredOverlayPositionOptions) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<AnchoredOverlayPosition | null>(null);
  const setOverlayRef = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node;
    setOverlayElement((current) => current === node ? current : node);
  }, []);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const overlay = overlayRef.current;
    if (!anchor || !overlay) return;
    const boundary = boundarySelector ? anchor.closest(boundarySelector) : null;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const position = resolveAnchoredOverlayPosition({
      anchor: anchor.getBoundingClientRect(),
      boundary: boundary?.getBoundingClientRect() ?? viewportRect(viewportWidth, viewportHeight),
      viewportWidth,
      viewportHeight,
      overlayHeight: overlay.getBoundingClientRect().height,
      preferredWidth: widthMode === "content"
        ? Math.max(preferredWidth, overlay.getBoundingClientRect().width) : preferredWidth,
      preferredMaxHeight,
      gap,
      margin,
      alignment,
      placementPreference,
    });
    setPosition(previous => previous && Object.keys(position).every(key =>
      previous[key as keyof AnchoredOverlayPosition] === position[key as keyof AnchoredOverlayPosition])
      ? previous : position);
  }, [
    alignment,
    anchorRef,
    boundarySelector,
    gap,
    margin,
    placementPreference,
    preferredMaxHeight,
    preferredWidth,
    widthMode,
  ]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    update();
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (overlayElement) observer?.observe(overlayElement);
    const boundary = boundarySelector ? anchorRef.current?.closest(boundarySelector) : null;
    if (boundary) observer?.observe(boundary);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, boundarySelector, open, overlayElement, update]);

  return { overlayRef, setOverlayRef, overlayPosition: position };
}

function viewportRect(width: number, height: number): Rect {
  return { top: 0, right: width, bottom: height, left: 0, width, height };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function resolvePlacement(
  preference: AnchoredOverlayPlacementPreference,
  spaceAbove: number,
  spaceBelow: number,
  desiredHeight: number,
): AnchoredOverlayPlacement {
  if (preference !== "auto") return preference;
  return spaceAbove >= desiredHeight || spaceAbove > spaceBelow ? "above" : "below";
}
