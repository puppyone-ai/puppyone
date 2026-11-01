import type { EditorView } from "@codemirror/view";

export function stopCodeMirrorEvent(event: Event) {
  event.stopPropagation();
}

export function hasPointerMoved(event: MouseEvent, pointerDown: { x: number; y: number }): boolean {
  return Math.abs(event.clientX - pointerDown.x) > 4 || Math.abs(event.clientY - pointerDown.y) > 4;
}

/**
 * Resolve a mounted widget to its current document anchor.
 *
 * A DecorationSet maps the widget's range through transactions without
 * mutating the immutable WidgetType that created its DOM. Interactive widgets
 * must use this live anchor instead of constructor-time absolute offsets.
 */
export function getMappedWidgetPosition(
  view: EditorView,
  element: HTMLElement,
): number | null {
  if (!element.isConnected || !view.dom.contains(element)) return null;
  try {
    return view.posAtDOM(element, 0);
  } catch {
    // CodeMirror may detach a widget between pointer delivery and dispatch.
    return null;
  }
}

/**
 * Resolve a mounted replacement widget back to its current document range.
 *
 * CodeMirror maps decoration positions through every transaction, while a
 * reused WidgetType descriptor remains immutable. Interactive widgets must
 * therefore read their current position from the mounted DOM instead of
 * retaining absolute offsets captured at construction time.
 */
export function getMappedWidgetSourceRange(
  view: EditorView,
  element: HTMLElement,
  sourceLength: number,
): { from: number; to: number } | null {
  const from = getMappedWidgetPosition(view, element);
  return from === null
    ? null
    : {
        from,
        to: Math.min(view.state.doc.length, from + Math.max(0, sourceLength)),
      };
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function isContentEditableCaretAtBoundary(element: HTMLElement, boundary: "start" | "end"): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchorNode = selection.anchorNode;
  if (!anchorNode || !element.contains(anchorNode)) return false;

  const range = selection.getRangeAt(0).cloneRange();
  const contentRange = element.ownerDocument.createRange();
  contentRange.selectNodeContents(element);

  if (boundary === "start") {
    contentRange.setEnd(range.startContainer, range.startOffset);
    return contentRange.toString().length === 0;
  }

  contentRange.setStart(range.endContainer, range.endOffset);
  return contentRange.toString().length === 0;
}

export function createSourceToggleIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = [
    ["polyline", "16 18 22 12 16 6"],
    ["polyline", "8 6 2 12 8 18"],
  ] as const;

  for (const item of paths) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", item[0]);
    element.setAttribute("points", item[1]);
    svg.appendChild(element);
  }

  return svg;
}
