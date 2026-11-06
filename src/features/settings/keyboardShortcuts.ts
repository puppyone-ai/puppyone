import { MARKDOWN_SHORTCUT_DEFINITIONS } from "@puppyone/shared-ui";
export type ShortcutPlatform = "mac" | "windows" | "linux";
export type KeyboardShortcut = Readonly<{
  id: string;
  group: string;
  labelId: string;
  keys: readonly string[];
  mac?: readonly string[];
  linux?: readonly string[];
  platforms?: readonly ShortcutPlatform[];
}>;
const entry = (group: string, id: string, keys: readonly string[], overrides: Partial<KeyboardShortcut> = {}): KeyboardShortcut => ({
  id: `${group}.${id}`, group, labelId: `settings.shortcuts.command.${id}`, keys, ...overrides,
});
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  entry("application", "settings", ["Mod-,"]),
  entry("application", "newWindow", ["Mod-n"], { platforms: ["mac"] }),
  entry("application", "closeDocument", ["Mod-w"]),
  entry("application", "nextDocument", ["Ctrl-Tab"]),
  entry("application", "previousDocument", ["Ctrl-Shift-Tab"]),
  entry("application", "zoomIn", ["Mod-="], { platforms: ["mac"] }),
  entry("application", "zoomOut", ["Mod--"], { platforms: ["mac"] }),
  entry("application", "zoomReset", ["Mod-0"], { platforms: ["mac"] }),
  entry("editing", "save", ["Mod-s"]),
  entry("editing", "undo", ["Mod-z"]),
  entry("editing", "redo", ["Mod-y"], { mac: ["Mod-Shift-z"], linux: ["Mod-y", "Ctrl-Shift-z"] }),
  entry("editing", "cut", ["Mod-x"]), entry("editing", "copy", ["Mod-c"]),
  entry("editing", "paste", ["Mod-v"]), entry("editing", "selectAll", ["Mod-a"]),
  entry("editing", "find", ["Mod-f"]),
  entry("editing", "findNext", ["Enter"]), entry("editing", "findPrevious", ["Shift-Enter"]),
  entry("editing", "closeFind", ["Escape"]),
  entry("editing", "lineUp", ["Alt-ArrowUp"]), entry("editing", "lineDown", ["Alt-ArrowDown"]),
  entry("editing", "copyLineUp", ["Alt-Shift-ArrowUp"]), entry("editing", "copyLineDown", ["Alt-Shift-ArrowDown"]),
  entry("editing", "deleteLine", ["Mod-Shift-k"]),
  entry("editing", "indent", ["Mod-]", "Tab"]), entry("editing", "outdent", ["Mod-[", "Shift-Tab"]),
  entry("editing", "cursorAbove", ["Mod-Alt-ArrowUp"]), entry("editing", "cursorBelow", ["Mod-Alt-ArrowDown"]),
  entry("editing", "blankLine", ["Mod-Enter"]),
  entry("editing", "matchingBracket", ["Mod-Shift-\\"]),
  entry("editing", "indentSelection", ["Mod-Alt-\\"]),
  entry("editing", "selectLine", ["Alt-l"], { mac: ["Ctrl-l"] }),
  entry("editing", "tabFocus", ["Ctrl-m"], { mac: ["Alt-Shift-m"] }),
  entry("code", "foldCode", ["Ctrl-Shift-["], { mac: ["Mod-Alt-["] }),
  entry("code", "unfoldCode", ["Ctrl-Shift-]"], { mac: ["Mod-Alt-]"] }),
  entry("code", "foldAll", ["Ctrl-Alt-["]), entry("code", "unfoldAll", ["Ctrl-Alt-]"]),
  entry("code", "toggleComment", ["Mod-/"]), entry("code", "blockComment", ["Alt-Shift-a"]),
  entry("code", "selectSyntax", ["Mod-i"]), entry("code", "undoSelection", ["Mod-u"]),
  entry("code", "redoSelection", ["Alt-u"], { mac: ["Mod-Shift-u"] }),
  ...MARKDOWN_SHORTCUT_DEFINITIONS.filter(item => item.keys.length > 0).map(item => ({
    id: `markdown.${item.id}`, group: "markdown", labelId: item.labelId, keys: item.keys, mac: item.mac,
  })),
  entry("markdown", "sourceMode", ["Mod-/", "Mod-Shift-m"]),
  entry("markdown", "continueList", ["Enter"]),
  entry("markdown", "listIndent", ["Tab"]), entry("markdown", "listOutdent", ["Shift-Tab"]),
  entry("markdown", "visibleLineStart", ["Home", "Mod-ArrowLeft"]),
  entry("markdown", "revealSource", ["Enter"]), entry("markdown", "collapseSource", ["Escape"]),
  entry("markdown", "deleteWidget", ["Backspace", "Delete"]),
  entry("markdown", "blockUp", ["Mod-Shift-ArrowUp"]), entry("markdown", "blockDown", ["Mod-Shift-ArrowDown"]),
  entry("markdownTable", "nextCell", ["Tab"]), entry("markdownTable", "previousCell", ["Shift-Tab"]),
  entry("markdownTable", "nextRow", ["Enter"]), entry("markdownTable", "insertRow", ["Mod-Enter"]),
  entry("markdownTable", "cancelCell", ["Escape"]),
  entry("explorer", "copyFiles", ["Mod-c"]), entry("explorer", "cutFiles", ["Mod-x"]),
  entry("explorer", "pasteFiles", ["Mod-v"]), entry("explorer", "duplicateFiles", ["Mod-d"]),
  entry("explorer", "deleteFiles", ["Delete"], { mac: ["Delete", "Mod-Backspace"] }),
  entry("explorer", "openFile", ["Enter", "Space"]),
  entry("explorer", "previousFile", ["ArrowUp"]), entry("explorer", "nextFile", ["ArrowDown"]),
  entry("explorer", "expandFolder", ["ArrowRight"]), entry("explorer", "collapseFolder", ["ArrowLeft"]),
  entry("explorer", "firstFile", ["Home"]), entry("explorer", "lastFile", ["End"]),
  entry("csv", "nextCell", ["Tab"], { labelId: "settings.shortcuts.command.nextCsvCell" }), entry("csv", "previousCell", ["Shift-Tab"]),
  entry("csv", "openCellLink", ["Mod-Enter"]),
  entry("csv", "undo", ["Mod-z"]), entry("csv", "redo", ["Mod-Shift-z"]),
  entry("csv", "clearSelection", ["Escape"]),
  entry("agentsTerminal", "sendMessage", ["Enter"]), entry("agentsTerminal", "messageNewline", ["Shift-Enter"]),
  entry("agentsTerminal", "splitLeft", ["Alt-Shift-ArrowLeft"]),
  entry("agentsTerminal", "splitRight", ["Alt-Shift-ArrowRight"]),
  entry("agentsTerminal", "splitUp", ["Alt-Shift-ArrowUp"]),
  entry("agentsTerminal", "splitDown", ["Alt-Shift-ArrowDown"]),
  entry("agentsTerminal", "nextSession", ["ArrowRight"]), entry("agentsTerminal", "previousSession", ["ArrowLeft"]),
  entry("agentsTerminal", "firstSession", ["Home"]), entry("agentsTerminal", "lastSession", ["End"]),
  entry("previews", "previousSlide", ["ArrowLeft", "ArrowUp", "PageUp"]),
  entry("previews", "nextSlide", ["ArrowRight", "ArrowDown", "PageDown"]),
  entry("previews", "firstSlide", ["Home"]), entry("previews", "lastSlide", ["End"]),
  entry("navigation", "nextControl", ["Tab"]), entry("navigation", "previousControl", ["Shift-Tab"]),
  entry("navigation", "activate", ["Enter", "Space"]), entry("navigation", "dismiss", ["Escape"]),
  entry("navigation", "menuNext", ["ArrowDown"]), entry("navigation", "menuPrevious", ["ArrowUp"]),
];
export function shortcutKeys(shortcut: KeyboardShortcut, platform: ShortcutPlatform): readonly string[] {
  if (platform === "mac" && shortcut.mac) return shortcut.mac;
  if (platform === "linux" && shortcut.linux) return shortcut.linux;
  return shortcut.keys;
}
export function shortcutKeycaps(key: string, platform: ShortcutPlatform): readonly string[] {
  const tokens = key.split("-").filter(Boolean);
  if (key.endsWith("--")) tokens.push("-");
  const symbols: Readonly<Record<string, string>> = {
    Mod: platform === "mac" ? "⌘" : "Ctrl", Ctrl: "Ctrl", Alt: platform === "mac" ? "⌥" : "Alt",
    Shift: platform === "mac" ? "⇧" : "Shift", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc",
  };
  return tokens.map(token => symbols[token] ?? (token.length === 1 ? token.toUpperCase() : token));
}
