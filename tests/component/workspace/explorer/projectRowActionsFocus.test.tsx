/**
 * @vitest-environment happy-dom
 */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRowActions, type ProjectActionSurface } from "../../../../src/components/ProjectRowActions";
import { OnboardingToolbarMenu } from "../../../../src/components/onboarding/OnboardingToolbarMenu";
import { DesktopMenuItem } from "../../../../src/components/DesktopMenu";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const key = (element: Element, keyName: string) => act(() => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
});
const press = (element: Element) => act(() => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
const trigger = () => document.querySelector<HTMLButtonElement>(".project-actions-trigger")!;
const menu = () => document.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>(".desktop-project-row-actions-menu .desktop-menu-item")];

function Actions() {
  const [surface, setSurface] = useState<ProjectActionSurface>(null);
  return (
    <>
      <button type="button" className="elsewhere">Elsewhere</button>
      <ProjectRowActions
        project={{ name: "Alpha" }}
        surface={surface}
        onSurfaceChange={setSurface}
        triggerClassName="project-actions-trigger"
        onRename={async () => undefined}
        onDelete={async () => undefined}
      />
    </>
  );
}

function renderInApp(content: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root!, content));
}

function openMenu() {
  trigger().focus();
  press(trigger());
  expect(menu()).not.toBeNull();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a project's actions", () => {
  it("returns focus to its button when Escape closes the menu", () => {
    renderInApp(<Actions />);
    openMenu();
    expect(document.activeElement).toBe(menuItems()[0]);

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("leaves focus to a press elsewhere", () => {
    renderInApp(<Actions />);
    openMenu();
    const elsewhere = document.querySelector<HTMLButtonElement>(".elsewhere")!;

    act(() => {
      elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      elsewhere.focus();
    });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("returns focus to its button when a dialog from the menu closes", () => {
    renderInApp(<Actions />);
    openMenu();
    press(menuItems()[0]!);
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();

    press(dialog!.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button")!);

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("walks the menu with the arrows, wrapping at both ends, and reaches its ends with Home and End", () => {
    renderInApp(<Actions />);
    openMenu();
    const [first, last] = menuItems();
    const surface = menu()!;

    key(surface, "ArrowDown");
    expect(document.activeElement).toBe(last);
    key(surface, "ArrowDown");
    expect(document.activeElement).toBe(first);
    key(surface, "ArrowUp");
    expect(document.activeElement).toBe(last);
    key(surface, "Home");
    expect(document.activeElement).toBe(first);
    key(surface, "End");
    expect(document.activeElement).toBe(last);
  });

  it("closes the menu on Tab and hands focus back to its button", () => {
    renderInApp(<Actions />);
    openMenu();

    key(menu()!, "Tab");

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("a Homepage menu", () => {
  it("answers the same keys", () => {
    renderInApp(
      <OnboardingToolbarMenu label="Sort" triggerLabel="Sort" trigger={<span />} disabled={false}>
        {() => <><DesktopMenuItem label="One" /><DesktopMenuItem label="Two" /></>}
      </OnboardingToolbarMenu>,
    );
    const button = document.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
    press(button);
    const items = [...document.querySelectorAll<HTMLButtonElement>(".desktop-menu-item")];
    const surface = document.querySelector<HTMLElement>(".onboarding-view-menu")!;

    key(surface, "End");
    expect(document.activeElement).toBe(items[1]);
    key(surface, "Tab");
    expect(document.querySelector(".desktop-menu-item")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
