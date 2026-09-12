import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { afterEach, vi } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { closeActiveMarkdownTableMenu } from "../../../../packages/shared-ui/src/editor/markdown/features/table/tableMenuState";
import { markdownLocalizationExtension } from "../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLocalization";
import { testT } from "../../react/localization";

const TABLE_SOURCE = [
  "| A | B | C |",
  "| --- | --- | --- |",
  "| one | two | three |",
  "| four | five | six |",
].join("\n");

const views: EditorView[] = [];

afterEach(() => {
  closeActiveMarkdownTableMenu();
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function createTableView(source = TABLE_SOURCE) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLocalizationExtension({
          direction: "ltr",
          formatNumber: (value) => String(value),
          locale: "en",
          t: testT,
        }, false),
        markdownLivePreviewExtension("safe", null, "table.md"),
      ],
    }),
  });
  views.push(view);
  return view;
}

function source(view: EditorView) {
  return view.state.doc.toString();
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
}

function makeHandleCaptureSafe(handle: HTMLElement) {
  let capturedPointer: number | null = null;
  Object.defineProperties(handle, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointer === pointerId,
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
    },
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        capturedPointer = pointerId;
      },
    },
  });
}

function mockHorizontalScroller(element: HTMLElement, clientWidth: number, scrollWidth: number) {
  let scrollLeft = 0;
  Object.defineProperties(element, {
    clientWidth: { configurable: true, get: () => clientWidth },
    scrollWidth: { configurable: true, get: () => scrollWidth },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => { scrollLeft = value; },
    },
  });
}

export { TABLE_SOURCE, createTableView, source, nextAnimationFrame, rect, mockRect, makeHandleCaptureSafe, mockHorizontalScroller };
