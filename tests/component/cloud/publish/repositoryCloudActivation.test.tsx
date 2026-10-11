/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryCloudSwitchGate } from "../../../../src/features/cloud/workbench/RepositoryCloudSwitchGate";
import { CloudLocalOnlyWorkspace } from "../../../../src/features/cloud/initialization/CloudInitializationView";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://api.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "user", user_email: "user@example.com",
  session_generation: "one", expires_at: 4102444800, expires_in: 3600, status: "authenticated" };
let root: Root;
let host: HTMLDivElement;
const publish = vi.fn();
const retry = vi.fn();
function Harness({ signedIn = true, context = { status: "local-only", projectId: null }, initializationPending = false }: {
  signedIn?: boolean; context?: ProjectCloudContext; initializationPending?: boolean;
}) {
  return <RepositoryCloudSwitchGate apiBaseUrl={apiBaseUrl} context={context} onRetry={retry}
    authState={signedIn ? { status: "signed-in", apiBaseUrl, session } : { status: "signed-out", apiBaseUrl }}
    initializationPending={initializationPending}
    publishEntry={<CloudLocalOnlyWorkspace activeSection="contents"
      workspace={{ id: "local-project", name: "Project", path: "/fixture/project", status: "recording" }}
      accountEmail={session.user_email} branchName="main" totalCommits={1} localChangeCount={0}
      isGitRepository hasHeadCommit hasCurrentBranch publishLoading={false}
      organizations={[{ id: "org", name: "Team" }]} selectedOrganizationId="org" organizationStatus="ready"
      onPublishWorkspace={publish} />} />;
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("repository Cloud activation", () => {
  it("keeps the value surface after login and changes its action to publish this project", async () => {
    await render({ signedIn: false });
    const before = host.querySelector(".desktop-cloud-project-activation")!.getAttribute("aria-label");
    expect(host.querySelector("[data-cloud-sign-in-action]")).not.toBeNull();
    await render();
    expect(host.querySelector(".desktop-cloud-project-activation")!.getAttribute("aria-label")).toBe(before);
    expect(host.querySelector("[data-cloud-sign-in-action]")).toBeNull();
    expect(host.querySelector(".desktop-cloud-project-activation h2")?.textContent).toBe("Put Project in the cloud");
    expect(host.textContent).toContain("You decide who can read it");
    expect(host.textContent).not.toContain("Share with your team");
    const agents = host.querySelector('[role="list"][aria-label="Cloud agents"]')!;
    expect([...agents.querySelectorAll("li")].map(item => item.textContent)).toEqual(["Manus", "Viktor", "Grok Bot", "Any MCP client"]);
    const button = host.querySelector<HTMLButtonElement>("[data-cloud-publish-action]")!;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Upload to Cloud");
    await act(async () => button.click());
    expect(publish).not.toHaveBeenCalled();
    const confirmation = document.querySelector('[role="dialog"]')!;
    const confirm = [...confirmation.querySelectorAll("button")].find(button => button.textContent === "Confirm")!;
    await act(async () => confirm.click());
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("org");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("retains the publish owner while its new remote is already resolvable", async () => {
    await render({ initializationPending: true,
      context: { status: "resolved", projectId: "new", target: { kind: "project_root", project_id: "new" } } });
    expect(host.querySelector("[data-cloud-publish-action]")).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it("offers reconnection for a different Cloud host without creating another project", async () => {
    await render({ context: { status: "wrong-host", projectId: "existing",
      message: cloudMessage("remote-wrong-host", { origin: "https://other.puppyone.ai" }) } });
    expect(host.querySelector("[data-cloud-publish-action]")).toBeNull();
    expect(host.querySelector(".desktop-cloud-project-activation")?.getAttribute("aria-label")).toBe("Get Puppyone Cloud");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Cloud project unavailable");
    const details = host.querySelector<HTMLDetailsElement>("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("https://other.puppyone.ai");
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
