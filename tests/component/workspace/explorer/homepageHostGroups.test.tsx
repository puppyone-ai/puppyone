/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
import type { OnboardingGroupsBase } from "../../../../src/components/onboarding/OnboardingProjectGroups";
import type { ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const local: ProjectHomeItem = { id: "local", label: "notes", localPath: "/Users/me/project/notes" };
const linked: ProjectHomeItem = { id: "linked", label: "site", localPath: "/Users/me/project/site",
  linkedCloudProject: { id: "cloud-site", name: "site" } };
const cloud: ProjectHomeItem = { id: "cloud", label: "shared", localPath: "", cloudProjectId: "cloud-shared" };

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

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
    projectItems: [local, linked, cloud],
    ...overrides,
  };
  act(() => renderWithTestLocalization(root!, React.createElement(HomeWithEntryFlow, props)));
  return container;
}

/** Each group's title with the names listed under it, in page order. */
function groups(container: HTMLElement) {
  return [...container.querySelectorAll(".onboarding-project-group")].map((group) => ({
    title: group.querySelector(".onboarding-project-group-title")?.textContent ?? "",
    names: [...group.querySelectorAll(".onboarding-project-row-wrap")].map((row) => row.textContent ?? ""),
  }));
}

describe("homepage grouped by where each project is", () => {
  it("puts the Cloud's projects first, then this computer's folders", () => {
    const shown = groups(renderHome());
    expect(shown.map((group) => group.title)).toEqual(["Cloud", "This computer"]);
    expect(shown[0].names.join(" ")).toMatch(/shared/);
    expect(shown[0].names.join(" ")).not.toMatch(/notes/);
    // A folder with its own Cloud project is still this computer's folder.
    expect(shown[1].names.join(" ")).toMatch(/notes/);
    expect(shown[1].names.join(" ")).toMatch(/site/);
  });

  it("scrolls the page as one, so no group can cut off its own last row", () => {
    const container = renderHome();
    const page = container.querySelectorAll(".onboarding-project-groups");
    expect(page).toHaveLength(1);
    expect(page[0].querySelectorAll(".onboarding-project-list")).toHaveLength(2);
  });

  it("shows just the list, with no heading, when every project is in one place", () => {
    const container = renderHome({ projectItems: [local] });
    expect(container.querySelector(".onboarding-project-groups")).toBeNull();
    expect(container.querySelector(".onboarding-project-group-title")).toBeNull();
    expect(container.querySelectorAll(".onboarding-project-list")).toHaveLength(1);
  });

  it("hands the Cloud's and this computer's groups, in that order, to whoever adds other computers", () => {
    let handed: OnboardingGroupsBase | null = null;
    const container = renderHome({
      projectGroups: (base) => {
        handed = base;
        return <div data-test-other-computers="">other computers</div>;
      },
    });
    expect(container.querySelector("[data-test-other-computers]")).not.toBeNull();
    expect(handed!.cloud?.id).toBe("cloud");
    expect(handed!.local?.title).toBe("This computer");
    expect(handed!.showOtherComputers).toBe(true);
  });
});
