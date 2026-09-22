import { scrollCodeMirrorIntoView } from "../../../../packages/shared-ui/src/editor/codemirror/navigationIntent";
import { dispatchTypographyChange } from "../../../../packages/shared-ui/src/core/typography";
import { EditorView } from "@codemirror/view";
import { createMarkdownLayoutCoordinator } from "../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/layoutCoordinator";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
type Anchor = { view: EditorView; position: number; top: number; edge: "start" | "end" | null; element?: HTMLElement };
type Sample = { top: number; width: number; committedWidth: number; scroll: number; error: number };

/** Geometry sampling is deliberately DOM-only after baseline setup. Calling
 * coordsAtPos while sampling would repair the very scheduling bug under test. */
export class MarkdownLayoutProbe {
  private anchors: Anchor[] = [];
  private samples: Sample[][] = [];
  private active = false;
  private source: string[] = [];
  private selections: string[] = [];
  private frameId = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private samplingError: unknown = null;

  constructor(private readonly getViews: () => EditorView[]) {}

  setRatio(ratio: number) {
    const split = document.querySelector<HTMLElement>('.desktop-editor-split[data-direction="horizontal"]')!;
    split.style.setProperty("--desktop-editor-first-track", `${ratio}fr`);
    split.style.setProperty("--desktop-editor-second-track", `${1 - ratio}fr`);
  }

  async prepare(edge: "start" | "end" | null = null) {
    this.setRatio(0.42);
    await wait(150);
    const views = this.getViews();
    for (const view of views) view.scrollDOM.scrollTop = edge === "start" ? 0
      : edge === "end" ? view.scrollDOM.scrollHeight : 5200;
    await wait(150);
    for (const view of views) {
      if (!edge && view.scrollDOM.scrollTop < 1000) {
        throw new Error(`Programmatic scroll was overridden: ${view.scrollDOM.scrollTop}`);
      }
    }
    this.track(edge);
  }

  track(edge: "start" | "end" | null = null) {
    this.anchors = this.getViews().map(view => {
      const rect = view.scrollDOM.getBoundingClientRect();
      const style = getComputedStyle(view.contentDOM);
      const position = view.posAtCoords({ x: rect.left + (parseFloat(style.paddingLeft) || 0) + view.scrollDOM.clientLeft + 1,
        y: rect.top + 1 }, false);
      if (position == null) throw new Error("No visible reading position");
      const anchor: Anchor = { view, position, top: 0, edge };
      anchor.top = this.read(anchor).top;
      return anchor;
    });
    this.source = this.getViews().map(view => view.state.doc.toString());
    this.selections = this.getViews().map(view => JSON.stringify(view.state.selection.toJSON()));
  }

  private read(anchor: Anchor): Sample {
    const { view, position } = anchor;
    const { node, offset } = view.domAtPos(position);
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, node.nodeType === Node.TEXT_NODE ? Math.min(offset + 1, node.textContent!.length) : offset);
    if (anchor.element && !anchor.element.isConnected) throw new Error("Anchored table row was unmounted");
    const top = (anchor.element ?? range).getBoundingClientRect().top - view.scrollDOM.getBoundingClientRect().top;
    const scroll = view.scrollDOM;
    return { top, width: scroll.clientWidth, scroll: scroll.scrollTop,
      committedWidth: createMarkdownLayoutCoordinator(view).snapshot().committedWidth,
      error: anchor.edge === "start" ? Math.abs(scroll.scrollTop)
        : anchor.edge === "end" ? Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop)
        : Math.abs(top - anchor.top) };
  }

  start() {
    this.samples = [];
    this.samplingError = null;
    this.active = true;
    const tick = () => {
      if (!this.active) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.active) {
          try { this.samples.push(this.anchors.map(anchor => this.read(anchor))); }
          catch (error) { this.samplingError = error; this.active = false; }
        }
      }, 0);
      this.timers.add(timer);
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  async stop(allowDocumentChange = false) {
    // Wait for real frames instead of assuming a fixed timer contains them.
    for (let index = 0; index < 6; index++) await frame();
    await wait(0);
    this.active = false;
    cancelAnimationFrame(this.frameId);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.samplingError) throw this.samplingError;
    if (!allowDocumentChange) this.getViews().forEach((view, index) => {
      if (view.state.doc.toString() !== this.source[index]) throw new Error("Layout modified the source");
      if (JSON.stringify(view.state.selection.toJSON()) !== this.selections[index]) {
        throw new Error(`Layout modified selection: ${this.selections[index]} -> ${JSON.stringify(view.state.selection.toJSON())}`);
      }
    });
    const all = this.samples.flat();
    return { frames: this.samples.length, maxError: Math.max(0, ...all.map(sample => sample.error)),
      maxWidthLag: Math.max(0, ...all.map(sample => Math.abs(sample.width - sample.committedWidth))),
      widths: this.anchors.map((_anchor, index) => [...new Set(this.samples.map(samples => samples[index].width))]),
      samples: this.samples };
  }

  async resize(steps: number) {
    for (let i = 0; i <= steps; i++) {
      await frame();
      this.setRatio(0.42 + Math.sin(i / steps * Math.PI) * 0.26);
    }
  }

  async typography() {
    const measuredSizes = new Set<string>();
    for (const size of [15, 16, 18, 14]) {
      await frame();
      for (const view of this.getViews()) view.dom.style.setProperty("--po-md-content-size", `${size}px`);
      dispatchTypographyChange(document, { generation: size, phase: "applied" });
      measuredSizes.add(getComputedStyle(this.getViews()[0].contentDOM).fontSize);
    }
    if (measuredSizes.size !== 4) throw new Error("Typography fixture did not change actual font size");
  }

  async navigate(resizeInSameTask = false) {
    const targets = this.getViews().map(view => view.state.doc.line(180).from);
    this.getViews().forEach((view, index) => scrollCodeMirrorIntoView(view, targets[index], { y: "start" }));
    if (resizeInSameTask) this.setRatio(0.6);
    await wait(150);
    this.getViews().forEach((view, index) => {
      const top = this.read({ view, position: targets[index], top: 0, edge: null }).top;
      if (top < -1 || top > 40) throw new Error(`Explicit navigation was overridden: ${top}`);
    });
    this.track();
  }

  async switchToSource() {
    const views = this.getViews();
    for (const handle of document.querySelectorAll<HTMLButtonElement>(".desktop-editor-pane-handle")) {
      handle.click();
      await wait(30);
      const source = document.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-label="Source code"]');
      if (!source) throw new Error("Source mode command is missing");
      source.click();
      await wait(100);
      handle.click();
      await wait(30);
    }
    if (document.querySelectorAll('.markdown-codemirror-editor[data-preview-state="source"]').length !== 2) {
      throw new Error("Both panes must enter Source mode");
    }
    views.forEach(view => { if (!view.dom.isConnected) throw new Error("Mode change recreated the EditorView"); });
  }

  async prepareTable() {
    const source = ["Before the table", "", "| Row | Content |", "| --- | --- |",
      ...Array.from({ length: 240 }, (_, index) => `| ${index} | 中文 row ${index} contents |`), "", "After the table"].join("\n");
    for (const view of this.getViews()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    await wait(200);
    for (const view of this.getViews()) view.scrollDOM.scrollTop = 3200;
    await wait(250);
    this.track();
    for (const anchor of this.anchors) {
      const top = anchor.view.scrollDOM.getBoundingClientRect().top;
      anchor.element = [...anchor.view.dom.querySelectorAll<HTMLElement>('tr[data-md-table-body-index]')]
        .find(row => row.getBoundingClientRect().bottom > top);
      if (!anchor.element) throw new Error("No visible virtual table row");
      anchor.top = this.read(anchor).top;
    }
  }

  insertAbove() {
    this.getViews().forEach((view, index) => {
      const insert = "A remote change above the reading position.\n\n";
      view.dispatch({ changes: { from: 0, insert } });
      this.anchors[index] = { ...this.anchors[index], position: this.anchors[index].position + insert.length };
    });
  }
}
