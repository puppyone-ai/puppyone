/**
 * @vitest-environment happy-dom
 */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingProjectList } from "../../../../src/components/onboarding/OnboardingProjectList";
import type { ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import type { HomepageProjectLayout } from "../../../../src/preferenceStorage";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLUMNS = 3;
const projects = (count: number): ProjectHomeItem[] => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, label: `Project ${index}`, localPath: `/projects/${index}`,
}));

let root: Root | null = null;
let setItems: (items: ProjectHomeItem[]) => void;

function List({ initial, layout }: { initial: ProjectHomeItem[]; layout: HomepageProjectLayout }) {
  const [items, update] = useState(initial);
  setItems = update;
  return (
    <OnboardingProjectList items={items} layout={layout} busy={false} openingPath={null} draggingPath={null}
      onOpen={() => undefined} onDragStart={() => undefined} onDragEnd={() => undefined}
      onRemove={async (path) => update((current) => current.filter((item) => item.localPath !== path))} />
  );
}

function render(count: number, layout: HomepageProjectLayout = "grid") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root!, <List initial={projects(count)} layout={layout} />));
  // A layout engine would put these in rows.
  controls().forEach((control, index) => {
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue({ top: Math.floor(index / COLUMNS) * 100 } as DOMRect);
  });
}

const controls = () => [...document.querySelectorAll<HTMLElement>("[data-project-open]")];
const focused = () => controls().indexOf(document.activeElement as HTMLElement);
const stops = () => [...document.querySelectorAll<HTMLElement>(".onboarding-project-list [tabindex='0']")];
const press = (key: string) => act(() => {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});
const start = (index: number) => act(() => controls()[index]!.focus());

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Homepage's project list", () => {
  it("is a list of its projects", () => {
    render(4);
    const list = document.querySelector(".onboarding-project-list")!;
    expect(list.tagName).toBe("UL");
    expect(list.querySelectorAll(":scope > li")).toHaveLength(4);
  });

  it("is one stop for Tab: the first project and that row's actions", () => {
    render(4);
    expect(stops().map((stop) => stop.closest("li"))).toEqual([
      controls()[0]!.closest("li"), controls()[0]!.closest("li"),
    ]);
  });

  it("moves the stop with focus, so Tab comes back to the project left", () => {
    render(4);
    start(2);
    expect(stops()[0]).toBe(controls()[2]);
  });

  it("walks a grid by cell and by row, stopping at its edges", () => {
    render(8);
    start(0);
    press("ArrowLeft");
    expect(focused()).toBe(0);
    press("ArrowUp");
    expect(focused()).toBe(0);
    press("ArrowRight");
    expect(focused()).toBe(1);
    press("ArrowDown");
    expect(focused()).toBe(1 + COLUMNS);
    press("ArrowDown");
    expect(focused()).toBe(7);
    press("ArrowDown");
    expect(focused()).toBe(7);
    press("ArrowUp");
    expect(focused()).toBe(7 - COLUMNS);
    press("Home");
    expect(focused()).toBe(0);
    press("End");
    expect(focused()).toBe(7);
  });

  it("drops to the last project from a column the shorter last row does not reach", () => {
    render(8);
    start(5);
    press("ArrowDown");
    expect(focused()).toBe(7);
  });

  it("walks a list one row at a time and leaves left and right alone", () => {
    render(3, "list");
    start(0);
    press("ArrowDown");
    expect(focused()).toBe(1);
    press("ArrowRight");
    expect(focused()).toBe(1);
    press("ArrowUp");
    expect(focused()).toBe(0);
  });

  it("flips left and right in a right-to-left layout", () => {
    render(3);
    document.querySelector<HTMLElement>(".onboarding-project-list")!.style.direction = "rtl";
    start(1);
    press("ArrowLeft");
    expect(focused()).toBe(2);
  });

  it("leaves the keys of a project's own controls alone", () => {
    render(3);
    const actions = document.querySelector<HTMLElement>(".onboarding-project-actions")!;
    act(() => actions.focus());
    press("ArrowDown");
    expect(document.activeElement).toBe(actions);
  });

  it("falls back to the first project when the stop's project goes", () => {
    render(4);
    start(3);
    act(() => setItems(projects(2)));
    expect(stops()[0]).toBe(controls()[0]);
  });

  it("gives focus to the list's stop when a project is removed from its own dialog", async () => {
    render(3);
    const actions = document.querySelector<HTMLElement>(".onboarding-project-actions")!;
    act(() => actions.focus());
    act(() => actions.click());
    const unlink = [...document.querySelectorAll<HTMLButtonElement>(".desktop-project-row-actions-menu .desktop-menu-item")].at(-1)!;
    act(() => unlink.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[role='dialog'] .desktop-dialog-button.destructive")!.click());

    expect(controls()).toHaveLength(2);
    expect(document.activeElement).toBe(controls()[0]);
  });
});
