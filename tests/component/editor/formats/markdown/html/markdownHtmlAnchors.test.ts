/** @vitest-environment happy-dom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { openMarkdownHref } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { getMarkdownFragmentPosition } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownFragmentTargets";
import { renderMarkdownInlineFromSharedPolicy } from "../../../../../../packages/shared-ui/src/editor/markdown/composition/preview/markdownInlinePlanAdapter";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach(view => view.destroy());
  document.body.replaceChildren();
});

function mount(source: string, readOnly = true, preview = true) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent, state: EditorState.create({
    doc: source,
    extensions: [
      ...markdownCodeMirrorBaseExtensions(readOnly),
      ...(preview ? [markdownLivePreviewExtension()] : []),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ],
  }) });
  views.push(view);
  return view;
}

describe("Markdown HTML anchor targets", () => {
  it.each(['<a id="section"></a>', '<a id=section></a>'])(
    "hides a valid empty anchor in preview without changing its source: %s", source => {
      const view = mount(`${source}\n\nBody`);
      expect(view.contentDOM.textContent).not.toContain("<a");
      expect(view.contentDOM.textContent).toContain("Body");
      expect(view.state.doc.toString()).toBe(`${source}\n\nBody`);
      const target = document.createElement("div");
      renderMarkdownInlineFromSharedPolicy(target, source);
      expect(target.textContent).toBe("");
      expect(target.querySelector("a")?.id).toBe("md-doc-section");
    },
  );

  it("preserves anchor source in source mode and reveals it for editing", async () => {
    const source = '<a id="section"></a>\n\nBody';
    expect(mount(source, false, false).contentDOM.textContent).toContain('<a id="section"></a>');
    const view = mount(source, false);
    expect(view.contentDOM.textContent).not.toContain("<a");
    view.focus();
    await new Promise(resolve => window.setTimeout(resolve, 20));
    view.dispatch({ selection: { anchor: 5 } });
    expect(view.contentDOM.textContent).toContain('<a id="section"></a>');
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each(['<a id=section><a>', '<a id=section>', '<a id=section href="javascript:alert(1)"></a>', '<span></span>'])(
    "keeps unsupported or incomplete source visible: %s", source => {
      const view = mount(`${source}\n\nBody`);
      expect(view.contentDOM.textContent).toContain(source);
      expect(openMarkdownHref("#section", view)).toBe(false);
    },
  );

  it("navigates to an explicit target without changing the caret or document", () => {
    const source = '[Section](#section)\n\n<a id="section"></a>\n\nBody';
    const view = mount(source);
    expect(view.dom.querySelector<HTMLElement>(".cm-md-link-label")?.dataset.mdLinkInteraction).toBe("navigate");
    const dispatch = vi.spyOn(view, "dispatch");
    expect(openMarkdownHref("#section", view)).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(view.state.selection.main.anchor).toBe(0);
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each([
    '`<a id="section"></a>`',
    '```html\n<a id="section"></a>\n```',
    '\\<a id="section"></a>',
  ])("does not turn literal code/examples into destinations: %s", source => {
    const view = mount(source);
    expect(getMarkdownFragmentPosition(view.state, "#section")).toBeNull();
    expect(view.contentDOM.textContent).toContain('<a id="section"></a>');
  });

  it("keeps targets local to each document and updates positions and IDs after edits", () => {
    const source = '<a id="section"></a>\n\nBody';
    const first = mount(source, false);
    const second = mount(`Other\n\n${source}`);
    expect(getMarkdownFragmentPosition(first.state, "#section")).toBe(0);
    expect(getMarkdownFragmentPosition(second.state, "#section")).toBe(7);
    first.dispatch({ changes: { from: 0, insert: "Before\n\n" } });
    expect(getMarkdownFragmentPosition(first.state, "#section")).toBe(8);
    const idStart = first.state.doc.toString().indexOf("section");
    first.dispatch({ changes: { from: idStart, to: idStart + 7, insert: "renamed" } });
    expect(getMarkdownFragmentPosition(first.state, "#section")).toBeNull();
    expect(getMarkdownFragmentPosition(first.state, "#renamed")).toBe(8);
    expect(getMarkdownFragmentPosition(second.state, "#section")).toBe(7);
  });

  it("resolves the first exact explicit ID before a generated heading slug", () => {
    const source = '# Section\n\n<a id="Section"></a>\n\n<a id="Section"></a>\n\n# Other';
    const view = mount(source);
    expect(getMarkdownFragmentPosition(view.state, "#%53ection")).toBe(source.indexOf("<a"));
    expect(getMarkdownFragmentPosition(view.state, "#section")).toBe(2);
    expect(getMarkdownFragmentPosition(view.state, "#other")).toBe(source.indexOf("Other"));
    expect(getMarkdownFragmentPosition(view.state, "#%ZZ")).toBeNull();
  });
});
