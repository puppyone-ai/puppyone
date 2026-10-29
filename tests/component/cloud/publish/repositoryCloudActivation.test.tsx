/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudLocalOnlyWorkspace } from "../../../../src/features/cloud/initialization/CloudInitializationView";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://api.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "user", user_email: "user@example.com",
  session_generation: "one", expires_at: 4102444800, expires_in: 3600, status: "authenticated" };
let root: Root;
let host: HTMLDivElement;
const publish = vi.fn();
async function render() {
  await act(async () => root.render(withTestLocalization(<CloudLocalOnlyWorkspace activeSection="initialize"
    workspace={{ id: "local-project", name: "Project", path: "/fixture/project", status: "recording" }}
    accountEmail={session.user_email} branchName="main" totalCommits={1} localChangeCount={0}
    isGitRepository hasHeadCommit hasCurrentBranch publishLoading={false}
    organizations={[{ id: "org", name: "Team" }]} selectedOrganizationId="org" organizationStatus="ready"
    onPublishWorkspace={publish} />)));
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("putting a local folder in the Cloud", () => {
  it("states the value of the Cloud project before offering to create it", async () => {
    await render();
    expect(host.querySelector(".desktop-cloud-project-activation h2")?.textContent).toBe("Put Project in the cloud");
    expect(host.textContent).toContain("Share with teammates");
    expect(host.querySelector(".desktop-cloud-project-journey-people")?.textContent).toBe("AMJTeammatespuppyone.ai/…");
    const agents = host.querySelector('[role="list"][aria-label="Cloud agents"]')!;
    expect([...agents.querySelectorAll("li")].map(item => item.textContent)).toEqual(["Manus", "Viktor", "Grok Bot", "Any MCP client"]);
    const button = host.querySelector<HTMLButtonElement>("[data-cloud-publish-action]")!;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Upload to Cloud");
  });

  it("confirms that the Cloud project is a separate project before creating it (ADR-001)", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-cloud-publish-action]")!.click());
    expect(publish).not.toHaveBeenCalled();
    const confirmation = document.querySelector('[role="dialog"]')!;
    expect(confirmation.textContent).toContain("Creates the Cloud project ⁨Project⁩ from this folder’s Git-tracked files.");
    expect(confirmation.textContent).toContain("this folder stays a separate project on this computer");
    const confirm = [...confirmation.querySelectorAll("button")].find(button => button.textContent === "Confirm")!;
    await act(async () => confirm.click());
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("org");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
