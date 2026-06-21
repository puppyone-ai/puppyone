"use client";

import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from "@milkdown/core";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { columnResizingPlugin, gfm } from "@milkdown/preset-gfm";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { $prose } from "@milkdown/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { EditorViewerContext } from "../viewerTypes";
import { TextEditorFrame } from "./TextEditorFrame";

export function MarkdownViewer(context: EditorViewerContext) {
  return (
    <TextEditorFrame
      key={context.document.path}
      content={context.content}
      nodeName={context.document.name}
      defaultMode="live"
      canEdit={context.canEdit}
      onSaveContent={context.onSaveContent}
      hideSourceView={context.hideSourceView}
      saveMode={context.saveMode}
      renderLive={(value, controls) => (
        <MarkdownPreview
          content={value}
          editable={controls.canEdit}
          onChange={controls.canEdit ? controls.onChange : undefined}
        />
      )}
    />
  );
}

export function canEditMarkdown() {
  return true;
}

function MarkdownPreview({
  content,
  editable,
  onChange,
}: {
  content: string;
  editable: boolean;
  onChange?: (content: string) => void;
}) {
  const canEdit = editable && Boolean(onChange);
  const [editorRevision, setEditorRevision] = useState(0);
  const lastAppliedContentRef = useRef(content);
  const lastEmittedContentRef = useRef(content);

  useEffect(() => {
    if (content === lastAppliedContentRef.current || content === lastEmittedContentRef.current) return;
    lastAppliedContentRef.current = content;
    lastEmittedContentRef.current = content;
    setEditorRevision((revision) => revision + 1);
  }, [content]);

  const handleChange = useCallback((nextContent: string) => {
    lastAppliedContentRef.current = nextContent;
    lastEmittedContentRef.current = nextContent;
    if (canEdit) onChange?.(nextContent);
  }, [canEdit, onChange]);

  const handleWheelCapture = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (scrollTableFromWheelEvent(event)) {
      event.stopPropagation();
    }
  }, []);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (startTableScrollbarDrag(event.nativeEvent)) {
      event.stopPropagation();
    }
  }, []);

  return (
    <div
      className="milkdown-editor puppy-markdown-preview"
      data-editable={canEdit ? "true" : undefined}
      data-empty={!content.trim() ? "true" : undefined}
      onWheelCapture={handleWheelCapture}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <MilkdownProvider>
        <MilkdownEditorContent
          key={editorRevision}
          defaultValue={content}
          onChange={canEdit ? handleChange : undefined}
          readOnly={!canEdit}
        />
      </MilkdownProvider>
    </div>
  );
}

type MilkdownEditorContentProps = {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  readOnly: boolean;
};

const taskListClickPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("task-list-click"),
    props: {
      handleClick(view, pos, event) {
        const { target } = event;
        if (!(target instanceof HTMLElement)) return false;

        const taskItem = target.closest('li[data-item-type="task"]');
        if (!(taskItem instanceof HTMLElement)) return false;

        const rect = taskItem.getBoundingClientRect();
        if (event.clientX - rect.left > 28) return false;

        const resolvedPos = view.state.doc.resolve(pos);
        for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
          const node = resolvedPos.node(depth);
          if (node.type.name !== "list_item" || node.attrs.checked == null) continue;

          const nodePos = resolvedPos.before(depth);
          const transaction = view.state.tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          });
          view.dispatch(transaction);
          return true;
        }

        return false;
      },
    },
  });
});

const tableWheelScrollPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("table-wheel-scroll"),
    props: {
      handleDOMEvents: {
        wheel(_view, event) {
          return scrollTableFromWheelEvent(event);
        },
      },
    },
  });
});

function MilkdownEditorContent({ defaultValue, onChange, readOnly }: MilkdownEditorContentProps) {
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const { get } = useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);

        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !readOnlyRef.current,
        }));

        if (onChange) {
          ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
            onChange(markdown);
          });
        }
      })
      .use(commonmark)
      .use(gfm)
      .use(columnResizingPlugin)
      .use(tableWheelScrollPlugin)
      .use(listener)
      .use(taskListClickPlugin);
  }, []);

  useEffect(() => {
    const editor = get();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => !readOnlyRef.current });
      view.updateState(view.state);
    });
  }, [get, readOnly]);

  return <Milkdown />;
}

type WheelScrollEvent = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  preventDefault: () => void;
};

function scrollTableFromWheelEvent(event: WheelScrollEvent): boolean {
  const scrollContainer = findTableScrollContainer(event.target);
  if (!scrollContainer) return false;

  const delta = getHorizontalWheelDelta(event);
  if (delta === 0) return false;

  const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
  if (maxScrollLeft <= 1) return false;

  const currentScrollLeft = scrollContainer.scrollLeft;
  const nextScrollLeft = clamp(scrollContainer.scrollLeft + delta, 0, maxScrollLeft);
  if (nextScrollLeft === currentScrollLeft) return false;

  event.preventDefault();
  scrollContainer.scrollLeft = nextScrollLeft;

  return true;
}

function startTableScrollbarDrag(event: PointerEvent): boolean {
  if (event.button !== 0) return false;

  const scrollContainer = findTableScrollContainer(event.target);
  if (!scrollContainer) return false;

  const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
  if (maxScrollLeft <= 1) return false;

  const rect = scrollContainer.getBoundingClientRect();
  const scrollbarHitArea = 18;
  const isInsideHorizontalScrollbar =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.bottom - scrollbarHitArea &&
    event.clientY <= rect.bottom;

  if (!isInsideHorizontalScrollbar) return false;

  event.preventDefault();

  const pointerId = event.pointerId;
  const startClientX = event.clientX;
  const startScrollLeft = scrollContainer.scrollLeft;
  const dragScale = scrollContainer.scrollWidth / Math.max(scrollContainer.clientWidth, 1);

  const stopDragging = () => {
    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("pointerup", stopDragging, true);
    window.removeEventListener("pointercancel", stopDragging, true);
    try {
      scrollContainer.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  const handlePointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();
    const nextScrollLeft = startScrollLeft + (moveEvent.clientX - startClientX) * dragScale;
    scrollContainer.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft);
  };

  try {
    scrollContainer.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is best-effort; window listeners still keep dragging stable.
  }

  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", stopDragging, true);
  window.addEventListener("pointercancel", stopDragging, true);

  return true;
}

function findTableScrollContainer(target: EventTarget | null): HTMLElement | null {
  const element = getEventElement(target);
  if (!element) return null;

  const scrollContainer = element.closest(".tableWrapper, .markdown-table-scroll");
  if (scrollContainer instanceof HTMLElement) return scrollContainer;

  const table = element.closest(".milkdown-editor table");
  if (table instanceof HTMLElement) return table;

  return null;
}

function getEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function getHorizontalWheelDelta(event: Pick<WheelScrollEvent, "deltaMode" | "deltaX" | "deltaY" | "shiftKey">): number {
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(rawDelta)) return 0;
  if (event.deltaMode === 1) return rawDelta * 16;
  if (event.deltaMode === 2) return rawDelta * 120;
  return rawDelta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
