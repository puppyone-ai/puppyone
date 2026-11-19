import { useState } from "react";
import type { DataWorkspaceExplorerFrame } from "@puppyone/shared-ui";
import { useDesktopPreference } from "../../settings";
import {
  useNativeSurfacePointerPassthroughActivity,
  useNativeSurfacePointerRoutingRegion,
} from "../../native-surfaces";
import { useDesktopPaneLayout } from "./DesktopPaneLayoutContext";
import {
  COLLAPSED_EXPLORER_WIDTH,
  EXPLORER_COLLAPSE_THRESHOLD,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
} from "../../../lib/desktopPaneLayout";

/**
 * The Explorer column as the window owns it.
 *
 * Its width and whether it is collapsed are one preference for the window,
 * whichever computer's files are in it, and the window's pane layout bounds
 * them. Every surface that stands in the Explorer column takes its frame from
 * here, the file tree and a workspace still opening alike, so the column
 * resizes, collapses and routes pointer input over native surfaces the same
 * way in each, and a width set in one is the width of the next.
 */
export function useDesktopExplorerFrame(): DataWorkspaceExplorerFrame {
  const onResizeActiveChange = useNativeSurfacePointerPassthroughActivity("explorer-resize");
  const [resizeHandle, setResizeHandle] = useState<HTMLDivElement | null>(null);
  useNativeSurfacePointerRoutingRegion("explorer-resize", resizeHandle);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setExplorerWidth = useDesktopPreference(s => s.setExplorerWidth);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const paneLayout = useDesktopPaneLayout();
  return {
    resizable: true,
    collapsed: paneLayout?.explorer.collapsed ?? sidebarCollapsed,
    // The frame's width input is the expanded content-plane width. The
    // Shell's resolved width becomes zero while collapsed and must never
    // replace that retained geometry, or the Explorer reflows during exit.
    width: paneLayout?.explorer.collapsed
      ? explorerWidth
      : paneLayout?.explorer.width ?? explorerWidth,
    minWidth: paneLayout?.explorer.minWidth ?? MIN_EXPLORER_WIDTH,
    maxWidth: paneLayout?.explorer.maxWidth ?? MAX_EXPLORER_WIDTH,
    collapsedWidth: COLLAPSED_EXPLORER_WIDTH,
    collapseThreshold: EXPLORER_COLLAPSE_THRESHOLD,
    onWidthChange: setExplorerWidth,
    onCollapsedChange: setSidebarCollapsed,
    onResizeActiveChange,
    resizeHandleRef: setResizeHandle,
  };
}
