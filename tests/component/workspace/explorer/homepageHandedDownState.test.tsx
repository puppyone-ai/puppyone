/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = { id: "alpha", label: "Alpha", localPath: "/projects/alpha" };
const appearance = createTestSurfaceAppearance({});

let root: Root | null = null;

function show(overrides: Partial<HomeWithEntryFlowProps>) {
  const props: HomeWithEntryFlowProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    appearance,
    ...overrides,
  };
  act(() => renderWithTestLocalization(root!, React.createElement(HomeWithEntryFlow, props)));
}

const failure = () => document.querySelector(".onboarding-homepage-error")?.textContent ?? null;
const page = () => document.querySelector(".onboarding-homepage");
const intro = () => document.querySelector("[data-onboarding-empty-state-intro]");

beforeEach(() => {
  initializeDesktopPreferences();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("what the Homepage is handed", () => {
  it("shows a failure handed down, and a later one in its place", () => {
    show({ projectItems: [project], initialError: "The first failure" });
    expect(failure()).toBe("The first failure");

    show({ projectItems: [project], initialError: "The second failure" });
    expect(failure()).toBe("The second failure");
  });

  it("does not bring back a failure the page's own action has cleared", async () => {
    show({ projectItems: [project], initialError: "The failure" });

    await act(async () => document.querySelector<HTMLButtonElement>(".onboarding-project-tile, .onboarding-project-row")!.click());
    expect(failure()).toBeNull();

    show({ projectItems: [project], initialError: "The failure" });
    expect(failure()).toBeNull();
  });

  it("holds the page inert for the intro of a page that became empty, and ends it if the page fills", () => {
    show({ projectItems: [project] });
    expect(intro()).toBeNull();
    expect(page()?.hasAttribute("inert")).toBe(false);

    show({ projectItems: [] });
    expect(intro()).not.toBeNull();
    expect(page()?.hasAttribute("inert")).toBe(true);

    show({ projectItems: [project] });
    expect(intro()).toBeNull();
    expect(page()?.hasAttribute("inert")).toBe(false);
  });
});
