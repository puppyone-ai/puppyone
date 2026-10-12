/** @vitest-environment happy-dom */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataNode } from "@puppyone/shared-ui";
import {
  DesktopCreateEntryMenu,
  DesktopExplorerRowActions,
  DesktopNodeActionMenu,
  rectToCreateEntryAnchor,
} from "../../../../src/features/data-workspace/nodeActions";
import { useDataNodeActions } from "../../../../src/features/data-workspace/useDataNodeActions";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
const nodes: DataNode[] = [
  { id: "docs", name: "docs", path: "docs", type: "folder" },
  { id: "notes", name: "notes", path: "notes", type: "folder" },
];
let root: Root;
let host: HTMLDivElement;
let commits: Array<string | null>;

function Harness() {
  const actions = useDataNodeActions({ dataPort: null, workspace: null,
    onEnterDataView: noop, onLocalWorkspaceContentChanged: noop, onWorkspaceContentChanged: noop,
    onActivateNode: noop, setActiveExplorerNode: noop });
  const { nodeActionMenu, createEntryDraft } = actions;
  const creatingFromFooter = createEntryDraft?.anchor.placement === "auto-end";
  useLayoutEffect(() => {
    commits.push(nodeActionMenu ? `actions:${nodeActionMenu.launcherPath}`
      : createEntryDraft ? `create:${createEntryDraft.parentPath ?? "root"}` : null);
  }, [nodeActionMenu, createEntryDraft]);
  return <>
    {nodes.map(node => <div key={node.path} data-test-row={node.path}>
      <DesktopExplorerRowActions node={node} parentPath={node.path}
        createMenuOpen={createEntryDraft?.parentPath === node.path}
        nodeMenuOpen={nodeActionMenu?.launcherPath === node.path}
        onCreate={actions.openCreateEntryMenu} onOpenNodeMenu={actions.openNodeActionMenu} />
    </div>)}
    <button data-test-new data-desktop-sidebar-menu-trigger="true" aria-haspopup="menu"
      aria-expanded={Boolean(creatingFromFooter)} onClick={event => {
        if (creatingFromFooter) actions.setCreateEntryDraft(null);
        else actions.openCreateEntryMenu(null, rectToCreateEntryAnchor(event.currentTarget.getBoundingClientRect(), "auto-end"));
      }}>New</button>
    <button data-test-unrelated aria-haspopup="menu">Unrelated menu</button>
    {createEntryDraft && <DesktopCreateEntryMenu draft={createEntryDraft}
      mainEntries={["markdown", "customFiles"]} submenuItemKinds={["json"]}
      onCancel={() => actions.setCreateEntryDraft(null)} onSelectKind={noop} />}
    {nodeActionMenu && <DesktopNodeActionMenu draft={nodeActionMenu}
      onChange={actions.setNodeActionMenu} onCancel={() => actions.setNodeActionMenu(null)}
      onCopyPath={noop} onCopy={noop} onCut={noop} onPaste={noop} onDuplicate={noop}
      onCreateInside={noop} onRename={noop} onDelete={noop} onOpenInDefaultApp={noop} onRevealInFinder={noop} />}
  </>;
}

beforeEach(() => {
  commits = [];
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(withTestLocalization(<Harness />)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function trigger(path: string, kind: "create" | "more") {
  return host.querySelector<HTMLButtonElement>(
    `[data-test-row="${path}"] .tree-row-action-button:nth-child(${kind === "create" ? 1 : 2})`,
  )!;
}
function press(target: Element) {
  act(() => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
}
function click(target: HTMLButtonElement) { act(() => target.click()); }
function menu() { return host.querySelector<HTMLDivElement>(".desktop-node-action-menu"); }

describe("Sidebar menu handoff", () => {
  it("keeps the menu and launcher state until another enabled trigger completes its click", () => {
    click(trigger("docs", "more"));
    const originalMenu = menu()!;
    const firstItem = originalMenu.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(firstItem);
    const before = commits.length;
    const next = trigger("notes", "more");
    press(next.querySelector("svg")!);
    expect(menu()).toBe(originalMenu);
    expect(trigger("docs", "more").getAttribute("aria-expanded")).toBe("true");
    expect(commits).toHaveLength(before);
    click(next);
    expect(menu()).toBe(originalMenu);
    expect(commits.slice(before)).toEqual(["actions:notes"]);
    expect(trigger("docs", "more").getAttribute("aria-expanded")).toBe("false");
    expect(next.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(firstItem);
  });

  it("hands off between node actions and creation without committing an empty menu state", () => {
    click(trigger("docs", "more"));
    const before = commits.length;
    press(trigger("notes", "create"));
    expect(commits).toHaveLength(before);
    click(trigger("notes", "create"));
    expect(commits.slice(before)).toEqual(["create:notes"]);
    expect(menu()?.classList.contains("desktop-create-entry-menu")).toBe(true);
    expect(document.activeElement).toBe(menu()?.querySelector("button"));
    press(trigger("docs", "more"));
    click(trigger("docs", "more"));
    expect(commits.slice(before)).toEqual(["create:notes", "actions:docs"]);
    expect(menu()?.classList.contains("desktop-sidebar-action-menu")).toBe(true);
  });

  it("resets an open creation submenu before rendering a different launch target", () => {
    click(trigger("docs", "create"));
    const originalMenu = menu();
    const submenuTrigger = host.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger")!;
    click(submenuTrigger);
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("true");
    press(trigger("notes", "create"));
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("true");
    click(trigger("notes", "create"));
    expect(menu()).toBe(originalMenu);
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(commits.at(-1)).toBe("create:notes");
  });

  it("dismisses for unmarked or disabled launchers, but allows pointer and scroll events inside the menu", () => {
    click(trigger("docs", "more"));
    const originalMenu = menu()!;
    press(originalMenu.querySelector("svg")!);
    act(() => originalMenu.dispatchEvent(new Event("scroll")));
    expect(menu()).toBe(originalMenu);
    press(host.querySelector("[data-test-unrelated]")!);
    expect(menu()).toBeNull();
    click(trigger("docs", "more"));
    const disabled = trigger("notes", "more");
    disabled.disabled = true;
    press(disabled);
    expect(menu()).toBeNull();
    click(trigger("docs", "more"));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(menu()).toBeNull();
  });

  it("uses Escape to close the creation submenu before dismissing its parent", () => {
    click(trigger("docs", "create"));
    const submenuTrigger = host.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger")!;
    click(submenuTrigger);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).not.toBeNull();
    expect(submenuTrigger.getAttribute("aria-expanded")).toBe("false");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();
  });

  it("lets the Sidebar New launcher toggle its menu closed instead of reopening after pointer dismissal", () => {
    click(trigger("docs", "more"));
    const next = host.querySelector<HTMLButtonElement>("[data-test-new]")!;
    const before = commits.length;
    press(next); click(next);
    expect(commits.slice(before)).toEqual(["create:root"]);
    expect(next.getAttribute("aria-expanded")).toBe("true");
    press(next);
    expect(menu()).not.toBeNull();
    click(next);
    expect(menu()).toBeNull();
  });
});
