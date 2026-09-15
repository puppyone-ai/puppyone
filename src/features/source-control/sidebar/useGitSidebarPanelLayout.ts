import {
  usePaneResizeDrag,
  useScrollableDescendantClasses,
  type SidebarResizeIntent,
} from "@puppyone/shared-ui";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type GitSidebarPanelId = "merge" | "committed" | "staged" | "unstaged";

export type GitSidebarLayoutPanel = {
  id: GitSidebarPanelId;
  grow: number;
  expanded: boolean;
  headerRows?: 0 | 1;
  bodyRows: number;
  /** Fixed-height controls and insets that surround the row-based body. */
  bodyChromePx?: number;
};

const MAX_VISIBLE_ROWS = 9;
const EMPTY_BODY_ROWS = 1.5;
const ROW_VERTICAL_MARGIN_PX = 2;
const SCROLLABLE_LIST_SELECTOR = [
  ".desktop-working-tree-list",
  ".desktop-git-remote-preview",
  ".desktop-git-changes-scroll",
].join(",");
const PANEL_MIN_HEIGHT: Record<GitSidebarPanelId, number> = {
  merge: 72,
  committed: 72,
  staged: 72,
  unstaged: 72,
};

export function getGitSidebarPanelBodyRows(resourceCount: number, hasBodyPlaceholder = false) {
  if (resourceCount > 0) return resourceCount;
  return hasBodyPlaceholder ? EMPTY_BODY_ROWS : 0;
}

export function useGitSidebarPanelLayout(revision: unknown) {
  const [panelHeights, setPanelHeights] = useState<Partial<Record<GitSidebarPanelId, number>>>({});
  const [activeResizeSplit, setActiveResizeSplit] = useState<string | null>(null);
  const sidebarListRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Partial<Record<GitSidebarPanelId, HTMLDivElement | null>>>({});

  const setPanelRef = useCallback((id: GitSidebarPanelId, node: HTMLDivElement | null) => {
    panelRefs.current[id] = node;
  }, []);

  const beginPanelResize = usePaneResizeDrag({
    bodyClassName: "desktop-git-sidebar-resizing",
    onDragStart: (event) => {
      const previous = toPanelId(event.currentTarget.dataset.previousPanel);
      const next = toPanelId(event.currentTarget.dataset.nextPanel);
      if (!previous || !next) return null;
      const previousNode = panelRefs.current[previous];
      const nextNode = panelRefs.current[next];
      if (!previousNode || !nextNode) return null;

      const previousStart = previousNode.getBoundingClientRect().height;
      const nextStart = nextNode.getBoundingClientRect().height;
      const totalHeight = previousStart + nextStart;
      const previousMin = getPanelComputedMinHeight(previousNode, PANEL_MIN_HEIGHT[previous]);
      const nextMin = getPanelComputedMinHeight(nextNode, PANEL_MIN_HEIGHT[next]);
      if (totalHeight < previousMin + nextMin) return null;

      const startY = event.clientY;
      const splitId = `${previous}:${next}`;
      setActiveResizeSplit(splitId);

      return {
        onMove: (point) => {
          const delta = point.clientY - startY;
          const previousMax = getPanelComputedMaxHeight(previousNode, previousStart);
          const nextMax = getPanelComputedMaxHeight(nextNode, nextStart);
          const lowerBound = Math.max(previousMin, totalHeight - nextMax);
          const upperBound = Math.min(previousMax, totalHeight - nextMin);
          if (lowerBound > upperBound) return;

          const previousHeight = clampNumber(previousStart + delta, lowerBound, upperBound);
          setPanelHeights((current) => ({
            ...current,
            [previous]: Math.round(previousHeight),
            [next]: Math.round(totalHeight - previousHeight),
          }));
        },
        onCancel: () => {
          setPanelHeights((current) => ({ ...current, [previous]: previousStart, [next]: nextStart }));
          setActiveResizeSplit(null);
        },
        onEnd: () => setActiveResizeSplit(null),
      };
    },
  });

  const resizePanelsByKeyboard = useCallback((
    previous: GitSidebarPanelId,
    next: GitSidebarPanelId,
    intent: SidebarResizeIntent,
    accelerated: boolean,
  ) => {
    const previousNode = panelRefs.current[previous];
    const nextNode = panelRefs.current[next];
    if (!previousNode || !nextNode) return;
    const previousStart = previousNode.getBoundingClientRect().height;
    const nextStart = nextNode.getBoundingClientRect().height;
    const totalHeight = previousStart + nextStart;
    const previousMin = getPanelComputedMinHeight(previousNode, PANEL_MIN_HEIGHT[previous]);
    const nextMin = getPanelComputedMinHeight(nextNode, PANEL_MIN_HEIGHT[next]);
    const previousMax = getPanelComputedMaxHeight(previousNode, previousStart);
    const nextMax = getPanelComputedMaxHeight(nextNode, nextStart);
    const lowerBound = Math.max(previousMin, totalHeight - nextMax);
    const upperBound = Math.min(previousMax, totalHeight - nextMin);
    const step = accelerated ? 32 : 8;
    const requested = intent === "minimum"
      ? lowerBound
      : intent === "maximum"
        ? upperBound
        : previousStart + (intent === "increase" ? step : -step);
    const previousHeight = clampNumber(requested, lowerBound, upperBound);
    setPanelHeights((current) => ({
      ...current,
      [previous]: Math.round(previousHeight),
      [next]: Math.round(totalHeight - previousHeight),
    }));
  }, []);

  const getPanelStyle = useCallback((panel: GitSidebarLayoutPanel): CSSProperties => {
    if (!panel.expanded) {
      return {
        flex: "0 0 var(--desktop-sidebar-row-height)",
        maxHeight: "var(--desktop-sidebar-row-height)",
        minHeight: "var(--desktop-sidebar-row-height)",
      };
    }
    const headerRows = panel.headerRows ?? 1;
    const visibleBodyRows = clampNumber(panel.bodyRows, 0, MAX_VISIBLE_ROWS);
    const bodyChromePx = Math.max(0, panel.bodyChromePx ?? 0);
    const maxHeight = visibleBodyRows > 0
      ? `calc(var(--desktop-sidebar-row-height) * ${visibleBodyRows + headerRows} + var(--git-section-body-top-gap) + ${visibleBodyRows * ROW_VERTICAL_MARGIN_PX + bodyChromePx}px)`
      : headerRows > 0
        ? `calc(var(--desktop-sidebar-row-height) + ${bodyChromePx}px)`
        : `${bodyChromePx}px`;
    const minHeight = `min(${PANEL_MIN_HEIGHT[panel.id]}px, ${maxHeight})`;
    const height = panelHeights[panel.id];
    return typeof height === "number"
      ? { flex: `0 1 ${height}px`, maxHeight, minHeight }
      : { flexGrow: panel.grow, maxHeight, minHeight };
  }, [panelHeights]);

  const scrollRevision = useMemo(() => ({ panelHeights, revision }), [panelHeights, revision]);
  useScrollableDescendantClasses(sidebarListRef, {
    revision: scrollRevision,
    selector: SCROLLABLE_LIST_SELECTOR,
  });

  return {
    activeResizeSplit,
    beginPanelResize,
    getPanelStyle,
    panelHeights,
    resizePanelsByKeyboard,
    setPanelRef,
    sidebarListRef,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPanelComputedMaxHeight(node: HTMLElement, fallback: number) {
  const value = Number.parseFloat(window.getComputedStyle(node).maxHeight);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getPanelComputedMinHeight(node: HTMLElement, fallback: number) {
  const value = Number.parseFloat(window.getComputedStyle(node).minHeight);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toPanelId(value: string | undefined): GitSidebarPanelId | null {
  return value && value in PANEL_MIN_HEIGHT ? value as GitSidebarPanelId : null;
}
