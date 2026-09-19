import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewCoreExtension } from "../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewContextExtension } from "../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { createMarkdownLinkGraph } from "../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";
import { markdownLivePreviewDecorations } from "../../../../../packages/shared-ui/src/editor/markdown/core/projection/markdownDocumentProjection";
import { markdownPointerSelectionField } from "../../../../../packages/shared-ui/src/editor/markdown/core/state/pointerSelection";
import "@puppyone/shared-ui/shared-ui.css";

const style = document.createElement("style");
style.textContent = `
  :root { --po-font-content: Arial, sans-serif; --po-font-mono: monospace; --po-font-sans: Arial, sans-serif; --po-text: #222; --po-editor-bg: white; --po-type-editor-content: 15px; }
  body { margin: 0; }
  #editor { width: 540px; height: 620px; }
`;
document.head.appendChild(style);
const context = new Compartment();
let revision = 1;
const openedUrls: string[] = [];
const linkCommands = { openExternalUrl: (href: string) => { openedUrls.push(href); } };
function makeContext() {
  const documents = [{ path: `folder/loaded-${revision}.md`, name: `loaded-${revision}.md` }];
  return markdownLivePreviewContextExtension("safe", createMarkdownLinkGraph(documents, undefined, revision), "note.md", null, "test", null, linkCommands);
}
const source = [
  "# Selection stability",
  "",
  "Prefix **abcdefghijklmno** suffix 中文字符保持稳定。",
  "",
  "Earlier [long editable label](missing/" + "very-long-path/".repeat(30) + "note.md) after link.",
  "",
  "Target paragraph abcdefghijklmnopqrstuvwxyz 中文反向单字选中。",
  "",
  ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ordinary text to exercise scroll continuity.`),
].join("\n");
const view = new EditorView({
  parent: document.querySelector<HTMLElement>("#editor")!,
  state: EditorState.create({ doc: source, extensions: [
    ...markdownCodeMirrorBaseExtensions(false),
    context.of(makeContext()),
    markdownLivePreviewCoreExtension(),
  ] }),
});
const fixture = {
  view,
  source,
  openedUrls,
  refreshLinks() { revision += 1; view.dispatch({ effects: context.reconfigure(makeContext()) }); },
  snapshot() {
    const selection = view.state.selection.main;
    return { anchor: selection.anchor, head: selection.head, text: view.state.sliceDoc(selection.from, selection.to), scrollTop: view.scrollDOM.scrollTop, selecting: view.state.field(markdownPointerSelectionField), reveal: view.state.field(markdownLivePreviewDecorations).revealRange, hasFocus: view.hasFocus, sourceUnchanged: view.state.doc.toString() === source };
  },
};
document.querySelector("#folder")!.addEventListener("click", () => fixture.refreshLinks());
Object.assign(window, { markdownSelectionFixture: fixture });
