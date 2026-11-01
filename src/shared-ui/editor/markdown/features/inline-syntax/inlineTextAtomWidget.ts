import { WidgetType } from "@codemirror/view";

/** Replaces short source such as an entity or a shortcode with the text it means. */
export class InlineTextAtomWidget extends WidgetType {
  constructor(private readonly text: () => string, private readonly identity: string) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof InlineTextAtomWidget && widget.identity === this.identity;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-inline-text-atom";
    span.textContent = this.text();
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** A textarea decodes character references without parsing or loading markup. */
export function decodeHtmlEntity(source: string): string {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = source;
  return decoder.value;
}
