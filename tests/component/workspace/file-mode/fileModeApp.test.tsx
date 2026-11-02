/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getInitialWorkspace: vi.fn(),
  resolveNode: vi.fn(),
  retry: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("../../../../src/lib/localFiles", () => ({
  getInitialWorkspace: mocks.getInitialWorkspace,
  createLocalDataPort: (rootPath: string) => ({
    rootPath,
    resolveNode: mocks.resolveNode,
    documentPersistence: { kind: "local-fs", storageIdentity: "test", persist: vi.fn() },
  }),
}));
vi.mock("../../../../src/features/settings", () => ({
  useDesktopPreference: () => undefined,
  useDesktopPreferenceEffects: vi.fn(),
}));
vi.mock("../../../../src/features/themes/useSubThemeCatalog", () => ({
  useSubThemeCatalog: () => ({ snapshot: {} }),
}));
vi.mock("../../../../src/features/typography", () => ({
  useTypographyCatalog: () => [],
  useTypographyRuntime: vi.fn(),
}));
vi.mock("@puppyone/shared-ui", async (original) => ({
  ...await original<typeof import("@puppyone/shared-ui")>(),
  FilePreview: (props: Record<string, unknown>) => {
    mocks.preview(props);
    return <div data-testid="preview" />;
  },
  useDocumentInput: () => ({
    content: null, generation: 0, fileUrl: null, fileUrlLoading: false, fileUrlError: null,
    loading: false, error: null, retry: mocks.retry, applyPersistedCommit: vi.fn(),
  }),
}));

import { FileModeApp } from "../../../../src/app/FileModeApp";

const target = { path: "/notes/plan.md", rootPath: "/notes", name: "plan.md" };

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(withTestLocalization(<FileModeApp />));
    await Promise.resolve();
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
}

describe("FileModeApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInitialWorkspace.mockResolvedValue({ initialFile: target });
    mocks.resolveNode.mockResolvedValue({ id: "plan.md", path: "plan.md", name: "plan.md", type: "markdown" });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the bound file under a draggable bar with explicit saves", async () => {
    await mount();

    expect(mocks.resolveNode).toHaveBeenCalledWith("plan.md");
    expect(container.querySelector('[data-window-drag-region="true"]')?.textContent).toBe("plan.md");
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull();
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({
      editorSaveMode: "manual",
      htmlTrustMode: "safe",
      workspaceRoot: "/notes",
      editorInteractionPreferences: expect.objectContaining({ showSaveStatus: true }),
    }));
    expect(mocks.preview.mock.lastCall?.[0].markdownEnvironment.assetUrlResolver).toBeTypeOf("function");
  });

  it("picks up outside changes when the window regains focus", async () => {
    await mount();
    expect(mocks.retry).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it.each([
    ["the window has no file", () => mocks.getInitialWorkspace.mockResolvedValue({ initialFile: null })],
    ["the file is gone", () => mocks.resolveNode.mockResolvedValue(null)],
    ["the path is a folder", () => mocks.resolveNode.mockResolvedValue({ id: "a", path: "a", name: "a", type: "folder" })],
    ["reading fails", () => mocks.resolveNode.mockRejectedValue(new Error("denied"))],
  ])("explains itself when %s", async (_name, arrange) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    arrange();
    await mount();

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview"]')).toBeNull();
    consoleError.mockRestore();
  });
});
