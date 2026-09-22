/** @vitest-environment happy-dom */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownLinkGraph, type MarkdownLinkGraphDocument } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";
import { markdownLivePreviewContextExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewCoreExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren(); });

describe("Markdown workspace projection continuity", () => {
  for (const kind of ["table", "tabs"] as const) {
    it(`retains ${kind} DOM on unrelated folder loads and refreshes changed wiki targets`, () => {
      const source = kind === "table"
        ? "| Name | Value |\n| --- | --- |\n| one | [[target]] |"
        : '<Tabs>\n<Tab label="First">\n[[target]]\n</Tab>\n<Tab label="Second">\nOther content\n</Tab>\n</Tabs>';
      const selector = kind === "table" ? ".cm-md-table-widget" : ".cm-md-mdx-tabs-widget";
      const context = new Compartment();
      let revision = 1;
      const makeContext = (documents: MarkdownLinkGraphDocument[]) => markdownLivePreviewContextExtension(
        "safe", createMarkdownLinkGraph(documents, undefined, revision++), "note.md", null,
      );
      const parent = document.body.appendChild(document.createElement("div"));
      const view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: [
        ...markdownCodeMirrorBaseExtensions(false, "openknowledge-mdx"),
        context.of(makeContext([])), markdownLivePreviewCoreExtension("openknowledge-mdx"),
      ] }) });
      views.push(view);
      const original = view.dom.querySelector(selector);
      expect(original).not.toBeNull();
      expect(original!.querySelector(".is-missing")).not.toBeNull();
      const unrelated = { path: "folder/unrelated.md", name: "unrelated.md" };
      view.dispatch({ effects: context.reconfigure(makeContext([unrelated])) });
      expect(view.dom.querySelector(selector)).toBe(original);
      const target = { path: "folder/target.md", name: "target.md" };
      view.dispatch({ effects: context.reconfigure(makeContext([unrelated, target])) });
      const resolved = view.dom.querySelector(selector);
      expect(resolved).not.toBe(original);
      expect(resolved!.querySelector(".is-missing")).toBeNull();
      expect(resolved!.querySelector(".is-resolved")).not.toBeNull();
      view.dispatch({ effects: context.reconfigure(makeContext([unrelated, target, { path: "elsewhere.md", name: "elsewhere.md" }])) });
      expect(view.dom.querySelector(selector)).toBe(resolved);
      view.dispatch({ effects: context.reconfigure(makeContext([unrelated])) });
      expect(view.dom.querySelector(`${selector} .is-missing`)).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    });
  }
});
