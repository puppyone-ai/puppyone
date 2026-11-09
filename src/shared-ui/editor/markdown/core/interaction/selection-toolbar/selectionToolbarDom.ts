import type { EditorView } from "@codemirror/view";
import { getMarkdownMessage, getMarkdownLocalization } from "../../editor/markdownLocalization";
import { INLINE_ACTIONS, BLOCK_ACTIONS, selectionBlockType, selectionFormatActive, applySelectionToolbarCommand, canFormatInlineSelection } from "./selectionToolbarModel";

const ICONS: Record<string, string[]> = {
  strong: ["M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8"],
  emphasis: ["M19 4h-9M14 20H5M15 4 9 20"],
  underline: ["M6 3v7a6 6 0 0 0 12 0V3M4 21h16"],
  strike: ["M17 5c-1-1-3-2-5-2-3 0-5 2-5 4 0 2 2 3 5 4M4 12h16M7 18c1 2 3 3 5 3 3 0 5-2 5-4 0-1-.4-2-1-2.5"],
  inlineCode: ["m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"],
  highlight: ["m9 11 6 6M6 14l4-4 8-8 4 4-8 8-4 4-4-4Zm0 0-3 3v3h3l4-4M3 22h7"],
  link: ["M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"],
  clearFormat: ["m9 15 6 6M5 17l-2-2a2 2 0 0 1 0-3l8-9a2 2 0 0 1 3 0l7 6a2 2 0 0 1 0 3l-8 9H9l-4-4ZM13 21h8"],
};
function icon(doc: Document, paths: string[]) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
  for (const d of paths) { const path = doc.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", d); svg.append(path); }
  return svg;
}
export function createSelectionToolbarDom(view: EditorView) {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div"); dom.className = "cm-md-selection-toolbar";
  dom.setAttribute("role", "toolbar"); dom.hidden = true;
  const block = doc.createElement("select"); block.className = "cm-md-selection-toolbar__block";
  for (const id of BLOCK_ACTIONS) { const option = doc.createElement("option"); option.value = id; block.append(option); }
  block.addEventListener("change", () => applySelectionToolbarCommand(view, block.value));
  dom.append(block);
  const separator = doc.createElement("span"); separator.className = "cm-md-selection-toolbar__divider"; separator.setAttribute("aria-hidden", "true"); dom.append(separator);
  for (const id of INLINE_ACTIONS) {
    const button = doc.createElement("button"); button.type = "button"; button.dataset.markdownCommand = id;
    button.append(icon(doc, ICONS[id]));
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => applySelectionToolbarCommand(view, id));
    dom.append(button);
  }
  dom.addEventListener("keydown", event => {
    if (!(event.target instanceof HTMLButtonElement) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(dom.querySelectorAll<HTMLElement>("select, button"));
    const index = controls.indexOf(event.target);
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    let next = (index + offset + controls.length) % controls.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = controls.length - 1;
    event.preventDefault(); controls[next].focus();
  });
  const update = () => {
    const label = getMarkdownMessage(view, "editor.selectionToolbar.label");
    dom.setAttribute("aria-label", label); dom.dir = getMarkdownLocalization(view).direction;
    block.setAttribute("aria-label", getMarkdownMessage(view, "editor.shortcuts.paragraph"));
    for (const option of Array.from(block.options)) option.text = getMarkdownMessage(view, `editor.shortcuts.${option.value}`);
    block.value = selectionBlockType(view.state);
    const inline = canFormatInlineSelection(view.state);
    for (const button of dom.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = !inline;
      const id = button.dataset.markdownCommand!;
      const text = getMarkdownMessage(view, id === "highlight" ? "editor.selectionToolbar.highlight" : `editor.shortcuts.${id}`);
      button.setAttribute("aria-label", text); button.title = text;
      if (id !== "link" && id !== "clearFormat") button.setAttribute("aria-pressed", String(inline && selectionFormatActive(view.state, id)));
    }
  };
  return { dom, update };
}
