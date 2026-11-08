/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { DocumentDropTargetProvider, createDocumentDropRegistry } from "@puppyone/shared-ui";
import { withTestLocalization } from "../../../../../support/react/localization";
import { MarkdownCodeMirrorEditor } from "../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mount(readOnly: boolean) {
  const registry = createDocumentDropRegistry();
  await act(async () => root.render(withTestLocalization(
    <DocumentDropTargetProvider registry={registry}>
      <MarkdownCodeMirrorEditor
        value={"# Title\n\nbody\n"}
        readOnly={readOnly}
        livePreview={false}
        documentPath="notes/a.md"
      />
    </DocumentDropTargetProvider>,
  )));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const scroller = host.querySelector<HTMLElement>(".cm-scroller");
  scroller!.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
  const view = EditorView.findFromDOM(host.querySelector(".cm-content")!)!;
  vi.spyOn(view, "documentTop", "get").mockReturnValue(0);
  return { registry, scroller: scroller! };
}

describe("Markdown editor document drop target", () => {
  it("claims points inside the content and inserts a relative image", async () => {
    const { registry } = await mount(false);
    const target = registry.find(300, 200);
    expect(target).not.toBeNull();
    expect(registry.find(700, 200)).toBeNull();

    let claimed = false;
    await act(async () => {
      claimed = await target!.prepareInsert({ x: 300, y: 200 })({
        kind: "workspace-entry",
        path: "assets/p.png",
        name: "p.png",
      });
    });
    expect(claimed).toBe(true);
    expect(host.querySelector(".cm-content")?.textContent).toContain("![p](../assets/p.png)");
  });

  it("does not claim non-image payloads", async () => {
    const { registry } = await mount(false);
    const target = registry.find(300, 200)!;
    let claimed = true;
    await act(async () => {
      claimed = await target.prepareInsert({ x: 300, y: 200 })({
        kind: "workspace-entry",
        path: "assets/data.pdf",
        name: "data.pdf",
      });
    });
    expect(claimed).toBe(false);
  });

  it("registers nothing for a read-only document", async () => {
    const { registry } = await mount(true);
    expect(registry.find(300, 200)).toBeNull();
  });
});
