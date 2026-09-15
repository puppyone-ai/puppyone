/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopCreateEntryDialog,
  type DesktopCreateEntryDraft,
} from "../../../../../src/features/data-workspace/nodeActions";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Create entry dialog", () => {
  it("asks only for a name and never exposes or detects launch configuration", () => {
    const onCreate = vi.fn();
    const container = render(
      <DesktopCreateEntryDialog
        draft={createDraft()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.textContent).not.toContain("Detected start options");
    expect(container.textContent).not.toContain("Start command");
    expect(findButton(container, "Create")?.disabled).toBe(false);

    act(() => findButton(container, "Create")?.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["markdown", "Untitled.md", "Create Markdown file", "Markdown file name"],
    ["csv", "Untitled.csv", "Create CSV file", "CSV file name"],
    ["html", "Untitled.html", "Create HTML file", "HTML file name"],
    ["folder", "Untitled folder", "Create folder", "Folder name"],
  ] as const)("keeps the %s creation form concise", (selectedKind, name, title, accessibleName) => {
    const container = render(
      <DesktopCreateEntryDialog
        draft={createDraft({ selectedKind, name })}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(container.querySelector("h2")?.textContent).toBe(title);
    expect(container.querySelector(".desktop-dialog-title-row p")).toBeNull();
    expect(container.querySelector(".desktop-dialog-note")).toBeNull();
    expect(container.querySelector(".desktop-dialog-field > span")).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector("input")?.getAttribute("aria-label")).toBe(accessibleName);
  });

  it("shows the single built-in Slides template without exposing generic template plumbing", () => {
    const container = render(
      <DesktopCreateEntryDialog
        draft={createDraft({ selectedKind: "slides", name: "Untitled Slides" })}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector(".desktop-slides-template")?.textContent)
      .toContain("PuppyOne Starter");
    expect(container.textContent).not.toContain("Browse templates");
  });
});

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
  return container;
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === text);
}

function createDraft(
  overrides: Partial<DesktopCreateEntryDraft> = {},
): DesktopCreateEntryDraft {
  return {
    parentPath: null,
    anchor: { left: 20, top: 20, right: 44, bottom: 44, width: 24, height: 24 },
    error: null,
    creatingKind: null,
    selectedKind: "app",
    name: "Untitled App.puppyoneapp",
    ...overrides,
  };
}
