/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudLocalOnlyWorkspace } from "../../../../src/features/cloud/initialization/CloudInitializationView";
import type { CloudPublishState } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });
type Props = ComponentProps<typeof CloudLocalOnlyWorkspace>;
const state: CloudPublishState = {
  operationId: "publish-1", session: "signed-in", project: "empty", push: "failed", local: "dirty", cleanup: "none",
  projectId: "project-1", projectName: "Notes", organizationId: "org-1", selectedSourceBranch: "topic", selectedSourceRef: "refs/heads/topic",
  latestSourceCommitOid: "abc", attemptId: "attempt-1", attemptCommitOid: "abc", attemptCount: 1, destinationBranch: "main",
  hasUncommittedChanges: true, currentBranch: "topic", lastError: null, availableActions: ["retry-push", "delete-empty-project"],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

const cases: Array<[string, Partial<Props>]> = [
  ["prerequisite", {}],
  ["waiting for sign in", { publishPending: true, accountEmail: null }],
  ["default validating progress", { publishLoading: true }],
  ["uploading with error", { publishProgress: { rootPath: "/tmp/notes", operationId: "publish-1", stage: "uploading", state, updatedAt: state.updatedAt }, publishError: { code: "PUSH_FAILED", retryable: true } }],
  ["state loading signed out", { publishStateLoading: true, accountEmail: null, organizationStatus: "signed-out" }],
  ["state loading sign in pending", { publishStateLoading: true, publishPending: true, accountEmail: null }],
  ["repository missing", { publishStateLoading: true, isGitRepository: false }],
  ["commit missing", { publishStateLoading: true, hasHeadCommit: false }],
  ["branch missing", { publishStateLoading: true, hasCurrentBranch: false }],
  ["explicit readiness", { publishStateLoading: true, publishReadiness: "commit-required" }],
  ["retry push", { publishState: state }],
  ["push latest", { publishState: { ...state, availableActions: ["push-latest"] } }],
  ["choose source", { publishState: { ...state, availableActions: ["choose-source"] } }],
  ["reconcile", { publishState: { ...state, push: "uncertain", availableActions: ["reconcile"] } }],
  ["no actions", { publishState: { ...state, push: "conflict", availableActions: [] } }],
  ["finish cleanup", { publishState: { ...state, cleanup: "failed", availableActions: ["finish-cleanup"] } }],
  ...(["signed-out", "loading", "none", "error", "selection-required", "ready"] as const).map((organizationStatus): [string, Partial<Props>] => [
    `organization ${organizationStatus}`, { publishStateLoading: true, organizationStatus, organizationError: organizationStatus === "error" ? "offline" : null },
  ]),
  ["multiple organizations", { publishStateLoading: true, organizations: [{ id: "org-1", name: "One" }, { id: "org-2", name: "Two" }] }],
  ["minimum change count", { publishState: state, localChangeCountIsMinimum: true }],
];

describe("Cloud initialization render contract captured before extraction", () => {
  it.each(cases)("locks %s", (_name, overrides) => {
    const container = render(overrides);
    expect({
      text: container.textContent,
      buttons: [...container.querySelectorAll("button")].map(button => ({ text: button.textContent, disabled: button.disabled, busy: button.getAttribute("aria-busy") })),
      alerts: [...container.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent),
      select: container.querySelector("select")?.outerHTML,
      hero: Boolean(container.querySelector(".desktop-cloud-publish-hero")),
      progress: Boolean(container.querySelector(".desktop-cloud-publish-running")),
    }).toMatchSnapshot();
  });

  it("requires confirmation to delete an empty project and supports cancel", () => {
    const onAbandonPublish = vi.fn();
    const container = render({ publishState: state, onAbandonPublish });
    click(container, "Delete empty Cloud project");
    expect(onAbandonPublish).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toMatchSnapshot();
    click(container, "Cancel");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    click(container, "Delete empty Cloud project");
    const confirm = container.querySelector<HTMLButtonElement>('[role="alertdialog"] button.primary');
    act(() => confirm?.click());
    expect(onAbandonPublish).toHaveBeenCalledTimes(1);
  });

  it("forwards organization selection, retry, and push intents", () => {
    const onPublishWorkspace = vi.fn();
    const container = render({ publishState: state, onPublishWorkspace });
    act(() => container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-primary")?.click());
    expect(onPublishWorkspace).toHaveBeenCalledWith("org-1");
  });
});

function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button, label).toBeDefined();
  act(() => button?.click());
}
function render(overrides: Partial<Props>) {
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(withTestLocalization(<CloudLocalOnlyWorkspace
    workspace={{ status: "recording", id: "notes", name: "Notes", path: "/tmp/notes" }} accountEmail="user@example.test"
    branchName="topic" totalCommits={2} localChangeCount={3} isGitRepository hasHeadCommit hasCurrentBranch publishLoading={false}
    organizations={[{ id: "org-1", name: "One" }]} selectedOrganizationId="org-1" organizationStatus="ready"
    onPublishWorkspace={vi.fn()} onAbandonPublish={vi.fn()} {...overrides}
  />)));
  return container;
}
