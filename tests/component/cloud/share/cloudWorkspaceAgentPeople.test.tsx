/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentPeople } from "../../../../src/app/CloudWorkspaceAgentPeople";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", async original => ({
  ...await original<typeof import("../../../../src/lib/cloudApi")>(), cloudApiRequest: vi.fn(),
}));
vi.mock("../../../../src/features/cloud/share/CloudWorkspaceShareDialog", () => ({
  CloudWorkspaceShareDialog: ({ onAgentsChanged, agents }: { onAgentsChanged: () => void; agents: { name: string }[] }) =>
    <div role="dialog" data-agents={agents.map(agent => agent.name).join()}>
      <button data-changed onClick={onAgentsChanged}>changed</button>
    </div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { api_base_url: API, user_id: "alice", user_email: "alice@example.com",
  session_generation: "1" } as DesktopCloudSession;
const project = (kind: "project_root" | "scope" = "project_root"): ProjectCloudContext => ({ status: "resolved", projectId: "p1",
  target: kind === "scope" ? { kind, project_id: "p1", scope_id: "s" } : { kind, project_id: "p1" }, capabilities: ["content.read"] });
const connection = (id: string, name: string) => ({ id, name, admission: "sign_in", grant_id: `g-${id}`,
  connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z" });
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
let root: Root; let connections: ReturnType<typeof connection>[]; let sessions: unknown[];
const marks = () => [...document.querySelectorAll<HTMLElement>(".desktop-project-reach-mark:not([data-reach-viewer])")];
const viewer = () => document.querySelector<HTMLElement>(".desktop-project-reach-mark[data-reach-viewer]");
const people = () => document.querySelector<HTMLButtonElement>(".desktop-titlebar-reach-people");
const share = () => document.querySelector<HTMLButtonElement>('[data-cloud-workspace-tool="share"]')!;
const render = async (context = project(), mounted = true) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceHeaderTools context={context} session={session}
    apiBaseUrl={API} onSessionChange={vi.fn()} renderPeople={mounted ? value => <CloudWorkspaceAgentPeople {...value} /> : undefined} />)));
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  connections = []; sessions = [];
  vi.mocked(cloudApiRequest).mockImplementation(async path =>
    String(path).endsWith("/agent-links") ? { links: [], connections } : sessions);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("An Agent in the Header", () => {
  it("shows only the person looking while nobody has been let in", async () => {
    await render();
    expect(marks()).toEqual([]);
    expect(viewer()?.textContent).toBe("A");
    expect(viewer()?.dataset.reachAudience).toBe("person");
    expect(people()!.compareDocumentPosition(share()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("does not claim the person is alone, because Organization members may reach the project", async () => {
    await render();
    expect(people()!.getAttribute("aria-label")).toContain("alice@example.com");
    expect(people()!.getAttribute("aria-label")).not.toContain("Only you");
  });
  it("waits for a resolved workspace before saying who is in it", async () => {
    await render(null as unknown as ProjectCloudContext);
    expect(people()).toBeNull();
  });
  it("appears ahead of Share as soon as it is allowed", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].textContent).toBe("秘");
    expect(marks()[0].dataset.reachAudience).toBe("machine");
    expect(people()!.compareDocumentPosition(share()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("is lit only while it is active", async () => {
    connections = [connection("c1", "Quiet agent"), connection("c2", "Busy agent")];
    sessions = [{ grant_id: "g-c2", state: "closed", created_at: ago(11), closed_at: ago(10), lease_until: ago(-20) },
      { grant_id: "g-c1", state: "closed", created_at: ago(3601), closed_at: ago(3600), lease_until: ago(3570) }];
    await render();
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined]);
    expect(marks().map(mark => mark.textContent)).toEqual(["B", "Q"]);
    expect(people()!.dataset.reachState).toBe("working");
    expect(people()!.getAttribute("aria-label")).toContain("Busy agent");
  });
  it("opens Share instead of a second list, and tells Share what it knows", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => people()!.click());
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-agents")).toBe("秘书小陈");
    expect(document.querySelector(".desktop-project-reach-menu")).toBeNull();
    expect(people()!.hasAttribute("aria-expanded")).toBe(false);
  });
  it("disappears the moment Share removes the last one", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => people()!.click());
    connections = [];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-changed]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(marks()).toEqual([]);
    expect(viewer()).not.toBeNull();
  });
  it("collapses a crowd into a count and keeps the person looking beside Share", async () => {
    connections = ["A", "B", "C", "D", "E"].map(name => connection(name, name));
    await render();
    expect(marks()).toHaveLength(3);
    const count = document.querySelector(".desktop-project-reach-count")!;
    expect(count.textContent).toBe("+2");
    expect(count.compareDocumentPosition(viewer()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("states the Agents first and then the person looking", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    const label = people()!.getAttribute("aria-label")!;
    expect(label.indexOf("秘书小陈")).toBeLessThan(label.indexOf("alice@example.com"));
  });
  it("keeps the person looking when the server will not list the Agents", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    await render();
    expect(marks()).toEqual([]);
    expect(viewer()?.textContent).toBe("A");
  });
  it("does not look for Agents in a scoped view, which cannot have any", async () => {
    await render(project("scope"));
    expect(cloudApiRequest).not.toHaveBeenCalled();
    expect(viewer()).not.toBeNull();
  });
});
