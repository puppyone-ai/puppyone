/** @vitest-environment happy-dom */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewCoreExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewContextExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { createMarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren(); });

function mount(source: string) {
  const context = new Compartment();
  const graph = (paths: string[], revision: number) => markdownLivePreviewContextExtension(
    "safe", createMarkdownLinkGraph(paths.map((path) => ({ path, name: path })), undefined, revision), "note.md", null,
  );
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")), state: EditorState.create({
    doc: source,
    extensions: [...markdownCodeMirrorBaseExtensions(false, "openknowledge-mdx"), context.of(graph([], 1)), markdownLivePreviewCoreExtension("openknowledge-mdx")],
  }) });
  views.push(view);
  view.focus();
  view.dispatch({ selection: { anchor: 0, head: source.length } });
  return { view, refresh: () => view.dispatch({ effects: context.reconfigure(graph(["target.md"], 2)) }) };
}

describe("Markdown whole-widget selection feedback", () => {
  it.each([
    ["Tabs", '<Tabs>\n<Tab label="First">\n[[target]]\n</Tab>\n</Tabs>', ".cm-md-mdx-tabs-widget"],
    ["video", "![[clip.mp4]]", ".cm-md-video-widget"],
  ])("marks a fully selected %s and clears it for a caret", async (_kind, source, selector) => {
    const { view } = mount(source);
    await vi.waitFor(() => expect(view.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(true));
    view.dispatch({ selection: { anchor: source.length } });
    await vi.waitFor(() => expect(view.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(false));
  });

  it("reapplies the covering selection when an index refresh replaces a table", async () => {
    const source = "| Name | Link |\n| --- | --- |\n| one | [[target]] |";
    const { view, refresh } = mount(source);
    const selector = ".cm-md-table-widget-wrap";
    await vi.waitFor(() => expect(view.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(true));
    const previous = view.dom.querySelector(selector);
    refresh();
    expect(view.dom.querySelector(selector)).not.toBe(previous);
    await vi.waitFor(() => expect(view.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(true));
    expect(view.state.selection.main).toMatchObject({ anchor: 0, head: source.length });
  });

  it("does not treat a sibling editor's widget focus as its own", async () => {
    const table = "| Name | Value |\n| --- | --- |\n| one | two |";
    const { view: left } = mount(table);
    const selector = ".cm-md-table-widget-wrap";
    await vi.waitFor(() => expect(left.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(true));
    const { view: right } = mount("![image](missing.png)");
    right.dom.querySelector<HTMLElement>(".cm-md-image-widget")!.focus();
    await vi.waitFor(() => expect(left.dom.querySelector(selector)?.classList.contains("is-doc-selected")).toBe(false));
    expect(left.state.selection.main).toMatchObject({ from: 0, to: table.length });
  });
});
