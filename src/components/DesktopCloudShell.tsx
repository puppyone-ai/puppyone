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
import { useLocalization } from "@puppyone/localization";
import { AuxiliaryPanelHost } from "../features/app-shell/auxiliary";
import { DesktopShellAccessoryProvider } from "../features/app-shell/DesktopShellAccessoryContext";
import { DesktopPaneLayoutProvider } from "../features/app-shell/layout/DesktopPaneLayoutContext";
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

type DesktopCloudShellProps = {
  children: ReactNode;
  leadingRail?: ReactNode;
  leadingRailWidth?: number;
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
  rightSidebar?: ReactNode;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
  minRightSidebarWidth?: number;
  maxRightSidebarWidth?: number;
  resizableRightSidebar?: boolean;
  onLeftSidebarExpand?: () => void;
  onRightSidebarOpenChange?: (open: boolean) => void;
  onRightSidebarWidthChange?: (width: number) => void;
};

export function DesktopCloudShell({
  children,
  leadingRail,
  leadingRailWidth = 0,
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
  onRightSidebarOpenChange,
  onRightSidebarWidthChange,
}: DesktopCloudShellProps) {
  const { t } = useLocalization();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [navigationToolbarHost, setNavigationToolbarHost] = useState<HTMLDivElement | null>(null);
  const bodyWidth = useObservedElementWidth(bodyRef);
  const resolvedLeadingRailWidth = leadingRail
    ? Math.max(0, Math.round(leadingRailWidth))
    : 0;
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

  return (
    <div
      className="desktop-shell"
      data-leading-rail={leadingRail ? "true" : undefined}
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
          {leadingRail && (
            <div className="desktop-shell-leading-rail">
              {leadingRail}
            </div>
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
