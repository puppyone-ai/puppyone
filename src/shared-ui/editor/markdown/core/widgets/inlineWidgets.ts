import { EditorView, type Rect, WidgetType } from "@codemirror/view";
import type { MarkdownTaskLine } from "../syntax/markdownListStructure";
import { getInlineWidgetEdgeX, getInlineWidgetTextCoords } from "../../shared/widgets/markdownWidgetMeasure";
import { getMappedWidgetPosition } from "../../shared/widgets/widgetDom";
import { toggleMarkdownTaskCheckboxAt } from "../commands/markdownTaskCommands";
import { getMarkdownMessage } from "../editor/markdownLocalization";

export type MarkdownSourceSyntaxKind =
  | "blockquote"
  | "delimiter"
  | "escape"
  | "heading"
  | "inline-html"
  | "link"
  | "list"
  | "task"
  | "wiki-link";

export class HiddenMarkdownSyntaxWidget extends WidgetType {
  constructor(private readonly kind: MarkdownSourceSyntaxKind) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof HiddenMarkdownSyntaxWidget && widget.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = `cm-md-hidden-syntax cm-md-hidden-syntax-${this.kind}`;
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  ignoreEvent() {
    return true;
  }

  coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
    return getInlineWidgetTextCoords(dom, getInlineWidgetEdgeX(dom, pos, side));
  }
}

export class InlineHtmlLineBreakWidget extends WidgetType {
  constructor(private readonly visualLineBreaks = 1) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof InlineHtmlLineBreakWidget && widget.visualLineBreaks === this.visualLineBreaks;
  }

  get lineBreaks(): number {
    return Math.max(0, this.visualLineBreaks);
  }

  get estimatedHeight(): number {
    return this.lineBreaks * 16;
  }

  toDOM(): HTMLElement {
    const lineBreak = document.createElement("br");
    lineBreak.className = "cm-md-inline-html-break";
    lineBreak.setAttribute("aria-hidden", "true");
    lineBreak.dataset.mdLineBreaks = String(this.visualLineBreaks);
    return lineBreak;
  }

  ignoreEvent() {
    return false;
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly task: MarkdownTaskLine) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof TaskCheckboxWidget &&
      widget.task.checked === this.task.checked &&
      widget.task.depth === this.task.depth &&
      widget.task.checkboxFrom === this.task.checkboxFrom &&
      widget.task.checkboxTo === this.task.checkboxTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const control = document.createElement("button");
    control.type = "button";
    control.role = "checkbox";
    control.className = "cm-md-task-checkbox-widget";
    syncTaskCheckboxControl(control, this.task, view);

    const indicator = document.createElement("span");
    indicator.setAttribute("aria-hidden", "true");
    control.appendChild(indicator);
    syncTaskCheckboxIndicator(indicator, this.task.checked);

    control.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    control.addEventListener("mousedown", (event) => {
      // Keep the browser from moving the contenteditable selection before the
      // command runs. Keyboard activation remains native because it does not
      // produce a mousedown event.
      event.preventDefault();
      event.stopPropagation();
    });
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const position = getMappedWidgetPosition(view, control);
      if (position === null || !toggleMarkdownTaskCheckboxAt(view, position)) return;
    });

    return control;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!(dom instanceof HTMLButtonElement)) return false;
    const indicator = dom.firstElementChild;
    if (!(indicator instanceof HTMLElement)) return false;
    syncTaskCheckboxControl(dom, this.task, view);
    syncTaskCheckboxIndicator(indicator, this.task.checked);
    return true;
  }

  ignoreEvent() {
    return true;
  }

  coordsAt(dom: HTMLElement): Rect | null {
    const line = dom.closest(".cm-line");
    const lineRect = line?.getBoundingClientRect();
    if (!line || !lineRect) return null;

    const lineStyle = window.getComputedStyle(line);
    const textLeft = lineRect.left + Number.parseFloat(lineStyle.paddingLeft || "0");
    return getInlineWidgetTextCoords(dom, textLeft);
  }
}

function syncTaskCheckboxControl(
  control: HTMLButtonElement,
  task: MarkdownTaskLine,
  view: EditorView,
) {
  control.style.setProperty("--md-list-depth", String(task.depth));
  control.setAttribute(
    "aria-label",
    getMarkdownMessage(
      view,
      task.checked ? "editor.markdown.taskIncomplete" : "editor.markdown.taskComplete",
    ),
  );
  control.setAttribute("aria-checked", String(task.checked));
}

function syncTaskCheckboxIndicator(indicator: HTMLElement, checked: boolean) {
  indicator.className = checked ? "cm-md-task-checkbox is-checked" : "cm-md-task-checkbox";
}

export class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly layoutEstimatedHeight = 37) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof HorizontalRuleWidget
      && widget.layoutEstimatedHeight === this.layoutEstimatedHeight;
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-md-hr-widget";
    return rule;
  }

  coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
    return getInlineWidgetTextCoords(dom, getInlineWidgetEdgeX(dom, pos, side));
  }
}
