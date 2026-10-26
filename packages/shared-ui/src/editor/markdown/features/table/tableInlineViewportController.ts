import type { MarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import type {
  EmbeddedInlineViewportPosition,
  EmbeddedInlineViewportSession,
} from "../../platform/codemirror/embeddedInlineViewportSession";
import { closeActiveMarkdownTableMenu } from "./tableMenuState";

const INLINE_START_EPSILON_PX = 0.5;
const DRAG_EDGE_ZONE_PX = 36;
const DRAG_MAX_STEP_PX = 18;

export type RtlScrollBehavior = "negative" | "positive-ascending" | "positive-descending";

export type MarkdownTableInlineViewportController = {
  dispose(): void;
  revealColumn(columnIndex: number): void;
  /**
   * Show or hide the scrollbar rail now, for column tracks the table changed
   * on its own. The rail's height then lands in the same frame as the tracks
   * that caused it, instead of resizing the table again while the editor is
   * still delivering that frame's size changes.
   */
  settleOverflow(): void;
  updateDragAutoScroll(clientX: number, onScroll: () => void): void;
  stopDragAutoScroll(): void;
};

type TableInlineViewportContext = Readonly<{
  columnCount: number;
  direction: "ltr" | "rtl";
  host: MarkdownEmbedHost;
  root: HTMLElement;
  scrollbar: HTMLElement;
  scrollbarContent: HTMLElement;
  sourceIdentity: string;
  table: HTMLTableElement;
  tableFrom: number;
  tableTo: number;
  viewport: HTMLElement;
}>;

type TableInlineGeometry = Readonly<{
  columnWidths: readonly number[];
  leadingInset: number;
  maxLogicalOffset: number;
  scrollbarInlineSize: number;
  viewportInlineSize: number;
}>;

const controllerByRoot = new WeakMap<HTMLElement, MarkdownTableInlineViewportController>();
const rtlBehaviorByDocument = new WeakMap<Document, RtlScrollBehavior>();

export function createMarkdownTableInlineViewportController(
  context: TableInlineViewportContext,
): MarkdownTableInlineViewportController {
  const session = context.host.inlineViewports.acquire({
    featureId: "markdown-table",
    mappedRange: { from: context.tableFrom, to: context.tableTo },
    sourceIdentity: context.sourceIdentity,
  });
  const ownerWindow = context.viewport.ownerDocument.defaultView ?? window;
  const restoreMeasureKey = {};
  const revealMeasureKey = {};
  const captureMeasureKey = {};
  let cachedGeometry: TableInlineGeometry | null = null;
  let disposed = false;
  let interactionRevision = 0;
  let captureFrame: number | null = null;
  let dragFrame: number | null = null;
  let dragVelocity = 0;
  let dragOnScroll: (() => void) | null = null;

  context.root.dataset.mdInlineViewportSession = session.sessionId;
  context.root.dataset.mdInlineViewportMount = String(session.mountToken);

  const readGeometry = (): TableInlineGeometry => {
    const logicalOffset = getLogicalScrollOffset(context.viewport, context.direction);
    const viewportRect = context.viewport.getBoundingClientRect();
    const rootRect = context.root.getBoundingClientRect();
    const scrollbarRect = context.scrollbar.getBoundingClientRect();
    const tableRect = context.table.getBoundingClientRect();
    const measuredLeadingInset = context.direction === "rtl"
      ? viewportRect.right - tableRect.right + logicalOffset
      : tableRect.left - viewportRect.left + logicalOffset;
    const cssLeadingInset = Number.parseFloat(
      ownerWindow.getComputedStyle(context.viewport).getPropertyValue("--cm-md-table-interaction-start-inset"),
    );
    const leadingInset = Math.max(
      0,
      Number.isFinite(measuredLeadingInset) && (viewportRect.width > 0 || tableRect.width > 0)
        ? measuredLeadingInset
        : Number.isFinite(cssLeadingInset) ? cssLeadingInset : 0,
    );
    const firstRow = context.table.rows[0];
    const columnWidths = Array.from({ length: context.columnCount }, (_, index) => {
      const cell = firstRow?.cells[index];
      if (!cell) return 0;
      const width = cell.getBoundingClientRect().width || cell.offsetWidth;
      return Number.isFinite(width) ? Math.max(0, width) : 0;
    });
    const viewportInlineSize = Math.max(0, context.viewport.clientWidth || viewportRect.width);
    const scrollbarInlineSize = Math.max(
      0,
      context.scrollbar.clientWidth
        || scrollbarRect.width
        || context.root.clientWidth
        || rootRect.width,
    );
    return {
      columnWidths,
      leadingInset,
      maxLogicalOffset: Math.max(0, context.viewport.scrollWidth - context.viewport.clientWidth),
      scrollbarInlineSize,
      viewportInlineSize,
    };
  };

  const syncScrollbarFromViewport = (geometry: TableInlineGeometry) => {
    const scrollbarMaximum = Math.max(
      0,
      context.scrollbar.scrollWidth - context.scrollbar.clientWidth,
    );
    const viewportOffset = getLogicalScrollOffset(context.viewport, context.direction);
    const target = mapInlineScrollOffset(
      viewportOffset,
      geometry.maxLogicalOffset,
      scrollbarMaximum,
    );
    const current = getLogicalScrollOffset(context.scrollbar, context.direction);
    if (Math.abs(current - target) <= INLINE_START_EPSILON_PX) return;
    setLogicalScrollOffset(context.scrollbar, context.direction, target);
  };

  const updateScrollbarPresentation = (geometry: TableInlineGeometry) => {
    const hasOverflow = geometry.maxLogicalOffset > INLINE_START_EPSILON_PX;
    context.scrollbar.hidden = !hasOverflow;
    context.scrollbarContent.style.inlineSize = `${Math.max(
      1,
      geometry.scrollbarInlineSize + geometry.maxLogicalOffset,
    )}px`;
    if (hasOverflow) syncScrollbarFromViewport(geometry);
  };

  const captureWithGeometry = (geometry: TableInlineGeometry) => {
    if (disposed) return;
    cachedGeometry = geometry;
    const logicalOffset = getLogicalScrollOffset(context.viewport, context.direction);
    const position = getEmbeddedInlineViewportPosition(logicalOffset, geometry);
    context.host.inlineViewports.capture(
      session.sessionId,
      session.mountToken,
      position,
    );
    context.root.dataset.mdInlineViewportOffset = String(logicalOffset);
    context.root.dataset.mdInlineViewportAnchor = position.kind === "start"
      ? "start"
      : String(position.itemIndex);
  };

  const scheduleCapture = () => {
    if (disposed || captureFrame !== null) return;
    captureFrame = ownerWindow.requestAnimationFrame(() => {
      captureFrame = null;
      if (disposed) return;
      if (cachedGeometry) {
        captureWithGeometry(cachedGeometry);
        return;
      }
      context.host.layout.schedule(captureMeasureKey, readGeometry, captureWithGeometry);
    });
  };

  const scheduleRestore = () => {
    if (disposed) return;
    const scheduledRevision = interactionRevision;
    context.host.layout.schedule(restoreMeasureKey, readGeometry, (geometry) => {
      if (disposed || scheduledRevision !== interactionRevision) return;
      cachedGeometry = geometry;
      const current = context.host.inlineViewports.get(session.sessionId) ?? session;
      const target = getLogicalOffsetForPosition(current.position, geometry);
      updateScrollbarPresentation(geometry);
      setLogicalScrollOffset(context.viewport, context.direction, target);
      syncScrollbarFromViewport(geometry);
      captureWithGeometry(geometry);
    });
  };

  const onScroll = () => {
    if (disposed) return;
    interactionRevision += 1;
    closeActiveMarkdownTableMenu();
    if (cachedGeometry) syncScrollbarFromViewport(cachedGeometry);
    scheduleCapture();
  };

  const onScrollbarScroll = () => {
    if (disposed) return;
    interactionRevision += 1;
    closeActiveMarkdownTableMenu();
    const geometry = cachedGeometry;
    if (!geometry) {
      scheduleRestore();
      return;
    }
    const scrollbarMaximum = Math.max(
      0,
      context.scrollbar.scrollWidth - context.scrollbar.clientWidth,
    );
    const scrollbarOffset = getLogicalScrollOffset(context.scrollbar, context.direction);
    const target = mapInlineScrollOffset(
      scrollbarOffset,
      scrollbarMaximum,
      geometry.maxLogicalOffset,
    );
    const current = getLogicalScrollOffset(context.viewport, context.direction);
    if (Math.abs(current - target) > INLINE_START_EPSILON_PX) {
      setLogicalScrollOffset(context.viewport, context.direction, target);
    }
    scheduleCapture();
  };

  const stopDragAutoScroll = () => {
    dragVelocity = 0;
    dragOnScroll = null;
    if (dragFrame !== null) ownerWindow.cancelAnimationFrame(dragFrame);
    dragFrame = null;
  };

  const runDragAutoScroll = () => {
    dragFrame = null;
    if (disposed || dragVelocity === 0) return;
    const current = getLogicalScrollOffset(context.viewport, context.direction);
    const maximum = Math.max(0, context.viewport.scrollWidth - context.viewport.clientWidth);
    const next = clamp(current + dragVelocity, 0, maximum);
    if (Math.abs(next - current) <= INLINE_START_EPSILON_PX) {
      stopDragAutoScroll();
      return;
    }
    setLogicalScrollOffset(context.viewport, context.direction, next);
    if (cachedGeometry) syncScrollbarFromViewport(cachedGeometry);
    scheduleCapture();
    dragOnScroll?.();
    dragFrame = ownerWindow.requestAnimationFrame(runDragAutoScroll);
  };

  const controller: MarkdownTableInlineViewportController = {
    dispose() {
      if (disposed) return;
      disposed = true;
      context.viewport.removeEventListener("scroll", onScroll);
      context.scrollbar.removeEventListener("scroll", onScrollbarScroll);
      stopObservingViewport();
      stopObservingRoot();
      stopObservingTable();
      if (captureFrame !== null) ownerWindow.cancelAnimationFrame(captureFrame);
      captureFrame = null;
      stopDragAutoScroll();
      context.host.inlineViewports.detach(session.sessionId, session.mountToken);
      controllerByRoot.delete(context.root);
    },

    settleOverflow() {
      if (disposed) return;
      const geometry = readGeometry();
      cachedGeometry = geometry;
      updateScrollbarPresentation(geometry);
    },

    revealColumn(columnIndex) {
      if (disposed) return;
      const targetIndex = clampInteger(columnIndex, 0, Math.max(0, context.columnCount - 1));
      context.host.layout.schedule(revealMeasureKey, readGeometry, (geometry) => {
        if (disposed) return;
        cachedGeometry = geometry;
        const current = getLogicalScrollOffset(context.viewport, context.direction);
        const columnStart = geometry.leadingInset + sumBefore(geometry.columnWidths, targetIndex);
        const columnEnd = columnStart + (geometry.columnWidths[targetIndex] ?? 0);
        let next = current;
        if (columnStart < current) next = columnStart;
        else if (columnEnd > current + geometry.viewportInlineSize) {
          next = columnEnd - geometry.viewportInlineSize;
        }
        setLogicalScrollOffset(
          context.viewport,
          context.direction,
          clamp(next, 0, geometry.maxLogicalOffset),
        );
        syncScrollbarFromViewport(geometry);
        captureWithGeometry(geometry);
      });
    },

    updateDragAutoScroll(clientX, onAutoScroll) {
      if (disposed) return;
      const rect = context.viewport.getBoundingClientRect();
      const physicalVelocity = getPhysicalDragVelocity(clientX, rect);
      dragVelocity = context.direction === "rtl" ? -physicalVelocity : physicalVelocity;
      dragOnScroll = onAutoScroll;
      if (dragVelocity === 0) {
        stopDragAutoScroll();
        return;
      }
      if (dragFrame === null) dragFrame = ownerWindow.requestAnimationFrame(runDragAutoScroll);
    },

    stopDragAutoScroll,
  };

  context.viewport.addEventListener("scroll", onScroll, { passive: true });
  context.scrollbar.addEventListener("scroll", onScrollbarScroll, { passive: true });
  const stopObservingViewport = context.host.layout.observe(
    context.viewport,
    undefined,
    () => scheduleRestore(),
  );
  const stopObservingRoot = context.host.layout.observe(
    context.root,
    undefined,
    () => scheduleRestore(),
  );
  const stopObservingTable = context.host.layout.observe(
    context.table,
    undefined,
    () => scheduleRestore(),
  );
  controllerByRoot.set(context.root, controller);
  scheduleRestore();
  return controller;
}

export function revealMarkdownTableInlineColumn(
  root: HTMLElement | null,
  columnIndex: number,
): boolean {
  if (!root) return false;
  const controller = controllerByRoot.get(root);
  if (!controller) return false;
  controller.revealColumn(columnIndex);
  return true;
}

export function normalizeInlineScrollOffset(
  rawScrollLeft: number,
  maximum: number,
  direction: "ltr" | "rtl",
  rtlBehavior: RtlScrollBehavior,
): number {
  if (direction === "ltr") return clamp(rawScrollLeft, 0, maximum);
  if (rtlBehavior === "negative") return clamp(-rawScrollLeft, 0, maximum);
  if (rtlBehavior === "positive-descending") {
    return clamp(maximum - rawScrollLeft, 0, maximum);
  }
  return clamp(rawScrollLeft, 0, maximum);
}

export function denormalizeInlineScrollOffset(
  logicalOffset: number,
  maximum: number,
  direction: "ltr" | "rtl",
  rtlBehavior: RtlScrollBehavior,
): number {
  const offset = clamp(logicalOffset, 0, maximum);
  if (direction === "ltr") return offset;
  if (rtlBehavior === "negative") return -offset;
  if (rtlBehavior === "positive-descending") return maximum - offset;
  return offset;
}

export function mapInlineScrollOffset(
  logicalOffset: number,
  sourceMaximum: number,
  targetMaximum: number,
): number {
  if (sourceMaximum <= INLINE_START_EPSILON_PX || targetMaximum <= 0) return 0;
  return clamp(
    (clamp(logicalOffset, 0, sourceMaximum) / sourceMaximum) * targetMaximum,
    0,
    targetMaximum,
  );
}

function getLogicalScrollOffset(
  viewport: HTMLElement,
  direction: "ltr" | "rtl",
): number {
  const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  return normalizeInlineScrollOffset(
    viewport.scrollLeft,
    maximum,
    direction,
    getRtlScrollBehavior(viewport.ownerDocument),
  );
}

function setLogicalScrollOffset(
  viewport: HTMLElement,
  direction: "ltr" | "rtl",
  logicalOffset: number,
) {
  const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  viewport.scrollLeft = denormalizeInlineScrollOffset(
    logicalOffset,
    maximum,
    direction,
    getRtlScrollBehavior(viewport.ownerDocument),
  );
}

function getRtlScrollBehavior(doc: Document): RtlScrollBehavior {
  const existing = rtlBehaviorByDocument.get(doc);
  if (existing) return existing;
  const body = doc.body;
  if (!body) return "negative";

  const viewport = doc.createElement("div");
  const content = doc.createElement("div");
  viewport.dir = "rtl";
  viewport.style.cssText = [
    "position:absolute",
    "inset:-9999px auto auto -9999px",
    "width:4px",
    "height:1px",
    "overflow:scroll",
    "visibility:hidden",
  ].join(";");
  content.style.width = "8px";
  content.style.height = "1px";
  viewport.appendChild(content);
  body.appendChild(viewport);

  let behavior: RtlScrollBehavior;
  if (viewport.scrollLeft > 0) {
    behavior = "positive-descending";
  } else {
    viewport.scrollLeft = 1;
    behavior = viewport.scrollLeft === 0 ? "negative" : "positive-ascending";
  }
  viewport.remove();
  rtlBehaviorByDocument.set(doc, behavior);
  return behavior;
}

function getEmbeddedInlineViewportPosition(
  logicalOffset: number,
  geometry: TableInlineGeometry,
): EmbeddedInlineViewportPosition {
  if (logicalOffset <= INLINE_START_EPSILON_PX) return { kind: "start" };
  const contentOffset = logicalOffset - geometry.leadingInset;
  let itemStart = 0;
  let itemIndex = 0;
  for (; itemIndex < geometry.columnWidths.length - 1; itemIndex += 1) {
    const itemEnd = itemStart + geometry.columnWidths[itemIndex];
    if (contentOffset < itemEnd) break;
    itemStart = itemEnd;
  }
  return {
    kind: "anchored",
    itemIndex,
    offsetWithinItemPx: contentOffset - itemStart,
    fallbackLogicalOffsetPx: logicalOffset,
  };
}

function getLogicalOffsetForPosition(
  position: EmbeddedInlineViewportSession["position"],
  geometry: TableInlineGeometry,
): number {
  if (position.kind === "start") return 0;
  const hasMeasuredColumns = geometry.columnWidths.some((width) => width > 0);
  const target = hasMeasuredColumns
    ? geometry.leadingInset
      + sumBefore(
        geometry.columnWidths,
        clampInteger(position.itemIndex, 0, Math.max(0, geometry.columnWidths.length - 1)),
      )
      + position.offsetWithinItemPx
    : position.fallbackLogicalOffsetPx;
  return clamp(target, 0, geometry.maxLogicalOffset);
}

function getPhysicalDragVelocity(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) return 0;
  if (clientX < rect.left + DRAG_EDGE_ZONE_PX) {
    const intensity = clamp((rect.left + DRAG_EDGE_ZONE_PX - clientX) / DRAG_EDGE_ZONE_PX, 0, 1);
    return -Math.max(1, DRAG_MAX_STEP_PX * intensity);
  }
  if (clientX > rect.right - DRAG_EDGE_ZONE_PX) {
    const intensity = clamp((clientX - (rect.right - DRAG_EDGE_ZONE_PX)) / DRAG_EDGE_ZONE_PX, 0, 1);
    return Math.max(1, DRAG_MAX_STEP_PX * intensity);
  }
  return 0;
}

function sumBefore(values: readonly number[], index: number): number {
  let total = 0;
  for (let current = 0; current < index; current += 1) total += values[current] ?? 0;
  return total;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.trunc(clamp(Number.isFinite(value) ? value : minimum, minimum, maximum));
}
