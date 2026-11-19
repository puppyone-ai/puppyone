import type { EditorView, Rect } from "@codemirror/view";

export function getInlineWidgetEdgeX(dom: HTMLElement, pos: number, side: number): number {
  const rect = dom.getBoundingClientRect();
  return pos <= 0 || side < 0 ? rect.left : rect.right;
}

export function getInlineWidgetTextCoords(dom: HTMLElement, x: number): Rect | null {
  const line = dom.closest(".cm-line");
  if (!(line instanceof HTMLElement)) return null;

  const referenceRect = dom.getBoundingClientRect();
  const textRect = getNearestVisibleTextRect(line, referenceRect) ?? getFallbackLineTextRect(line);

  return {
    left: x,
    right: x,
    top: textRect.top,
    bottom: textRect.bottom,
  };
}

function getNearestVisibleTextRect(line: HTMLElement, referenceRect: DOMRect): Rect | null {
  const ownerDocument = line.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return null;

  const textNodes = ownerDocument.createTreeWalker(
    line,
    ownerWindow.NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) return ownerWindow.NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return ownerWindow.NodeFilter.FILTER_REJECT;
        if (parent.closest(".cm-md-hidden-syntax, .cm-md-task-checkbox-widget")) {
          return ownerWindow.NodeFilter.FILTER_REJECT;
        }
        return ownerWindow.NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const referenceY = referenceRect.top + referenceRect.height / 2;
  const referenceX = referenceRect.left + referenceRect.width / 2;
  let bestRect: Rect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
    const range = ownerDocument.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;

      const verticalDistance = Math.abs(rect.top + rect.height / 2 - referenceY);
      const horizontalDistance = referenceX < rect.left
        ? rect.left - referenceX
        : referenceX > rect.right
          ? referenceX - rect.right
          : 0;
      const distance = verticalDistance * 4 + horizontalDistance;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestRect = {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }
    }
    range.detach();
  }

  return bestRect;
}

function getFallbackLineTextRect(line: HTMLElement): Rect {
  const lineRect = line.getBoundingClientRect();
  const style = window.getComputedStyle(line);
  const paddingTop = parseCssPixelValue(style.paddingTop);
  const lineHeight = parseCssPixelValue(style.lineHeight) || parseCssPixelValue(style.fontSize) * 1.2;
  const top = lineRect.top + paddingTop;
  return {
    top,
    bottom: top + lineHeight,
    left: lineRect.left,
    right: lineRect.right,
  };
}

function parseCssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
