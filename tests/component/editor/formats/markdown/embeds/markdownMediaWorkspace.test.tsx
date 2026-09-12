/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort } from "../../../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../../../packages/shared-ui/src/data/DataWorkspace";
import { withTestLocalization } from "../../../../../support/react/localization";
import { CENTERED_README_DOCUMENT } from "../../../../../fixtures/editor/formats/markdown/centeredReadme";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Markdown workspace media integration", () => {
  it("hydrates the canonical README logo while keeping HTTPS badges out of the workspace resolver", async () => {
    const markdownPath = "README.md";
    const getFileUrl = vi.fn(async (path: string) => {
      if (path === "public/assets/brand/puppy/puppy-dark.svg") {
        return "puppyone-local://file/token/markdown-asset/root/public/assets/brand/puppy/puppy-dark.svg";
      }
      if (path === "public/assets/media/screenshots/puppyone-editor-overview.png") {
        return "puppyone-local://file/token/markdown-asset/root/public/assets/media/screenshots/puppyone-editor-overview.png";
      }
      return null;
    });
    const dataPort: DataPort = {
      listChildren: vi.fn(async () => [markdownNode(markdownPath)]),
      readFile: vi.fn(async (path: string) => ({
        path,
        name: markdownPath,
        type: "markdown",
        content: CENTERED_README_DOCUMENT,
        mimeType: "text/markdown",
        size: "2 KB",
        version: "v1",
      })),
      getFileUrl,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={{ id: "workspace", name: "puppyone", path: "/workspace", status: "recording" }}
          dataPort={dataPort}
          defaultActivePath={markdownPath}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
    });

    await waitFor(() => container.querySelector(".cm-md-html-rendered-surface") !== null);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    // The overview is below the initial CodeMirror viewport and is resolved
    // only when mounted. The header logo is visible immediately; remote badge
    // URLs must not be forwarded to the workspace filesystem capability.
    expect(getFileUrl.mock.calls).toEqual([
      ["public/assets/brand/puppy/puppy-dark.svg", { purpose: "markdown-asset" }],
    ]);
    expect(container.querySelector<HTMLImageElement>('.cm-md-html-rendered-surface img[alt="puppyone Logo"]')
      ?.getAttribute("src")).toBe(
        "puppyone-local://file/token/markdown-asset/root/public/assets/brand/puppy/puppy-dark.svg",
      );
    expect(container.querySelectorAll('.cm-md-html-rendered-surface img[src^="https://img.shields.io/"]'))
      .toHaveLength(4);
  });

  it("resolves a standard Markdown image relative to the active document", async () => {
    const markdownPath = "Puppyone — One Pager.md";
    const imagePath = "asserts/market-unbundling-chart.png";
    const getFileUrl = vi.fn(async () => "blob:https://app/market-unbundling-chart");
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: markdownPath,
      type: "markdown",
      content: [
        "<table><tr><td>Header</td></tr></table>",
        "",
        "## Market",
        "",
        `![market-unbundling](${imagePath})`,
      ].join("\n"),
      mimeType: "text/markdown",
      size: "1 KB",
      version: "v1",
    }));
    const dataPort: DataPort = {
      listChildren: vi.fn(async (folderPath) => {
        if (folderPath === "asserts") return [imageNode(imagePath)];
        return [markdownNode(markdownPath), folderNode()];
      }),
      readFile,
      getFileUrl,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={{ id: "workspace", name: "VC pitch", path: "/workspace", status: "recording" }}
          dataPort={dataPort}
          defaultActivePath={markdownPath}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
    });

    await waitFor(() => container.querySelector(".cm-md-image-widget img") !== null);

    expect(getFileUrl).toHaveBeenCalledWith(imagePath, { purpose: "markdown-asset" });
    expect(container.querySelector(".cm-md-image-widget")?.classList.contains("is-block"))
      .toBe(true);
    expect(container.querySelector(".cm-md-image-widget")?.getAttribute("data-display-mode"))
      .toBe("block");
    expect(container.querySelector<HTMLImageElement>(".cm-md-image-widget img")?.src)
      .toBe("blob:https://app/market-unbundling-chart");
  });
});

function markdownNode(path: string): DataNode {
  return {
    id: path,
    path,
    name: path,
    type: "markdown",
    mimeType: "text/markdown",
  };
}

function folderNode(): DataNode {
  return {
    id: "asserts",
    path: "asserts",
    name: "asserts",
    type: "folder",
  };
}

function imageNode(path: string): DataNode {
  return {
    id: path,
    path,
    name: "market-unbundling-chart.png",
    type: "image",
    mimeType: "image/png",
  };
}

async function waitFor(assertion: () => boolean, attempts = 1_500): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    });
  }
  throw new Error("Timed out waiting for Markdown media state.");
}
