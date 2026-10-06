/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingCloudProjectRecovery } from "../../../../src/features/cloud/workbench/MissingCloudProjectRecovery";
import { RepositoryCloudSwitchGate } from "../../../../src/features/cloud/workbench/RepositoryCloudSwitchGate";
import { CloudLocalOnlyWorkspace } from "../../../../src/features/cloud/initialization/CloudInitializationView";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { withTestLocalization } from "../../../support/react/localization";

const api = vi.hoisted(() => ({ getCloudRepositoryContext: vi.fn() }));
vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"), ...api,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = "http://localhost:9090/api/v1";
const session: DesktopCloudSession = { api_base_url: base, user_id: "user", user_email: "user@example.com",
  session_generation: "one", expires_at: 4102444800, expires_in: 3600, status: "authenticated" };
const oldUrl = "http://api.puppyone.ai/git/project-1.git";
const status = gitStatus({ remotes: [
  { name: "puppyone", fetchUrl: oldUrl, pushUrl: oldUrl, branches: [] },
  { name: "origin", fetchUrl: "https://github.com/fixture/project.git", pushUrl: "https://github.com/fixture/project.git", branches: [] },
] });
const missing = { status: "not-found", projectId: "project-1", message: cloudMessage("remote-not-found") } as const;
const remove = vi.fn();
const retry = vi.fn();
const publish = vi.fn();
let root: Root;
let host: HTMLDivElement;
function Harness({ currentStatus = status } = {}) {
  const [detached, setDetached] = useState(false);
  return <RepositoryCloudSwitchGate context={detached ? { status: "local-only", projectId: null } : missing}
    apiBaseUrl={base} authState={{ status: "signed-in", apiBaseUrl: base, session }} onRetry={retry}
    missingProjectRecovery={<MissingCloudProjectRecovery context={missing} status={currentStatus} session={session}
      apiBaseUrl={base} onRetry={retry} onRemoveCloudRemote={async expected => { await remove(expected); setDetached(true); }} />}
    publishEntry={<CloudLocalOnlyWorkspace activeSection="contents"
      workspace={{ id: "local", name: "Project", path: "/fixture/project", status: "recording" }}
      accountEmail={session.user_email} branchName="main" totalCommits={1} localChangeCount={0}
      isGitRepository hasHeadCommit hasCurrentBranch publishLoading={false}
      organizations={[{ id: "org", name: "Team" }]} selectedOrganizationId="org" organizationStatus="ready"
      onPublishWorkspace={publish} />} />;
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
async function beginReplacement() {
  await act(async () => host.querySelector<HTMLButtonElement>("[data-cloud-replace-action]")!.click());
}
async function confirmReplacement() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === "Continue")!;
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "https://api.puppyone.ai");
  api.getCloudRepositoryContext.mockReset(); remove.mockReset(); retry.mockReset(); publish.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllEnvs(); });

describe("missing Cloud project recovery", () => {
  it("retains the value cards and returns to the existing publish confirmation after a reviewed replacement", async () => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Project not found"), { status: 404 }));
    await render();
    expect(host.textContent).toContain("Share with your team");
    expect(host.textContent).not.toContain("current Cloud service");
    expect(host.textContent).not.toContain("Retry");
    expect(host.querySelector("[data-cloud-replace-action]")?.textContent).toBe("Share project to Cloud");
    expect(host.textContent).not.toContain("no longer exists");
    expect(remove).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    await beginReplacement();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("old Cloud Git connection");
    await confirmReplacement();
    expect(api.getCloudRepositoryContext).toHaveBeenCalledWith(session, "project-1",
      { kind: "project_root", project_id: "project-1" }, undefined, base);
    expect(remove).toHaveBeenCalledWith(status.remotes);
    expect(host.querySelector("[data-cloud-replace-action]")).toBeNull();
    expect(host.querySelector("[data-cloud-publish-action]")?.textContent).toBe("Share project to Cloud");
    expect(publish).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-cloud-publish-action]")!.click());
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === "Confirm")!;
    await act(async () => confirm.click());
    expect(publish).toHaveBeenCalledWith("org");
  });
  it("cancels without querying, disconnecting or publishing", async () => {
    await render(); await beginReplacement();
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === "Cancel")!;
    await act(async () => cancel.click());
    expect(api.getCloudRepositoryContext).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("reopens the old project when authorization starts succeeding again", async () => {
    api.getCloudRepositoryContext.mockResolvedValue({ project: { id: "project-1" }, target: { kind: "project_root", project_id: "project-1" } });
    await render(); await beginReplacement(); await confirmReplacement();
    expect(remove).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it.each([401, 403, 503, undefined])("preserves the connection on a non-404 failure (%s)", async statusCode => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Lookup failed"), { status: statusCode }));
    await render(); await beginReplacement(); await confirmReplacement();
    expect(remove).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Couldn’t replace");
  });
  it("discards authorization after leaving the reviewed repository/session", async () => {
    let reject!: (error: Error) => void;
    api.getCloudRepositoryContext.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await render(); await beginReplacement(); await confirmReplacement();
    await act(async () => root.render(null));
    await act(async () => reject(Object.assign(new Error("Project not found"), { status: 404 })));
    expect(remove).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });
  it("keeps a changed native connection intact and exposes recovery failure", async () => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Project not found"), { status: 404 }));
    remove.mockRejectedValue(new Error("Git remotes changed"));
    await render(); await beginReplacement(); await confirmReplacement();
    expect(publish).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
  });
  it("requires manual recovery for several Cloud remote aliases", async () => {
    await render({ currentStatus: gitStatus({ remotes: [...status.remotes, { ...status.remotes[0]!, name: "cloud-copy" }] }) });
    expect(host.querySelector("[data-cloud-replace-action]")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});
