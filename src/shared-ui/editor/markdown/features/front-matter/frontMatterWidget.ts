import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import { markdownRevealedSourceEffect } from "../../core/state/revealedSource";
import { createSourceToggleIcon, getMappedWidgetSourceRange } from "../../shared/widgets/widgetDom";

export type MarkdownFrontMatterEntry = Readonly<{ key: string; value: string }>;

export function parseMarkdownFrontMatter(source: string): MarkdownFrontMatterEntry[] {
  const entries: Array<{ key: string; value: string }> = [];
  for (const line of source.split("\n")) {
    const pair = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(line);
    if (pair) {
      entries.push({ key: pair[1].trim(), value: pair[2].trim().replace(/^(["'])(.*)\1$/, "$2") });
    } else if (line.trim() && entries.length > 0) {
      // Nested values and list items read as a continuation of their key.
      const last = entries[entries.length - 1];
      last.value = [last.value, line.trim().replace(/^-[ \t]*/, "")].filter(Boolean).join(", ");
    }
  }
  return entries;
}

/** Metadata reads as a table. Its source stays one click away and fully editable. */
export class FrontMatterWidget extends WidgetType {
  constructor(
    private readonly entries: readonly MarkdownFrontMatterEntry[],
    private readonly sourceLength: number,
    private readonly identity: string,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof FrontMatterWidget && widget.identity === this.identity;
  }

  toDOM(view: EditorView): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "cm-md-html-widget cm-md-front-matter";

    const toolbar = document.createElement("div");
    toolbar.className = "cm-md-html-widget-toolbar";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cm-md-html-source-toggle";
    toggle.appendChild(createSourceToggleIcon());
    toggle.setAttribute("aria-label", getMarkdownLocalization(view).t("editor.markdown.html.showSource"));
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const range = getMappedWidgetSourceRange(view, shell, this.sourceLength);
      if (!range) return;
      view.dispatch({
        effects: markdownRevealedSourceEffect.of({ ...range, presentation: "block" }),
        selection: EditorSelection.cursor(range.from + 4),
      });
      view.focus();
    });
    toolbar.appendChild(toggle);

    const table = document.createElement("dl");
    table.className = "cm-md-front-matter-table";
    for (const { key, value } of this.entries) {
      const term = document.createElement("dt");
      term.textContent = key;
      const detail = document.createElement("dd");
      detail.textContent = value;
      table.append(term, detail);
    }
    shell.append(toolbar, table);
    return shell;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
