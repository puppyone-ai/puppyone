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
  fileChanged: { value: () => undefined as void },
  platformCapabilities: { value: null as null | Record<string, unknown> },
  menuItems: { value: [] as Array<
    | { kind: "toggle"; id: string; label: string; checked: boolean; setChecked: (checked: boolean) => void }
    | { kind: "segmented"; id: string; label: string; value: string; options: Array<{ id: string; label: string; icon: React.ReactNode }>; setValue: (value: string) => void }
  > },
  appearance: {
    appearance: { effectiveColorMode: "dark" },
    rootProps: { "data-po-appearance-root": "true", "data-sub-theme-id": "default.github", style: {} },
  },
}));

vi.mock("../../../../src/features/appearance/AppearanceRuntime", () => ({
  resolveSurfaceAppearance: () => mocks.appearance,
  SurfaceAppearanceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => mocks.platformCapabilities.value,
}));

vi.mock("../../../../src/lib/localFiles", () => ({
  getInitialWorkspace: mocks.getInitialWorkspace,
  openExternalUrl: vi.fn(),
  subscribeFileModeFileChanges: (callback: () => void) => {
    mocks.fileChanged.value = callback;
    return () => { mocks.fileChanged.value = () => undefined; };
  },
  createLocalDataPort: (rootPath: string) => ({
    rootPath,
    resolveNode: mocks.resolveNode,
    documentPersistence: { kind: "local-fs", storageIdentity: "test", persist: vi.fn() },
  }),
}));
vi.mock("../../../../src/features/settings", () => ({
  useDesktopAppearance: () => ({ resolvedAppearance: {}, lightThemePreset: "neutral", darkThemePreset: "default" }),
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
vi.mock("@puppyone/shared-ui", async (original) => {
  const actual = await original<typeof import("@puppyone/shared-ui")>();
  /** Hands its settings over the way the real editors do. */
  function FilePreview(props: Record<string, unknown>) {
    mocks.preview(props);
    const publish = actual.useEditorPaneMenuContributionPublisher();
    React.useLayoutEffect(() => {
      if (!publish || !mocks.menuItems.value.length) return undefined;
      publish({ documentId: "plan.md", viewItems: mocks.menuItems.value });
      return () => publish(null);
    }, [publish]);
    return <div data-testid="preview" />;
  }
  return { ...actual, FilePreview,
  useDocumentInput: () => ({
    content: mocks.content.value, generation: 0, fileUrl: null, fileUrlLoading: false, fileUrlError: null,
    loading: false, error: null, retry: mocks.retry, applyPersistedCommit: vi.fn(),
  }),
};
});

import { FileModeApp } from "../../../../src/app/FileModeApp";
import { EMBEDDED_POINTER_EVENT, EMBEDDED_SCROLL_EVENT } from "../../../../src/shared-ui/editor/host/embeddedFrameRelay";

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

/** A tall scroller whose top sits `top` pixels below the document's. */
function scrollerAt(parent: Element, top: number) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 600 },
    scrollTop: { value: 0, writable: true },
  });
  element.getBoundingClientRect = () => ({ top } as DOMRect);
  parent.append(element);
  return element;
}

function scroll(element: HTMLElement, top: number) {
  element.scrollTop = top;
  element.dispatchEvent(new Event("scroll"));
}

describe("FileModeApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.content.value = null;
    mocks.menuItems.value = [];
    mocks.platformCapabilities.value = { platform: "macos", windowChrome: { mode: "overlay" } };
    mocks.getInitialWorkspace.mockResolvedValue({ initialFile: target });
    mocks.resolveNode.mockResolvedValue({ id: "plan.md", path: "plan.md", name: "plan.md", type: "markdown" });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the bound file under a draggable bar and saves edits as they are made", async () => {
    await mount();

    expect(mocks.resolveNode).toHaveBeenCalledWith("plan.md");
    expect(container.querySelector('[data-window-drag-region="true"] .file-mode-window__name')?.textContent).toBe("plan.md");
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull();
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({
      // As in a project window: no save step, no save status.
      editorSaveMode: "auto",
      // Markdown keeps its source view, as in a project pane.
      hideSourceView: false,
      htmlTrustMode: "safe",
      workspaceRoot: "/notes",
      editorInteractionPreferences: expect.objectContaining({ showSaveStatus: false }),
    }));
    expect(mocks.preview.mock.lastCall?.[0].markdownEnvironment.assetUrlResolver).toBeTypeOf("function");
  });

  it("puts the window under the same theme boundary as a project window", async () => {
    await mount();

    const root = container.querySelector<HTMLElement>(".file-mode-window");
    expect(root?.dataset).toMatchObject({ poAppearanceRoot: "true", subThemeId: "default.github" });
    expect(root?.classList.contains("dark")).toBe(true);
  });

  it("tells the title bar which window controls it has to clear", async () => {
    await mount();

    const titlebar = container.querySelector<HTMLElement>(".file-mode-window__titlebar");
    expect(titlebar?.dataset).toMatchObject({ windowPlatform: "macos", windowChromeMode: "overlay" });
  });

  it("keeps the title bar to the file's name when the editor has no settings", async () => {
    await mount();
    expect(container.querySelector(".file-mode-window__titlebar button")).toBeNull();
  });

  it("shows the editor's current view in the title bar, one press from the others", async () => {
    const setValue = vi.fn();
    mocks.menuItems.value = [{
      kind: "segmented", id: "editor-view-mode", label: "View", value: "live", setValue,
      options: [{ id: "live", label: "Live view", icon: null }, { id: "source", label: "Source code", icon: null }],
    }];
    await mount();

    const buttons = container.querySelectorAll<HTMLButtonElement>(".file-mode-window__titlebar button");
    expect(buttons).toHaveLength(1);
    const trigger = buttons[0]!;
    expect(trigger.getAttribute("aria-label")).toBe("View: Live view");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

    await act(async () => { trigger.click(); await Promise.resolve(); });
    const options = [...document.querySelectorAll<HTMLButtonElement>(".desktop-editor-view-mode-menu [role=menuitemradio]")];
    expect(options.map((option) => [option.textContent, option.getAttribute("aria-checked")])).toEqual([
      ["Live view", "true"],
      ["Source code", "false"],
    ]);
    act(() => options[1]?.click());
    expect(setValue).toHaveBeenCalledWith("source");
    expect(document.querySelector(".desktop-editor-view-mode-menu")).toBeNull();
  });

  it("shows the file's controls only while the pointer is in the top third of the window", async () => {
    mocks.menuItems.value = [{
      kind: "segmented", id: "editor-view-mode", label: "View", value: "live", setValue: vi.fn(),
      options: [{ id: "live", label: "Live view", icon: null }, { id: "source", label: "Source code", icon: null }],
    }];
    await mount();
    const windowRoot = container.querySelector<HTMLElement>(".file-mode-window")!;
    windowRoot.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, height: 600 } as DOMRect);
    const pointAt = (clientY: number) => act(() => {
      windowRoot.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY }));
    });

    expect(windowRoot.dataset.controlsRevealed).toBeUndefined();
    pointAt(150);
    expect(windowRoot.dataset.controlsRevealed).toBe("true");
    pointAt(450);
    expect(windowRoot.dataset.controlsRevealed).toBeUndefined();
    pointAt(150);
    act(() => { windowRoot.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: null })); });
    expect(windowRoot.dataset.controlsRevealed).toBeUndefined();
  });

  it("fades and reveals for a page drawn in a frame, from what its viewer relays", async () => {
    mocks.menuItems.value = [{
      kind: "segmented", id: "editor-view-mode", label: "View", value: "preview", setValue: vi.fn(),
      options: [{ id: "preview", label: "Interact", icon: null }, { id: "source", label: "Source code", icon: null }],
    }];
    await mount();
    const windowRoot = container.querySelector<HTMLElement>(".file-mode-window")!;
    const surface = container.querySelector<HTMLElement>(".file-mode-window__document")!;
    windowRoot.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, height: 600 } as DOMRect);
    const frame = document.createElement("iframe");
    container.querySelector('[data-testid="preview"]')!.append(frame);
    const relay = (type: string, detail: unknown) => act(() => {
      frame.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    });

    // The page scrolls inside its frame; only its viewer's report says so.
    relay(EMBEDDED_SCROLL_EVENT, { top: 300 });
    // Marked as a frame's: the page keeps its own background instead of fading into the window's.
    expect(surface.dataset.scrolled).toBe("frame");
    relay(EMBEDDED_SCROLL_EVENT, { top: 0 });
    expect(surface.hasAttribute("data-scrolled")).toBe(false);

    relay(EMBEDDED_POINTER_EVENT, { clientX: 400, clientY: 120 });
    expect(windowRoot.dataset.controlsRevealed).toBe("true");
    relay(EMBEDDED_POINTER_EVENT, { clientX: 400, clientY: 450 });
    expect(windowRoot.dataset.controlsRevealed).toBeUndefined();
    relay(EMBEDDED_POINTER_EVENT, { clientX: 400, clientY: 120 });
    relay(EMBEDDED_POINTER_EVENT, null);
    expect(windowRoot.dataset.controlsRevealed).toBeUndefined();

    // Moving from the page onto the title bar: the window sees the pointer before the page says it left.
    act(() => { windowRoot.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 20 })); });
    relay(EMBEDDED_POINTER_EVENT, null);
    expect(windowRoot.dataset.controlsRevealed).toBe("true");
  });

  it("puts the editor's settings in a title bar menu instead of the editor", async () => {
    const setChecked = vi.fn();
    mocks.menuItems.value = [{ kind: "toggle", id: "csv-header-row", label: "Header row", checked: true, setChecked }];
    await mount();

    const button = container.querySelector<HTMLButtonElement>(".file-mode-window__titlebar .file-mode-window__action");
    expect(button?.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => { button?.click(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });

    const item = document.querySelector<HTMLButtonElement>(".desktop-editor-pane-menu [role=menuitemcheckbox]");
    expect(item?.textContent).toContain("Header row");
    expect(document.querySelector(".desktop-editor-pane-menu-close-action")).toBeNull();
    act(() => item?.click());
    expect(setChecked).toHaveBeenCalledWith(false);
  });

  it("fades the document under the title bar only once it has left its top", async () => {
    await mount();
    const surface = container.querySelector<HTMLElement>(".file-mode-window__document")!;
    const scroller = scrollerAt(container.querySelector('[data-testid="preview"]')!, 0);
    const codeBlock = scrollerAt(scroller, 300);

    scroll(scroller, 40);
    expect(surface.hasAttribute("data-scrolled")).toBe(true);
    // A block scrolling inside the page does not decide the edge.
    scroll(codeBlock, 0);
    expect(surface.hasAttribute("data-scrolled")).toBe(true);
    scroll(scroller, 0);
    expect(surface.hasAttribute("data-scrolled")).toBe(false);

    // A view switch replaces the scroller without scrolling.
    scroll(scroller, 40);
    await act(async () => {
      scroller.remove();
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(surface.hasAttribute("data-scrolled")).toBe(false);
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

  it("reads the file again when it changes on disk, without focus", async () => {
    await mount();
    expect(mocks.retry).not.toHaveBeenCalled();

    act(() => mocks.fileChanged.value());
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
