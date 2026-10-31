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
  CloudWorkspaceAgentsPanel: ({ onChanged, agents, expandedAgentId }: {
    onChanged: () => void; agents: { name: string }[]; expandedAgentId: string | null;
  }) => <div role="dialog" data-panel="agents" data-agents={agents.map(agent => agent.name).join()} data-expanded={expandedAgentId ?? ""}>
    <button data-changed onClick={onChanged}>changed</button>
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
const marks = () => [...document.querySelectorAll<HTMLElement>(".desktop-project-reach-mark")];
const agentButtons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-cloud-workspace-agent]")];
const agentButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-cloud-workspace-agent="${id}"]`)!;
const row = () => document.querySelector<HTMLElement>(".desktop-titlebar-cloud-agents");
const connect = () => document.querySelector<HTMLButtonElement>('[data-cloud-workspace-tool="connect-agent"]');
const panel = () => document.querySelector<HTMLElement>("[role=dialog]");
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
  it("offers to connect one while nobody has been let in, and shows no mark for the person looking", async () => {
    await render();
    expect(marks()).toEqual([]);
    expect(connect()?.getAttribute("aria-label")).toBe("Connect an agent");
    expect(connect()!.compareDocumentPosition(share()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => connect()!.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(connect()!.getAttribute("aria-expanded")).toBe("true");
  });
  it("shows the kind of Agent, and an initial only for a name it cannot recognize", async () => {
    connections = [connection("1", "Grok Bot"), connection("2", "Research helper")];
    await render();
    const [grok, helper] = marks();
    expect(grok?.dataset.reachBrand).toBe("grok-bot");
    expect(grok?.textContent).toBe("");
    expect(grok?.querySelector("img")).not.toBeNull();
    expect(helper?.dataset.reachBrand).toBeUndefined();
    expect(helper?.textContent).toBe("R");
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
    expect(connect()).toBeNull();
  });
  it("appears ahead of Share as soon as it is allowed, as a control of its own", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].textContent).toBe("秘");
    expect(marks()[0].dataset.reachAudience).toBe("machine");
    expect(row()!.compareDocumentPosition(share()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row()!.contains(share())).toBe(false);
    expect(connect()).toBeNull();
  });
  it("is lit only while it is active", async () => {
    connections = [connection("c1", "Quiet agent"), connection("c2", "Busy agent")];
    sessions = [{ grant_id: "g-c2", state: "closed", created_at: ago(11), closed_at: ago(10), lease_until: ago(-20) },
      { grant_id: "g-c1", state: "closed", created_at: ago(3601), closed_at: ago(3600), lease_until: ago(3570) }];
    await render();
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined]);
    expect(marks().map(mark => mark.textContent)).toEqual(["B", "Q"]);
    expect(agentButton("c2").getAttribute("aria-label")).toBe("Busy agent · Active now");
  });
  it("makes every Agent its own button, and pressing one asks about that Agent", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    await render();
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["c1", "c2"]);
    await act(async () => agentButton("c2").click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(panel()?.dataset.agents).toBe("秘书小陈,Codex");
    expect(panel()?.dataset.expanded).toBe("c2");
    expect(agentButton("c2").getAttribute("aria-expanded")).toBe("true");
    expect(agentButton("c1").getAttribute("aria-expanded")).toBe("false");
  });
  it("moves to another Agent while open, and closes when the same one is pressed again", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    await render();
    await act(async () => agentButton("c1").click());
    await act(async () => agentButton("c2").click());
    expect(panel()?.dataset.expanded).toBe("c2");
    await act(async () => agentButton("c2").click());
    expect(panel()).toBeNull();
  });
  it("keeps Share and the Agents apart: each opens only its own card", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => share().click());
    expect(panel()?.dataset.panel).toBe("share");
    expect(agentButton("c1").getAttribute("aria-expanded")).toBe("false");
    await act(async () => agentButton("c1").click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(share().getAttribute("aria-expanded")).toBe("false");
  });
  it("offers to connect again the moment the last one is removed, without closing the panel", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => agentButton("c1").click());
    connections = [];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-changed]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(marks()).toEqual([]);
    expect(connect()).not.toBeNull();
    expect(panel()?.dataset.panel).toBe("agents");
  });
  it("collapses a crowd into a count that opens the whole list", async () => {
    connections = ["A", "B", "C", "D", "E"].map(name => connection(name, name));
    await render();
    expect(marks()).toHaveLength(3);
    const more = document.querySelector<HTMLButtonElement>("[data-cloud-workspace-agent-more]")!;
    expect(more.textContent).toBe("+2");
    await act(async () => more.click());
    expect(panel()?.dataset.expanded).toBe("");
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });
  it("offers nothing about Agents to someone the server will not show them to", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    await render();
    expect(marks()).toEqual([]);
    expect(connect()).toBeNull();
  });
  it("does not look for Agents in a scoped view, which cannot have any", async () => {
    await render(project("scope"));
    expect(cloudApiRequest).not.toHaveBeenCalled();
    expect(connect()).toBeNull();
  });
});
