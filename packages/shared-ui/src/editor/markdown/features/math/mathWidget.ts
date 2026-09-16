import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { render as renderKatex } from "katex";
import { markdownRevealedSourceEffect } from "../../core/state/revealedSource";
import { getMappedWidgetSourceRange, hasPointerMoved } from "../../shared/widgets/widgetDom";
import { findMarkdownInlineMathTokens, getMarkdownMathBlock } from "./mathModel";

type MathPresentation = "block" | "inline";

abstract class MathWidget extends WidgetType {
  protected readonly sourceLength: number;

  constructor(
    from: number,
    to: number,
    protected readonly source: string,
    protected readonly presentation: MathPresentation,
  ) {
    super();
    this.sourceLength = Math.max(0, to - from);
  }

  protected createDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.presentation === "block" ? "div" : "span");
    wrapper.className = this.presentation === "block"
      ? "cm-md-math-block-widget"
      : "cm-md-math-inline-widget";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "math");
    wrapper.setAttribute("aria-label", this.source);

    const rendered = document.createElement("span");
    rendered.className = "cm-md-math-rendered";
    try {
      renderKatex(this.source, rendered, {
        displayMode: this.presentation === "block",
        throwOnError: true,
        strict: false,
        trust: false,
        maxExpand: 1_000,
        maxSize: 500,
        output: "htmlAndMathml",
      });
    } catch (error) {
      wrapper.classList.add("is-invalid");
      rendered.classList.add("cm-md-math-source-fallback");
      rendered.textContent = this.presentation === "block"
        ? `$$\n${this.source}\n$$`
        : `$${this.source}$`;
      if (error instanceof Error) wrapper.title = error.message;
    }
    wrapper.appendChild(rendered);
    installMathInteractions(wrapper, view, this.sourceLength, this.presentation);
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

export class MathInlineWidget extends MathWidget {
  constructor(from: number, to: number, source: string) {
    super(from, to, source, "inline");
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof MathInlineWidget
      && widget.sourceLength === this.sourceLength
      && widget.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    return this.createDOM(view);
  }
}

export class MathBlockWidget extends MathWidget {
  constructor(from: number, to: number, source: string, private readonly layoutEstimatedHeight: number) {
    super(from, to, source, "block");
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof MathBlockWidget
      && widget.sourceLength === this.sourceLength
      && widget.source === this.source
      && widget.layoutEstimatedHeight === this.layoutEstimatedHeight;
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    return this.createDOM(view);
  }
}

function installMathInteractions(
  wrapper: HTMLElement,
  view: EditorView,
  sourceLength: number,
  presentation: MathPresentation,
) {
  let pointerDown: { x: number; y: number } | null = null;
  const getSourceRange = () => getMappedWidgetSourceRange(view, wrapper, sourceLength);
  const revealSource = () => {
    const range = getSourceRange();
    if (!range) return;
    view.dispatch({
      effects: markdownRevealedSourceEffect.of({ ...range, presentation }),
      selection: EditorSelection.cursor(resolveMathRevealCursor(view, range, presentation)),
    });
    view.focus();
  };

  wrapper.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  wrapper.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const moved = pointerDown && hasPointerMoved(event, pointerDown);
    pointerDown = null;
    if (!moved) wrapper.focus({ preventScroll: true });
  });
  wrapper.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    revealSource();
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      revealSource();
      return;
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (view.state.readOnly) return;
    const range = getSourceRange();
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: "" },
      selection: EditorSelection.cursor(range.from),
    });
    queueMicrotask(() => {
      if (view.dom.isConnected) view.focus();
    });
  });
}

function resolveMathRevealCursor(
  view: EditorView,
  range: { from: number; to: number },
  presentation: MathPresentation,
): number {
  if (presentation === "inline") {
    const token = findMarkdownInlineMathTokens(view.state, range.from, range.to)
      .find((candidate) => candidate.from === range.from && candidate.to === range.to);
    return token?.contentFrom ?? Math.min(range.to, range.from + 1);
  }

  const block = getMarkdownMathBlock(view.state, view.state.doc.lineAt(range.from).number);
  if (block && block.from === range.from && block.to === range.to) {
    return block.contentFrom;
  }

  return Math.min(range.to, range.from + 3);
}
