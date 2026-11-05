/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
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

/** Each group heading with the names listed under it, in page order. */
function groups(container: HTMLElement) {
  const result: Array<{ title: string; names: string[] }> = [];
  for (const node of container.querySelectorAll(".onboarding-host-groups > *")) {
    if (node.classList.contains("onboarding-host-group-title")) result.push({ title: node.textContent ?? "", names: [] });
    else if (result.length) {
      const other = node.getAttribute("data-test-other-computers");
      result.at(-1)!.names.push(other ?? node.textContent ?? "");
    }
  }
  return result;
}

describe("homepage grouped by machine", () => {
  it("shows this computer, the owner's other computers, then the Cloud as one group", () => {
    const container = renderHome({
      remoteFoldersSlot: <div data-test-other-computers="other computers">other computers</div>,
    });
    const shown = groups(container);
    expect(shown.map((group) => group.title)).toEqual(["This computer", "Cloud"]);
    // Local folders (with or without a Cloud link) are this computer's; Cloud projects are the Cloud's.
    expect(shown[0].names.join(" ")).toMatch(/notes/);
    expect(shown[0].names.join(" ")).toMatch(/site/);
    expect(shown[0].names).toContain("other computers");
    expect(shown[1].names.join(" ")).toMatch(/shared/);
    expect(shown[1].names.join(" ")).not.toMatch(/notes/);
  });

  it("keeps the single list when no other computer shares anything here", () => {
    const container = renderHome();
    expect(container.querySelector(".onboarding-host-groups")).toBeNull();
    expect(container.querySelectorAll(".onboarding-project-list")).toHaveLength(1);
  });
});
