/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopCreateEntryMenu,
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

describe("App and Slides creation", () => {
  it.each(["app", "slides"] as const)(
    "creates %s in one step from the menu without exposing launch configuration or template plumbing",
    (kind) => {
      const onSelectKind = vi.fn();
      const container = render(
        <DesktopCreateEntryMenu
          draft={createDraft()}
          mainEntries={["customFiles"]}
          submenuItemKinds={["app", "slides"]}
          onCancel={vi.fn()}
          onSelectKind={onSelectKind}
        />,
      );
      const label = kind === "app" ? "PuppyOne app" : "Slides";

      expect(container.querySelector("input")).toBeNull();
      expect(container.textContent).not.toContain("Detected start options");
      expect(container.textContent).not.toContain("Start command");
      expect(container.textContent).not.toContain("Browse templates");

      act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === label)?.click());
      expect(onSelectKind).toHaveBeenCalledWith(kind);
    },
  );
});

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
  return container;
}

function createDraft(): DesktopCreateEntryDraft {
  return {
    parentPath: null,
    anchor: { left: 20, top: 20, right: 44, bottom: 44, width: 24, height: 24 },
    error: null,
    creatingKind: null,
  };
}
