import { Prec, type Extension } from "@codemirror/state";
import { ViewPlugin, keymap } from "@codemirror/view";
import { moveMarkdownBlock } from "../../core/commands/markdownBlockMove";
import { BlockDragController } from "./blockDragController";

// One stable value: reconfiguring a Compartment with it keeps the live plugin.
const blockDragExtension: Extension = [
  Prec.high(keymap.of([
    { key: "Mod-Shift-ArrowUp", run: (view) => moveMarkdownBlock(view, "up") },
    { key: "Mod-Shift-ArrowDown", run: (view) => moveMarkdownBlock(view, "down") },
  ])),
  ViewPlugin.fromClass(BlockDragController),
];

export function markdownBlockDragExtension(): Extension {
  return blockDragExtension;
}
