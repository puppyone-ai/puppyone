/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canReplaceMissingCloudProject,
  MissingCloudProjectReplacement,
} from "../../../../src/features/cloud/project/MissingCloudProjectReplacement";
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
const cancel = vi.fn();
const done = vi.fn();
let root: Root;
let host: HTMLDivElement;
async function render() {
  await act(async () => root.render(withTestLocalization(<MissingCloudProjectReplacement context={missing} status={status}
    session={session} apiBaseUrl={base} onRemoveCloudRemote={remove} onCancel={cancel} onDone={done} />)));
}
async function press(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === label)!;
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubEnv("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "https://api.puppyone.ai");
  api.getCloudRepositoryContext.mockReset(); remove.mockReset(); cancel.mockReset(); done.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllEnvs(); });

describe("putting a folder in the Cloud again after its Cloud project disappeared", () => {
  it("is offered only for exactly one canonical Cloud remote on this app's Cloud", () => {
    expect(canReplaceMissingCloudProject(missing, status, base)).toBe(true);
    expect(canReplaceMissingCloudProject(missing, gitStatus({ remotes: [...status.remotes,
      { ...status.remotes[0]!, name: "cloud-copy" }] }), base)).toBe(false);
    expect(canReplaceMissingCloudProject({ ...missing, projectId: "other" }, status, base)).toBe(false);
    expect(canReplaceMissingCloudProject(missing, null, base)).toBe(false);
  });

  it("detaches exactly the reviewed remotes after confirming the old project is gone", async () => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Project not found"), { status: 404 }));
    await render();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("old Cloud Git connection");
    expect(remove).not.toHaveBeenCalled();
    await press("Continue");
    expect(api.getCloudRepositoryContext).toHaveBeenCalledWith(session, "project-1",
      { kind: "project_root", project_id: "project-1" }, undefined, base);
    expect(remove).toHaveBeenCalledWith(status.remotes);
    expect(done).toHaveBeenCalledWith("replaced");
  });

  it("cancels without querying or disconnecting", async () => {
    await render();
    await press("Cancel");
    expect(cancel).toHaveBeenCalledOnce();
    expect(api.getCloudRepositoryContext).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps the link when the old project is reachable again", async () => {
    api.getCloudRepositoryContext.mockResolvedValue({ project: { id: "project-1" }, target: { kind: "project_root", project_id: "project-1" } });
    await render();
    await press("Continue");
    expect(remove).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith("reconnected");
  });

  it.each([401, 403, 503, undefined])("preserves the connection on a non-404 failure (%s)", async statusCode => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Lookup failed"), { status: statusCode }));
    await render();
    await press("Continue");
    expect(remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Couldn’t replace");
  });

  it("discards authorization after leaving the reviewed folder or session", async () => {
    let reject!: (error: Error) => void;
    api.getCloudRepositoryContext.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await render();
    await press("Continue");
    await act(async () => root.render(null));
    await act(async () => reject(Object.assign(new Error("Project not found"), { status: 404 })));
    expect(remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps a changed native connection intact and says the replacement failed", async () => {
    api.getCloudRepositoryContext.mockRejectedValue(Object.assign(new Error("Project not found"), { status: 404 }));
    remove.mockRejectedValue(new Error("Git remotes changed"));
    await render();
    await press("Continue");
    expect(done).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
  });
});
