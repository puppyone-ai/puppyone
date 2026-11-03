/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsPanel, type AgentsPanelControl } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsPanel";
import type { AgentRequest } from "../../../../src/features/cloud/share/agentLinks";
import type { WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = (id: string, name: string, active: boolean): WorkspaceAgent => ({ id, name, admission: "sign_in",
  grant_id: `g-${id}`, connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z",
  active, lastActiveAt: null, activityKnown: true });
const anchor = { current: document.createElement("button") };
let root: Root;
const surface = () => document.querySelector<HTMLElement>(".desktop-cloud-agents-panel")!;
const render = async (onManage = vi.fn(), renderAgentMark?: Parameters<typeof CloudWorkspaceAgentsPanel>[0]["renderAgentMark"]) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsPanel anchor={anchor}
    agents={[agent("c1", "Claude Code", true), agent("c2", "Codex", false)]}
    renderAgentMark={renderAgentMark} onManage={onManage} onClose={vi.fn()} />)));
};
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const asking = (id: string, name: string): AgentRequest => ({ id, name, admission: "sign_in",
  requested_at: new Date(Date.now() - 30_000).toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() });
let decisions: { path: string; body: unknown }[];
let decisionFails: boolean;
const control = (change: Partial<AgentsPanelControl> = {}): AgentsPanelControl => ({
  session: { user_id: "alice" } as DesktopCloudSession, apiBaseUrl: API, projectId: "p1", projectName: "Launch plan",
  waiting: false, onInvited: vi.fn(), onChanged: vi.fn(), ...change });
const renderWith = async (props: Partial<Parameters<typeof CloudWorkspaceAgentsPanel>[0]>) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsPanel anchor={anchor} agents={[]}
    onManage={vi.fn()} onClose={vi.fn()} {...props} />)));
};
const press = async (selector: string) => {
  await act(async () => surface().querySelector<HTMLButtonElement>(selector)!.click());
};
beforeEach(() => {
  decisions = []; decisionFails = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (String(path).endsWith("/decision")) {
      if (decisionFails) throw new Error("offline");
      decisions.push({ path: String(path), body: JSON.parse(String(init.body)) });
      return { state: "approved" };
    }
    return { links: [], connections: [] };
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("The Agents in a project, at a glance", () => {
  it("says who is here and when each was last here, and nothing else", async () => {
    await render();
    expect(surface().textContent).toBe("Claude CodeActive nowCodexNo recent activityManage agents");
  });
  it("changes nothing itself: Manage agents is the one thing to press", async () => {
    await render();
    expect(surface().querySelectorAll("button")).toHaveLength(1);
    expect(surface().querySelector("button")?.textContent).toBe("Manage agents");
  });
  it("hands over to Manage agents", async () => {
    const onManage = vi.fn();
    await render(onManage);
    await act(async () => surface().querySelector<HTMLButtonElement>("[data-cloud-agents-manage]")!.click());
    expect(onManage).toHaveBeenCalledTimes(1);
  });
  it("draws an Agent with the mark the shell lends it", async () => {
    await render(vi.fn(), ({ name, active }) => <i data-mark={name} data-working={active} />);
    const row = surface().querySelector('[data-cloud-agent-row="c1"]')!;
    expect(row.querySelector("[data-mark]")?.getAttribute("data-working")).toBe("true");
    expect(row.querySelector(".desktop-cloud-agent-lamp")).toBeNull();
  });
});

describe("Letting an Agent in", () => {
  it("offers only the invite while no Agent is here or asking", async () => {
    await renderWith({ control: control() });
    expect(surface().querySelector("h3")?.textContent).toBe("Invite an agent");
    expect(surface().querySelector("[data-cloud-agents-manage]")).toBeNull();
    expect(surface().querySelector(".desktop-cloud-agents-foot")?.hasAttribute("data-alone")).toBe(true);
  });
  it("puts an Agent asking to join above the ones here, with when it asked", async () => {
    await renderWith({ control: control(), agents: [agent("c1", "Codex", false)], requests: [asking("r1", "Claude Code")] });
    const rows = [...surface().querySelectorAll("li")].map(row => row.getAttribute("data-cloud-agent-request")
      ?? row.getAttribute("data-cloud-agent-row"));
    expect(rows).toEqual(["r1", "c1"]);
    expect(surface().querySelector('[data-cloud-agent-request="r1"]')?.textContent).toBe("Claude CodeWants to join · nowDenyAllow");
    // Agents are listed, so inviting another is a row.
    expect(surface().querySelector("h3")).toBeNull();
    expect(surface().querySelector("[data-cloud-agent-invite]")?.textContent).toBe("Invite another agent");
  });
  it("allows an Agent with the owner's own session, and tells the Header at once", async () => {
    const onChanged = vi.fn();
    await renderWith({ control: control({ onChanged }), requests: [asking("r1", "Claude Code")] });
    await press(".desktop-cloud-agent-request-allow");
    expect(decisions).toEqual([{ path: "/agent-links/connections/r1/decision", body: { decision: "approve" } }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // It stays until the list without it arrives, and cannot be answered twice.
    expect(surface().querySelector<HTMLButtonElement>(".desktop-cloud-agent-request-allow")?.disabled).toBe(true);
    expect(surface().querySelector<HTMLButtonElement>(".desktop-cloud-agent-request-deny")?.disabled).toBe(true);
  });
  it("denies an Agent", async () => {
    await renderWith({ control: control(), requests: [asking("r1", "Claude Code")] });
    await press(".desktop-cloud-agent-request-deny");
    expect(decisions).toEqual([{ path: "/agent-links/connections/r1/decision", body: { decision: "reject" } }]);
  });
  it("says an answer did not go through and lets it be given again", async () => {
    const onChanged = vi.fn();
    decisionFails = true;
    await renderWith({ control: control({ onChanged }), requests: [asking("r1", "Claude Code")] });
    await press(".desktop-cloud-agent-request-allow");
    expect(surface().querySelector('[role="alert"]')?.textContent).toBe("That didn’t work. Try again.");
    expect(onChanged).not.toHaveBeenCalled();
    decisionFails = false;
    await press(".desktop-cloud-agent-request-allow");
    expect(surface().querySelector('[role="alert"]')).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it("names the Agent each answer is for", async () => {
    await renderWith({ control: control(), requests: [asking("r1", "Claude Code"), asking("r2", "Codex")] });
    expect([...surface().querySelectorAll(".desktop-cloud-agent-request-allow")].map(button => button.getAttribute("aria-label")))
      .toEqual(["Allow Claude Code", "Allow Codex"]);
  });
});
