/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort } from "../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../packages/shared-ui/src/data/DataWorkspace";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resource preview readiness", () => {
  it("keeps the initial neutral surface committed while the image URL loads in staging", async () => {
    const fileUrl = deferred<string>();
    const { container, getFileUrl } = await renderWorkspace({
      activePath: "photo.png",
      nodes: [imageNode()],
      resolveFileUrl: () => fileUrl.promise,
    });

    await waitFor(() => getFileUrl.mock.calls.length === 1);

    expect(container.querySelector(".native-image-preview")).toBeNull();
    const pending = container.querySelector<HTMLElement>(".document-surface-pending");
    expect(pending?.textContent).toBe("");
    expect(pending?.getAttribute("aria-label")).toBe(testT("editor.preview.loading"));
    expect(pending?.closest<HTMLElement>(".document-surface-slot")?.dataset.surfaceState)
      .toBe("staging");
    expect(container.querySelector('[data-surface-key="file-preview:empty"]')?.getAttribute("data-surface-state"))
      .toBe("committed");
    expect(container.textContent).not.toContain("PNG metadata from the explorer");
  });

  it("retains the committed preview until the image URL is ready, then hides the image until it loads", async () => {
    const fileUrl = deferred<string>();
    const { container, getFileUrl } = await renderWorkspace({
      activePath: "notes.bin",
      nodes: [
        {
          id: "notes.bin",
          path: "notes.bin",
          name: "notes.bin",
          type: "file",
        },
        imageNode(),
      ],
      resolveFileUrl: () => fileUrl.promise,
    });

    await waitFor(() => (
      container.querySelector('[data-surface-key="notes.bin"]')?.getAttribute("data-surface-state")
        === "committed"
    ));
    const imageRow = container.querySelector<HTMLElement>('[data-explorer-path="photo.png"]');
    if (!imageRow) throw new Error("Image explorer row did not render.");

    await act(async () => {
      imageRow.click();
      await Promise.resolve();
    });
    await waitFor(() => getFileUrl.mock.calls.length === 1);

    expect(container.querySelector(".document-preview")?.getAttribute("aria-label")).toContain("notes.bin");
    expect(container.querySelector(".document-preview__label")?.textContent).toBe("Binary file");
    expect(container.querySelector(".native-image-preview")).toBeNull();
    expect(container.querySelector(".document-surface-host")?.getAttribute("data-transitioning")).toBe("true");
    expect(container.querySelector('[data-surface-key="notes.bin"]')?.getAttribute("data-surface-state")).toBe("committed");
    expect(container.querySelector('[data-surface-key="photo.png"]')?.getAttribute("data-surface-state")).toBe("staging");

    fileUrl.resolve("blob:photo-preview");
    await act(async () => fileUrl.promise);
    await waitFor(() => container.querySelector(".native-image-preview") !== null);

    const image = container.querySelector<HTMLImageElement>(".native-image-preview");
    const shell = container.querySelector<HTMLElement>(".native-image-preview-shell");
    if (!image || !shell) throw new Error("Image preview did not mount.");
    expect(image.getAttribute("src")).toBe("blob:photo-preview");
    expect(image.hidden).toBe(true);
    expect(shell.dataset.previewState).toBe("loading");
    expect(shell.getAttribute("aria-busy")).toBe("true");
    expect(shell.querySelector(".document-surface-pending")?.textContent).toBe("");
    expect(shell.querySelector(".document-surface-pending")?.getAttribute("aria-label"))
      .toBe(testT("editor.preview.loading"));

    Object.defineProperty(image, "decode", { configurable: true, value: undefined });
    act(() => image.dispatchEvent(new Event("load")));

    expect(shell.dataset.previewState).toBe("ready");
    expect(shell.getAttribute("aria-busy")).toBe("false");
    expect(image.hidden).toBe(false);
    expect(shell.querySelector(".document-surface-pending")).toBeNull();
    await waitFor(() => container.querySelector(".document-surface-host")?.getAttribute("data-transitioning") === "false");
    expect(container.querySelector('[data-surface-key="notes.bin"]')).toBeNull();
    expect(container.querySelector('[data-surface-key="photo.png"]')?.getAttribute("data-surface-state")).toBe("committed");
  });
});

function imageNode(): DataNode {
  return {
    id: "photo.png",
    path: "photo.png",
    name: "photo.png",
    type: "image",
    preview: "PNG metadata from the explorer",
    mimeType: "image/png",
  };
}

async function renderWorkspace({
  activePath,
  nodes,
  resolveFileUrl,
}: {
  activePath: string;
  nodes: DataNode[];
  resolveFileUrl: (path: string) => Promise<string>;
}) {
  const getFileUrl = vi.fn(resolveFileUrl);
  const dataPort: DataPort = {
    listChildren: vi.fn(async (folderPath) => folderPath ? [] : nodes),
    getFileUrl,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        dataPort={dataPort}
        defaultActivePath={activePath}
        showHeader={false}
        showPreviewHeader={false}
        enableMarkdownLinkContentIndexing={false}
      />,
    ));
  });
  return { container, getFileUrl };
}

async function waitFor(assertion: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    });
  }
  throw new Error("Timed out waiting for resource preview state.");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
