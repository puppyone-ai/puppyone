/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withTestLocalization } from "../../../../../support/react/localization";
import { MarkdownViewer } from "../../../../../../src/shared-ui/editor/markdown/MarkdownViewer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  host.style.height = "600px";
  host.style.width = "960px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

function context(content: string) {
  return {
    document: { path: "notes/a.md", name: "a.md", type: "file" },
    content,
    canEdit: true,
    hideSourceView: false,
    editorInteractionPreferences: {
      markdownBlockDragEnabled: false,
      markdownHeadingOutlineEnabled: true,
    },
    aiEditFile: null,
    htmlTrustMode: "safe" as const,
    workspaceId: "w1",
    workspaceRoot: "/workspace",
    markdownEnvironment: undefined,
  };
}

const documentSource = [
  "# One",
  "",
  "## Two",
  "",
  "### Three",
  "",
  ...Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}.`),
].join("\n");

describe("Markdown viewer live outline", () => {
  it("renders the outline of a real editor document", async () => {
    await act(async () => root.render(withTestLocalization(
      <MarkdownViewer {...context(documentSource)} />,
    )));
    await settle();

    const panel = host.querySelector("nav.po-markdown-outline-panel");
    expect(panel).not.toBeNull();
    const items = [...host.querySelectorAll<HTMLButtonElement>(".po-markdown-outline-item")];
    expect(items.map((item) => item.textContent)).toEqual(["One", "Two", "Three"]);
    expect(items[0].getAttribute("aria-current")).toBe("location");
  });

  it("hides the panel when the document has a single heading", async () => {
    await act(async () => root.render(withTestLocalization(
      <MarkdownViewer {...context("# Only\n\nbody\n")} />,
    )));
    await settle();
    expect(host.querySelector("nav.po-markdown-outline-panel")).toBeNull();
    expect(host.querySelector(".markdown-viewer-shell")).not.toBeNull();
  });
});
