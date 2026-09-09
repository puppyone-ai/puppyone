import { EditorView } from "@codemirror/view";
import {
  applyMarkdownFormatCommand,
  isMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from "./markdownInlineCommands";
import {
  applyMarkdownEditorCommand,
  isMarkdownEditorCommand,
} from "./markdownEditorCommands";

export {
  applyMarkdownFormatCommand,
  isMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from "./markdownInlineCommands";

export const MARKDOWN_FORMAT_ACTIVE_EVENT = "puppyone:markdown-format-active";
export const MARKDOWN_FORMAT_SHORTCUT_EVENT = "puppyone:markdown-format-shortcut";
export const MARKDOWN_EDITOR_COMMAND_EVENT = "puppyone:markdown-editor-command";

let boundEditorCount = 0;
let activeMarkdownEditor: EditorView | null = null;

export function bindMarkdownFormatHotkeys(view: EditorView): () => void {
  if (boundEditorCount === 0) {
    window.addEventListener("keydown", onMarkdownFormatKeyDown, true);
    window.addEventListener(MARKDOWN_FORMAT_SHORTCUT_EVENT, onMarkdownFormatShortcut);
    window.addEventListener(MARKDOWN_EDITOR_COMMAND_EVENT, onMarkdownEditorCommand);
  }
  boundEditorCount += 1;

  const onFocusIn = (event: FocusEvent) => (
    syncMarkdownEditorCommandAvailability(view, event.target === view.contentDOM)
  );
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && view.dom.contains(next)) return;
    if (activeMarkdownEditor === view) setActiveMarkdownEditor(null);
  };

  view.dom.addEventListener("focusin", onFocusIn);
  view.dom.addEventListener("focusout", onFocusOut);
  if (view.hasFocus || view.dom.ownerDocument.activeElement === view.contentDOM) {
    syncMarkdownEditorCommandAvailability(view);
  }

  return () => {
    view.dom.removeEventListener("focusin", onFocusIn);
    view.dom.removeEventListener("focusout", onFocusOut);
    boundEditorCount = Math.max(0, boundEditorCount - 1);
    if (activeMarkdownEditor === view) setActiveMarkdownEditor(null);
    if (boundEditorCount === 0) {
      window.removeEventListener("keydown", onMarkdownFormatKeyDown, true);
      window.removeEventListener(MARKDOWN_FORMAT_SHORTCUT_EVENT, onMarkdownFormatShortcut);
      window.removeEventListener(MARKDOWN_EDITOR_COMMAND_EVENT, onMarkdownEditorCommand);
    }
  };
}

export function syncMarkdownEditorCommandAvailability(
  view: EditorView,
  ownsFocus = view.hasFocus || view.dom.ownerDocument.activeElement === view.contentDOM,
): void {
  if (!ownsFocus) {
    if (activeMarkdownEditor === view) setActiveMarkdownEditor(null);
    return;
  }
  if (view.state.readOnly) {
    setActiveMarkdownEditor(null);
    return;
  }
  setActiveMarkdownEditor(view);
}

export function matchMarkdownFormatHotkey(event: KeyboardEvent): MarkdownFormatCommand | null {
  if (event.altKey || event.isComposing || event.repeat) return null;
  if (!event.metaKey && !event.ctrlKey) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : "";
  if (event.shiftKey) {
    if (key === "x") return "strike";
    if (key === "h") return "highlight";
    return null;
  }
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

function onMarkdownEditorCommand(event: Event): void {
  if (!activeMarkdownEditor || !(event instanceof CustomEvent)) return;
  const type = event.detail?.type;
  if (!isMarkdownEditorCommand(type)) return;
  applyMarkdownEditorCommand(activeMarkdownEditor, type);
}
