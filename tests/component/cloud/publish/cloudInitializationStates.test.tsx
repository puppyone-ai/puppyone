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
  ["size limit rejected", { publishState: state, publishError: { code: "PUSH_LIMIT_EXCEEDED", retryable: true } }],
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
  it("offers sending again after Cloud explicitly refuses discard", () => {
    const container = render({
      publishState: { ...state, cleanup: "none", availableActions: ["retry-push"] },
      publishError: { code: "CLEANUP_NOT_ALLOWED", retryable: false },
    });
    expect(container.textContent).toContain("Cloud didn’t allow this project to be discarded");
    expect(container.textContent).not.toContain("Try again in a moment");
    expect(container.textContent).not.toContain("Discard didn’t finish");
    const buttons = [...container.querySelectorAll("button")].map(button => button.textContent);
    expect(buttons).toContain("Retry");
    expect(buttons).not.toContain("Discard");
  });

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

  it("requires confirmation to give up and supports cancel", () => {
    const onAbandonPublish = vi.fn();
    const container = render({ publishState: state, onAbandonPublish });
    click(container, "Discard");
    expect(onAbandonPublish).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toMatchSnapshot();
    click(container, "Cancel");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    click(container, "Discard");
    const confirm = container.querySelector<HTMLButtonElement>('[role="alertdialog"] button.primary');
    act(() => confirm?.click());
    expect(onAbandonPublish).toHaveBeenCalledTimes(1);
  });

  it("shows an unfinished publish as the progress view standing still, not a separate page", () => {
    const container = render({ publishState: { ...state, push: "uncertain", availableActions: ["reconcile"] } });
    expect(container.querySelector(".desktop-cloud-publish-running[data-paused]")).not.toBeNull();
    expect(container.querySelector(".desktop-cloud-publish-progress[data-paused] [aria-current='step']")?.textContent)
      .toContain("Stopped here");
    // Interrupted, not paused by anyone: the step carries a warning, never a pause mark.
    const progress = container.querySelector(".desktop-cloud-publish-progress[data-paused]");
    expect(progress?.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(progress?.querySelector(".lucide-pause")).toBeNull();
    expect(container.querySelector(".desktop-cloud-publish-primary")?.textContent).toBe("Retry");
    expect(container.textContent).toContain("check the result and send again if needed");
    expect(container.textContent).not.toContain("pick up where it left off");
    expect(container.textContent).not.toMatch(/\bPush\b/);
    expect(container.querySelector(".desktop-cloud-publish-hero, .desktop-cloud-publish-card")).toBeNull();
  });

  it("offers exactly two choices when paused: give up on it, or continue it", () => {
    const onAbandonPublish = vi.fn();
    const container = render({ publishState: state, onAbandonPublish });
    const footer = container.querySelector(".desktop-cloud-project-activation-actions");
    expect([...footer!.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Discard", "Retry"]);
    expect(container.textContent).not.toContain("Not now");
    click(container, "Discard");
    // Giving up deletes the empty Cloud project, so it asks first, with focus on the safe answer.
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-primary")?.disabled).toBe(true);
    expect(onAbandonPublish).not.toHaveBeenCalled();
  });

  it("finishes an unfinished discard with Discard, and never draws a send for it", () => {
    const onAbandonPublish = vi.fn();
    const discarding = { ...state, cleanup: "failed" as const, availableActions: ["finish-cleanup" as const] };
    const container = render({ publishState: discarding, onAbandonPublish });
    // The user already chose Discard; the screen says that, in that word, and
    // shows no send steps, because nothing will be sent again.
    expect(container.textContent).toContain("Discard didn’t finish");
    expect(container.querySelector(".desktop-cloud-publish-progress")).toBeNull();
    expect(container.textContent).not.toMatch(/Finish cleanup|Upload|branches or commits/);
    const button = container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-primary")!;
    expect(button.textContent).toBe("Discard");
    act(() => button.click());
    expect(onAbandonPublish).toHaveBeenCalledTimes(1);

    // While the deletion runs, loading has no send progress. It must stay on
    // this screen and say it is discarding, not restart the send from step one.
    rerender({ publishState: discarding, onAbandonPublish, publishLoading: true });
    expect(container.querySelector(".desktop-cloud-publish-running:not([data-paused])")).toBeNull();
    expect(container.textContent).not.toContain("Sending");
    const busy = container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-primary")!;
    expect(busy.textContent).toBe("Discarding…");
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");

    // It failed again: back to Discard, ready to try once more.
    rerender({ publishState: discarding, onAbandonPublish, publishLoading: false,
      publishError: { code: "CLEANUP_FAILED", retryable: true } });
    expect(container.querySelector(".desktop-cloud-publish-primary")?.textContent).toBe("Discard");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Couldn’t delete the empty cloud project. Try again in a moment.");
  });

  it("keeps a first Discard on its own screen instead of drawing a send", () => {
    const onAbandonPublish = vi.fn();
    const container = render({ publishState: state, onAbandonPublish });
    click(container, "Discard");
    act(() => container.querySelector<HTMLButtonElement>(".desktop-cloud-publish-resume-confirm-abandon")?.click());
    expect(onAbandonPublish).toHaveBeenCalledTimes(1);
    rerender({ publishState: state, onAbandonPublish, publishLoading: true });
    expect(container.querySelector(".desktop-cloud-publish-running:not([data-paused])")).toBeNull();
    expect(container.querySelector(".desktop-cloud-publish-resume-abandon")?.textContent).toBe("Discarding…");
  });

  it("still draws the send when a retry is running", () => {
    const container = render({ publishState: state, publishLoading: true, publishProgress: {
      rootPath: "/tmp/notes", operationId: "publish-1", stage: "validating", state, updatedAt: state.updatedAt,
    } });
    expect(container.querySelector(".desktop-cloud-publish-running:not([data-paused])")).not.toBeNull();
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
  rerender(overrides);
  return container;
}
/** Render into the current root again, keeping component state, as a prop change does. */
function rerender(overrides: Partial<Props>) {
  act(() => root.render(withTestLocalization(<CloudLocalOnlyWorkspace
    workspace={{ status: "recording", id: "notes", name: "Notes", path: "/tmp/notes" }} accountEmail="user@example.test"
    branchName="topic" totalCommits={2} localChangeCount={3} isGitRepository hasHeadCommit hasCurrentBranch publishLoading={false}
    organizations={[{ id: "org-1", name: "One" }]} selectedOrganizationId="org-1" organizationStatus="ready"
    onPublishWorkspace={vi.fn()} onAbandonPublish={vi.fn()} {...overrides}
  />)));
}
