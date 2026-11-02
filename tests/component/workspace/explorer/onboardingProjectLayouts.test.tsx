/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
import { HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY, HOMEPAGE_PROJECT_SORT_STORAGE_KEY } from "../../../../src/preferenceStorage";
import { viewProjectHomeItems, type ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAYOUTS = ["list", "grid"] as const;
const OPEN = { list: ".onboarding-project-row", grid: ".onboarding-project-tile" };
const local: ProjectHomeItem = { id: "local", label: "notes", localPath: "/Users/me/project/notes", lastModifiedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() };
const linked: ProjectHomeItem = { id: "linked", label: "site", localPath: "/Users/me/project/site", linkedCloudProject: { id: "cloud-site", name: "site" } };
const cloud: ProjectHomeItem = { id: "cloud", label: "shared", localPath: "", cloudProjectId: "cloud-shared" };
const projectItems = [local, linked, cloud];

let root: Root | null = null;

function renderHome(overrides: Partial<HomeWithEntryFlowProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: HomeWithEntryFlowProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    onOpenCloudProject: vi.fn(),
    onRemoveProject: vi.fn(async () => undefined),
    appearance: createTestSurfaceAppearance({}),
    projectItems,
    ...overrides,
  };
  act(() => renderWithTestLocalization(root!, React.createElement(HomeWithEntryFlow, props)));
  return { container, props };
}

const shownLayout = (container: HTMLElement) =>
  container.querySelector(".onboarding-project-list")?.getAttribute("data-project-layout");
const toolbarControls = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>(".onboarding-project-view .onboarding-view-menu-root .po-icon-button")];
const layoutTrigger = (container: HTMLElement) => toolbarControls(container)[2]!;
const layoutOption = (container: HTMLElement, layout: string) =>
  container.querySelector<HTMLButtonElement>(`[data-project-layout-option="${layout}"]`)!;
const pick = (container: HTMLElement, layout: string) => {
  act(() => layoutTrigger(container).click());
  act(() => layoutOption(container, layout).click());
};
const project = (container: HTMLElement, id: "local" | "linked" | "cloud") => {
  const wrap = [...container.querySelectorAll<HTMLElement>(".onboarding-project-row-wrap")];
  return { local: wrap[0], linked: wrap[1], cloud: wrap[2] }[id]!;
};

const viewTriggers = (container: HTMLElement) => toolbarControls(container).slice(0, 2);
const withCloudActions = (overrides: Partial<HomeWithEntryFlowProps> = {}): Partial<MinimalOnboardingProps> => ({
  projectItems: [local, linked, { ...cloud, cloudActions: { rename: true, delete: true } }],
  onRenameProject: vi.fn(async () => undefined),
  onRenameCloudProject: vi.fn(async () => undefined),
  onDeleteCloudProject: vi.fn(async () => undefined),
  ...overrides,
});
const actionMenu = () => document.body.querySelector<HTMLElement>(".desktop-project-row-actions-menu");
const actionItems = () => [...(actionMenu()?.querySelectorAll<HTMLButtonElement>(".desktop-menu-item") ?? [])];
const menuLabels = () => actionItems().map((item) => item.textContent);
const actionItem = (label: string) => actionItems().find((item) => item.textContent === label);
const dialogButton = (selector: string) =>
  document.body.querySelector<HTMLButtonElement>(`.desktop-project-row-dialog .desktop-dialog-footer .desktop-dialog-button${selector}`)!;
const openActions = (container: HTMLElement, id: "local" | "linked" | "cloud") =>
  act(async () => project(container, id).querySelector<HTMLButtonElement>(".onboarding-project-actions")!.click());
const typeName = (name: string) => act(async () => {
  const input = document.body.querySelector<HTMLInputElement>(".desktop-project-row-dialog input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const menuItem = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLButtonElement>(".onboarding-view-menu .desktop-menu-item")]
  .find((candidate) => candidate.textContent === name);
/** Turns places on or off in the filter's menu, and closes it again. */
const togglePlaces = (container: HTMLElement, ...places: string[]) => {
  act(() => viewTriggers(container)[0]!.click());
  for (const place of places) act(() => menuItem(container, place)!.click());
  act(() => viewTriggers(container)[0]!.click());
};
const chooseSort = (container: HTMLElement, option: string) => {
  act(() => viewTriggers(container)[1]!.click());
  act(() => menuItem(container, option)!.click());
};
const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".onboarding-filter-chip")];

const originalConfirm = window.confirm;

beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); window.confirm = vi.fn(() => true); });

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("Homepage project order", () => {
  const view = (items: ProjectHomeItem[], sort: "modified" | "name", locale = "en") =>
    viewProjectHomeItems(items, { places: new Set(), sort, locale, untitled: "Untitled" }).map((item) => item.id);
  const item = (id: string, lastModifiedAt: string | null, label = id): ProjectHomeItem =>
    ({ id, label, localPath: `/p/${id}`, lastModifiedAt });

  it("puts the latest change first, unknown times last, and keeps the catalog's order for equals", () => {
    const items = [
      item("unknown", null),
      item("older", "2026-10-01T00:00:00Z"),
      item("invalid", "not a date"),
      item("newer", "2026-10-30T00:00:00Z"),
      item("older-too", "2026-10-01T00:00:00Z"),
    ];
    expect(view(items, "modified")).toEqual(["newer", "older", "older-too", "unknown", "invalid"]);
  });

  it("orders names the way a person reads them, without touching the catalog's list", () => {
    const items = [item("c", null, "Notes 10"), item("a", null, "notes 2"), item("b", null, "Archive")];
    expect(view(items, "name")).toEqual(["b", "a", "c"]);
    expect(items.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });
});

describe("Homepage project layouts", () => {
  it("opens on the Grid for everyone who never chose a layout", () => {
    const { container } = renderHome();
    expect(shownLayout(container)).toBe("grid");
    expect(container.querySelectorAll(".onboarding-project-tile")).toHaveLength(3);
    expect(container.querySelector(".onboarding-project-row")).toBeNull();
    expect(layoutTrigger(container).getAttribute("aria-label")).toBe("Project layout: Grid");
  });

  it("switches on the Homepage itself", () => {
    const { container } = renderHome();
    for (const layout of LAYOUTS) {
      pick(container, layout);
      expect(shownLayout(container)).toBe(layout);
      expect(container.querySelectorAll(OPEN[layout])).toHaveLength(3);
      act(() => layoutTrigger(container).click());
      for (const option of LAYOUTS) {
        expect(layoutOption(container, option).getAttribute("aria-checked")).toBe(String(option === layout));
      }
      act(() => layoutTrigger(container).click());
    }
  });

  it("shows the layout as one quiet icon, with the other layouts behind it", () => {
    const { container } = renderHome();
    expect(container.querySelector(".desktop-theme-segment")).toBeNull();
    expect(container.querySelector("[data-project-layout-option]")).toBeNull();
    expect(layoutTrigger(container).getAttribute("aria-haspopup")).toBe("menu");
    expect(layoutTrigger(container).textContent).toBe("");
    pick(container, "grid");
    expect(container.querySelector("[data-project-layout-option]")).toBeNull();
    expect(layoutTrigger(container).getAttribute("aria-label")).toBe("Project layout: Grid");
    expect(layoutTrigger(container).querySelector(".lucide-layout-grid")).not.toBeNull();
  });

  it("sets the toolbar just before New, with the product named in the Header", () => {
    const { container } = renderHome();
    const view = container.querySelector(".onboarding-brand-lockup .onboarding-project-toolbar .onboarding-project-view")!;
    const roots = [...view.querySelectorAll(":scope > .onboarding-view-menu-root")];
    expect(roots).toHaveLength(3);
    expect(roots[0]?.contains(viewTriggers(container)[0]!)).toBe(true);
    expect(roots[1]?.contains(viewTriggers(container)[1]!)).toBe(true);
    expect(roots[2]?.contains(layoutTrigger(container))).toBe(true);
    const head = [...container.querySelector(".onboarding-brand-lockup")!.children];
    expect(head.map((part) => part.className)).toEqual(["onboarding-project-toolbar", "onboarding-entry-menu-root"]);
    expect(container.querySelector(".onboarding-home-primary .onboarding-view-menu-root")).toBeNull();
    expect(container.querySelector(".desktop-titlebar .onboarding-view-menu-root")).toBeNull();
    expect(container.querySelector(".onboarding-brand-lockup img")).toBeNull();
    expect(container.querySelector(".onboarding-brand-prompt")).toBeNull();
    const brand = container.querySelector(".desktop-titlebar .onboarding-header-brand")!;
    expect(brand.textContent).toBe("puppyone");
    expect(brand.querySelector("img")).not.toBeNull();
  });

  it("names nothing in the Header until there are projects, when the page greets you itself", () => {
    const { container } = renderHome({ projectItems: [] });
    expect(container.querySelector(".desktop-titlebar .onboarding-header-brand")).toBeNull();
    expect(container.querySelector(".onboarding-brand-lockup img")).not.toBeNull();
  });

  it("keeps the arrow on the entry menu when New gives up its words", () => {
    const css = readFileSync("src/styles/onboarding.css", "utf8");
    const narrow = css.slice(css.indexOf("@media (max-width: 696px)"));
    expect(narrow).toMatch(/\.onboarding-entry-menu-root \.onboarding-entry-action \.po-button__label \{/);
    expect(narrow).not.toMatch(/\.onboarding-entry-menu-root \.po-button__label \{/);
    const { container } = renderHome();
    expect(container.querySelector("[data-onboarding-action='more'] .lucide-chevron-down")).not.toBeNull();
  });

  it("hangs each toolbar menu centred under its control", () => {
    const css = readFileSync("src/styles/onboarding.css", "utf8");
    expect(css).toMatch(/\.onboarding-view-menu \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/);
    expect(css).not.toMatch(/\.onboarding-view-menu \{[^}]*inset-inline-end/);
    const { container } = renderHome();
    act(() => viewTriggers(container)[0]!.click());
    expect(container.querySelector(".onboarding-view-menu")?.classList.contains("is-multiple")).toBe(true);
    act(() => viewTriggers(container)[0]!.click());
    act(() => viewTriggers(container)[1]!.click());
    expect(container.querySelector(".onboarding-view-menu")?.classList.contains("is-multiple")).toBe(false);
  });

  it("draws the toolbar as three icons, with their state left to the tooltip", () => {
    const { container } = renderHome();
    expect(container.querySelector(".onboarding-project-toolbar .lucide-chevron-down")).toBeNull();
    const controls = toolbarControls(container);
    expect(controls.map((control) => control.textContent)).toEqual(["", "", ""]);
    expect(controls.map((control) => control.getAttribute("data-tooltip"))).toEqual([
      "Filter projects",
      "Sort projects: Last modified",
      "Project layout: Grid",
    ]);
  });

  it("names each place with its product icon, in the menu and on its chip once chosen", () => {
    const { container } = renderHome();
    act(() => viewTriggers(container)[0]!.click());
    const icon = (name: string) => menuItem(container, name)?.querySelector("[data-product-icon]")?.getAttribute("data-product-icon");
    expect(icon("This computer")).toBe("local");
    expect(icon("Cloud projects")).toBe("cloud");
    act(() => menuItem(container, "Cloud projects")!.click());
    expect(chips(container)[0]?.querySelector("[data-product-icon='cloud']")).not.toBeNull();
  });

  it("offers every project first, ticked until a place is chosen, and nothing else", () => {
    const { container } = renderHome();
    act(() => viewTriggers(container)[0]!.click());
    const rows = () => [...container.querySelectorAll<HTMLElement>(".onboarding-view-menu .desktop-menu-item")];
    expect(rows().map((item) => item.textContent)).toEqual(["All projects", "This computer", "Cloud projects"]);
    expect(container.querySelectorAll(".onboarding-view-menu .desktop-menu-section")).toHaveLength(1);
    expect(menuItem(container, "All projects")?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(menuItem(container, "All projects"));
    act(() => menuItem(container, "Cloud projects")!.click());
    expect(menuItem(container, "All projects")?.getAttribute("aria-checked")).toBe("false");
    expect(menuItem(container, "Cloud projects")?.getAttribute("aria-checked")).toBe("true");
  });

  it("clears every filter from All projects, and stays open", () => {
    const { container } = renderHome();
    togglePlaces(container, "Cloud projects", "This computer");
    expect(chips(container)).toHaveLength(2);
    act(() => viewTriggers(container)[0]!.click());
    act(() => menuItem(container, "All projects")!.click());
    expect(chips(container)).toHaveLength(0);
    expect(container.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(3);
    expect(menuItem(container, "All projects")?.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps offering every place to someone with one kind of project, and strands no one", () => {
    const { container } = renderHome({ projectItems: [local, linked] });
    act(() => viewTriggers(container)[0]!.click());
    const item = (name: string) => [...container.querySelectorAll<HTMLButtonElement>(".onboarding-view-menu .desktop-menu-item")]
      .find((candidate) => candidate.textContent === name);
    expect(item("Cloud projects")?.disabled).toBe(true);
    expect(item("This computer")?.disabled).toBe(false);
  });

  it("drops a filter whose place empties out, and shows every project again", () => {
    const first = renderHome();
    togglePlaces(first.container, "Cloud projects");
    const props = { ...first.props, projectItems: [local, linked] };
    act(() => renderWithTestLocalization(root!, React.createElement(HomeWithEntryFlow, props)));
    expect(first.container.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(2);
    expect(chips(first.container)).toHaveLength(0);
    expect(viewTriggers(first.container)[0]?.getAttribute("aria-label")).toBe("Filter projects");
  });

  it("filters by any number of places, showing every project when none is chosen", () => {
    const { container } = renderHome();
    const shown = () => [...container.querySelectorAll(".onboarding-project-row-wrap")].map((row) => row.getAttribute("data-project-location"));
    expect(shown()).toEqual(["local", "local", "cloud"]);
    togglePlaces(container, "Cloud projects");
    expect(shown()).toEqual(["cloud"]);
    pick(container, "grid");
    expect(shown()).toEqual(["cloud"]);
    togglePlaces(container, "This computer");
    expect(shown()).toEqual(["local", "local", "cloud"]);
    togglePlaces(container, "Cloud projects");
    expect(shown()).toEqual(["local", "local"]);
    togglePlaces(container, "This computer");
    expect(shown()).toEqual(["local", "local", "cloud"]);
  });

  it("leaves the filter open while choosing several, and closes the order on its one choice", () => {
    const { container } = renderHome();
    act(() => viewTriggers(container)[0]!.click());
    const item = menuItem(container, "This computer")!;
    expect(item.getAttribute("role")).toBe("menuitemcheckbox");
    act(() => item.click());
    expect(container.querySelector(".onboarding-view-menu")).not.toBeNull();
    expect(menuItem(container, "This computer")?.getAttribute("aria-checked")).toBe("true");
    act(() => viewTriggers(container)[0]!.click());
    act(() => viewTriggers(container)[1]!.click());
    expect(menuItem(container, "Name")?.getAttribute("role")).toBe("menuitemradio");
    act(() => menuItem(container, "Name")!.click());
    expect(container.querySelector(".onboarding-view-menu")).toBeNull();
  });

  it("names each filter in force on the toolbar, one press from being taken off", () => {
    const { container } = renderHome();
    expect(chips(container)).toHaveLength(0);
    togglePlaces(container, "Cloud projects", "This computer");
    const view = container.querySelector(".onboarding-project-view")!;
    expect(view.firstElementChild).toBe(chips(container)[0]);
    expect(view.lastElementChild?.contains(layoutTrigger(container))).toBe(true);
    expect(chips(container).map((chip) => chip.textContent)).toEqual(["This computer", "Cloud projects"]);
    expect(chips(container)[1]?.getAttribute("aria-label")).toContain("Remove filter");
    expect(viewTriggers(container)[0]?.getAttribute("aria-label")).toBe("Filter projects: This computer, Cloud projects");
    act(() => chips(container)[1]!.click());
    expect(chips(container).map((chip) => chip.textContent)).toEqual(["This computer"]);
    expect(container.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(2);
  });

  it("forgets the filter on the next launch but remembers the order", () => {
    const { container } = renderHome();
    togglePlaces(container, "Cloud projects");
    chooseSort(container, "Name");
    expect(localStorage.getItem(HOMEPAGE_PROJECT_SORT_STORAGE_KEY)).toBe("name");
    act(() => { root?.unmount(); root = null; });
    initializeDesktopPreferences();
    const next = renderHome();
    expect(chips(next.container)).toHaveLength(0);
    expect(viewTriggers(next.container).map((trigger) => trigger.getAttribute("aria-label"))).toEqual(["Filter projects", "Sort projects: Name"]);
  });

  it("falls back to the latest modification for a stored order it does not know", () => {
    localStorage.setItem(HOMEPAGE_PROJECT_SORT_STORAGE_KEY, "shuffle");
    initializeDesktopPreferences();
    const { container } = renderHome();
    expect(viewTriggers(container).at(-1)?.getAttribute("aria-label")).toBe("Sort projects: Last modified");
  });

  it("marks the current choice and starts the keyboard on it", () => {
    const { container } = renderHome();
    chooseSort(container, "Name");
    act(() => viewTriggers(container)[1]!.click());
    const items = [...container.querySelectorAll<HTMLElement>(".onboarding-view-menu [role='menuitemradio']")];
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(items[1]);
  });

  it("keeps New one click away at the head of the page, with the other entries behind the arrow", () => {
    const { container } = renderHome();
    const head = container.querySelector(".onboarding-brand-lockup")!;
    expect(head.querySelector("[data-onboarding-action='create']")).not.toBeNull();
    expect(container.querySelector("[data-onboarding-action='open'], [data-onboarding-action='import']")).toBeNull();
    const more = head.querySelector<HTMLButtonElement>("[data-onboarding-action='more']")!;
    expect(more.getAttribute("aria-label")).toBe("More ways to start a project");
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("data-onboarding-action")).toBe("open");
  });

  it("moves through the entry menu by keyboard and hands focus back when dismissed", () => {
    const { container } = renderHome({ onImportSource: vi.fn(async () => false) });
    const more = container.querySelector<HTMLButtonElement>("[data-onboarding-action='more']")!;
    const press = (key: string) => act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    act(() => more.focus());
    act(() => more.click());
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-onboarding-action")).toBe("import");
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-onboarding-action")).toBe("open");
    press("Escape");
    expect(container.querySelector(".onboarding-entry-menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("closes the entry menu on a press outside it", () => {
    const { container } = renderHome();
    const more = container.querySelector<HTMLButtonElement>("[data-onboarding-action='more']")!;
    act(() => more.click());
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(container.querySelector(".onboarding-entry-menu")).toBeNull();
  });

  it("names the switch and each layout for assistive technology", () => {
    const { container } = renderHome();
    expect(layoutTrigger(container).getAttribute("aria-label")).toBe("Project layout: Grid");
    act(() => layoutTrigger(container).click());
    expect(container.querySelector(".onboarding-view-menu")?.getAttribute("aria-label")).toBe("Project layout");
    expect(LAYOUTS.map((layout) => layoutOption(container, layout).textContent)).toEqual(["List", "Grid"]);
  });

  it("remembers the choice across launches", () => {
    const { container } = renderHome();
    pick(container, "grid");
    expect(localStorage.getItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY)).toBe("grid");
    act(() => { root?.unmount(); root = null; });
    initializeDesktopPreferences();
    const next = renderHome();
    expect(shownLayout(next.container)).toBe("grid");
  });

  it("falls back to the Grid for a stored value it does not know", () => {
    localStorage.setItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY, "mosaic");
    initializeDesktopPreferences();
    expect(shownLayout(renderHome().container)).toBe("grid");
  });

  it("has nothing to arrange before there are projects", () => {
    const { container } = renderHome({ projectItems: [] });
    expect(container.querySelector(".onboarding-project-toolbar")).toBeNull();
    expect(container.querySelector(".onboarding-project-list")).toBeNull();
  });

  it("leaves the layout alone while a project is opening", () => {
    const { container } = renderHome({ cloudOpening: true });
    expect(layoutTrigger(container).disabled).toBe(true);
    expect(viewTriggers(container).every((trigger) => trigger.disabled)).toBe(true);
  });

  it.each(LAYOUTS)("opens local and Cloud projects from the %s layout", async (layout) => {
    const { container, props } = renderHome();
    pick(container, layout);
    await act(async () => project(container, "local").querySelector<HTMLButtonElement>(OPEN[layout])!.click());
    expect(props.onOpenWorkspacePath).toHaveBeenCalledWith(local.localPath);
    await act(async () => project(container, "cloud").querySelector<HTMLButtonElement>(OPEN[layout])!.click());
    expect(props.onOpenCloudProject).toHaveBeenCalledWith("cloud-shared");
  });

  it.each(LAYOUTS)("gives a folder and its linked Cloud project their own actions in the %s layout", async (layout) => {
    const { container, props } = renderHome(withCloudActions());
    pick(container, layout);
    await act(async () => project(container, "linked").querySelector<HTMLButtonElement>(".onboarding-project-cloud-link")!.click());
    expect(props.onOpenCloudProject).toHaveBeenCalledWith("cloud-site");

    await openActions(container, "local");
    expect(menuLabels()).toEqual(["Copy path", "Rename…", "Unlink…"]);
    expect(actionMenu()?.querySelector(".desktop-project-menu-header-path")?.textContent).toBe("~/project/notes");
    expect(actionMenu()?.style.width).toBe("224px");
    await act(async () => actionItem("Unlink…")!.click());
    await act(async () => dialogButton(".destructive").click());
    expect(props.onRemoveProject).toHaveBeenCalledWith(local.localPath);

    await openActions(container, "cloud");
    expect(menuLabels()).toEqual(["Rename…", "Delete…"]);
    expect(actionMenu()?.querySelector(".desktop-project-menu-header-path")).toBeNull();
    expect(actionMenu()?.style.width).toBe("184px");
    await act(async () => actionItem("Rename…")!.click());
    await typeName("renamed");
    await act(async () => dialogButton(".primary").click());
    expect(props.onRenameCloudProject).toHaveBeenCalledWith("cloud-shared", "renamed");
  });

  it("places the menu by its measured height, once the overlay has mounted it", async () => {
    const box = (top: number, right: number, width: number, height: number) =>
      ({ top, right, bottom: top + height, left: right - width, width, height, x: right - width, y: top, toJSON: () => ({}) });
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches(".desktop-project-row-actions-menu") ? box(0, 184, 184, 80) : box(700, 1000, 22, 22);
    });
    const { container } = renderHome(withCloudActions());
    await openActions(container, "cloud");
    measure.mockRestore();

    expect(actionMenu()?.style.top).toBe(`${700 - 4 - 80}px`);
    expect(actionMenu()?.style.left).toBe(`${1000 - 184}px`);
    expect(document.activeElement).toBe(actionItem("Rename…"));
  });

  it("leads a local menu with Copy path, without repeating the project's name", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderHome(withCloudActions({ projectItems: [{ ...local, label: "Display name" }, linked, cloud] }));
    await openActions(container, "local");

    expect(actionMenu()?.textContent).not.toContain("Display name");
    expect(document.activeElement).toBe(actionItem("Copy path"));
    await act(async () => actionItem("Copy path")!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(local.localPath);
    expect(menuLabels()).toEqual(["Copied", "Rename…", "Unlink…"]);
  });

  it("says so in the menu when the path cannot be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const { container } = renderHome(withCloudActions());
    await openActions(container, "local");
    await act(async () => actionItem("Copy path")!.click());
    expect(actionMenu()?.querySelector("[role=alert]")?.textContent).toBe("Couldn’t copy. Try again.");
    expect(menuLabels()).toContain("Copy path");
  });

  it("renames a local project from the Homepage by its path", async () => {
    const { container, props } = renderHome(withCloudActions());
    await openActions(container, "local");
    await act(async () => actionItem("Rename…")!.click());
    await typeName("renamed");
    await act(async () => dialogButton(".primary").click());
    expect(props.onRenameProject).toHaveBeenCalledWith(local.localPath, "renamed");
    expect(props.onRenameCloudProject).not.toHaveBeenCalled();
  });

  it("deletes a Cloud project only after a confirmation that opens on Cancel", async () => {
    const { container, props } = renderHome(withCloudActions());
    await openActions(container, "cloud");
    await act(async () => actionItem("Delete…")!.click());

    const dialog = document.body.querySelector<HTMLElement>(".desktop-project-row-dialog")!;
    expect(dialog.textContent).toMatch(/permanently deletes .*shared.* cannot be undone/s);
    expect(dialog.querySelector("[data-desktop-dialog-initial-focus]")?.textContent).toBe("Cancel");
    expect(props.onDeleteCloudProject).not.toHaveBeenCalled();
    await act(async () => dialogButton(":not(.destructive)").click());
    expect(props.onDeleteCloudProject).not.toHaveBeenCalled();

    await openActions(container, "cloud");
    await act(async () => actionItem("Delete…")!.click());
    await act(async () => dialogButton(".destructive").click());
    expect(props.onDeleteCloudProject).toHaveBeenCalledExactlyOnceWith("cloud-shared");
    expect(document.body.querySelector(".desktop-project-row-dialog")).toBeNull();
  });

  it("keeps the delete dialog up with the reason when the server refuses", async () => {
    const { container } = renderHome(withCloudActions({
      onDeleteCloudProject: vi.fn(async () => { throw new Error("Only admins can delete this project."); }),
    }));
    await openActions(container, "cloud");
    await act(async () => actionItem("Delete…")!.click());
    await act(async () => dialogButton(".destructive").click());
    expect(document.body.querySelector(".desktop-project-row-dialog [role=alert]")?.textContent).toBe("Only admins can delete this project.");
    expect(dialogButton(".destructive").disabled).toBe(false);
  });

  it.each([
    [{ rename: true, delete: false }, ["Rename…"]],
    [{ rename: false, delete: true }, ["Delete…"]],
  ])("offers a Cloud project only what the account may do (%j)", async (cloudActions, labels) => {
    const { container } = renderHome(withCloudActions({ projectItems: [local, linked, { ...cloud, cloudActions }] }));
    await openActions(container, "cloud");
    expect(menuLabels()).toEqual(labels);
    expect(actionMenu()?.querySelector(".desktop-menu-separator, [role=separator]")).toBeNull();
  });

  it.each([{ rename: false, delete: false }, undefined])("shows no actions on a Cloud project the account cannot change (%j)", (cloudActions) => {
    const { container } = renderHome(withCloudActions({ projectItems: [local, linked, { ...cloud, cloudActions }] }));
    expect(project(container, "cloud").querySelector(".onboarding-project-actions")).toBeNull();
    expect(project(container, "local").querySelector(".onboarding-project-actions")).not.toBeNull();
  });

  it.each(LAYOUTS)("drags a local project out of the %s layout", (layout) => {
    const { container } = renderHome();
    pick(container, layout);
    expect(project(container, "local").querySelector(OPEN[layout])?.getAttribute("draggable")).toBe("true");
    expect(project(container, "cloud").querySelector(OPEN[layout])?.getAttribute("draggable")).toBe("false");
  });

  it("flows the Grid in the list's own order, with nothing placed by hand", () => {
    const { container } = renderHome();
    const names = (layout: "list" | "grid") => [...container.querySelectorAll(OPEN[layout])]
      .map((element) => element.getAttribute("aria-label"));
    pick(container, "list");
    const order = names("list");
    pick(container, "grid");
    expect(names("grid")).toEqual(order);
    const list = container.querySelector(".onboarding-project-list")!;
    expect([...list.children].every((child) => child.classList.contains("onboarding-project-row-wrap"))).toBe(true);
    expect([...list.children].every((child) => !child.hasAttribute("style"))).toBe(true);
  });

  it.each(LAYOUTS)("labels each project for what opening it does in the %s layout", (layout) => {
    const { container } = renderHome();
    pick(container, layout);
    const label = (id: "local" | "cloud") => project(container, id).querySelector(OPEN[layout])?.getAttribute("aria-label");
    expect(label("local")).toContain("notes");
    expect(label("cloud")).toContain("shared");
    expect(label("local")).not.toBe(label("cloud"));
  });

  it("tells local and Cloud folders apart at a glance", () => {
    const { container } = renderHome();
    pick(container, "grid");
    expect(container.querySelector(".onboarding-project-tile .onboarding-project-icon")).toBeNull();
    const folder = (id: "local" | "linked" | "cloud") => project(container, id).querySelector(".onboarding-project-folder")!;
    expect(folder("local").querySelector(".project-folder-cloud")).toBeNull();
    expect(folder("local").querySelector(".onboarding-project-cloud-badge")).toBeNull();
    expect(folder("cloud").querySelector(".project-folder-cloud")).not.toBeNull();
    expect(folder("cloud").querySelector(".onboarding-project-cloud-badge")).toBeNull();
    expect(folder("linked").querySelector(".project-folder-cloud")).toBeNull();
    expect(folder("linked").querySelector(".onboarding-project-cloud-badge")).not.toBeNull();
  });

  it("draws the list's folders in the Grid's fill", () => {
    const { container } = renderHome();
    pick(container, "list");
    const icon = (id: "local" | "linked" | "cloud") => project(container, id).querySelector(".onboarding-project-icon")!;
    expect(icon("local").querySelector(".project-folder-front")).not.toBeNull();
    expect(icon("linked").querySelector(".project-folder-front")).not.toBeNull();
    expect(icon("linked").querySelector(".onboarding-project-cloud-badge")).not.toBeNull();
    expect(icon("cloud").querySelector(".project-folder-front")).toBeNull();
  });

  it("keeps one sheet behind a folder's front, centred, showing nothing until you reach for it", () => {
    const { container } = renderHome();
    pick(container, "grid");
    const folder = project(container, "local").querySelector(".project-folder-glyph")!;
    expect(folder.querySelectorAll(".project-folder-sheet")).toHaveLength(1);
    const sheet = folder.querySelector(".project-folder-sheet rect")!;
    expect(Number(sheet.getAttribute("x")) + Number(sheet.getAttribute("width")) / 2).toBe(24);
    expect(Number(sheet.getAttribute("y"))).toBeGreaterThan(11);
    const paint = [...folder.children].map((node) => node.getAttribute("class"));
    expect(paint.indexOf("project-folder-sheet")).toBeLessThan(paint.indexOf("project-folder-front"));
    const css = readFileSync("src/styles/onboarding.css", "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.project-folder-sheet \{\s*transition: none;/);
  });

  it("keeps every folder neutral, fill alone, and leaves the blue to the cloud", () => {
    const css = readFileSync("src/styles/onboarding.css", "utf8");
    const start = css.indexOf(".onboarding-project-folder {");
    const cloud = css.indexOf(".project-folder-cloud {");
    expect(start).toBeGreaterThan(-1);
    expect(cloud).toBeGreaterThan(start);
    expect(css.slice(start, cloud)).not.toMatch(/is-cloud|is-local|brand-blue|--po-accent|#[0-9a-f]{3,8}\b|gradient|shadow|stroke|url\(/i);
    expect(css.slice(cloud)).toMatch(/\.project-folder-cloud \{\s*fill: none;\s*stroke: color-mix\(in srgb, var\(--po-brand-blue\) 84%, var\(--po-text\)\);/);
  });

  it("names a project under its folder, and leaves the tooltip for what is not shown", () => {
    const { container } = renderHome();
    pick(container, "grid");
    const tile = project(container, "local").querySelector(".onboarding-project-tile");
    expect(tile?.textContent).toBe("notes");
    expect(tile?.getAttribute("data-tooltip")).toBe("~/project · 3 days ago");
    expect(project(container, "cloud").querySelector(".onboarding-project-tile")?.getAttribute("data-tooltip")).toBe("Cloud project");
  });

  it("adds the name to the tooltip only when the line under the folder has cut it", () => {
    const { container } = renderHome();
    pick(container, "grid");
    const tile = project(container, "local").querySelector<HTMLButtonElement>(".onboarding-project-tile")!;
    const name = tile.querySelector(".onboarding-project-tile-name")!;
    expect(tile.getAttribute("data-tooltip")).toBe("~/project · 3 days ago");
    Object.defineProperty(name, "scrollWidth", { configurable: true, value: 180 });
    Object.defineProperty(name, "clientWidth", { configurable: true, value: 120 });
    act(() => tile.focus());
    expect(tile.getAttribute("data-tooltip")).toBe("notes · ~/project · 3 days ago");
  });
});
