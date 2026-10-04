/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorInput } from "@puppyone/shared-ui";
import { EditorHeaderTabs } from "../../../../src/features/editor-workbench/header/EditorHeaderTabs";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("EditorHeaderTabs", () => {
  it("registers hidden scrollbar ownership and reveals the activated overflow tab", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const editors = Array.from({ length: 20 }, (_, index) => createEditorInput(`notes/${index}.md`));
    const props = {
      editors, fileIconTheme: "default" as const, storageIdentity: null,
      onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(),
    };
    act(() => root?.render(withTestLocalization(<EditorHeaderTabs {...props} activeEditorId={editors[0]!.id} />)));
    const tablist = container.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(tablist.dataset.poScrollbar).toBe("hidden");
    const lastTab = container.querySelector<HTMLButtonElement>(`[data-editor-tab-id="${editors[19]!.id}"]`)!;
    const scrollIntoView = vi.fn();
    lastTab.scrollIntoView = scrollIntoView;
    act(() => root?.render(withTestLocalization(<EditorHeaderTabs {...props} activeEditorId={editors[19]!.id} />)));
    expect(container.querySelector('[role="tablist"]')).toBe(tablist);
    expect(lastTab.getAttribute("aria-selected")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("switches files, closes through the host barrier, and opens the create menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onClose = vi.fn(async () => undefined);
    const onCreate = vi.fn();

    function Harness() {
      const [activeEditorId, setActiveEditorId] = React.useState("notes/a.md");
      return (
        <EditorHeaderTabs
          activeEditorId={activeEditorId}
          editors={[
            createEditorInput("notes/a.md", "a.md"),
            createEditorInput("notes/b.md", "b.md"),
          ]}
          fileIconTheme="default"
          storageIdentity={null}
          onActivate={setActiveEditorId}
          onClose={onClose}
          onCreate={onCreate}
          onMove={vi.fn()}
        />
      );
    }

    act(() => root?.render(withTestLocalization(<Harness />)));
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => tabs[1]?.click());
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close b.md"]')?.click();
    });
    expect(onClose).toHaveBeenCalledWith("notes/b.md");

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="New file"]')?.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0]?.[0]).toBeInstanceOf(DOMRect);
  });

  it("uses roving tab focus and activates the next file from the keyboard", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [activeEditorId, setActiveEditorId] = React.useState("a.md");
      return (
        <EditorHeaderTabs
          activeEditorId={activeEditorId}
          editors={[
            createEditorInput("a.md"),
            createEditorInput("b.md"),
            createEditorInput("c.md"),
          ]}
          fileIconTheme="default"
          storageIdentity={null}
          onActivate={setActiveEditorId}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onMove={vi.fn()}
        />
      );
    }

    act(() => root?.render(withTestLocalization(<Harness />)));
    const selected = () => container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    act(() => selected()?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
    })));
    expect(selected()?.textContent).toContain("b.md");

    act(() => selected()?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "End",
    })));
    expect(selected()?.textContent).toContain("c.md");
  });
});
