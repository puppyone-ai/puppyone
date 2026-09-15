import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  COLLAPSIBLE_PANE_MOTION_MS,
  CollapsiblePaneFrame,
  useCollapsiblePaneResize,
  type CollapsiblePanePresentation,
  type CollapsiblePaneGestureCommit,
  type SidebarResizeIntent,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import {
  getArrowResizedSidebarWidth,
  type InlineDirection,
} from "../../../components/auxiliarySidebarGeometry";
import {
  useNativeSurfaceLayoutTransition,
  useNativeSurfacePointerPassthroughActivity,
  useNativeSurfacePointerRoutingRegion,
} from "../../native-surfaces";

export type AuxiliaryPanelHostProps = {
  children: ReactNode | ((presentation: CollapsiblePanePresentation) => ReactNode);
  collapseThreshold?: number;
  open: boolean;
  width?: number;
  expandedWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  onOpenChange?: (open: boolean) => void;
  onWidthChange?: (width: number) => void;
};

const AUXILIARY_LAYOUT_TRANSITION_PROPERTIES = new Set(["flex-basis", "width"]);

export function AuxiliaryPanelHost({
  children,
  collapseThreshold = 0,
  open,
  width,
  expandedWidth,
  minWidth = 320,
  maxWidth = 760,
  resizable = false,
  onOpenChange,
  onWidthChange,
}: AuxiliaryPanelHostProps) {
  const { t } = useLocalization();
  const resolvedWidth = width ?? 560;
  const [lastExpandedWidth, setLastExpandedWidth] = useState(() => clamp(
    resolvedWidth > 0 ? resolvedWidth : expandedWidth ?? 560,
    minWidth,
    maxWidth,
  ));
  const wasOpenRef = useRef(open);
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const [resizerElement, setResizerElement] = useState<HTMLDivElement | null>(null);
  const onResizeActiveChange = useNativeSurfacePointerPassthroughActivity(
    "auxiliary-panel-resize",
  );
  useNativeSurfacePointerRoutingRegion("auxiliary-panel-resize", resizerElement);

  const commitPane = (commit: CollapsiblePaneGestureCommit) => {
    if (commit.type === "collapse") {
      setLastExpandedWidth(commit.restoreWidth);
      onWidthChange?.(commit.restoreWidth);
      onOpenChange?.(false);
      return;
    }
    if (commit.type === "expand") {
      if (commit.width !== undefined) onWidthChange?.(commit.width);
      onOpenChange?.(true);
      return;
    }
    onWidthChange?.(commit.width);
  };
  const resize = useCollapsiblePaneResize({
    enabled: resizable && Boolean(onWidthChange),
    bodyClassName: "desktop-right-sidebar-resizing",
    collapsed: !open,
    collapsedWidth: 0,
    collapseThreshold,
    collapsible: Boolean(onOpenChange),
    direction: getDocumentDirection(),
    maxWidth,
    minWidth,
    side: "inline-end",
    width: resolvedWidth,
    onCommit: commitPane,
    onDragActiveChange: onResizeActiveChange,
  });
  const visualOpen = !resize.collapsed;

  useNativeSurfaceLayoutTransition(
    "auxiliary-panel-transition",
    panelElement,
    visualOpen,
    COLLAPSIBLE_PANE_MOTION_MS,
    AUXILIARY_LAYOUT_TRANSITION_PROPERTIES,
    !resize.dragging,
  );
  const liveExpandedWidth = clamp(resize.width, minWidth, maxWidth);
  const renderedExpandedWidth = resize.dragging
    ? open
      ? liveExpandedWidth
      : resize.collapsed
        ? lastExpandedWidth
        : Math.max(lastExpandedWidth, liveExpandedWidth)
    : open
      ? liveExpandedWidth
      : lastExpandedWidth;

  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open) {
      setLastExpandedWidth((current) => current === liveExpandedWidth
        ? current
        : liveExpandedWidth);
      return;
    }
    if (!wasOpen && expandedWidth !== undefined) {
      const preferred = clamp(expandedWidth, minWidth, maxWidth);
      setLastExpandedWidth((current) => current === preferred ? current : preferred);
    }
  }, [expandedWidth, liveExpandedWidth, maxWidth, minWidth, open]);

  const panelStyle = {
    "--desktop-right-sidebar-width": `${renderedExpandedWidth}px`,
  } as CSSProperties;
  const resizeByKeyboard = (intent: SidebarResizeIntent, accelerated: boolean) => {
    if (!resizable || !onWidthChange) return;
    if (intent === "minimum" || intent === "maximum") {
      if (intent === "minimum" && onOpenChange) {
        commitPane({ type: "collapse", restoreWidth: minWidth });
        return;
      }
      const nextWidth = intent === "minimum" ? minWidth : maxWidth;
      commitPane(onOpenChange
        ? { type: "expand", width: nextWidth }
        : { type: "resize", width: nextWidth });
      return;
    }
    const step = accelerated ? 24 : 12;
    const nextWidth = getArrowResizedSidebarWidth({
      currentWidth: resolvedWidth,
      direction: getDocumentDirection(),
      key: intent === "decrease" ? "ArrowLeft" : "ArrowRight",
      step,
    });
    if (onOpenChange && nextWidth < minWidth) {
      commitPane({ type: "collapse", restoreWidth: minWidth });
      return;
    }
    commitPane({ type: "resize", width: clamp(nextWidth, minWidth, maxWidth) });
  };

  return (
    <CollapsiblePaneFrame
      ref={setPanelElement}
      as="aside"
      className={`desktop-right-sidebar ${visualOpen ? "is-open" : ""}`}
      collapsed={!visualOpen}
      contentWidth="var(--desktop-right-sidebar-content-width)"
      frameWidth={resize.width}
      gesturePhase={resize.phase}
      side="inline-end"
      style={panelStyle}
      viewportClassName="desktop-right-sidebar-viewport"
      contentClassName="desktop-right-sidebar-inner"
      resizeHandleRef={setResizerElement}
      resizeHandleProps={(presentation) => resizable && (open || Boolean(onOpenChange))
        ? {
            className: "desktop-right-sidebar-resizer",
            resizing: resize.dragging,
            collapsedEdgeSide: presentation.settledCollapsed ? "inline-end" : undefined,
            orientation: "vertical",
            label: t("shell.sidebar.resizeAuxiliary"),
            min: onOpenChange ? 0 : minWidth,
            max: maxWidth,
            value: resize.width,
            tabIndex: visualOpen || presentation.settledCollapsed ? 0 : -1,
            onPointerDown: resize.onPointerDown,
            onKeyboardResize: resizeByKeyboard,
          }
        : undefined}
    >
      {(presentation) => typeof children === "function"
        ? children(presentation)
        : children}
    </CollapsiblePaneFrame>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getDocumentDirection(): InlineDirection {
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}
