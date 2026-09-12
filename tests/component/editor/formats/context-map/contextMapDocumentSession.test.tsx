/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorDocumentHost } from "../../../../../packages/shared-ui/src/editor/host/EditorDocumentHost";
import {
  EditorPaneMenuContributionProvider,
  type EditorPaneMenuContribution,
} from "../../../../../packages/shared-ui/src/editor/editorPaneMenuContribution";
import { preloadPresetViewer } from "../../../../../packages/shared-ui/src/editor/host/PresetViewerRenderer";
import { resolveEditorViewer } from "../../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import {
  createDefaultContextMapDocumentContent,
  parseContextMapDocument,
  type DataNode,
} from "@puppyone/shared-ui";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Context Map Document Session integration", () => {
  it("opens as a standard editable file and persists disclosure state through the host session", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const source = createDefaultContextMapDocumentContent();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const contextMapDocument = {
      path: "Knowledge.contextmap",
      name: "Knowledge.contextmap",
      type: "context-map",
      sourceKind: "local" as const,
      content: source,
      version: "v1",
    };
    await preloadPresetViewer(resolveEditorViewer(contextMapDocument).viewer);

    await act(async () => root?.render(withTestLocalization(
      <EditorDocumentHost
        document={contextMapDocument}
        contextMapEnvironment={{
          revision: 1,
          listChildren: async (path) => path === null ? [folder("Civil Law")] : [],
        }}
        documentPersistence={{ kind: "local-fs", storageIdentity: "test:context-map", persist }}
        saveMode="auto"
      />,
    )));

    await vi.waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>(
        'button.folder-relationship-card[data-node-path="Civil Law"]',
      ))
        .not.toBeNull();
    });
    act(() => container.querySelector<HTMLButtonElement>(
      'button.folder-relationship-card[data-node-path="Civil Law"]',
    )?.click());

    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    const persistedContent = persist.mock.calls.at(-1)?.[0].content ?? "";
    expect(parseContextMapDocument(persistedContent)).toMatchObject({
      ok: true,
      document: { layout: { expanded: ["Civil Law"] } },
    });
  });

  it("switches between radial and layered hierarchy renderers", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    let paneMenuContribution: EditorPaneMenuContribution | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const contextMapDocument = {
      path: "Context Map.contextmap",
      name: "Context Map.contextmap",
      type: "context-map",
      sourceKind: "local" as const,
      content: createDefaultContextMapDocumentContent(),
      version: "v1",
    };
    await preloadPresetViewer(resolveEditorViewer(contextMapDocument).viewer);

    await act(async () => root?.render(withTestLocalization(
      <EditorPaneMenuContributionProvider
        onContributionChange={(contribution) => {
          paneMenuContribution = contribution;
        }}
      >
        <EditorDocumentHost
          document={contextMapDocument}
          contextMapEnvironment={{
            revision: 1,
            listChildren: async (path) => {
              if (path === null) return [folder("src"), file("README.md")];
              if (path === "src") return [folder("src/editor"), file("src/index.ts")];
              if (path === "src/editor") return [file("src/editor/view.tsx")];
              return [];
            },
          }}
          documentPersistence={{ kind: "local-fs", storageIdentity: "test:radial-map", persist }}
          saveMode="auto"
        />
      </EditorPaneMenuContributionProvider>,
    )));

    const getLayoutControl = () => paneMenuContribution?.viewItems.find(
      (item) => item.id === "context-map-layout",
    );

    await vi.waitFor(() => {
      expect(getLayoutControl()?.kind).toBe("segmented");
      expect(container.querySelector(".folder-relationship-radial-canvas")).not.toBeNull();
      expect(container.querySelector(".folder-relationship-layout-trigger")).toBeNull();
    });
    const initialLayoutControl = getLayoutControl();
    if (!initialLayoutControl || initialLayoutControl.kind !== "segmented") {
      throw new Error("Context Map layout control was not published.");
    }
    expect(initialLayoutControl.value).toBe("radial");
    expect(initialLayoutControl.options.map((option) => option.label)).toEqual([
        "Radial tree",
        "Canvas",
        "Layered tree",
    ]);
    expect(initialLayoutControl.options.map((option) => {
      if (!React.isValidElement<{ size?: number }>(option.icon)) return null;
      return option.icon.props.size;
    })).toEqual([12, 12, 12]);
    expect(paneMenuContribution?.viewItems.map((item) => item.id)).toEqual([
      "context-map-layout",
      "context-map-filter-one-way-links",
      "context-map-filter-bidirectional-links",
    ]);
    expect(paneMenuContribution?.viewItems.slice(1).map((item) => (
      item.kind === "toggle" ? item.checked : null
    ))).toEqual([true, true]);

    await vi.waitFor(() => {
      expect(container.querySelector(".folder-relationship-radial-canvas")).not.toBeNull();
      expect(container.querySelector(
        '.folder-relationship-radial-node[data-root="true"]',
      )).not.toBeNull();
      expect(container.querySelectorAll(".folder-relationship-radial-hierarchy path").length)
        .toBeGreaterThan(0);
    });
    const radialCanvas = container.querySelector<HTMLElement>(
      ".folder-relationship-radial-canvas",
    );
    const centerBeforeExpansion = {
      x: radialCanvas?.style.getPropertyValue("--relationship-grid-offset-x"),
      y: radialCanvas?.style.getPropertyValue("--relationship-grid-offset-y"),
    };
    act(() => container.querySelector<HTMLButtonElement>(
      'button.folder-relationship-radial-node[data-node-path="src"]',
    )?.click());

    await vi.waitFor(() => {
      expect(container.querySelector(
        '.folder-relationship-radial-node[data-node-path="src/editor"]',
      )).not.toBeNull();
      expect([...container.querySelectorAll(".folder-relationship-radial-hierarchy path")]
        .some((path) => path.getAttribute("d")?.includes(" A "))).toBe(true);
      expect({
        x: radialCanvas?.style.getPropertyValue("--relationship-grid-offset-x"),
        y: radialCanvas?.style.getPropertyValue("--relationship-grid-offset-y"),
      }).toEqual(centerBeforeExpansion);
    });
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());

    const currentLayoutControl = getLayoutControl();
    if (!currentLayoutControl || currentLayoutControl.kind !== "segmented") {
      throw new Error("Context Map layout control disappeared.");
    }
    act(() => currentLayoutControl.setValue("layered"));
    await vi.waitFor(() => {
      expect(container.querySelector(".folder-relationship-layered-canvas")).not.toBeNull();
      expect(container.querySelector(
        '.folder-relationship-layered-node[data-root="true"]',
      )).not.toBeNull();
      expect(container.querySelector(
        '.folder-relationship-layered-node[data-node-path="src/editor"]',
      )).not.toBeNull();
      expect([...container.querySelectorAll(".folder-relationship-layered-hierarchy path")]
        .some((path) => (path.getAttribute("d")?.match(/ L /g)?.length ?? 0) === 3)).toBe(true);
    });

    const rootTop = Number.parseFloat(container.querySelector<HTMLElement>(
      '.folder-relationship-layered-node[data-root="true"]',
    )?.style.top ?? "0");
    const srcTop = Number.parseFloat(container.querySelector<HTMLElement>(
      '.folder-relationship-layered-node[data-node-path="src"]',
    )?.style.top ?? "0");
    const editorTop = Number.parseFloat(container.querySelector<HTMLElement>(
      '.folder-relationship-layered-node[data-node-path="src/editor"]',
    )?.style.top ?? "0");
    expect(srcTop).toBeGreaterThan(rootTop);
    expect(editorTop).toBeGreaterThan(srcTop);
  });
});

function folder(path: string): DataNode {
  return {
    id: path,
    name: path,
    path,
    type: "folder",
    source: "local",
  };
}

function file(path: string): DataNode {
  return {
    id: path,
    name: path.split("/").at(-1) ?? path,
    path,
    type: "file",
    source: "local",
  };
}
