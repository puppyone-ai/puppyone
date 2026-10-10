/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort } from "@puppyone/shared-ui";
import { DesktopNodeActionMenu } from "../../../../src/features/data-workspace/nodeActions";
import { useDataNodeActions } from "../../../../src/features/data-workspace/useDataNodeActions";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let actions: ReturnType<typeof useDataNodeActions>;
let writeText: ReturnType<typeof vi.fn<(value: string) => Promise<void>>>;
let getPathForCopy: ReturnType<typeof vi.fn<(path: string) => string>>;
let dataPort: DataPort;
let onCopyLink: (() => void) | undefined;
const noop = () => undefined;
const folder: DataNode = { id: "docs", path: "docs", name: "docs", type: "folder" };
const file: DataNode = { id: "docs/笔记 #1.md", path: "docs/笔记 #1.md", name: "笔记 #1.md", type: "markdown" };

function Harness() {
  actions = useDataNodeActions({ dataPort, getPathForCopy,
    workspace: { id: "project", path: "/project", name: "Project", status: "recording" },
    onEnterDataView: noop, onLocalWorkspaceContentChanged: noop, onWorkspaceContentChanged: noop,
    onActivateNode: noop, setActiveExplorerNode: noop });
  const draft = actions.nodeActionMenu;
  return draft && <DesktopNodeActionMenu draft={draft} onChange={actions.setNodeActionMenu}
    onCancel={() => actions.setNodeActionMenu(null)} onCopyPath={actions.copyNodePathFromMenu}
    onCopyLink={onCopyLink}
    canCopy={false} canCut={false} canDuplicate={false}
    onCopy={noop} onCut={noop} onPaste={noop} onDuplicate={noop} onCreateInside={noop}
    onRename={noop} onDelete={noop} onOpenInDefaultApp={noop} onRevealInFinder={noop} />;
}

beforeEach(() => {
  onCopyLink = undefined;
  writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
  getPathForCopy = vi.fn((path) => `/project/${path}`);
  dataPort = { listChildren: async () => [], moveNode: vi.fn(async () => undefined), copyNode: vi.fn(async () => ({ path: "unused" })) };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(withTestLocalization(<Harness />)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function open(node: DataNode, selected: DataNode[] = [node]) {
  act(() => actions.openNodeActionMenu(node, new DOMRect(20, 20, 24, 24), selected));
}
function firstRow() { return host.querySelector<HTMLButtonElement>(".desktop-node-action-menu button")!; }

describe("Explorer Copy Path", () => {
  it("retains the clicked row as launcher when nested selection collapses to its folder", () => {
    open(file, [folder, file]);
    expect(actions.nodeActionMenu?.node).toBe(folder);
    expect(actions.nodeActionMenu?.launcherPath).toBe(file.path);
  });

  it("offers Copy Link only when the owning Cloud workspace provides it", () => {
    open(file);
    expect(host.textContent).not.toContain("Copy Link");
    onCopyLink = vi.fn();
    open(folder);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".desktop-node-action-menu button"));
    expect(buttons[0]?.textContent?.trim()).toBe("Copy Path");
    expect(buttons[1]?.textContent?.trim()).toBe("Copy Link");
    act(() => buttons[1]?.click());
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(dataPort.moveNode).not.toHaveBeenCalled();
    expect(dataPort.copyNode).not.toHaveBeenCalled();
  });

  it.each([folder, file, { ...file, type: "image" as const, name: "photo.png" }])(
    "puts Copy Path first for $type and writes the readable path without file mutations", async (node) => {
      open(node);
      expect(firstRow().textContent?.trim()).toBe("Copy Path");
      expect(firstRow().disabled).toBe(false);
      await act(async () => firstRow().click());
      expect(getPathForCopy).toHaveBeenCalledWith(node.path);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(`/project/${node.path}`);
      expect(actions.nodeActionMenu).toBeNull();
      expect(dataPort.moveNode).not.toHaveBeenCalled();
      expect(dataPort.copyNode).not.toHaveBeenCalled();
    },
  );

  it("copies the menu target's path during multi-selection and preserves the file clipboard", async () => {
    const other: DataNode = { ...file, id: "other.md", path: "other.md", name: "other.md" };
    act(() => actions.fileClipboardController.cutNodes([other]));
    const clipboard = actions.fileClipboardController.clipboard;
    open(file, [other, file]);
    await act(async () => firstRow().click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("/project/docs/笔记 #1.md");
    expect(actions.fileClipboardController.clipboard).toBe(clipboard);
    expect(actions.fileClipboardController.cutPaths.has(other.path)).toBe(true);
  });

  it("keeps the menu retryable after a clipboard rejection", async () => {
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    open(file);
    await act(async () => firstRow().click());
    expect(host.querySelector(".desktop-node-action-error")?.textContent).toContain("Clipboard denied");
    expect(firstRow().disabled).toBe(false);
    await act(async () => firstRow().click());
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(actions.nodeActionMenu).toBeNull();
  });

  it("does not export a URI or a guessed path when its owning root is unavailable", async () => {
    getPathForCopy.mockImplementation(() => { throw new Error("Resource is outside the current Workbench Workspace."); });
    open(file);
    await act(async () => firstRow().click());
    expect(writeText).not.toHaveBeenCalled();
    expect(firstRow().disabled).toBe(false);
    expect(actions.nodeActionMenu?.error?.code).toBe("operation-failed");
  });

  it.each(["resolve", "reject"] as const)("fences a late clipboard %s from a newer menu", async (result) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    writeText.mockImplementationOnce(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    open(file);
    let copying!: Promise<void>;
    act(() => { copying = actions.copyNodePathFromMenu(); });
    expect(firstRow().disabled).toBe(true);
    open(folder);
    await act(async () => {
      if (result === "resolve") resolve(); else reject(new Error("Old failure"));
      await copying;
    });
    expect(actions.nodeActionMenu?.node).toBe(folder);
    expect(actions.nodeActionMenu?.error).toBeNull();
    expect(firstRow().disabled).toBe(false);
  });
});
