/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinimalOnboarding, type MinimalOnboardingProps } from "../../../../src/components/MinimalOnboarding";
import type { ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY } from "../../../../src/preferenceStorage";
import { desktopPreferencesStore as preferences, initializeDesktopPreferences } from "../../../../src/preferencesStore";
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

function renderHome(overrides: Partial<MinimalOnboardingProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: MinimalOnboardingProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    onOpenCloudProject: vi.fn(),
    onRemoveProject: vi.fn(async () => undefined),
    appearance: createTestSurfaceAppearance({}),
    projectItems,
    ...overrides,
  };
  act(() => renderWithTestLocalization(root!, React.createElement(MinimalOnboarding, props)));
  return { container, props };
}

const shownLayout = (container: HTMLElement) =>
  container.querySelector(".onboarding-project-list")?.getAttribute("data-project-layout");
const switchButton = (container: HTMLElement, layout: string) =>
  container.querySelector<HTMLButtonElement>(`[data-project-layout-option="${layout}"]`)!;
const pick = (container: HTMLElement, layout: string) => act(() => switchButton(container, layout).click());
const project = (container: HTMLElement, id: "local" | "linked" | "cloud") => {
  const wrap = [...container.querySelectorAll<HTMLElement>(".onboarding-project-row-wrap")];
  return { local: wrap[0], linked: wrap[1], cloud: wrap[2] }[id]!;
};

const originalConfirm = window.confirm;

beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); window.confirm = vi.fn(() => true); });

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("Homepage project layouts", () => {
  it("keeps the list as the default for everyone who never chose a layout", () => {
    const { container } = renderHome();
    expect(shownLayout(container)).toBe("list");
    expect(container.querySelectorAll(".onboarding-project-row")).toHaveLength(3);
    expect(container.querySelector(".onboarding-project-tile")).toBeNull();
    expect(switchButton(container, "list").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches on the Homepage itself, with no experimental setting involved", () => {
    const { container } = renderHome();
    expect(preferences.getState().experimentalSettings.enableAssetLibraryHome).toBe(false);
    for (const layout of LAYOUTS) {
      pick(container, layout);
      expect(shownLayout(container)).toBe(layout);
      expect(container.querySelectorAll(OPEN[layout])).toHaveLength(3);
      for (const option of LAYOUTS) {
        expect(switchButton(container, option).getAttribute("aria-pressed")).toBe(String(option === layout));
      }
    }
  });

  it("keeps the switch beside the title it answers, out of the Header", () => {
    const { container } = renderHome();
    expect(container.querySelector(".onboarding-brand-lockup .onboarding-project-layout-switch")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar .onboarding-project-layout-switch")).toBeNull();
  });

  it("names the switch and each layout for assistive technology", () => {
    const { container } = renderHome();
    const group = container.querySelector(".onboarding-project-layout-switch");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("Project layout");
    expect(LAYOUTS.map((layout) => switchButton(container, layout).getAttribute("aria-label"))).toEqual(["List", "Grid"]);
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

  it("falls back to the list for a stored value it does not know", () => {
    localStorage.setItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY, "mosaic");
    initializeDesktopPreferences();
    expect(shownLayout(renderHome().container)).toBe("list");
  });

  it("has nothing to arrange before there are projects", () => {
    const { container } = renderHome({ projectItems: [] });
    expect(container.querySelector(".onboarding-project-layout-switch")).toBeNull();
    expect(container.querySelector(".onboarding-project-list")).toBeNull();
  });

  it("leaves the layout alone while a project is opening", () => {
    const { container } = renderHome({ cloudOpening: true });
    for (const layout of LAYOUTS) expect(switchButton(container, layout).disabled).toBe(true);
  });

  it.each(LAYOUTS)("opens local and Cloud projects from the %s layout", async (layout) => {
    const { container, props } = renderHome();
    pick(container, layout);
    await act(async () => project(container, "local").querySelector<HTMLButtonElement>(OPEN[layout])!.click());
    expect(props.onOpenWorkspacePath).toHaveBeenCalledWith(local.localPath);
    await act(async () => project(container, "cloud").querySelector<HTMLButtonElement>(OPEN[layout])!.click());
    expect(props.onOpenCloudProject).toHaveBeenCalledWith("cloud-shared");
  });

  it.each(LAYOUTS)("keeps removal and the linked Cloud project in the %s layout", async (layout) => {
    const { container, props } = renderHome();
    pick(container, layout);
    await act(async () => project(container, "linked").querySelector<HTMLButtonElement>(".onboarding-project-cloud-link")!.click());
    expect(props.onOpenCloudProject).toHaveBeenCalledWith("cloud-site");
    await act(async () => project(container, "local").querySelector<HTMLButtonElement>(".onboarding-project-remove")!.click());
    expect(props.onRemoveProject).toHaveBeenCalledWith(local.localPath);
    expect(project(container, "cloud").querySelector(".onboarding-project-remove")).toBeNull();
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

  it("keeps every folder neutral and leaves the blue to the cloud alone", () => {
    const css = readFileSync("src/styles/onboarding.css", "utf8");
    const start = css.indexOf(".onboarding-project-folder {");
    const cloud = css.indexOf(".project-folder-cloud {");
    expect(start).toBeGreaterThan(-1);
    expect(cloud).toBeGreaterThan(start);
    expect(css.slice(start, cloud)).not.toMatch(/is-cloud|is-local|brand-blue|--po-accent|#[0-9a-f]{3,8}\b|gradient|shadow|url\(/i);
    expect(css.slice(cloud)).toMatch(/\.project-folder-cloud \{\s*fill: var\(--po-brand-blue\);/);
  });

  it("shows a project as one line of name and keeps all of it one hover away", () => {
    const { container } = renderHome();
    pick(container, "grid");
    const tile = project(container, "local").querySelector(".onboarding-project-tile");
    expect(tile?.textContent).toBe("notes");
    expect(tile?.getAttribute("data-tooltip")).toBe("notes · ~/project · 3 days ago");
    expect(project(container, "cloud").querySelector(".onboarding-project-tile")?.getAttribute("data-tooltip")).toBe("shared · Cloud project");
  });
});
