/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorDocumentHost } from "../../../../../packages/shared-ui/src/editor/host/EditorDocumentHost";
import { preloadPresetViewer } from "../../../../../packages/shared-ui/src/editor/host/PresetViewerRenderer";
import { resolveEditorViewer } from "../../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("PuppyFlow Document Session integration", () => {
  it("preserves an invalid source verbatim until the user performs an edit", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const source = "{ invalid puppyflow source";
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await preloadPresetViewer(resolveEditorViewer({
      path: "workflow.puppyflow",
      name: "workflow.puppyflow",
      type: "workflow",
    }).viewer);

    await act(async () => root?.render(withTestLocalization(
      <EditorDocumentHost
        document={{
          path: "workflow.puppyflow",
          name: "workflow.puppyflow",
          type: "workflow",
          sourceKind: "local",
          content: source,
          version: "v1",
        }}
        documentPersistence={{ kind: "local-fs", storageIdentity: "test:puppyflow", persist }}
        saveMode="manual"
      />,
    )));

    expect(container.textContent).toContain("Unable to parse this PuppyFlow file");
    act(() => root?.unmount());
    root = null;
    await Promise.resolve();

    expect(persist).not.toHaveBeenCalled();
  });
});
