/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudLocalOnlyWorkspace } from "../../../../src/features/cloud/initialization/CloudInitializationView";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("simple Cloud publish onboarding", () => {
  it("presents one activation action without the repository-to-Cloud diagram", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPublishWorkspace = vi.fn();

    act(() => root.render(withTestLocalization(
      <CloudLocalOnlyWorkspace
        workspace={{ status: "recording", id: "local-notes", name: "Local Notes", path: "/tmp/local-notes" }}
        accountEmail="dev@example.com"
        branchName="main"
        totalCommits={19}
        localChangeCount={3}
        publishReadiness="ready"
        isGitRepository
        hasHeadCommit
        hasCurrentBranch
        publishLoading={false}
        organizations={[{ id: "org-1", name: "PuppyOne" }]}
        selectedOrganizationId="org-1"
        organizationStatus="ready"
        onPublishWorkspace={onPublishWorkspace}
      />,
    )));

    expect(container.querySelector("h1")?.textContent).toBe("Serve this project via MCP");
    expect(container.textContent).toContain("ChatGPT");
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Manus");
    expect(container.textContent).toContain("Hermes");
    expect(container.textContent).toContain("Grok");
    expect(container.textContent).toContain("Get Started");
    expect(container.textContent).not.toContain("May upload");
    expect(container.textContent).not.toContain("19 commits");
    expect(container.textContent).not.toContain("New Cloud project");
    expect(container.querySelector(".desktop-cloud-publish-hero")).toBeNull();
    expect(container.querySelector(".desktop-cloud-git-prerequisite-steps")).toBeNull();
    expect(container.querySelector(".desktop-cloud-mcp-illustration")).not.toBeNull();
    const primary = container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-primary");
    expect(primary).not.toBeNull();

    act(() => primary?.click());
    const dialog = document.querySelector<HTMLElement>("#desktop-overlay-root [role='dialog']");
    expect(dialog?.textContent).toContain("May upload");
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(onPublishWorkspace).not.toHaveBeenCalled();

    const confirm = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Confirm");
    act(() => confirm?.click());
    expect(onPublishWorkspace).toHaveBeenCalledWith("org-1");

    act(() => root.unmount());
  });

  it("reduces the first upload to one vertical five-step task list", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(withTestLocalization(
      <CloudLocalOnlyWorkspace
        workspace={{ status: "recording", id: "local-notes", name: "Local Notes", path: "/tmp/local-notes" }}
        accountEmail="dev@example.com"
        branchName="main"
        totalCommits={1}
        localChangeCount={0}
        publishReadiness="ready"
        isGitRepository
        hasHeadCommit
        hasCurrentBranch
        publishLoading
        publishProgress={{
          rootPath: "/tmp/local-notes",
          operationId: "publish-1",
          stage: "uploading",
          state: null,
          updatedAt: "2026-08-27T00:00:00.000Z",
        }}
        organizations={[{ id: "org-1", name: "PuppyOne" }]}
        selectedOrganizationId="org-1"
        organizationStatus="ready"
        onPublishWorkspace={vi.fn()}
      />,
    )));

    const tasks = Array.from(container.querySelectorAll(".desktop-cloud-publish-progress li"));
    expect(tasks).toHaveLength(5);
    expect(Array.from(container.querySelectorAll(".desktop-cloud-publish-progress-marker"))
      .map((marker) => marker.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(tasks.slice(0, 3).every((task) => task.classList.contains("done"))).toBe(true);
    expect(tasks[3]?.classList.contains("current")).toBe(true);
    expect(tasks[3]?.textContent).toContain("Upload");
    expect(tasks[3]?.textContent).toContain("Uploading and publishing files…");
    expect(tasks[4]?.className).toBe("");
    expect(container.querySelector(".desktop-cloud-publish-hero")).toBeNull();
    expect(container.querySelector(".desktop-cloud-publish-summary")).toBeNull();
    expect(container.querySelector(".desktop-cloud-publish-primary")).toBeNull();

    act(() => root.unmount());
  });
});
