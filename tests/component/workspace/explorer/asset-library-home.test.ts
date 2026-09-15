/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLibraryHome } from "../../../../src/components/AssetLibraryHome";
import type { MinimalOnboardingProps, ProjectHomeItem } from "../../../../src/components/MinimalOnboarding";
import { renderWithTestLocalization, stripBidiIsolation } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("local project library", () => {
  it("presents only repositories registered on this device", () => {
    const container = renderLibrary();

    expect(container.textContent).toContain("Projects");
    expect(container.textContent).toContain("Local Notes");
    expect(container.textContent).toContain("Brand System");
    expect(container.textContent).toContain("Research Atlas");
    expect(container.querySelectorAll(".asset-library-card-cover")).toHaveLength(3);
    expect(container.querySelectorAll(".asset-library-new-project")).toHaveLength(1);
    expect(container.textContent).not.toContain("New Cloud project");
    expect(container.textContent).not.toContain("Templates");
    expect(container.querySelector(".asset-library-home-filter-row")).toBeNull();
  });

  it("opens a repository through its filesystem path", async () => {
    const onOpenWorkspacePath = vi.fn(async () => undefined);
    const container = renderLibrary({ onOpenWorkspacePath });
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => stripBidiIsolation(candidate.getAttribute("aria-label")) === "Open Local Notes");
    if (!button) throw new Error("Local project button is missing.");

    await act(async () => button.click());

    expect(onOpenWorkspacePath).toHaveBeenCalledWith("/Users/example/Local Notes");
  });

  it("creates projects by choosing a local folder", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const container = renderLibrary({ onChooseWorkspace });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".asset-library-new-project")?.click();
    });

    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
  });
});

function renderLibrary(overrides: Partial<MinimalOnboardingProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: MinimalOnboardingProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    projectItems: items,
    appearance: createTestSurfaceAppearance(),
    ...overrides,
  };

  act(() => renderWithTestLocalization(root, React.createElement(AssetLibraryHome, props)));
  return container;
}

const items: ProjectHomeItem[] = [
  {
    id: "local-notes",
    label: "Local Notes",
    localPath: "/Users/example/Local Notes",
    lastOpenedAt: "2026-07-10T10:00:00.000Z",
  },
  {
    id: "brand-system",
    label: "Brand System",
    localPath: "/Users/example/brand-system",
    lastOpenedAt: "2026-07-09T10:00:00.000Z",
  },
  {
    id: "research-atlas",
    label: "Research Atlas",
    localPath: "/Users/example/research-atlas",
    lastOpenedAt: "2026-07-08T10:00:00.000Z",
  },
];
