import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { scrollCodeMirrorIntoView } from "../../../codemirror/navigationIntent";
import { getMarkdownFootnotes } from "./footnoteModel";

/** A reference and its definition each jump to the other, as links do on a page. */
export class FootnoteMarkerWidget extends WidgetType {
  constructor(
    private readonly marker: "definition" | "reference",
    private readonly id: string,
    private readonly label: string,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof FootnoteMarkerWidget &&
      widget.marker === this.marker &&
      widget.id === this.id &&
      widget.label === this.label
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.marker === "reference" ? "sup" : "span");
    element.className = `cm-md-footnote-${this.marker}`;
    element.textContent = this.label;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = getMarkdownFootnotes(view.state);
      const target = this.marker === "reference"
        ? index.definitions.get(this.id)?.from
        : index.firstReferences.get(this.id);
      if (target === undefined) return;
      view.dispatch({ selection: EditorSelection.cursor(target) });
      scrollCodeMirrorIntoView(view, target, { y: "center" });
    });
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
