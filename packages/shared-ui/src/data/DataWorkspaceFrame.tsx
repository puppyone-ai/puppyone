import { useCallback, useEffect, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { useCollapsiblePaneResize } from "../primitives/useCollapsiblePaneResize";
import type { CollapsiblePaneGestureCommit } from "../primitives/collapsiblePaneGesture";
import { CollapsiblePaneFrame, type SidebarResizeIntent } from "../sidebar";

const DEFAULT_EXPLORER_WIDTH = 320;
const MIN_EXPLORER_WIDTH = 240;
const MAX_EXPLORER_WIDTH = 520;
const COLLAPSED_EXPLORER_WIDTH = 47;

/** The Explorer column's geometry and how it changes. */
export type DataWorkspaceExplorerFrame = {
  resizable?: boolean;
  collapsed?: boolean;
  /** Controlled expanded width; the frame keeps its own when omitted. */
  width?: number;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsedWidth?: number;
  collapseThreshold?: number;
  onWidthChange?: (width: number) => void;
  /** Collapsing is offered only when the host can store it. */
  onCollapsedChange?: (collapsed: boolean) => void;
  onResizeActiveChange?: (active: boolean) => void;
  resizeHandleRef?: Ref<HTMLDivElement>;
};

export type DataWorkspaceFrameProps = DataWorkspaceExplorerFrame & {
  header?: ReactNode;
  /** Explorer content; called only while the column's content is visible. */
  explorer: () => ReactNode;
  explorerFooter?: (() => ReactNode) | null;
  collapsedExplorer?: (() => ReactNode) | null;
  /** The main column's content. */
  children?: ReactNode;
};

/**
 * The workspace's frame: an Explorer column beside a main column.
 *
 * The frame is geometry the user owns: the column's width, whether it is
 * collapsed, and the gestures that change them. It is not the files. Keeping
 * it apart from DataWorkspace is what lets a surface with no files yet, such
 * as a workspace still opening, stand in the same frame, so the column can be
 * resized there exactly as it can everywhere else instead of being drawn as a
 * picture of a column that cannot.
 */
export function DataWorkspaceFrame({
  resizable: resizableExplorer = false,
  collapsed: explorerCollapsed = false,
  width: explorerWidth,
  defaultWidth: defaultExplorerWidth = DEFAULT_EXPLORER_WIDTH,
  minWidth: minExplorerWidth = MIN_EXPLORER_WIDTH,
  maxWidth: maxExplorerWidth = MAX_EXPLORER_WIDTH,
  collapsedWidth: collapsedExplorerWidth = COLLAPSED_EXPLORER_WIDTH,
  collapseThreshold: explorerCollapseThreshold,
  onWidthChange: onExplorerWidthChange,
  onCollapsedChange: onExplorerCollapsedChange,
  onResizeActiveChange: onExplorerResizeActiveChange,
  resizeHandleRef: explorerResizeHandleRef,
  header,
  explorer,
  explorerFooter,
  collapsedExplorer,
  children,
}: DataWorkspaceFrameProps) {
  const { direction, t } = useLocalization();
  const [internalExplorerWidth, setInternalExplorerWidth] = useState(() => (
    clampNumber(defaultExplorerWidth, minExplorerWidth, maxExplorerWidth)
  ));
  const expandedExplorerWidth = clampNumber(
    explorerWidth ?? internalExplorerWidth,
    minExplorerWidth,
    maxExplorerWidth,
  );
  const resolvedExplorerWidth = clampNumber(
    explorerCollapsed ? collapsedExplorerWidth : expandedExplorerWidth,
    collapsedExplorerWidth,
    maxExplorerWidth,
  );
  const explorerCanCollapse = Boolean(onExplorerCollapsedChange);
  const resolvedExplorerCollapseThreshold = clampNumber(
    explorerCollapseThreshold ?? Math.round(minExplorerWidth * 0.5),
    collapsedExplorerWidth,
    minExplorerWidth,
  );

  const setExplorerWidth = useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampNumber(nextWidth, minExplorerWidth, maxExplorerWidth);
      if (explorerWidth === undefined) setInternalExplorerWidth(clampedWidth);
      onExplorerWidthChange?.(clampedWidth);
    },
    [explorerWidth, maxExplorerWidth, minExplorerWidth, onExplorerWidthChange],
  );

  useEffect(() => {
    if (explorerWidth !== undefined) return;
    setInternalExplorerWidth(clampNumber(defaultExplorerWidth, minExplorerWidth, maxExplorerWidth));
  }, [defaultExplorerWidth, explorerWidth, maxExplorerWidth, minExplorerWidth]);

  const commitExplorerPane = (commit: CollapsiblePaneGestureCommit) => {
    if (commit.type === "collapse") {
      setExplorerWidth(commit.restoreWidth);
      onExplorerCollapsedChange?.(true);
      return;
    }
    if (commit.type === "expand") {
      if (commit.width !== undefined) setExplorerWidth(commit.width);
      onExplorerCollapsedChange?.(false);
      return;
    }
    setExplorerWidth(commit.width);
  };
  const explorerResize = useCollapsiblePaneResize({
    enabled: resizableExplorer,
    bodyClassName: "data-sidebar-resizing",
    collapsed: explorerCollapsed,
    collapsedWidth: collapsedExplorerWidth,
    collapseThreshold: resolvedExplorerCollapseThreshold,
    collapsible: explorerCanCollapse,
    direction,
    maxWidth: maxExplorerWidth,
    minWidth: minExplorerWidth,
    side: "inline-start",
    width: expandedExplorerWidth,
    onCommit: commitExplorerPane,
    onDragActiveChange: onExplorerResizeActiveChange,
  });

  const resizeExplorerByKeyboard = (intent: SidebarResizeIntent, accelerated: boolean) => {
    if (!resizableExplorer) return;

    if (intent === "minimum") {
      if (explorerCanCollapse) {
        commitExplorerPane({ type: "collapse", restoreWidth: minExplorerWidth });
        return;
      }
      commitExplorerPane({ type: "resize", width: minExplorerWidth });
      return;
    }
    if (intent === "maximum") {
      commitExplorerPane({ type: "expand", width: maxExplorerWidth });
      return;
    }

    const step = accelerated ? 24 : 12;
    const physicalDirection = intent === "decrease" ? -1 : 1;
    const directionMultiplier = direction === "rtl" ? -1 : 1;
    const nextWidth = resolvedExplorerWidth + physicalDirection * directionMultiplier * step;
    if (explorerCollapsed) {
      if (nextWidth > collapsedExplorerWidth) {
        commitExplorerPane({ type: "expand", width: minExplorerWidth });
      }
      return;
    }
    if (explorerCanCollapse && nextWidth < minExplorerWidth) {
      commitExplorerPane({ type: "collapse", restoreWidth: minExplorerWidth });
      return;
    }
    commitExplorerPane({ type: "resize", width: nextWidth });
  };

  // Shrinking the frame must clip a stable expanded content plane. Otherwise
  // flex rows and labels recompute at every pointer sample before collapse.
  // Growing may extend the plane with the pointer because nothing is squeezed.
  const renderedExplorerContentWidth = Math.max(
    explorerResize.width,
    expandedExplorerWidth,
  );
  const dataContentStyle = resizableExplorer
    ? ({
        "--data-explorer-width": `${explorerResize.width}px`,
      } as CSSProperties)
    : undefined;

  return (
    <section className="data-workspace">
      {header}

      <div
        className="data-content"
        data-explorer-collapsed={explorerResize.collapsed ? "true" : undefined}
        data-explorer-gesture={explorerResize.phase === "idle" ? undefined : explorerResize.phase}
        data-explorer-dragging={explorerResize.dragging ? "true" : undefined}
        style={dataContentStyle}
      >
        <CollapsiblePaneFrame
          as="aside"
          className="explorer-column"
          collapsed={explorerResize.collapsed}
          contentWidth={renderedExplorerContentWidth}
          frameWidth={explorerResize.width}
          gesturePhase={explorerResize.phase}
          side="inline-start"
          viewportClassName="data-explorer-viewport"
          contentClassName="data-explorer-inner"
          resizeHandleRef={explorerResizeHandleRef}
          resizeHandleProps={(presentation) => resizableExplorer && presentation.contentVisible
            ? {
                className: "data-explorer-resizer",
                resizing: explorerResize.dragging,
                orientation: "vertical",
                label: t("shared-ui.explorer.resizeSidebar"),
                min: explorerCanCollapse ? collapsedExplorerWidth : minExplorerWidth,
                max: maxExplorerWidth,
                value: explorerResize.width,
                "aria-hidden": explorerResize.collapsed ? true : undefined,
                tabIndex: explorerResize.collapsed ? -1 : 0,
                onPointerDown: explorerResize.collapsed ? undefined : explorerResize.onPointerDown,
                onKeyboardResize: explorerResize.collapsed ? undefined : resizeExplorerByKeyboard,
            }
            : undefined}
        >
          {({ contentVisible }) => (
            <>
              {contentVisible && explorer()}
              {contentVisible && explorerFooter && (
                <div className="data-explorer-footer">
                  {explorerFooter()}
                </div>
              )}
            </>
          )}
        </CollapsiblePaneFrame>

        {explorerResize.collapsed && collapsedExplorer && (
          <div className="data-explorer-collapsed-slot">
            {collapsedExplorer()}
          </div>
        )}

        <main className="browser-column desktop-editor-panel">
          {children}
        </main>
      </div>
    </section>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
