import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { joinSidebarClassNames } from "./classNames";
import {
  SidebarResizeHandle,
  type CollapsedPaneEdgeSide,
  type SidebarResizeHandleProps,
} from "./SidebarResizeHandle";

export type CollapsiblePanePresentationPhase =
  | "expanded"
  | "collapsing"
  | "collapsed"
  | "expanding"
  | "resizing";

export type CollapsiblePanePresentation = Readonly<{
  /** Expanded domain layout stays active until the moving viewport has settled. */
  contentExpanded: boolean;
  /** Content is present throughout motion and hidden only at a settled zero-width edge. */
  contentVisible: boolean;
  phase: CollapsiblePanePresentationPhase;
  settledCollapsed: boolean;
}>;

type PaneChildren = ReactNode | ((presentation: CollapsiblePanePresentation) => ReactNode);
type PaneGesturePhase = "resizing" | "collapse-preview" | "expand-preview";
type PaneResizeHandleProps =
  | Omit<SidebarResizeHandleProps, "paneEdge">
  | ((presentation: CollapsiblePanePresentation) => Omit<SidebarResizeHandleProps, "paneEdge"> | null | undefined);

export type CollapsiblePaneFrameProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: "aside" | "div";
  children: PaneChildren;
  collapsed: boolean;
  /** Fixed geometry of the content plane behind the moving viewport. */
  contentWidth?: number | string;
  contentClassName?: string;
  /** Current outer frame width. This is the only layout value that animates. */
  frameWidth?: number | string;
  gesturePhase?: PaneGesturePhase | "idle";
  /** Compact rails retain interactive content after the frame settles collapsed. */
  retainCollapsedContent?: boolean;
  resizeHandleProps?: PaneResizeHandleProps;
  resizeHandleRef?: Ref<HTMLDivElement>;
  side: CollapsedPaneEdgeSide;
  viewportClassName?: string;
};

type PresentationSnapshot = Readonly<{
  settledCollapsed: boolean;
  targetCollapsed: boolean;
  transitioning: boolean;
  transitionRevision: number;
}>;

const FRAME_TRANSITION_PROPERTIES = new Set(["flex-basis", "min-width", "width"]);

/**
 * Canonical geometry and transition boundary for a collapsible inline pane.
 *
 * Only Frame changes width. Viewport clips. Content Plane keeps its last
 * expanded width and edge anchor, so rows, labels, gaps and scroll geometry do
 * not reflow or translate while the divider crosses them. The frame also owns
 * the presentation lifecycle so hosts cannot hide content before motion ends.
 */
export const CollapsiblePaneFrame = forwardRef<HTMLElement, CollapsiblePaneFrameProps>(
  function CollapsiblePaneFrame(
    {
      as = "aside",
      children,
      className,
      collapsed,
      contentClassName,
      contentWidth,
      frameWidth,
      gesturePhase = "idle",
      onTransitionEnd,
      resizeHandleProps,
      resizeHandleRef,
      retainCollapsedContent = false,
      side,
      style,
      viewportClassName,
      ...props
    },
    ref,
  ) {
    const frameElementRef = useRef<HTMLElement | null>(null);
    const [snapshot, setSnapshot] = useState<PresentationSnapshot>(() => ({
      settledCollapsed: collapsed,
      targetCollapsed: collapsed,
      transitioning: false,
      transitionRevision: 0,
    }));

    // Synchronize the target before React commits the new frame width. This
    // prevents rapid direction reversals from briefly hiding the content plane.
    if (snapshot.targetCollapsed !== collapsed) {
      setSnapshot({
        ...snapshot,
        targetCollapsed: collapsed,
        transitioning: true,
        transitionRevision: snapshot.transitionRevision + 1,
      });
    }

    const transitionPending = snapshot.transitioning;
    const settleTarget = useCallback(() => {
      setSnapshot((current) => !current.transitioning
        ? current
        : {
            ...current,
            settledCollapsed: current.targetCollapsed,
            transitioning: false,
          });
    }, []);

    useEffect(() => {
      if (!transitionPending) return undefined;
      // transitionend is authoritative. The timeout is only a convergence path
      // for reduced motion, detached elements, and Chromium transitioncancel.
      const timeoutId = window.setTimeout(
        settleTarget,
        readTransitionDurationMs(frameElementRef.current) + 50,
      );
      return () => window.clearTimeout(timeoutId);
    }, [settleTarget, snapshot.transitionRevision, transitionPending]);

    const handleTransitionEnd = (event: ReactTransitionEvent<HTMLElement>) => {
      onTransitionEnd?.(event);
      if (event.target !== event.currentTarget
        || !FRAME_TRANSITION_PROPERTIES.has(event.propertyName)) return;
      settleTarget();
    };
    const phase: CollapsiblePanePresentationPhase = gesturePhase === "resizing"
      ? "resizing"
      : transitionPending
        ? snapshot.targetCollapsed ? "collapsing" : "expanding"
        : snapshot.settledCollapsed ? "collapsed" : "expanded";
    const gestureActive = gesturePhase !== "idle";
    const contentVisible = retainCollapsedContent
      || gestureActive
      || !snapshot.settledCollapsed
      || transitionPending;
    const presentation: CollapsiblePanePresentation = Object.freeze({
      contentExpanded: gestureActive || !snapshot.settledCollapsed || transitionPending,
      contentVisible,
      phase,
      settledCollapsed: snapshot.settledCollapsed && !transitionPending && !gestureActive,
    });
    const resolvedChildren = typeof children === "function"
      ? children(presentation)
      : children;
    const resolvedResizeHandleProps = typeof resizeHandleProps === "function"
      ? resizeHandleProps(presentation)
      : resizeHandleProps;
    const frameStyle = {
      ...style,
      ...(contentWidth === undefined ? null : {
        "--po-collapsible-pane-content-width": toCssLength(contentWidth),
      }),
      ...(frameWidth === undefined ? null : {
        "--po-collapsible-pane-frame-width": toCssLength(frameWidth),
      }),
    } as CSSProperties;
    const frameProps = {
      ...props,
      className: joinSidebarClassNames("po-collapsible-pane-frame", className),
      "data-pane-collapsed": collapsed ? "true" : "false",
      "data-pane-content-visible": contentVisible ? "true" : "false",
      "data-pane-gesture": gesturePhase === "idle" ? undefined : gesturePhase,
      "data-pane-presentation": phase,
      "data-pane-side": side,
      onTransitionEnd: handleTransitionEnd,
      style: frameStyle,
    };
    const frameChildren = (
      <>
        <div className={joinSidebarClassNames("po-collapsible-pane-viewport", viewportClassName)}>
          <div
            className={joinSidebarClassNames("po-collapsible-pane-content", contentClassName)}
            aria-hidden={contentVisible ? undefined : true}
            {...(!contentVisible ? { inert: "" } : {})}
          >
            {resolvedChildren}
          </div>
        </div>
        {resolvedResizeHandleProps && (
          <SidebarResizeHandle
            {...resolvedResizeHandleProps}
            ref={resizeHandleRef}
            paneEdge
          />
        )}
      </>
    );
    const setFrameRef = useCallback((element: HTMLElement | null) => {
      frameElementRef.current = element;
      assignRef(ref, element);
    }, [ref]);

    return as === "div"
      ? <div {...frameProps} ref={setFrameRef as Ref<HTMLDivElement>}>{frameChildren}</div>
      : <aside {...frameProps} ref={setFrameRef}>{frameChildren}</aside>;
  },
);

function toCssLength(value: number | string) {
  return typeof value === "number" ? `${value}px` : value;
}

function readTransitionDurationMs(element: HTMLElement | null) {
  if (!element) return 0;
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(",").map(parseCssTimeMs);
  const delays = style.transitionDelay.split(",").map(parseCssTimeMs);
  return durations.reduce((maximum, duration, index) => Math.max(
    maximum,
    duration + (delays[index % Math.max(1, delays.length)] ?? 0),
  ), 0);
}

function parseCssTimeMs(value: string) {
  const normalized = value.trim();
  if (normalized.endsWith("ms")) return Number.parseFloat(normalized) || 0;
  if (normalized.endsWith("s")) return (Number.parseFloat(normalized) || 0) * 1_000;
  return 0;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}
