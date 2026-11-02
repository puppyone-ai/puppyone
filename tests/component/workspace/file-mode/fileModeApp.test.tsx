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
  content: { value: null as null | Record<string, unknown> },
  openFileFolder: vi.fn(async () => undefined),
  setFileEdited: vi.fn(),
  publishUnsaved: { value: (_unsaved: boolean) => undefined as void },
}));

vi.mock("../../../../src/lib/localFiles", () => ({
  getInitialWorkspace: mocks.getInitialWorkspace,
  openExternalUrl: vi.fn(),
  openFileFolder: mocks.openFileFolder,
  setFileEdited: mocks.setFileEdited,
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
  subscribeUnsavedDocumentSessions: (listener: (unsaved: boolean) => void) => {
    mocks.publishUnsaved.value = listener;
    return () => undefined;
  },
  useDocumentInput: () => ({
    content: mocks.content.value, generation: 0, fileUrl: null, fileUrlLoading: false, fileUrlError: null,
    loading: false, error: null, retry: mocks.retry, applyPersistedCommit: vi.fn(),
  }),
}));

import { FileModeApp } from "../../../../src/app/FileModeApp";

const target = { path: "/notes/plan.md", rootPath: "/notes", name: "plan.md", tooLarge: false, sizeLimit: 1048576 };

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
    mocks.content.value = null;
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
    expect(container.querySelector('[data-window-drag-region="true"] .file-mode-window__name')?.textContent).toBe("plan.md");
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull();
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({
      editorSaveMode: "manual",
      htmlTrustMode: "safe",
      workspaceRoot: "/notes",
      editorInteractionPreferences: expect.objectContaining({ showSaveStatus: true }),
    }));
    expect(mocks.preview.mock.lastCall?.[0].markdownEnvironment.assetUrlResolver).toBeTypeOf("function");
  });

  it("lets the window know about unsaved edits", async () => {
    await mount();
    mocks.publishUnsaved.value(true);
    expect(mocks.setFileEdited).toHaveBeenLastCalledWith(true);
  });

  it("offers the way into a project from the title bar", async () => {
    await mount();
    const button = container.querySelector<HTMLButtonElement>(".file-mode-window__action");
    expect(button?.closest('[data-window-drag-region="true"]')).not.toBeNull();

    act(() => button?.click());
    expect(mocks.openFileFolder).toHaveBeenCalledOnce();
  });

  it("sends links to the browser without offering neighbouring files", async () => {
    await mount();
    const { documentNavigation } = mocks.preview.mock.lastCall![0];
    expect(documentNavigation.resolveReference("plan.md", "https://puppyone.ai")).toMatchObject({ kind: "external" });
  });

  it("does not offer to import images next to the file", async () => {
    await mount();
    expect(mocks.preview.mock.lastCall?.[0].editorAssets).toBeUndefined();
  });

  it.each(["gb18030", "unknown"])("keeps a %s file read-only and says why", async (encoding) => {
    mocks.content.value = { path: "plan.md", name: "plan.md", type: "markdown", content: "x", encoding };
    await mount();

    expect(mocks.preview.mock.lastCall?.[0].documentPersistence).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("edits a UTF-8 file", async () => {
    mocks.content.value = { path: "plan.md", name: "plan.md", type: "markdown", content: "x", encoding: "utf-8" };
    await mount();

    expect(mocks.preview.mock.lastCall?.[0].documentPersistence).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("explains a file over the size limit without reading it", async () => {
    mocks.getInitialWorkspace.mockResolvedValue({ initialFile: { ...target, tooLarge: true } });
    await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("1 MB");
    expect(mocks.resolveNode).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="preview"]')).toBeNull();
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
