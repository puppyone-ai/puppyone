import { EditorView } from "@codemirror/view";
import {
  applyMarkdownFormatCommand,
  isMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from "./markdownInlineCommands";

export {
  applyMarkdownFormatCommand,
  isMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from "./markdownInlineCommands";

export const MARKDOWN_FORMAT_ACTIVE_EVENT = "puppyone:markdown-format-active";
export const MARKDOWN_FORMAT_SHORTCUT_EVENT = "puppyone:markdown-format-shortcut";

let boundEditorCount = 0;
let activeMarkdownEditor: EditorView | null = null;

export function bindMarkdownFormatHotkeys(view: EditorView): () => void {
  if (boundEditorCount === 0) {
    window.addEventListener("keydown", onMarkdownFormatKeyDown, true);
    window.addEventListener(MARKDOWN_FORMAT_SHORTCUT_EVENT, onMarkdownFormatShortcut);
  }
  boundEditorCount += 1;

  const onFocusIn = () => setActiveMarkdownEditor(view);
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && view.dom.contains(next)) return;
    if (activeMarkdownEditor === view) setActiveMarkdownEditor(null);
  };

  view.dom.addEventListener("focusin", onFocusIn);
  view.dom.addEventListener("focusout", onFocusOut);
  if (view.hasFocus || view.dom.contains(view.dom.ownerDocument.activeElement)) {
    setActiveMarkdownEditor(view);
  }

  return () => {
    view.dom.removeEventListener("focusin", onFocusIn);
    view.dom.removeEventListener("focusout", onFocusOut);
    boundEditorCount = Math.max(0, boundEditorCount - 1);
    if (activeMarkdownEditor === view) setActiveMarkdownEditor(null);
    if (boundEditorCount === 0) {
      window.removeEventListener("keydown", onMarkdownFormatKeyDown, true);
      window.removeEventListener(MARKDOWN_FORMAT_SHORTCUT_EVENT, onMarkdownFormatShortcut);
    }
  };
}

export function matchMarkdownFormatHotkey(event: KeyboardEvent): MarkdownFormatCommand | null {
  if (event.altKey || event.isComposing || event.repeat) return null;
  if (!event.metaKey && !event.ctrlKey) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : "";
  if (event.shiftKey) return key === "x" ? "strike" : null;
  if (key === "b") return "strong";
  if (key === "i") return "emphasis";
  if (key === "u") return "underline";
  if (key === "d") return "strike";
  return null;
}

function setActiveMarkdownEditor(view: EditorView | null): void {
  activeMarkdownEditor = view;
  window.dispatchEvent(new CustomEvent(MARKDOWN_FORMAT_ACTIVE_EVENT, {
    detail: { active: view != null },
  }));
}

function onMarkdownFormatKeyDown(event: KeyboardEvent): void {
  if (!activeMarkdownEditor) return;
  const type = matchMarkdownFormatHotkey(event);
  if (!type) return;
  event.preventDefault();
  event.stopPropagation();
  applyMarkdownFormatCommand(activeMarkdownEditor, type);
}

function onMarkdownFormatShortcut(event: Event): void {
  if (!activeMarkdownEditor || !(event instanceof CustomEvent)) return;
  const type = event.detail?.type;
  if (!isMarkdownFormatCommand(type)) return;
  applyMarkdownFormatCommand(activeMarkdownEditor, type);
}
