/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorDocumentHost } from "../../../../packages/shared-ui/src/editor/host/EditorDocumentHost";
import {
  EMPTY_VIEWER_PACK_SNAPSHOT,
  type ViewerPackSnapshot,
} from "../../../../packages/shared-ui/src/editor/registry/viewerPackTypes";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("preset viewer host composition", () => {
  it("keeps an unknown document on the honest preset placeholder by default", () => {
    const container = renderHost({
      document: {
        path: "assets/scene.glb",
        name: "scene.glb",
        type: "binary",
        mimeType: "model/gltf-binary",
        sourceKind: "local",
      },
    });

    expect(container.querySelector(".document-preview")).not.toBeNull();
    expect(container.querySelector(".document-preview__label")?.textContent).toBe("Binary file");
    expect(container.querySelector(".document-preview")?.getAttribute("aria-label")).toContain("scene.glb");
    expect(container.textContent).not.toContain("scene.glb");
    expect(container.textContent).not.toContain("model/gltf-binary");
    expect(container.querySelector('[data-testid="install-viewer"]')).toBeNull();
  });

  it("keeps loading non-visual and renders recoverable errors before mounting a content viewer", async () => {
    const loadingContainer = renderHost({
      document: { path: "notes.txt", name: "notes.txt", type: "text" },
      loading: true,
    });
    expect(loadingContainer.textContent).not.toContain("Loading file…");
    expect(loadingContainer.querySelector('[role="status"]')?.getAttribute("aria-label"))
      .toBe("Loading file…");

    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";

    const openExternalFile = vi.fn(async () => undefined);
    const errorContainer = renderHost({
      document: { path: "notes.txt", name: "notes.txt", type: "text" },
      error: "Read failed",
      openExternalFile,
    });
    expect(errorContainer.textContent).toContain("Cannot open in editor");
    expect(errorContainer.textContent).toContain("Read failed");

    const button = errorContainer.querySelector("button");
    expect(button?.textContent).toContain("Open in default app");
    await act(async () => button?.click());
    expect(openExternalFile).toHaveBeenCalledWith("notes.txt");
  });

  it("invokes the external extension port only when the host explicitly provides it", () => {
    const container = renderHost({
      document: {
        path: "assets/scene.glb",
        name: "scene.glb",
        type: "binary",
        sourceKind: "local",
      },
      viewerExtensionAdapter: {
        snapshot: EMPTY_VIEWER_PACK_SNAPSHOT,
        renderInstallFallback: ({ document: input }) => React.createElement(
          "button",
          { "data-testid": "install-viewer" },
          `Install viewer for ${input.name}`,
        ),
      },
    });

    expect(container.querySelector(".document-preview")).toBeNull();
    expect(container.querySelector('[data-testid="install-viewer"]')?.textContent)
      .toBe("Install viewer for scene.glb");
  });

  it("never offers local extension installation for cloud documents", () => {
    const container = renderHost({
      document: {
        path: "assets/scene.glb",
        name: "scene.glb",
        type: "binary",
        sourceKind: "cloud",
      },
      viewerExtensionAdapter: {
        snapshot: EMPTY_VIEWER_PACK_SNAPSHOT,
        renderInstallFallback: () => React.createElement("button", {
          "data-testid": "install-viewer",
        }),
      },
    });

    expect(container.querySelector('[data-testid="install-viewer"]')).toBeNull();
    expect(container.querySelector(".document-preview")).not.toBeNull();
  });

  it("keeps the Document Session and persistence adapter outside Viewer Pack surfaces", () => {
    const snapshot = {
      sequence: 1,
      generatedAt: "2026-07-13T00:00:00.000Z",
      contributions: [{
        pluginId: "ai.puppyone.viewer.glb",
        publisher: "puppyone",
        version: "1.0.0",
        label: "glTF Viewer",
        enabled: true,
        contentHash: "abc",
        viewer: {
          entry: "viewer.html",
          source: "range-resource",
          sources: ["local"],
          runtime: ["worker"],
        },
        formats: [{
          id: "glb",
          label: "glTF Binary Scene",
          extensions: [".glb"],
          mimeTypes: ["model/gltf-binary"],
          category: "binary",
          defaultViewer: "plugin:ai.puppyone.viewer.glb",
          editable: false,
        }],
        permissions: {
          currentDocument: ["metadata", "readRange"],
          relatedFiles: "none",
          network: [],
        },
        installedAt: "2026-07-13T00:00:00.000Z",
      }],
    } as const satisfies ViewerPackSnapshot;
    const persist = vi.fn(async () => ({ ok: true as const, version: "should-not-run" }));
    const renderSurface = vi.fn((request: object) => React.createElement(
      "div",
      { "data-testid": "external-viewer" },
      Object.keys(request).sort().join(","),
    ));

    const container = renderHost({
      document: {
        path: "assets/scene.glb",
        name: "scene.glb",
        type: "binary",
        mimeType: "model/gltf-binary",
        sourceKind: "local",
      },
      documentPersistence: {
        kind: "local-fs",
        storageIdentity: "test:viewer-host",
        persist,
      },
      viewerExtensionAdapter: { snapshot, renderSurface },
    });

    expect(container.querySelector('[data-testid="external-viewer"]')?.textContent)
      .toBe("contribution,document");
    expect(renderSurface).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });
});

function renderHost(props: React.ComponentProps<typeof EditorDocumentHost>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(React.createElement(EditorDocumentHost, props))));
  return container;
}
