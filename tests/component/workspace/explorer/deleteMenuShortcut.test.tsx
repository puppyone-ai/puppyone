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
const noop = () => undefined;
const file: DataNode = { id: "a.png", path: "a.png", name: "a.png", type: "image" };
let shortcut: string | undefined;

function Harness() {
  actions = useDataNodeActions({
    dataPort: { listChildren: async () => [] } as DataPort,
    workspace: { id: "project", path: "/project", name: "Project", status: "recording" },
    onEnterDataView: noop,
    onLocalWorkspaceContentChanged: noop,
    onWorkspaceContentChanged: noop,
    onActivateNode: noop,
    setActiveExplorerNode: noop,
  });
  const draft = actions.nodeActionMenu;
  return draft ? <DesktopNodeActionMenu
    draft={draft}
    onChange={actions.setNodeActionMenu}
    onCancel={() => actions.setNodeActionMenu(null)}
    onCopyPath={noop}
    canCopy={false}
    canCut={false}
    canDuplicate={false}
    onCopy={noop}
    onCut={noop}
    onPaste={noop}
    onDuplicate={noop}
    onCreateInside={noop}
    onRename={noop}
    onDelete={noop}
    deleteShortcut={shortcut}
    onOpenInDefaultApp={noop}
    onRevealInFinder={noop}
  /> : null;
}

beforeEach(() => {
  shortcut = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(withTestLocalization(<Harness />)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function openMenu() {
  act(() => actions.openNodeActionMenu(file, new DOMRect(0, 0, 40, 20), [file]));
  return [...host.querySelectorAll<HTMLElement>(".desktop-menu-item")]
    .find((item) => item.textContent?.includes("Delete"))!;
}

describe("delete menu hint", () => {
  it("shows the platform chord when deletion is enabled", () => {
    shortcut = "⌘⌫";
    expect(openMenu().textContent).toContain("⌘⌫");
  });

  it("shows nothing when the host has not enabled deletion", () => {
    expect(openMenu().textContent).not.toContain("⌘⌫");
  });
});
