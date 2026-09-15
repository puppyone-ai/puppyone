import { installDesktopBridge } from "../../../../support/electron/desktopBridge";
/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataNodeActions } from "../../../../../src/features/data-workspace/useDataNodeActions";
import { createLocalDataPort } from "../../../../../src/lib/localFiles";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let originalDesktopBridge: Window["puppyoneDesktop"];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalDesktopBridge;
});

describe("Slides create action", () => {
  it("delegates one template intent and opens the manifest returned by the main process", async () => {
    const instantiateTemplate = vi.fn(async () => ({
      rootPath: "Untitled Slides",
      openPath: "Untitled Slides/Untitled Slides.puppyoneapp",
      createdPaths: ["Untitled Slides", "Untitled Slides/Untitled Slides.puppyoneapp"],
      template: { id: "slides.default" as const, version: 1 },
    }));
    originalDesktopBridge = window.puppyoneDesktop;
    installDesktopBridge({ instantiateTemplate });
    const dataPort = createLocalDataPort("/workspace");
    const onActivateNode = vi.fn();
    const setActiveExplorerNode = vi.fn();
    const onWorkspaceContentChanged = vi.fn();
    const onLocalWorkspaceContentChanged = vi.fn();
    let actions: ReturnType<typeof useDataNodeActions> | null = null;

    function Harness() {
      actions = useDataNodeActions({
        dataPort,
        onEnterDataView: vi.fn(),
        onLocalWorkspaceContentChanged,
        onWorkspaceContentChanged,
        onActivateNode,
        setActiveExplorerNode,
        workspace: { id: "workspace", name: "Workspace", path: "/workspace", status: "recording" },
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withTestLocalization(<Harness />)));
    act(() => actions?.openCreateEntryMenu(null, {
      left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20,
    }));
    act(() => actions?.selectCreateEntryKind("slides"));
    await act(async () => actions?.createEntryFromMenu());

    expect(instantiateTemplate).toHaveBeenCalledWith({
      rootPath: "/workspace",
      templateId: "slides.default",
      parentPath: null,
      name: "Untitled Slides",
    });
    expect(instantiateTemplate).toHaveBeenCalledOnce();
    expect(onActivateNode).toHaveBeenCalledWith(expect.objectContaining({
      path: "Untitled Slides/Untitled Slides.puppyoneapp",
      type: "app",
    }));
    expect(setActiveExplorerNode).not.toHaveBeenCalled();
    expect(onWorkspaceContentChanged).toHaveBeenCalledOnce();
    expect(onLocalWorkspaceContentChanged).toHaveBeenCalledOnce();
  });

  it("returns a created folder as an Explorer node instead of a document path", async () => {
    const createFolder = vi.fn(async () => undefined);
    const onActivateNode = vi.fn();
    let actions: ReturnType<typeof useDataNodeActions> | null = null;

    function Harness() {
      actions = useDataNodeActions({
        dataPort: { listChildren: async () => [], createFolder, createFile: vi.fn() },
        onEnterDataView: vi.fn(),
        onLocalWorkspaceContentChanged: vi.fn(),
        onWorkspaceContentChanged: vi.fn(),
        onActivateNode,
        setActiveExplorerNode: vi.fn(),
        workspace: { id: "workspace", name: "Workspace", path: "/workspace", status: "recording" },
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(withTestLocalization(<Harness />)));
    act(() => actions?.openCreateEntryMenu(null, {
      left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20,
    }));
    act(() => actions?.selectCreateEntryKind("folder"));
    await act(async () => actions?.createEntryFromMenu());

    expect(createFolder).toHaveBeenCalledWith("Untitled Folder");
    expect(onActivateNode).toHaveBeenCalledWith({
      id: "Untitled Folder",
      name: "Untitled Folder",
      path: "Untitled Folder",
      type: "folder",
      children: null,
    });
  });
});
