/** @vitest-environment happy-dom */
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySelectionToolbarCommand, canFormatSelection, placeSelectionToolbar } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/selection-toolbar/selectionToolbarModel";
import { getInlineFormatCoverage, getMarkdownElements } from "../../../../../../src/shared-ui/editor/markdown/core/syntax/markdownElements";
import { applySelectionHighlight, selectionHighlightColor } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/selection-toolbar/selectionHighlight";
import { markdownLocalizationFacet } from "../../../../../../src/shared-ui/editor/markdown/core/editor/markdownLocalization";
import type { AppLocale } from "@puppyone/localization/core";
import { markdownCodeMirrorBaseExtensions } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) { const host = view.dom.parentElement; view.destroy(); host?.remove(); } });
function editor(doc = "选中文字之后可以设置格式", readOnly = false) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView({ parent: host, state: EditorState.create({ doc,
    extensions: [markdownCodeMirrorBaseExtensions(readOnly), EditorState.readOnly.of(readOnly)] }) });
  views.push(view); vi.spyOn(view, "focus").mockImplementation(() => undefined);
  view.dispatch({ selection: EditorSelection.range(0, 4) });
  return view;
}
function action(view: EditorView, id: string) {
  const button = view.dom.querySelector<HTMLButtonElement>(`[data-markdown-command="${id}"]`);
  expect(button, `selection toolbar command ${id}`).not.toBeNull();
  button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button!.click();
}
describe("Markdown selection formatting toolbar", () => {
  it("opens an editor-owned block menu and converts the retained selection", () => {
    const view = editor("hello world");
    const trigger = view.dom.querySelector<HTMLButtonElement>('[data-toolbar-menu="block"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    const heading = view.dom.querySelector<HTMLButtonElement>('[data-block-type="heading2"]');
    expect(heading?.closest<HTMLElement>('[role="menu"]')?.hidden).toBe(false);
    heading!.click();
    expect(view.state.doc.toString()).toBe("## hello world");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("hell");
  });
  it("removes the clear-format toolbar button", () => {
    expect(editor().dom.querySelector('[data-markdown-command="clearFormat"]')).toBeNull();
  });
  it("persists highlight colors, replaces them, removes them, and undoes each operation", () => {
    const view = editor("hello world");
    action(view, "highlight");
    view.dom.querySelector<HTMLButtonElement>('[data-highlight-color="yellow"]')!.click();
    const yellow = view.state.doc.toString();
    expect(yellow).toContain('<mark style="background-color: #fff2a8; color: #202124">hell</mark>o world');
    action(view, "highlight");
    view.dom.querySelector<HTMLButtonElement>('[data-highlight-color="pink"]')!.click();
    expect(view.state.doc.toString()).toContain('background-color: #ffd6e7');
    expect(view.state.doc.toString().match(/<mark/g)).toHaveLength(1);
    action(view, "highlight");
    view.dom.querySelector<HTMLButtonElement>('[data-highlight-color="none"]')!.click();
    expect(view.state.doc.toString()).toBe("hello world");
    undo(view); expect(view.state.doc.toString()).toContain('#ffd6e7');
    undo(view); expect(view.state.doc.toString()).toBe(yellow);
    undo(view); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("changes only the selected part of an existing highlight and preserves formatting", () => {
    const view = editor("==one **two** three==");
    view.dispatch({ selection: EditorSelection.range(6, 13) });
    expect(applySelectionHighlight(view, "blue")).toBe(true);
    expect(view.state.doc.toString()).toBe('<mark>one </mark><mark style="background-color: #cbe6ff; color: #202124">**two**</mark><mark> three</mark>');
    expect(selectionHighlightColor(view.state)).toBe("blue");
    undo(view); expect(view.state.doc.toString()).toBe("==one **two** three==");
  });
  it("removes only the selected legacy highlight without leaving a nested highlight", () => {
    const view = editor("==one two three=="); view.dispatch({ selection: EditorSelection.range(6, 9) });
    applySelectionHighlight(view, "none");
    const doc = view.state.doc.toString(), from = doc.indexOf("two");
    expect(getInlineFormatCoverage(view.state, from, from + 3, "highlight").formats).toHaveLength(0);
    for (const text of ["one", "three"]) {
      const start = doc.indexOf(text); expect(getInlineFormatCoverage(view.state, start, start + text.length, "highlight").formats).toHaveLength(1);
    }
  });
  it.each([
    ["<u>one two</u> three", "two", "three"],
    ["one <strong>two three</strong>", "one", "two"],
    ["<u>one two</u> three <em>four five</em>", "two", "four"],
  ])("keeps HTML nesting balanced across formatting boundaries in %s", (source, first, last) => {
    const view = editor(source);
    view.dispatch({ selection: EditorSelection.range(source.indexOf(first), source.indexOf(last) + last.length) });
    expect(applySelectionHighlight(view, "green")).toBe(true);
    const elements = getMarkdownElements(view.state).filter(element => element.kind === "inlineHtml");
    expect(elements.length).toBeGreaterThan(1);
    expect(selectionHighlightColor(view.state)).toBe("green");
    for (const element of elements) expect(element.inlineHtml?.status).toBe("complete");
    undo(view); expect(view.state.doc.toString()).toBe(source);
  });
  it.each(["==**one two three**==", "<mark><u>one two three</u></mark>"])("retains surrounding formatting while removing the middle of %s", source => {
    const view = editor(source), from = source.indexOf("two");
    view.dispatch({ selection: EditorSelection.range(from, from + 3) });
    applySelectionHighlight(view, "none");
    const doc = view.state.doc.toString(), start = doc.indexOf("two");
    expect(getInlineFormatCoverage(view.state, start, start + 3, "highlight").formats).toHaveLength(0);
    expect(getInlineFormatCoverage(view.state, start, start + 3, source.includes("**") ? "strong" : "underline").formats).toHaveLength(1);
    for (const element of getMarkdownElements(view.state).filter(element => element.kind === "inlineHtml")) expect(element.inlineHtml?.status).toBe("complete");
    undo(view); expect(view.state.doc.toString()).toBe(source);
  });
  it.each([[0, 10], [7, 14]])("keeps source selections at HTML marker boundaries balanced (%s, %s)", (from, to) => {
    const view = editor("<u>one two</u> three"); view.dispatch({ selection: EditorSelection.range(from, to) });
    expect(applySelectionHighlight(view, "purple")).toBe(true);
    for (const element of getMarkdownElements(view.state).filter(element => element.kind === "inlineHtml")) expect(element.inlineHtml?.status).toBe("complete");
  });
  it("does not insert HTML inside inline code or a partial HTML marker", () => {
    for (const [source, from, to] of [["`hello`", 1, 6], ["<u>hello</u>", 1, 6]] as const) {
      const view = editor(source); view.dispatch({ selection: EditorSelection.range(from, to) });
      expect(applySelectionHighlight(view, "pink")).toBe(false); expect(view.state.doc.toString()).toBe(source);
    }
  });
  it("renders saved mark colors after reopening and can remove them", () => {
    const source = '<mark style="background-color: #ffd6e7; color: #202124">hello</mark> world';
    const view = editor(source); const from = source.indexOf("hello");
    view.dispatch({ selection: EditorSelection.range(from, from + 5) });
    expect(selectionHighlightColor(view.state)).toBe("pink");
    applySelectionHighlight(view, "none"); expect(view.state.doc.toString()).toBe("hello world");
    undo(view); expect(view.state.doc.toString()).toBe(source);
  });
  it("does not change highlights in read-only or cross-paragraph selections", () => {
    expect(applySelectionHighlight(editor("hello", true), "yellow")).toBe(false);
    const view = editor("one\n\ntwo"); view.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(applySelectionHighlight(view, "yellow")).toBe(false);
  });
  it("updates visible menus and tooltips in every supported application language", async () => {
    const view = editor("hello world");
    const catalogs = import.meta.glob<Record<string, string>>("../../../../../../locales/renderer/*/editor.json", { import: "default" });
    expect(Object.keys(catalogs)).toHaveLength(8);
    for (const [path, load] of Object.entries(catalogs)) {
      const messages = await load();
      view.dispatch({ effects: StateEffect.appendConfig.of(markdownLocalizationFacet.of({ locale: path.split("/").at(-2) as AppLocale,
        direction: "ltr", formatNumber: String, t: id => messages[id.replace(/^editor\./, "")] ?? id })) });
      expect(view.dom.querySelector('[data-toolbar-menu="block"]')?.textContent).toBe(messages["shortcuts.paragraph"]);
      action(view, "highlight");
      expect(view.dom.querySelector('[data-highlight-color="yellow"]')?.textContent).toBe(messages["selectionToolbar.colors.yellow"]);
      expect(view.dom.querySelector('[data-markdown-command="strong"]')?.getAttribute("title")).toBe(messages["shortcuts.strong"]);
    }
  });
  it("formats the retained selection and supports undo", () => {
    const view = editor(); const before = view.state.doc.toString();
    action(view, "strong");
    expect(view.state.doc.toString()).toBe("**选中文字**之后可以设置格式");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("选中文字");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(before);
  });
  it("toggles an existing inline format without adding another wrapper", () => {
    const view = editor("**hello** world");
    view.dispatch({ selection: EditorSelection.range(2, 7) });
    action(view, "strong"); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("keeps successive format actions as separate undo steps", () => {
    const view = editor("hello world"); view.dispatch({ selection: EditorSelection.range(0, 5) });
    action(view, "strong"); action(view, "emphasis");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("**hello** world");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("highlights and clears selected text using canonical Markdown", () => {
    const view = editor("hello world"); view.dispatch({ selection: EditorSelection.range(0, 5) });
    applySelectionToolbarCommand(view, "highlight"); expect(view.state.doc.toString()).toBe("==hello== world");
    applySelectionToolbarCommand(view, "clearFormat"); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("converts a list item into a heading atomically", () => {
    const view = editor("- hello\n- world"); view.dispatch({ selection: EditorSelection.range(2, 7) });
    expect(applySelectionToolbarCommand(view, "heading2")).toBe(true);
    expect(view.state.doc.toString()).toBe("## hello\n- world");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("hello");
    undo(view); expect(view.state.doc.toString()).toBe("- hello\n- world");
  });
  it.each(["```js\nhello\n```", "---\ntitle: hello\n---", "| hello | world |\n| --- | --- |\n| one | two |"])("leaves non-prose content untouched: %s", doc => {
    const view = editor(doc); const start = doc.indexOf("hello");
    view.dispatch({ selection: EditorSelection.range(start, start + 5) });
    expect(canFormatSelection(view.state)).toBe(false);
    expect(applySelectionToolbarCommand(view, "strong")).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("does not convert the next code fence when selection ends at its line start", () => {
    const view = editor("hello\n```js\nconst x = 1;\n```");
    view.dispatch({ selection: EditorSelection.range(0, 6) });
    expect(applySelectionToolbarCommand(view, "heading2")).toBe(true);
    expect(view.state.doc.toString()).toBe("## hello\n```js\nconst x = 1;\n```");
  });
  it.each([["# [x] Title", "paragraph", "[x] Title"], ["> [x] note", "heading2", "## [x] note"], ["> - nested", "paragraph", "nested"]])("preserves literal text while converting %s", (doc, type, expected) => {
    const view = editor(doc); view.dispatch({ selection: EditorSelection.range(0, doc.length) });
    expect(applySelectionToolbarCommand(view, type)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });
  it("does not insert invalid inline markers across separate paragraphs", () => {
    const view = editor("one\n\ntwo"); view.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(applySelectionToolbarCommand(view, "strong")).toBe(false);
    expect(view.state.doc.toString()).toBe("one\n\ntwo");
    expect(applySelectionToolbarCommand(view, "bulletList")).toBe(true);
  });
  it.each([["Title\n====", "heading2", "## Title"], ["Title\n----", "quote", "> Title"], ["## Title ##", "paragraph", "Title"]])("normalizes structural heading markers in %s", (doc, type, expected) => {
    const view = editor(doc); const from = doc.indexOf("Title"); view.dispatch({ selection: EditorSelection.range(from, from + 5) });
    expect(applySelectionToolbarCommand(view, type)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    undo(view); expect(view.state.doc.toString()).toBe(doc);
  });
  it("does not show for a caret or multiple selections", () => {
    const view = editor(); view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(canFormatSelection(view.state)).toBe(false);
    const state = EditorState.create({ doc: "hello world", extensions: EditorState.allowMultipleSelections.of(true),
      selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(7, 9)]) });
    expect(canFormatSelection(state)).toBe(false);
  });
  it("places controls below top-edge selections and inside a narrow pane", () => {
    const pane = { left: 100, right: 400, top: 80, bottom: 500 };
    const result = placeSelectionToolbar({ left: 110, right: 140, top: 90, bottom: 110 }, pane, 280, 42);
    expect(result).toEqual({ left: 106, top: 118 });
    expect(result.left + 280).toBeLessThan(pane.right);
  });
  it("does not modify a read-only document through toolbar actions", () => {
    const view = editor("read only", true);
    view.dom.querySelector<HTMLButtonElement>('[data-markdown-command="strong"]')?.click();
    expect(view.state.doc.toString()).toBe("read only");
  });
});
