import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { PanelLeft } from "lucide-react";
import {
  CollapsiblePaneFrame,
  useCollapsiblePaneResize,
  type CollapsiblePanePresentation,
  type CollapsiblePaneGestureCommit,
  type SidebarResizeIntent,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { AuxiliaryPanelHost } from "../features/app-shell/auxiliary";
import { DesktopShellAccessoryProvider } from "../features/app-shell/DesktopShellAccessoryContext";
import { DesktopPaneLayoutProvider } from "../features/app-shell/layout/DesktopPaneLayoutContext";
import {
  useNativeSurfacePointerPassthroughActivity,
  useNativeSurfacePointerRoutingRegion,
} from "../features/native-surfaces";
import {
  DEFAULT_EXPLORER_WIDTH,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
  MIN_MAIN_PANE_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  RIGHT_SIDEBAR_COLLAPSE_THRESHOLD,
  resolveDesktopPaneLayout,
} from "../features/app-shell/layout/desktopPaneLayout";
import { DesktopWindowChrome } from "./DesktopWindowChrome";

import type { WorkspaceSurfaceId } from "../features/app-shell/workspace-surfaces";

export type DesktopView = WorkspaceSurfaceId;
export type DesktopLeadingRailRenderState = Readonly<{ expanded: boolean }>;

type DesktopCloudShellProps = {
  children: ReactNode;
  leadingRail?: ReactNode;
  renderLeadingRail?: (state: DesktopLeadingRailRenderState) => ReactNode;
  leadingRailWidth?: number;
  leadingRailMinWidth?: number;
  leadingRailMaxWidth?: number;
  leadingRailCollapsed?: boolean;
  leadingRailCollapsedWidth?: number;
  leadingRailCollapseThreshold?: number;
  resizableLeadingRail?: boolean;
  titlebarSidebarSlot?: ReactNode;
  titlebarEditorSlot?: ReactNode;
  titlebarActions?: ReactNode;
  navigationToolbarActions?: ReactNode;
  locationBar?: ReactNode;
  leftSidebarCollapsed?: boolean;
  leftSidebarMinWidth?: number;
  leftSidebarMaxWidth?: number;
  leftSidebarPresent?: boolean;
  leftSidebarWidth?: number;
  mainPaneMinWidth?: number;
  rightSidebar?: ReactNode | ((presentation: CollapsiblePanePresentation) => ReactNode);
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
  minRightSidebarWidth?: number;
  maxRightSidebarWidth?: number;
  resizableRightSidebar?: boolean;
  onLeftSidebarExpand?: () => void;
  onLeadingRailCollapsedChange?: (collapsed: boolean) => void;
  onLeadingRailWidthChange?: (width: number) => void;
  onRightSidebarOpenChange?: (open: boolean) => void;
  onRightSidebarWidthChange?: (width: number) => void;
};

export function DesktopCloudShell({
  children,
  leadingRail,
  renderLeadingRail,
  leadingRailWidth = 0,
  leadingRailMinWidth = 160,
  leadingRailMaxWidth = 360,
  leadingRailCollapsed = false,
  leadingRailCollapsedWidth = 0,
  leadingRailCollapseThreshold,
  resizableLeadingRail = false,
  titlebarSidebarSlot,
  titlebarEditorSlot,
  titlebarActions,
  navigationToolbarActions,
  locationBar,
  leftSidebarCollapsed = false,
  leftSidebarMinWidth = MIN_EXPLORER_WIDTH,
  leftSidebarMaxWidth = MAX_EXPLORER_WIDTH,
  leftSidebarPresent = true,
  leftSidebarWidth = DEFAULT_EXPLORER_WIDTH,
  mainPaneMinWidth = MIN_MAIN_PANE_WIDTH,
  rightSidebar,
  rightSidebarOpen = false,
  rightSidebarWidth = DEFAULT_RIGHT_SIDEBAR_WIDTH,
  minRightSidebarWidth = MIN_RIGHT_SIDEBAR_WIDTH,
  maxRightSidebarWidth,
  resizableRightSidebar = false,
  onLeftSidebarExpand,
  onLeadingRailCollapsedChange,
  onLeadingRailWidthChange,
  onRightSidebarOpenChange,
  onRightSidebarWidthChange,
}: DesktopCloudShellProps) {
  const { t } = useLocalization();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [navigationToolbarHost, setNavigationToolbarHost] = useState<HTMLDivElement | null>(null);
  const [leadingRailResizerElement, setLeadingRailResizerElement] = useState<HTMLDivElement | null>(null);
  const bodyWidth = useObservedElementWidth(bodyRef);
  const resolvedLeadingRailMinWidth = Math.max(0, Math.round(leadingRailMinWidth));
  const resolvedLeadingRailMaxWidth = Math.max(
    resolvedLeadingRailMinWidth,
    Math.round(leadingRailMaxWidth),
  );
  const resolvedLeadingRailCollapsedWidth = clamp(
    Math.round(leadingRailCollapsedWidth),
    0,
    resolvedLeadingRailMinWidth,
  );
  const resolvedLeadingRailCollapseThreshold = clamp(
    Math.round(leadingRailCollapseThreshold ?? resolvedLeadingRailMinWidth / 2),
    0,
    resolvedLeadingRailMinWidth,
  );
  const leadingRailPresent = Boolean(leadingRail || renderLeadingRail);
  const leadingRailResizable = Boolean(
    leadingRailPresent && resizableLeadingRail && onLeadingRailWidthChange,
  );
  const leadingRailCanCollapse = Boolean(onLeadingRailCollapsedChange);
  const onLeadingRailResizeActiveChange = useNativeSurfacePointerPassthroughActivity(
    "explorer-resize",
  );
  useNativeSurfacePointerRoutingRegion("explorer-resize", leadingRailResizerElement);
  const commitLeadingRail = (commit: CollapsiblePaneGestureCommit) => {
    if (commit.type === "collapse") {
      onLeadingRailWidthChange?.(commit.restoreWidth);
      onLeadingRailCollapsedChange?.(true);
      return;
    }
    if (commit.type === "expand") {
      if (commit.width !== undefined) onLeadingRailWidthChange?.(commit.width);
      onLeadingRailCollapsedChange?.(false);
      return;
    }
    onLeadingRailWidthChange?.(commit.width);
  };
  const leadingRailResize = useCollapsiblePaneResize({
    bodyClassName: "desktop-project-switcher-resizing",
    collapsed: leadingRailCollapsed,
    collapsedWidth: resolvedLeadingRailCollapsedWidth,
    collapseThreshold: leadingRailCanCollapse ? resolvedLeadingRailCollapseThreshold : 0,
    collapsible: leadingRailCanCollapse,
    direction: getDocumentDirection(),
    enabled: leadingRailResizable,
    maxWidth: resolvedLeadingRailMaxWidth,
    minWidth: resolvedLeadingRailMinWidth,
    side: "inline-start",
    width: leadingRailWidth,
    onCommit: commitLeadingRail,
    onDragActiveChange: onLeadingRailResizeActiveChange,
  });
  const leadingRailVisuallyCollapsed = leadingRailResize.collapsed;
  const resolvedLeadingRailWidth = leadingRailPresent
    ? leadingRailResizable
      ? leadingRailResize.width
      : Math.max(0, Math.round(leadingRailWidth))
    : 0;
  const retainedLeadingRailExpandedWidth = clamp(
    Math.round(leadingRailWidth),
    resolvedLeadingRailMinWidth,
    resolvedLeadingRailMaxWidth,
  );
  // Match the Explorer contract: the frame changes width while its content
  // plane retains expanded geometry. Rows are clipped instead of reflowing.
  const renderedLeadingRailContentWidth = Math.max(
    resolvedLeadingRailWidth,
    retainedLeadingRailExpandedWidth,
  );
  const paneLayout = useMemo(() => resolveDesktopPaneLayout({
    // The Project rail sits beside the workspace column below the Header, so
    // the observed body width is already the exact width available to panes.
    availableWidth: Math.max(0, bodyWidth),
    explorer: {
      collapsed: leftSidebarCollapsed,
      maxWidth: leftSidebarMaxWidth,
      minWidth: leftSidebarMinWidth,
      preferredWidth: leftSidebarWidth,
      present: leftSidebarPresent,
    },
    mainMinWidth: mainPaneMinWidth,
    rightSidebar: {
      minWidth: minRightSidebarWidth,
      maxWidth: maxRightSidebarWidth,
      open: rightSidebarOpen,
      preferredWidth: rightSidebarWidth,
      present: Boolean(rightSidebar),
    },
  }), [
    bodyWidth,
    leftSidebarCollapsed,
    leftSidebarMinWidth,
    leftSidebarMaxWidth,
    leftSidebarPresent,
    leftSidebarWidth,
    mainPaneMinWidth,
    minRightSidebarWidth,
    maxRightSidebarWidth,
    rightSidebar,
    rightSidebarOpen,
    rightSidebarWidth,
  ]);
  const bodyStyle = {
    minWidth: paneLayout.minimumWidth,
  } as CSSProperties;
  const paneGroupStyle = {
    "--desktop-main-pane-min-width": `${paneLayout.main.minWidth}px`,
    minWidth: paneLayout.minimumWidth,
  } as CSSProperties;
  const sidebarState = !leftSidebarPresent
    ? "absent"
    : paneLayout.explorer.collapsed
      ? "collapsed"
      : "expanded";
  const shellStyle = {
    "--desktop-shell-explorer-width": `${paneLayout.explorer.width}px`,
    "--desktop-shell-leading-rail-width": `${resolvedLeadingRailWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    publishWindowMinimumWidth(paneLayout.minimumWidth + resolvedLeadingRailWidth);
  }, [paneLayout.minimumWidth, resolvedLeadingRailWidth]);

  useEffect(() => () => {
    publishWindowMinimumWidth(0);
  }, []);

  const resizeLeadingRailByKeyboard = (
    intent: SidebarResizeIntent,
    accelerated: boolean,
  ) => {
    if (!leadingRailResizable || !onLeadingRailWidthChange) return;
    if (intent === "minimum") {
      if (leadingRailCanCollapse) {
        commitLeadingRail({
          type: "collapse",
          restoreWidth: resolvedLeadingRailMinWidth,
        });
        return;
      }
      commitLeadingRail({ type: "resize", width: resolvedLeadingRailMinWidth });
      return;
    }
    if (intent === "maximum") {
      commitLeadingRail({ type: "expand", width: resolvedLeadingRailMaxWidth });
      return;
    }
    const step = accelerated ? 24 : 12;
    const physicalDirection = intent === "decrease" ? -1 : 1;
    const directionMultiplier = getDocumentDirection() === "rtl" ? -1 : 1;
    const nextWidth = resolvedLeadingRailWidth
      + physicalDirection * directionMultiplier * step;
    if (leadingRailCollapsed) {
      if (nextWidth > resolvedLeadingRailCollapsedWidth) {
        commitLeadingRail({ type: "expand", width: resolvedLeadingRailMinWidth });
      }
      return;
    }
    if (leadingRailCanCollapse && nextWidth < resolvedLeadingRailMinWidth) {
      commitLeadingRail({
        type: "collapse",
        restoreWidth: resolvedLeadingRailMinWidth,
      });
      return;
    }
    commitLeadingRail({
      type: "resize",
      width: clamp(nextWidth, resolvedLeadingRailMinWidth, resolvedLeadingRailMaxWidth),
    });
  };

  return (
    <div
      className="desktop-shell"
      data-leading-rail={leadingRailPresent ? "true" : undefined}
      data-titlebar-sidebar-state={sidebarState}
      style={shellStyle}
    >
      <div className="desktop-shell-workbench">
        <DesktopWindowChrome
          context={(
            <>
              <div
                className="desktop-titlebar-sidebar-context"
                data-sidebar-state={sidebarState}
              >
                {paneLayout.explorer.collapsed && leftSidebarPresent && onLeftSidebarExpand && (
                  <button
                    className="desktop-titlebar-context-icon-button desktop-titlebar-sidebar-expand"
                    type="button"
                    aria-label={t("shared-ui.explorer.expandSidebar")}
                    title={t("shared-ui.explorer.expandSidebar")}
                    onClick={() => onLeftSidebarExpand()}
                  >
                    <PanelLeft size={15} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                )}
                {titlebarSidebarSlot}
              </div>
              {titlebarEditorSlot != null && (
                <div className="desktop-titlebar-editor-context">
                  {titlebarEditorSlot}
                </div>
              )}
            </>
          )}
          actions={titlebarActions}
        />

        <div className="desktop-shell-below-header">
          {leadingRailPresent && (
            <CollapsiblePaneFrame
              as="div"
              className="desktop-shell-leading-rail"
              collapsed={leadingRailVisuallyCollapsed}
              contentWidth={renderedLeadingRailContentWidth}
              frameWidth={resolvedLeadingRailWidth}
              gesturePhase={leadingRailResize.phase}
              retainCollapsedContent
              side="inline-start"
              viewportClassName="desktop-shell-leading-rail-viewport"
              contentClassName="desktop-shell-leading-rail-inner"
              resizeHandleRef={setLeadingRailResizerElement}
              resizeHandleProps={(presentation) => leadingRailResizable
                ? {
                    className: "desktop-project-switcher-resizer",
                    collapsedEdgeSide: presentation.settledCollapsed ? "inline-start" : undefined,
                    resizing: leadingRailResize.dragging,
                    orientation: "vertical",
                    label: t("shell.workspaceSwitcher.resizeProjects"),
                    min: leadingRailCanCollapse
                      ? resolvedLeadingRailCollapsedWidth
                      : resolvedLeadingRailMinWidth,
                    max: resolvedLeadingRailMaxWidth,
                    value: resolvedLeadingRailWidth,
                    onPointerDown: leadingRailResize.onPointerDown,
                    onKeyboardResize: resizeLeadingRailByKeyboard,
                  }
                : undefined}
            >
              {({ contentExpanded }) => renderLeadingRail
                ? renderLeadingRail({ expanded: contentExpanded })
                : leadingRail}
            </CollapsiblePaneFrame>
          )}
          <div className="desktop-shell-workspace-column">
            <DesktopShellAccessoryProvider navigationToolbarHost={navigationToolbarHost}>
              <div
                ref={setNavigationToolbarHost}
                className="desktop-shell-navigation-toolbar-host"
                data-window-no-drag="true"
              >
                {navigationToolbarActions && (
                  <div
                    className="desktop-shell-navigation-toolbar-actions desktop-shell-toolbar-section"
                    data-shell-toolbar-section="actions"
                  >
                    {navigationToolbarActions}
                  </div>
                )}
              </div>
              {locationBar && (
                <div className="desktop-shell-location-bar-host" data-window-no-drag="true">
                  {locationBar}
                </div>
              )}
              <DesktopPaneLayoutProvider value={paneLayout}>
                <div ref={bodyRef} className="desktop-shell-body" style={bodyStyle}>
                  <div className="desktop-shell-pane-group" style={paneGroupStyle}>
                    <main className="desktop-surface" style={{ minWidth: paneLayout.surfaceMinWidth }}>
                      {children}
                    </main>
                    {rightSidebar && (
                      <AuxiliaryPanelHost
                        collapseThreshold={RIGHT_SIDEBAR_COLLAPSE_THRESHOLD}
                        open={paneLayout.rightSidebar.open}
                        width={paneLayout.rightSidebar.width}
                        expandedWidth={rightSidebarWidth}
                        minWidth={paneLayout.rightSidebar.minWidth}
                        maxWidth={paneLayout.rightSidebar.maxWidth}
                        resizable={resizableRightSidebar}
                        onOpenChange={onRightSidebarOpenChange}
                        onWidthChange={onRightSidebarWidthChange}
                      >
                        {rightSidebar}
                      </AuxiliaryPanelHost>
                    )}
                  </div>
                </div>
              </DesktopPaneLayoutProvider>
            </DesktopShellAccessoryProvider>
          </div>
        </div>
      </div>
    </div>
  );
}

function useObservedElementWidth<T extends HTMLElement>(ref: RefObject<T>) {
  const [width, setWidth] = useState(() => readViewportWidth());

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      if (nextWidth > 0) setWidth((current) => current === nextWidth ? current : nextWidth);
    };
    update();

    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(update)
      : null;
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);

  return width;
}

function readViewportWidth() {
  if (typeof window === "undefined") return 1440;
  return window.innerWidth || document.documentElement.clientWidth || 1440;
}

function publishWindowMinimumWidth(width: number) {
  try {
    void window.puppyoneDesktop?.setWindowMinimumWidth?.({ width }).catch(() => {
      // The BrowserWindow may already be closing. Its native constraint is no
      // longer observable, so a rejected cleanup invoke requires no recovery.
    });
  } catch {
    // Browser-only surfaces intentionally have no Electron bridge.
  }
}

function getDocumentDirection() {
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
