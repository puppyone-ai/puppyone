import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  SidebarResizeHandle,
  useCollapsiblePaneResize,
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
  children: ReactNode;
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

const PANE_COLLAPSE_ANIMATION_MS = 260;
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
  const [collapsedEdgeSettled, setCollapsedEdgeSettled] = useState(!open);
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const [resizerElement, setResizerElement] = useState<HTMLDivElement | null>(null);
  const onResizeActiveChange = useNativeSurfacePointerPassthroughActivity(
    "auxiliary-panel-resize",
  );
  useNativeSurfacePointerRoutingRegion("auxiliary-panel-resize", resizerElement);
  useNativeSurfaceLayoutTransition(
    "auxiliary-panel-transition",
    panelElement,
    open,
    PANE_COLLAPSE_ANIMATION_MS,
    AUXILIARY_LAYOUT_TRANSITION_PROPERTIES,
  );

  useEffect(() => {
    if (open) {
      setCollapsedEdgeSettled(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(
      () => setCollapsedEdgeSettled(true),
      PANE_COLLAPSE_ANIMATION_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const resize = useCollapsiblePaneResize({
    enabled: resizable && Boolean(onWidthChange),
    bodyClassName: "desktop-right-sidebar-resizing",
    collapsed: !open,
    collapsedWidth: 0,
    collapseThreshold,
    direction: getDocumentDirection(),
    maxWidth,
    minWidth,
    side: "inline-end",
    width: resolvedWidth,
    widthChangeMode: "end",
    onCollapsedChange: onOpenChange
      ? (collapsed) => onOpenChange(!collapsed)
      : undefined,
    onDragActiveChange: onResizeActiveChange,
    onWidthChange: onWidthChange ?? noop,
  });
  const liveExpandedWidth = clamp(resize.width, minWidth, maxWidth);
  const renderedExpandedWidth = open ? liveExpandedWidth : lastExpandedWidth;

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
  const collapsedEdgeVisible = !open && collapsedEdgeSettled;

  const resizeByKeyboard = (intent: SidebarResizeIntent, accelerated: boolean) => {
    if (!resizable || !onWidthChange) return;
    if (intent === "minimum" || intent === "maximum") {
      if (intent === "minimum" && onOpenChange) {
        onOpenChange(false);
        return;
      }
      onOpenChange?.(true);
      onWidthChange(intent === "minimum" ? minWidth : maxWidth);
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
      onOpenChange(false);
      return;
    }
    onWidthChange(clamp(nextWidth, minWidth, maxWidth));
  };

  return (
    <aside
      ref={setPanelElement}
      className={`desktop-right-sidebar ${open ? "is-open" : ""}`}
      style={panelStyle}
    >
      {resizable && (open || Boolean(onOpenChange)) && (
        <SidebarResizeHandle
          ref={setResizerElement}
          className="desktop-right-sidebar-resizer"
          paneEdge
          collapsedEdgeSide={collapsedEdgeVisible ? "inline-end" : undefined}
          orientation="vertical"
          label={t(collapsedEdgeVisible
            ? "shell.sidebar.expandAuxiliary"
            : "shell.sidebar.resizeAuxiliary")}
          min={onOpenChange ? 0 : minWidth}
          max={maxWidth}
          value={resize.width}
          tabIndex={open || collapsedEdgeVisible ? 0 : -1}
          onCollapsedActivate={collapsedEdgeVisible
            ? () => onOpenChange?.(true)
            : undefined}
          onPointerDown={resize.onPointerDown}
          onKeyboardResize={resizeByKeyboard}
        />
      )}
      <div className="desktop-right-sidebar-viewport">
        <div
          className="desktop-right-sidebar-inner"
          aria-hidden={open ? undefined : true}
          {...(!open ? { inert: "" } : {})}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getDocumentDirection(): InlineDirection {
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}

function noop() {}
