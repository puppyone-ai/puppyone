/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  CloudWorkspaceShareDialog: () => <div role="dialog" data-panel="share" />,
}));
vi.mock("../../../../src/features/cloud/share/CloudWorkspaceAgentsPanel", () => ({
  CloudWorkspaceAgentsPanel: ({ onManage, agents, requests, control }: { onManage: () => void;
    agents: { name: string }[]; requests: { name: string }[];
    control: { waiting: boolean; onInvited: () => void; onChanged: () => void } | null }) =>
    <div role="dialog" data-panel="agents" data-agents={agents.map(agent => agent.name).join()}
      data-requests={requests.map(request => request.name).join()} data-control={Boolean(control)}
      data-waiting={control?.waiting}>
      <button data-manage onClick={onManage}>manage</button>
      <button data-invited onClick={control?.onInvited}>invited</button>
      <button data-answered onClick={control?.onChanged}>answered</button>
    </div>,
}));
vi.mock("../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog", () => ({
  CloudWorkspaceAgentsDialog: ({ onChanged }: { onChanged: () => void }) =>
    <div role="dialog" data-panel="manage"><button data-changed onClick={onChanged}>changed</button></div>,
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
const request = (id: string, name: string) => ({ id, name, admission: "sign_in", requested_at: ago(30),
  expires_at: new Date(Date.now() + 600_000).toISOString() });
let root: Root; let connections: ReturnType<typeof connection>[]; let pending: ReturnType<typeof request>[];
let sessions: unknown[];
const marks = () => [...document.querySelectorAll<HTMLElement>(".desktop-project-reach-mark")];
const agentButtons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-cloud-workspace-agent]")];
const agentButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-cloud-workspace-agent="${id}"]`)!;
const row = () => document.querySelector<HTMLElement>(".desktop-titlebar-cloud-agents");
const panel = () => document.querySelector<HTMLElement>("[role=dialog]");
const share = () => document.querySelector<HTMLButtonElement>('[data-cloud-workspace-tool="share"]');
const invite = () => document.querySelector<HTMLButtonElement>('[data-cloud-workspace-tool="invite-agent"]');
const render = async (context = project(), mounted = true) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceHeaderTools context={context} session={session}
    apiBaseUrl={API} onSessionChange={vi.fn()} renderPeople={mounted ? value => <CloudWorkspaceAgentPeople {...value} /> : undefined} />)));
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  connections = []; pending = []; sessions = [];
  vi.mocked(cloudApiRequest).mockImplementation(async path =>
    String(path).endsWith("/agent-links") ? { links: [], connections, pending } : sessions);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("An Agent in the Header", () => {
  it("shows only an empty seat while nobody has been let in, and it opens the Agents card", async () => {
    await render();
    expect(marks()).toEqual([]);
    expect(row()).toBeNull();
    expect(invite()!.getAttribute("aria-label")).toBe("Invite an agent");
    await act(async () => invite()!.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(panel()?.dataset.control).toBe("true");
    expect(invite()!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => invite()!.click());
    expect(panel()).toBeNull();
  });
  it("puts an Agent asking to join first, apart from the ones already here, and opens the card to answer it", async () => {
    connections = [connection("c1", "Codex")];
    pending = [request("r1", "Claude Code")];
    await render();
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["r1", "c1"]);
    expect(agentButton("r1").dataset.waiting).toBe("true");
    expect(agentButton("c1").dataset.waiting).toBeUndefined();
    expect(agentButton("r1").getAttribute("aria-label")).toBe("Claude Code · Wants to join");
    await act(async () => agentButton("r1").click());
    expect(panel()?.dataset.requests).toBe("Claude Code");
    expect(panel()?.dataset.agents).toBe("Codex");
    expect(agentButton("r1").getAttribute("aria-expanded")).toBe("true");
    expect(invite()!.getAttribute("aria-expanded")).toBe("false");
  });
  it("shows the kind of Agent, and the Agent mark, never a letter of its name, when it cannot recognize one", async () => {
    connections = [connection("1", "Grok Bot"), connection("2", "Research helper"), connection("3", "秘书小陈")];
    await render();
    const [grok, helper, secretary] = marks();
    expect(grok?.dataset.reachBrand).toBe("grok-bot");
    expect(grok?.textContent).toBe("");
    expect(grok?.querySelector("img")).not.toBeNull();
    for (const mark of [helper, secretary]) {
      expect(mark?.dataset.reachBrand).toBeUndefined();
      expect(mark?.textContent).toBe("");
      expect(mark?.querySelector("svg")).not.toBeNull();
    }
  });
  it("keeps the working Agent in front of the grey ones and moves it for no one who asked for less motion", async () => {
    const now = new Date().toISOString();
    connections = [connection("1", "Cursor"), connection("2", "Grok Bot"), connection("3", "Gemini CLI")];
    sessions = [{ grant_id: "g-2", state: "active", created_at: now, closed_at: null,
      lease_until: new Date(Date.now() + 60_000).toISOString() }];
    await render();
    expect(marks().map(mark => mark.dataset.reachBrand)).toEqual(["grok-bot", "cursor", "gemini"]);
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined, undefined]);
    const styles = readFileSync(resolve(process.cwd(), "src/features/app-shell/project-reach/reach-header.css"), "utf8");
    const reduced = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\[data-reach-activity\],\s+[^{]*\[data-reach-activity\]::before\s*\{\s*animation: none;/);
  });
  it("waits for a resolved workspace before saying who is in it", async () => {
    await render(null as unknown as ProjectCloudContext);
    expect(row()).toBeNull();
  });
  it("appears ahead of the invite seat as soon as it is allowed, as a control of its own", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].dataset.reachAudience).toBe("machine");
    expect(row()!.compareDocumentPosition(invite()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row()!.contains(invite())).toBe(false);
  });
  it("is lit only while it is active", async () => {
    connections = [connection("c1", "Quiet agent"), connection("c2", "Busy agent")];
    sessions = [{ grant_id: "g-c2", state: "closed", created_at: ago(11), closed_at: ago(10), lease_until: ago(-20) },
      { grant_id: "g-c1", state: "closed", created_at: ago(3601), closed_at: ago(3600), lease_until: ago(3570) }];
    await render();
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined]);
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["c2", "c1"]);
    expect(agentButton("c2").getAttribute("aria-label")).toBe("Busy agent · Active now");
  });
  it("makes every Agent its own button, and any of them opens the list", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    await render();
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["c1", "c2"]);
    await act(async () => agentButton("c2").click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(panel()?.dataset.agents).toBe("秘书小陈,Codex");
    expect(agentButton("c2").getAttribute("aria-expanded")).toBe("true");
    expect(agentButton("c1").getAttribute("aria-expanded")).toBe("false");
  });
  it("stays open when another Agent is pressed, and closes when the same one is pressed again", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    await render();
    await act(async () => agentButton("c1").click());
    await act(async () => agentButton("c2").click());
    expect(panel()).not.toBeNull();
    expect(agentButton("c2").getAttribute("aria-expanded")).toBe("true");
    expect(agentButton("c1").getAttribute("aria-expanded")).toBe("false");
    await act(async () => agentButton("c2").click());
    expect(panel()).toBeNull();
  });
  it("offers no way to share with people while inviting Agents comes first", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(share()).toBeNull();
    await act(async () => agentButton("c1").click());
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(panel()?.dataset.panel).toBe("agents");
  });
  it("opens Manage agents from the list, as a dialog of its own", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => agentButton("c1").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-manage]")!.click());
    expect(panel()?.dataset.panel).toBe("manage");
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
  });
  it("disappears when Manage agents removes the last one, and the dialog stays", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => agentButton("c1").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-manage]")!.click());
    connections = [];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-changed]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(marks()).toEqual([]);
    expect(row()).toBeNull();
    expect(panel()?.dataset.panel).toBe("manage");
  });
  it("collapses a crowd into a count that opens the whole list", async () => {
    connections = ["A", "B", "C", "D", "E"].map(name => connection(name, name));
    await render();
    expect(marks()).toHaveLength(3);
    const more = document.querySelector<HTMLButtonElement>("[data-cloud-workspace-agent-more]")!;
    expect(more.textContent).toBe("+2");
    await act(async () => more.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });
  it("waits for an answer after an invite, until an Agent asks to join", async () => {
    connections = [connection("c1", "Codex")];
    await render();
    await act(async () => invite()!.click());
    expect(panel()?.dataset.waiting).toBe("false");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-invited]")!.click());
    expect(panel()?.dataset.waiting).toBe("true");
    pending = [request("r1", "Claude Code")];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-answered]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(panel()?.dataset.waiting).toBe("false");
    expect(agentButton("r1").dataset.waiting).toBe("true");
  });
  it("stops waiting when a new Agent joins without asking", async () => {
    connections = [connection("c1", "Codex")];
    await render();
    await act(async () => invite()!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-invited]")!.click());
    connections = [connection("c1", "Codex"), connection("c2", "Cursor")];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-answered]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(panel()?.dataset.waiting).toBe("false");
  });
  it("offers nothing about Agents to someone the server will not show them to", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    await render();
    expect(marks()).toEqual([]);
    expect(invite()).toBeNull();
    expect(share()).toBeNull();
  });
  it("does not look for Agents in a scoped view, which cannot have any", async () => {
    await render(project("scope"));
    expect(cloudApiRequest).not.toHaveBeenCalled();
    expect(invite()).toBeNull();
  });
});
