/**
 * @vitest-environment happy-dom
 */
import React, { useState } from "react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateNewSettingsView } from "../../../../src/features/settings/main/CreateNewSettingsView";
import {
  cloneDefaultCreateNewMenuSettings,
  DEFAULT_EXPERIMENTAL_SETTINGS,
  type CreateNewMenuSettings,
} from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Create New settings", () => {
  it("renders one connected hierarchy with a nested submenu and a Not shown group", () => {
    const container = render(defaultSettings(), vi.fn());

    expect(container.textContent).toContain("Main menu");
    expect(container.textContent).toContain("Not shown");
    expect(container.textContent).not.toContain("Folder stays fixed");
    expect(container.textContent).not.toContain("Items here do not appear");
    expect(container.querySelectorAll(".desktop-settings-switch")).toHaveLength(0);
    expect(container.querySelector(".desktop-create-new-location-select")).toBeNull();
    expect(readEntries(container, "main")).toEqual([
      "markdown",
      "csv",
      "html",
      "customFiles",
    ]);
    expect(readEntries(container, "submenu")).toEqual(["contextMap"]);
    expect(readEntries(container, "hidden")).toEqual(["text", "json", "slides", "app", "puppyflow"]);

    const submenuNode = container.querySelector('[data-entry="customFiles"]')
      ?.closest(".desktop-create-new-submenu-node");
    expect(submenuNode?.querySelector('[data-entry="contextMap"]')).not.toBeNull();
  });

  it("reorders the Custom files node by dragging without move buttons", () => {
    const onChange = vi.fn();
    const container = render(defaultSettings(), onChange);
    const dragHandle = container.querySelector(
      '[data-entry="customFiles"] .desktop-create-new-drag-handle',
    );
    const htmlRow = container.querySelector('[data-entry="html"]');
    if (!(dragHandle instanceof HTMLElement) || !(htmlRow instanceof HTMLElement)) {
      throw new Error("Expected drag source and target");
    }
    const dataTransfer = createDataTransfer();

    expect(container.querySelector(".desktop-create-new-order-controls")).toBeNull();
    act(() => dragHandle.dispatchEvent(createDragEvent("dragstart", dataTransfer)));
    act(() => htmlRow.dispatchEvent(createDragEvent("dragover", dataTransfer)));
    act(() => htmlRow.dispatchEvent(createDragEvent("drop", dataTransfer)));

    expect(onChange).toHaveBeenLastCalledWith({
      version: 5,
      main: ["markdown", "csv", "customFiles", "html"],
      submenu: ["contextMap"],
      hidden: ["text", "json", "slides", "app", "puppyflow"],
    });
    expect(readEntries(container, "main")).toEqual([
      "markdown",
      "csv",
      "customFiles",
      "html",
    ]);
  });

  it("moves an item from the main menu to Not shown by dragging", () => {
    const onChange = vi.fn();
    const container = render(defaultSettings(), onChange);
    const dragHandle = container.querySelector('[data-entry="csv"] .desktop-create-new-drag-handle');
    const hiddenDropZone = container.querySelector(
      '.desktop-create-new-hidden-list .desktop-create-new-drop-zone[data-group="hidden"]',
    );
    if (!(dragHandle instanceof HTMLElement) || !(hiddenDropZone instanceof HTMLElement)) {
      throw new Error("Expected drag source and Not shown drop target");
    }
    const dataTransfer = createDataTransfer();

    act(() => dragHandle.dispatchEvent(createDragEvent("dragstart", dataTransfer)));
    act(() => hiddenDropZone.dispatchEvent(createDragEvent("dragover", dataTransfer)));
    act(() => hiddenDropZone.dispatchEvent(createDragEvent("drop", dataTransfer)));

    expect(onChange).toHaveBeenLastCalledWith({
      version: 5,
      main: ["markdown", "html", "customFiles"],
      submenu: ["contextMap"],
      hidden: ["text", "json", "slides", "app", "puppyflow", "csv"],
    });
    expect(readEntries(container, "main")).toEqual(["markdown", "html", "customFiles"]);
    expect(readEntries(container, "hidden")).toEqual(["text", "json", "slides", "app", "puppyflow", "csv"]);
  });

  it("drags an item directly from Not shown into the Custom files submenu", () => {
    const onChange = vi.fn();
    const container = render(defaultSettings(), onChange);
    const dragHandle = container.querySelector('[data-entry="text"] .desktop-create-new-drag-handle');
    const submenuDropZone = container.querySelector(
      '.desktop-create-new-submenu-children .desktop-create-new-drop-zone[data-group="submenu"]',
    );
    if (!(dragHandle instanceof HTMLElement) || !(submenuDropZone instanceof HTMLElement)) {
      throw new Error("Expected drag source and submenu drop target");
    }
    const dataTransfer = createDataTransfer();

    act(() => dragHandle.dispatchEvent(createDragEvent("dragstart", dataTransfer)));
    act(() => submenuDropZone.dispatchEvent(createDragEvent("dragover", dataTransfer)));
    act(() => submenuDropZone.dispatchEvent(createDragEvent("drop", dataTransfer)));

    expect(onChange).toHaveBeenLastCalledWith({
      version: 5,
      main: ["markdown", "csv", "html", "customFiles"],
      submenu: ["contextMap", "text"],
      hidden: ["json", "slides", "app", "puppyflow"],
    });
    expect(readEntries(container, "submenu")).toEqual(["contextMap", "text"]);
    expect(readEntries(container, "hidden")).toEqual(["json", "slides", "app", "puppyflow"]);
  });

  it("keeps unavailable experimental types visible in the hierarchy", () => {
    const container = render(defaultSettings(), vi.fn());
    const puppyflow = container.querySelector<HTMLElement>('[data-entry="puppyflow"]');

    expect(puppyflow?.dataset.group).toBe("hidden");
    expect(puppyflow?.dataset.unavailable).toBe("true");
  });

  it("uses Settings surface tokens instead of popup-menu colors and shadows", () => {
    const css = readFileSync("src/styles/settings-new-menu.css", "utf8");

    expect(css).toContain("padding-inline: 10px");
    expect(css).toContain("background: var(--po-panel)");
    expect(css).toContain("border: 1px solid var(--po-border-subtle)");
    expect(css).not.toContain("var(--po-menu-bg)");
    expect(css).not.toContain("var(--po-menu-shadow");
  });
});

function render(settings: CreateNewMenuSettings, onChange: (settings: CreateNewMenuSettings) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  function Harness() {
    const [currentSettings, setCurrentSettings] = useState(settings);
    return (
      <CreateNewSettingsView
        settings={currentSettings}
        experimentalSettings={DEFAULT_EXPERIMENTAL_SETTINGS}
        fileIconTheme="default"
        onChange={(nextSettings) => {
          setCurrentSettings(nextSettings);
          onChange(nextSettings);
        }}
      />
    );
  }

  root = createRoot(container);
  act(() => root?.render(withTestLocalization(<Harness />)));
  return container;
}

function readEntries(container: HTMLElement, group: "main" | "submenu" | "hidden"): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`.desktop-create-new-row[data-group="${group}"]`),
    (element) => element.dataset.entry ?? "",
  );
}

function defaultSettings(): CreateNewMenuSettings {
  return cloneDefaultCreateNewMenuSettings();
}

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
  } as DataTransfer;
}

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: 0 });
  return event;
}
