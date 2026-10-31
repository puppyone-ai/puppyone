import type { EditorView } from "@codemirror/view";
import type { MarkdownMovableBlockRef } from "../../core/syntax/markdownBlockBoundaries";

const MAX_PREVIEW_HEIGHT_PX = 360;
// A copy of these would reload, replay, or paint blank.
const LIVE_CONTENT_SELECTOR = "iframe, video, audio, canvas, object, embed";
const INSTANCE_ATTRIBUTES = ["id", "name", "for", "tabindex", "contenteditable", "autofocus", "draggable"];

/**
 * A still copy of what the block looks like right now, built once when a drag
 * starts. It reads only CodeMirror's public DOM contract, so any block the
 * editor can render previews the same way with no knowledge of its kind.
 */
export function createBlockPreview(view: EditorView, block: MarkdownMovableBlockRef): HTMLElement {
  const preview = view.dom.ownerDocument.createElement("div");
  preview.className = `${view.contentDOM.className} cm-md-block-drag-preview`;
  // The preview lives outside the scroller, so text metrics do not inherit.
  preview.style.lineHeight = getComputedStyle(view.contentDOM).lineHeight;
  const { rows, height } = readRenderedRows(view, block);
  preview.classList.toggle("is-clipped", height > MAX_PREVIEW_HEIGHT_PX);
  preview.append(...rows.map(copyRow));
  return preview;
}

function readRenderedRows(view: EditorView, block: MarkdownMovableBlockRef) {
  const { doc } = view.state;
  // Rows start at the line, because a list item starts after its indentation.
  const from = doc.lineAt(block.from).from;
  const to = doc.lineAt(block.to).to;
  const rows: HTMLElement[] = [];
  let height = 0;
  for (const child of Array.from(view.contentDOM.children)) {
    const position = view.posAtDOM(child);
    if (position > to) break;
    if (position < from || !(child instanceof HTMLElement)) continue;
    rows.push(child);
    height += child.getBoundingClientRect().height;
    if (height > MAX_PREVIEW_HEIGHT_PX) break;
  }
  return { rows, height };
}

function copyRow(row: HTMLElement): HTMLElement {
  const copy = row.cloneNode(true) as HTMLElement;
  const originals = row.querySelectorAll(LIVE_CONTENT_SELECTOR);
  copy.querySelectorAll(LIVE_CONTENT_SELECTOR).forEach((live, index) => {
    live.replaceWith(createPlaceholder(originals[index]));
  });
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const attribute of INSTANCE_ATTRIBUTES) element.removeAttribute(attribute);
  }
  return copy;
}

function createPlaceholder(live: Element): HTMLElement {
  const { width, height } = live.getBoundingClientRect();
  const placeholder = live.ownerDocument.createElement("div");
  placeholder.className = "cm-md-block-drag-placeholder";
  placeholder.style.width = `${width}px`;
  placeholder.style.height = `${height}px`;
  return placeholder;
}
