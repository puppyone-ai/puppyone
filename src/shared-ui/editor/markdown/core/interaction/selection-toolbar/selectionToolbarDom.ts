import { HIGHLIGHT_COLORS, canHighlightSelection, applySelectionHighlight, selectionHighlightColor, type HighlightColor } from "./selectionHighlight";
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
};
function icon(doc: Document, paths: string[]) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
  for (const d of paths) { const path = doc.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", d); svg.append(path); }
  return svg;
}
function blockIcon(doc: Document, type: string) {
  const paths: Record<string, string[]> = {
    paragraph: ["M13 4H9a5 5 0 0 0 0 10h4M13 4v17M18 4v17M10 4h11"],
    quote: ["M3 4h7v8H7c0 4-2 6-4 7M14 4h7v8h-3c0 4-2 6-4 7"],
    bulletList: ["M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"],
    orderedList: ["M10 5h11M10 12h11M10 19h11M3 3h1v6M2 14c0-3 5-3 5 0 0 2-5 3-5 6h5"],
    taskList: ["m2 5 2 2 3-4M10 5h11m-19 7 2 2 3-4M10 12h11m-19 7 2 2 3-4M10 19h11"],
  };
  if (paths[type]) return icon(doc, paths[type]);
  const svg = icon(doc, ["M3 5v14M13 5v14M3 12h10"]);
  const number = doc.createElementNS(svg.namespaceURI, "text");
  for (const [name, value] of Object.entries({ x: "16", y: "20", fill: "currentColor", stroke: "none", "font-size": "12", "font-family": "system-ui" })) number.setAttribute(name, value);
  number.textContent = type.slice(-1); svg.append(number); return svg;
}
export function createSelectionToolbarDom(view: EditorView, layoutChanged: () => void) {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div"); dom.className = "cm-md-selection-toolbar";
  dom.setAttribute("role", "toolbar"); dom.hidden = true;
  const row = doc.createElement("div"); row.className = "cm-md-selection-toolbar__row"; dom.append(row);
  const panel = doc.createElement("div"); panel.className = "cm-md-selection-toolbar__menu";
  panel.setAttribute("role", "menu"); panel.hidden = true; dom.append(panel);
  let openMenu: "block" | "highlight" | null = null;
  let menuTrigger: HTMLButtonElement | null = null;
  const closeMenu = (focus = false) => {
    if (!openMenu) return false;
    openMenu = null; panel.hidden = true; menuTrigger?.setAttribute("aria-expanded", "false");
    if (focus) menuTrigger?.focus();
    layoutChanged(); return true;
  };
  const button = () => {
    const control = doc.createElement("button"); control.type = "button";
    control.addEventListener("mousedown", event => event.preventDefault());
    return control;
  };
  const label = (control: HTMLElement, text: string) => { control.setAttribute("aria-label", text); control.title = text; };
  const toggleMenu = (kind: "block" | "highlight", trigger: HTMLButtonElement) => {
    if (openMenu === kind) { closeMenu(true); return; }
    closeMenu(); openMenu = kind; menuTrigger = trigger; trigger.setAttribute("aria-expanded", "true");
    panel.replaceChildren(); panel.hidden = false; panel.dataset.menu = kind;
    label(panel, trigger.getAttribute("aria-label")!);
    const choices = kind === "block" ? BLOCK_ACTIONS : [...Object.keys(HIGHLIGHT_COLORS), "none"];
    for (const id of choices) {
      const item = button(); item.setAttribute("role", "menuitemradio");
      const text = getMarkdownMessage(view, kind === "block" ? `editor.shortcuts.${id}` : `editor.selectionToolbar.colors.${id}`);
      label(item, text);
      const caption = doc.createElement("span"); caption.textContent = text; caption.className = "cm-md-selection-toolbar__caption"; item.append(caption);
      if (kind === "block") {
        item.prepend(blockIcon(doc, id));
        item.dataset.blockType = id; item.setAttribute("aria-checked", String(selectionBlockType(view.state) === id));
      } else {
        item.dataset.highlightColor = id; item.setAttribute("aria-checked", String((selectionHighlightColor(view.state) ?? "none") === id));
        if (id !== "none") {
          const swatch = doc.createElement("span"); swatch.className = "cm-md-selection-toolbar__swatch";
          swatch.style.backgroundColor = HIGHLIGHT_COLORS[id as HighlightColor]; swatch.setAttribute("aria-hidden", "true"); item.prepend(swatch);
        }
      }
      const check = icon(doc, ["m5 12 4 4L19 6"]); check.classList.add("cm-md-selection-toolbar__check"); item.append(check);
      item.addEventListener("click", () => {
        closeMenu();
        if (kind === "block") applySelectionToolbarCommand(view, id);
        else applySelectionHighlight(view, id as HighlightColor | "none");
      });
      panel.append(item);
    }
    panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    if (!panel.contains(doc.activeElement)) panel.querySelector<HTMLElement>("button")?.focus();
    layoutChanged();
  };
  const block = button(); block.className = "cm-md-selection-toolbar__block"; block.dataset.toolbarMenu = "block";
  block.setAttribute("aria-haspopup", "menu"); block.setAttribute("aria-expanded", "false");
  block.addEventListener("click", () => toggleMenu("block", block)); row.append(block);
  const separator = doc.createElement("span"); separator.className = "cm-md-selection-toolbar__divider"; separator.setAttribute("aria-hidden", "true"); row.append(separator);
  for (const id of INLINE_ACTIONS) {
    const control = button(); control.dataset.markdownCommand = id; control.append(icon(doc, ICONS[id]));
    if (id === "highlight") { control.setAttribute("aria-haspopup", "menu"); control.setAttribute("aria-expanded", "false"); }
    control.addEventListener("click", () => {
      if (id === "highlight") toggleMenu("highlight", control);
      else { closeMenu(); applySelectionToolbarCommand(view, id); }
    }); row.append(control);
  }
  dom.addEventListener("keydown", event => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const inMenu = panel.contains(event.target);
    const keys = inMenu ? ["ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const controls = Array.from((inMenu ? panel : row).querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = controls.indexOf(event.target);
    const offset = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    let next = (index + offset + controls.length) % controls.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = controls.length - 1;
    event.preventDefault(); controls[next]?.focus();
  });
  const update = () => {
    label(dom, getMarkdownMessage(view, "editor.selectionToolbar.label")); dom.dir = getMarkdownLocalization(view).direction;
    const blockText = getMarkdownMessage(view, `editor.shortcuts.${selectionBlockType(view.state)}`);
    label(block, blockText); block.replaceChildren(blockIcon(doc, selectionBlockType(view.state)));
    const caption = doc.createElement("span"); caption.textContent = blockText; block.append(caption, icon(doc, ["m6 9 6 6 6-6"]));
    const inline = canFormatInlineSelection(view.state);
    for (const control of row.querySelectorAll<HTMLButtonElement>("[data-markdown-command]")) {
      const id = control.dataset.markdownCommand!;
      control.disabled = !inline || (id === "highlight" && !canHighlightSelection(view.state));
      label(control, getMarkdownMessage(view, id === "highlight" ? "editor.selectionToolbar.highlight" : `editor.shortcuts.${id}`));
      if (id !== "link") control.setAttribute("aria-pressed", String(inline && (id === "highlight" ? selectionHighlightColor(view.state) !== null : selectionFormatActive(view.state, id))));
    }
  };
  return { dom, update, closeMenu };
}
