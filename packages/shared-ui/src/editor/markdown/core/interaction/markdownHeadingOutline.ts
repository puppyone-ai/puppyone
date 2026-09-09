import type { Extension, EditorState } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const MIN_HEADING_COUNT = 3;
const RAIL_WIDTH_PX = 14;
const RAIL_LEFT_OFFSET_PX = 28;
const RAIL_READING_GAP_PX = 8;
const RAIL_VERTICAL_MARGIN_PX = 16;
const RAIL_TICK_SPACING_PX = 19;
const RAIL_TICK_TARGET_PX = 14;
const SCROLL_HEIGHT_PADDING_PX = 8;
const ACTIVE_SCROLL_OFFSET_PX = 24;
const POPOVER_CLOSE_DELAY_MS = 140;
let nextOutlinePopoverId = 0;

type HeadingEntry = Readonly<{
  from: number;
  level: number;
  title: string;
}>;

type TickMeasurement = Readonly<{
  index: number;
  top: number;
}>;

type RailMeasurement = Readonly<{
  left: number;
  top: number;
  height: number;
  popoverMaxHeight: number;
}>;

class MarkdownHeadingOutlineController {
  private readonly view: EditorView;
  private readonly layer: HTMLDivElement;
  private readonly rail: HTMLDivElement;
  private readonly ticks: HTMLDivElement;
  private readonly popover: HTMLDivElement;
  private readonly popoverList: HTMLDivElement;
  private readonly measureKey = {};
  private headings: readonly HeadingEntry[] = [];
  private activeIndex = -1;
  private visible = false;
  private disposed = false;
  private closeTimer: number | null = null;
  private popoverPreviewedIndex = -1;

  constructor(view: EditorView) {
    this.view = view;
    const doc = view.dom.ownerDocument;

    this.layer = doc.createElement("div");
    this.layer.className = "cm-md-heading-outline-layer";

    this.rail = doc.createElement("div");
    this.rail.className = "cm-md-heading-outline-rail";
    this.rail.setAttribute("role", "navigation");
    this.rail.setAttribute("aria-label", "Document outline");

    this.ticks = doc.createElement("div");
    this.ticks.className = "cm-md-heading-outline-ticks";

    this.popover = doc.createElement("div");
    this.popover.className = "cm-md-heading-outline-popover";
    this.popover.id = `cm-md-heading-outline-popover-${nextOutlinePopoverId += 1}`;
    this.popover.setAttribute("role", "group");
    this.popover.setAttribute("aria-label", "Document headings");
    this.popover.setAttribute("aria-hidden", "true");
    this.popover.inert = true;

    this.popoverList = doc.createElement("div");
    this.popoverList.className = "cm-md-heading-outline-list";
    this.popover.append(this.popoverList);
    this.popover.addEventListener("pointerenter", this.cancelScheduledClose);
    this.popover.addEventListener("pointerleave", this.scheduleClose);
    this.popover.addEventListener("focusin", this.cancelScheduledClose);
    this.popover.addEventListener("focusout", this.scheduleClose);
    this.popover.addEventListener("keydown", this.onPopoverKeyDown);

    this.rail.append(this.ticks, this.popover);
    this.layer.append(this.rail);
    view.dom.append(this.layer);
    view.dom.classList.add("cm-md-heading-outline-enabled");

    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });

    this.refreshHeadings();
    this.scheduleMeasure();
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.refreshHeadings();
      this.scheduleMeasure();
    });
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.refreshHeadings();
    if (
      update.docChanged
      || update.geometryChanged
      || update.viewportChanged
    ) {
      this.scheduleMeasure();
    }
  }

  destroy() {
    this.disposed = true;
    this.cancelScheduledClose();
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.view.dom.classList.remove("cm-md-heading-outline-enabled");
    this.layer.remove();
  }

  private readonly onScroll = () => {
    if (this.disposed || !this.visible) return;
    this.scheduleMeasure();
  };

  private refreshHeadings() {
    this.headings = collectHeadings(this.view);
    this.visible = shouldShowOutline(this.view, this.headings);
    this.layer.classList.toggle("is-visible", this.visible);
    if (!this.visible) {
      this.hidePopover();
      this.ticks.replaceChildren();
      this.popoverList.replaceChildren();
    }
  }

  private jumpToHeading(index: number) {
    const heading = this.headings[index];
    if (!heading) return;
    this.view.dispatch({
      effects: EditorView.scrollIntoView(heading.from, { y: "start", yMargin: 16 }),
    });
    this.view.focus();
    this.scheduleMeasure();
  }

  private scheduleMeasure() {
    if (this.disposed) return;
    this.view.requestMeasure<{
      ticks: TickMeasurement[];
      activeIndex: number;
      rail: RailMeasurement;
    }>({
      key: this.measureKey,
      read: (view) => {
        const headings = this.headings;
        if (!shouldShowOutline(view, headings)) {
          return {
            ticks: [],
            activeIndex: -1,
            rail: { left: 0, top: 0, height: 0, popoverMaxHeight: 0 },
          };
        }
        const rail = resolveRailLayout(view, headings.length);
        const ticks = headings.map((_heading, index) => ({
          index,
          top: headingTickTop(index, headings.length, rail.height),
        }));
        return {
          ticks,
          activeIndex: resolveActiveHeadingIndex(
            headings,
            view.scrollDOM.scrollTop,
            view,
          ),
          rail,
        };
      },
      write: ({ ticks, activeIndex, rail }) => {
        if (this.disposed) return;
        this.visible = shouldShowOutline(this.view, this.headings);
        this.layer.classList.toggle("is-visible", this.visible);
        if (!this.visible) {
          this.hidePopover();
          this.ticks.replaceChildren();
          this.popoverList.replaceChildren();
          return;
        }

        this.rail.style.left = `${rail.left}px`;
        this.rail.style.top = `${rail.top}px`;
        this.rail.style.height = `${rail.height}px`;
        this.popover.style.maxHeight = `${rail.popoverMaxHeight}px`;

        this.activeIndex = activeIndex;
        this.renderTicks(ticks);
      },
    });
  }

  private renderTicks(ticks: readonly TickMeasurement[]) {
    const doc = this.view.dom.ownerDocument;
    let elements = [...this.ticks.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick")];
    if (elements.length !== ticks.length) {
      const next = doc.createDocumentFragment();
      elements = ticks.map(() => {
        const element = doc.createElement("button");
        element.type = "button";
        element.className = "cm-md-heading-outline-tick";
        element.setAttribute("data-po-interaction", "navigation");
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = event.currentTarget as HTMLButtonElement;
          this.jumpToHeading(Number(current.dataset.index));
        });
        element.addEventListener("keydown", this.onTickKeyDown);
        element.addEventListener("pointerenter", this.onTickPointerEnter);
        element.addEventListener("pointerleave", this.scheduleClose);
        element.addEventListener("focus", this.onTickFocus);
        element.addEventListener("blur", this.scheduleClose);
        next.append(element);
        return element;
      });
      this.ticks.replaceChildren(next);
    }

    for (const tick of ticks) {
      const element = elements[tick.index];
      const heading = this.headings[tick.index];
      element.dataset.index = String(tick.index);
      element.style.top = `${tick.top}px`;
      element.setAttribute("aria-label", heading?.title ?? "Heading");
      element.setAttribute("aria-controls", this.popover.id);
      element.setAttribute(
        "aria-expanded",
        String(this.isPopoverOpen() && tick.index === this.popoverPreviewedIndex),
      );
      element.classList.toggle("is-active", tick.index === this.activeIndex);
      element.tabIndex = tick.index === this.activeIndex ? 0 : -1;
      if (tick.index === this.activeIndex) element.setAttribute("aria-current", "location");
      else element.removeAttribute("aria-current");
    }
    this.renderPopoverItems();
  }

  private renderPopoverItems() {
    const doc = this.view.dom.ownerDocument;
    let items = [...this.popoverList.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-item")];
    if (items.length !== this.headings.length) {
      const next = doc.createDocumentFragment();
      items = this.headings.map(() => {
        const item = doc.createElement("button");
        item.type = "button";
        item.className = "cm-md-heading-outline-item";
        item.setAttribute("data-po-interaction", "navigation");
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = event.currentTarget as HTMLButtonElement;
          this.jumpToHeading(Number(current.dataset.index));
          this.hidePopover();
        });
        next.append(item);
        return item;
      });
      this.popoverList.replaceChildren(next);
    }

    for (const [index, heading] of this.headings.entries()) {
      const item = items[index];
      item.dataset.index = String(index);
      if (item.textContent !== heading.title) item.textContent = heading.title;
      const indent = 10 + Math.min(Math.max(0, heading.level - 1), 3) * 12;
      item.style.setProperty("--cm-md-heading-indent", `${indent}px`);
      item.classList.toggle("is-current", index === this.activeIndex);
      if (index === this.activeIndex) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    }
  }

  private readonly onTickPointerEnter = (event: PointerEvent) => {
    const tick = event.currentTarget as HTMLButtonElement | null;
    const index = Number(tick?.dataset.index);
    if (!tick || Number.isNaN(index)) return;
    this.showPopover(index);
  };

  private readonly onTickFocus = (event: FocusEvent) => {
    const tick = event.currentTarget as HTMLButtonElement | null;
    const index = Number(tick?.dataset.index);
    if (!tick || Number.isNaN(index)) return;
    this.showPopover(index);
  };

  private showPopover(previewedIndex: number) {
    this.cancelScheduledClose();
    this.popoverPreviewedIndex = previewedIndex;
    this.layer.classList.add("is-popover-open");
    this.popover.setAttribute("aria-hidden", "false");
    this.popover.inert = false;
    this.ticks.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick").forEach((tick) => {
      tick.setAttribute("aria-expanded", String(Number(tick.dataset.index) === previewedIndex));
    });
    this.popoverList.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-item").forEach((item) => {
      item.classList.toggle("is-previewed", Number(item.dataset.index) === previewedIndex);
    });
  }

  private hidePopover() {
    this.cancelScheduledClose();
    this.popoverPreviewedIndex = -1;
    this.layer.classList.remove("is-popover-open");
    this.popover.setAttribute("aria-hidden", "true");
    this.popover.inert = true;
    this.ticks.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-tick").forEach((tick) => {
      tick.setAttribute("aria-expanded", "false");
    });
    this.popoverList.querySelectorAll<HTMLButtonElement>(".cm-md-heading-outline-item.is-previewed").forEach((item) => {
      item.classList.remove("is-previewed");
    });
  }

  private readonly scheduleClose = () => {
    this.cancelScheduledClose();
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.hidePopover();
    }, POPOVER_CLOSE_DELAY_MS);
  };

  private readonly cancelScheduledClose = () => {
    if (this.closeTimer === null) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  };

  private isPopoverOpen() {
    return this.layer.classList.contains("is-popover-open");
  }

  private readonly onTickKeyDown = (event: KeyboardEvent) => {
    const current = event.currentTarget as HTMLButtonElement | null;
    const index = Number(current?.dataset.index);
    if (!current || Number.isNaN(index)) return;

    if (event.key === "Escape" && this.isPopoverOpen()) {
      event.preventDefault();
      this.hidePopover();
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(this.headings.length - 1, index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = Math.max(0, index - 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = this.headings.length - 1;
    }
    if (nextIndex === null || nextIndex === index) return;

    event.preventDefault();
    const next = this.ticks.querySelector<HTMLButtonElement>(`[data-index="${nextIndex}"]`);
    if (!next) return;
    current.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  };

  private readonly onPopoverKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = this.ticks.querySelector<HTMLButtonElement>(`[data-index="${this.activeIndex}"]`)
      ?? this.ticks.querySelector<HTMLButtonElement>(".cm-md-heading-outline-tick");
    trigger?.focus();
    this.hidePopover();
  };
}

const markdownHeadingOutlinePlugin = ViewPlugin.fromClass(MarkdownHeadingOutlineController);

export function markdownHeadingOutlineExtension(): Extension {
  return markdownHeadingOutlinePlugin;
}

export function collectMarkdownHeadingOutlineEntries(state: EditorState): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const text = line.text;
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const character = marker[0] as "`" | "~";
      if (!fence) {
        fence = { character, length: marker.length };
      } else if (
        character === fence.character
        && marker.length >= fence.length
        && fenceMatch[3].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const headingMatch = /^( {0,3})(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    if (!headingMatch) continue;
    const leading = headingMatch[1];
    const marker = headingMatch[2];
    const authoredTitle = headingMatch[3] ?? "";
    const title = authoredTitle.replace(/[ \t]+#+[ \t]*$/, "").trim();
    const contentOffset = text.indexOf(authoredTitle, leading.length + marker.length);
    headings.push({
      from: line.from + (contentOffset >= 0 ? contentOffset : text.length),
      level: marker.length,
      title: title || "Untitled",
    });
  }

  return headings;
}

function collectHeadings(view: EditorView): HeadingEntry[] {
  return collectMarkdownHeadingOutlineEntries(view.state);
}

function shouldShowOutline(view: EditorView, headings: readonly HeadingEntry[]): boolean {
  if (headings.length < MIN_HEADING_COUNT) return false;
  return view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight + SCROLL_HEIGHT_PADDING_PX;
}

function resolveActiveHeadingIndex(
  headings: readonly HeadingEntry[],
  scrollTop: number,
  view: EditorView,
): number {
  if (headings.length === 0) return -1;
  let active = 0;
  const marker = scrollTop + ACTIVE_SCROLL_OFFSET_PX;
  for (let index = 0; index < headings.length; index += 1) {
    const block = view.lineBlockAt(headings[index].from);
    if (block.top <= marker) active = index;
    else break;
  }
  return active;
}

function resolveRailLayout(view: EditorView, headingCount: number): RailMeasurement {
  const rootRect = view.dom.getBoundingClientRect();
  const contentRect = view.contentDOM.getBoundingClientRect();
  const contentStyle = view.dom.ownerDocument.defaultView?.getComputedStyle(view.contentDOM);
  const paddingLeft = Number.parseFloat(contentStyle?.paddingLeft ?? "") || 0;
  const readingRailLeft = contentRect.left + paddingLeft;
  const availableGutter = readingRailLeft - rootRect.left;
  const left = Math.max(
    4,
    Math.min(
      RAIL_LEFT_OFFSET_PX,
      availableGutter - RAIL_WIDTH_PX - RAIL_READING_GAP_PX,
    ),
  );
  const viewportHeight = view.scrollDOM.clientHeight;
  const availableHeight = Math.max(
    RAIL_TICK_TARGET_PX,
    viewportHeight - RAIL_VERTICAL_MARGIN_PX * 2,
  );
  const desiredHeight = Math.max(
    RAIL_TICK_TARGET_PX,
    (headingCount - 1) * RAIL_TICK_SPACING_PX + RAIL_TICK_TARGET_PX,
  );
  const height = Math.min(availableHeight, desiredHeight);
  const top = Math.max(0, (viewportHeight - height) / 2);
  return { left, top, height, popoverMaxHeight: availableHeight };
}

function headingTickTop(
  index: number,
  headingCount: number,
  railHeight: number,
): number {
  if (headingCount <= 1) return railHeight / 2;
  const spacing = (railHeight - RAIL_TICK_TARGET_PX) / (headingCount - 1);
  return RAIL_TICK_TARGET_PX / 2 + spacing * index;
}
