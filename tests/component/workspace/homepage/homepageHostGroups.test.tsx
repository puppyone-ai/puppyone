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
import { accessibleName, getByRole, queryAllByRole, readableText } from "../../../support/react/queries";
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

/** The groups: regions named by their own heading, unlike the page around them. */
const groupRegions = (container: HTMLElement) => queryAllByRole(container, "region")
  .filter((region) => queryAllByRole(region, "heading").some((heading) => accessibleName(heading) === accessibleName(region)));

/** Each group as announced: its name, and the projects listed under it, in page order. */
function groups(container: HTMLElement) {
  return groupRegions(container).map((group) => ({
    title: accessibleName(group),
    names: queryAllByRole(group, "listitem").map(readableText),
  }));
}

describe("homepage audience grouping", () => {
  it("keeps unresolved shared ownership reachable without misclassifying local folders", () => {
    const shown = groups(renderHome());
    expect(shown.map((group) => group.title)).toEqual(["On this computer", "Shared projects"]);
    expect(shown[1].names.join(" ")).toMatch(/shared/);
    expect(shown[1].names.join(" ")).not.toMatch(/notes/);
    // A folder with its own Cloud project is still this computer's folder.
    expect(shown[0].names.join(" ")).toMatch(/notes/);
    expect(shown[0].names.join(" ")).toMatch(/site/);
  });

  it("scrolls the page as one, so no group can cut off its own last row", () => {
    const container = renderHome();
    const regions = groupRegions(container);
    expect(regions.map((group) => queryAllByRole(group, "list"))).toHaveLength(2);
    // Every group sits in the same container, which the Homepage smoke checks is the one that scrolls.
    expect(new Set(regions.map((group) => group.parentElement)).size).toBe(1);
  });

  it("states the local-only audience even when it is the only group", () => {
    const container = renderHome({ projectItems: [local] });
    expect(groups(container).map((group) => group.title)).toEqual(["On this computer"]);
    expect(queryAllByRole(getByRole(container, "region", { name: "On this computer" }), "list")).toHaveLength(1);
  });

  it("hands audience composition to the owner of the device catalog", () => {
    let handed: OnboardingGroupsBase | null = null;
    const container = renderHome({
      projectGroups: (base) => {
        handed = base;
        return <div>other computers</div>;
      },
    });
    expect(readableText(container)).toContain("other computers");
    expect(handed!.cloud[0]?.id).toBe("shared-unresolved");
    expect(handed!.local?.title).toBe("On this computer");
    expect(handed!.cloud.map(group => group.title)).toEqual(["Shared projects"]);
  });
});
