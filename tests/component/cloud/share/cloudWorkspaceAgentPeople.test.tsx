/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentPeople } from "../../../../src/app/CloudWorkspaceAgentPeople";
import { DesktopTooltipLayer } from "../../../../src/components/DesktopTooltipLayer";
import { agentCreatureFor } from "../../../../src/components/brand/AgentCreature";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", async original => ({
  ...await original<typeof import("../../../../src/lib/cloudApi")>(), cloudApiRequest: vi.fn(),
}));
vi.mock("../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog", () => ({
  CloudWorkspaceAgentsDialog: ({ agents, requests, control, onClose }: {
    agents: { name: string }[]; requests: { name: string }[];
    control: { onInvited: () => void; onChanged: () => void }; onClose: () => void }) =>
    <div role="dialog" data-panel="agents" data-agents={agents.map(agent => agent.name).join()}
      data-requests={requests.map(request => request.name).join()}>
      <button data-invited onClick={control.onInvited}>invited</button>
      <button data-answered onClick={control.onChanged}>answered</button>
      <button data-close onClick={onClose}>close</button>
    </div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { api_base_url: API, user_id: "alice", user_email: "alice@example.com",
  session_generation: "1" } as DesktopCloudSession;
const project = (kind: "project_root" | "scope" = "project_root"): ProjectCloudContext => ({ status: "resolved", projectId: "p1",
  target: kind === "scope" ? { kind, project_id: "p1", scope_id: "s" } : { kind, project_id: "p1" }, capabilities: ["content.read"] });
const connection = (id: string, name: string, avatar?: string) => ({ id, name, avatar, admission: "sign_in",
  grant_id: `g-${id}`, connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z" });
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
const stack = () => document.querySelector<HTMLButtonElement>("[data-cloud-workspace-agent-stack]");
const card = () => document.querySelector<HTMLElement>("[data-cloud-agent-card]");
const close = () => act(async () => document.querySelector<HTMLButtonElement>("[data-close]")!.click());
/** Rests the pointer on a mark long enough for its card. */
const hover = async (target: Element, type: "pointerover" | "pointermove" = "pointerover") => {
  await act(async () => { target.dispatchEvent(new PointerEvent(type, { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
};
const working = (grantId: string) => ({ grant_id: grantId, state: "active", created_at: ago(5), closed_at: null,
  lease_until: new Date(Date.now() + 60_000).toISOString() });
const render = async (context = project(), mounted = true, genericHint = false) => {
  const tools = <CloudWorkspaceHeaderTools context={context} session={session}
    apiBaseUrl={API} onSessionChange={vi.fn()} renderPeople={mounted ? value => <CloudWorkspaceAgentPeople {...value} /> : undefined} />;
  await act(async () => root.render(withTestLocalization(genericHint
    ? <><div data-tooltip="Editor mode">{tools}</div><DesktopTooltipLayer /></> : tools)));
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
  it("shows only an empty seat while nobody has been let in, and it opens the Agents dialog straight away", async () => {
    await render();
    expect(marks()).toEqual([]);
    expect(row()).toBeNull();
    expect(invite()!.getAttribute("aria-label")).toBe("Invite an agent");
    await act(async () => invite()!.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(invite()!.getAttribute("aria-expanded")).toBe("true");
    await close();
    expect(panel()).toBeNull();
    expect(invite()!.getAttribute("aria-expanded")).toBe("false");
  });
  it("puts an Agent asking to join first, with its decision already showing below the Header", async () => {
    connections = [connection("c1", "Codex")];
    pending = [request("r1", "Claude Code")];
    await render();
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["r1"]);
    expect(agentButton("r1").dataset.waiting).toBe("true");
    expect(agentButton("r1").compareDocumentPosition(stack()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stack()!.getAttribute("aria-label")).toBe("Codex");
    expect(agentButton("r1").getAttribute("aria-label")).toBe("Claude Code · Wants to join");
    await act(async () => agentButton("r1").click());
    expect(panel()).toBeNull();
    expect(document.querySelector('[data-cloud-agent-request-card="r1"]')?.textContent).toContain("Claude Code");
    expect(document.activeElement?.getAttribute("data-agent-decision")).toBe("reject");
    expect(agentButton("r1").hasAttribute("aria-haspopup")).toBe(false);
    expect(agentButton("r1").hasAttribute("aria-expanded")).toBe(false);
    expect(stack()!.hasAttribute("aria-expanded")).toBe(false);
  });
  it("shows the kind of Agent, and a creature of its own, never a letter of its name, when it cannot recognize one", async () => {
    connections = [connection("1", "Grok Bot"), connection("2", "Research helper"), connection("3", "秘书小陈")];
    await render();
    const [grok, helper, secretary] = marks();
    expect(grok?.dataset.reachBrand).toBe("grok-bot");
    expect(grok?.dataset.reachCreature).toBeUndefined();
    expect(grok?.querySelector("img")).not.toBeNull();
    for (const mark of [helper, secretary]) {
      expect(mark?.dataset.reachBrand).toBeUndefined();
      expect(mark?.dataset.reachCreature).toBe("");
      expect(mark?.textContent).toBe("");
    }
    const creature = (mark?: HTMLElement) => mark?.querySelector<SVGElement>(".desktop-agent-creature")?.dataset;
    // The same name makes the same creature, wherever and whenever it is drawn.
    expect(creature(helper)?.creatureBody).toBe(String(agentCreatureFor("Research helper").body));
    expect(creature(secretary)?.creatureBody).toBe(String(agentCreatureFor("秘书小陈").body));
    expect(agentCreatureFor("秘书小陈")).toEqual(agentCreatureFor(" 秘书小陈 "));
  });
  it("draws the picture an Agent chose when it connected, over anything read from its name", async () => {
    connections = [connection("1", "薄肌孙教练", "grok-bot"), connection("2", "Claude helper", "other"),
      connection("3", "Codex", "a-picture-this-build-does-not-know"), connection("4", "小方")];
    await render();
    const byName = Object.fromEntries([...stack()!.querySelectorAll<HTMLElement>(".desktop-project-reach-mark")]
      .map((mark, index) => [["薄肌孙教练", "Claude helper", "Codex"][index], mark]));
    expect(byName["薄肌孙教练"].dataset.reachBrand).toBe("grok-bot");
    // "other" is a choice of no brand, so the name is not read for one.
    expect(byName["Claude helper"].dataset.reachBrand).toBeUndefined();
    expect(byName["Claude helper"].dataset.reachCreature).toBe("");
    // A picture this build does not know is no choice: the name decides, as before.
    expect(byName["Codex"].dataset.reachBrand).toBe("codex");
  });
  it("wakes a creature only while its Agent works", async () => {
    connections = [connection("c1", "Quiet agent"), connection("c2", "Busy agent")];
    sessions = [working("g-c2")];
    await render();
    const eyes = (id: string) => (id === "c2" ? agentButton(id) : stack())!
      .querySelector<SVGElement>(".desktop-agent-creature")?.dataset.creatureEyes;
    expect(eyes("c2")).toBe("open");
    expect(eyes("c1")).toBe("closed");
  });
  it("keeps the working Agent in front, on its own, and moves it for no one who asked for less motion", async () => {
    connections = [connection("1", "Cursor"), connection("2", "Grok Bot"), connection("3", "Gemini CLI")];
    sessions = [working("g-2")];
    await render();
    expect(marks().map(mark => mark.dataset.reachBrand)).toEqual(["grok-bot", "cursor", "gemini"]);
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined, undefined]);
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["2"]);
    expect([...stack()!.querySelectorAll<HTMLElement>(".desktop-project-reach-mark")].map(mark => mark.dataset.reachBrand))
      .toEqual(["cursor", "gemini"]);
  });
  it("waits for a resolved workspace before saying who is in it", async () => {
    await render(null as unknown as ProjectCloudContext);
    expect(row()).toBeNull();
  });
  it("takes the empty seat's place as soon as it is allowed: once Agents are here, their list invites the next", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].dataset.reachAudience).toBe("machine");
    expect(invite()).toBeNull();
  });
  it("is lit only while it is active", async () => {
    connections = [connection("c1", "Quiet agent"), connection("c2", "Busy agent")];
    sessions = [{ grant_id: "g-c2", state: "closed", created_at: ago(11), closed_at: ago(10), lease_until: ago(-20) },
      { grant_id: "g-c1", state: "closed", created_at: ago(3601), closed_at: ago(3600), lease_until: ago(3570) }];
    await render();
    expect(marks().map(mark => mark.dataset.reachActivity)).toEqual(["working", undefined]);
    expect(agentButtons().map(button => button.dataset.cloudWorkspaceAgent)).toEqual(["c2"]);
    expect(agentButton("c2").getAttribute("aria-label")).toBe("Busy agent · Working now");
    expect(stack()!.getAttribute("aria-label")).toBe("Quiet agent");
  });
  it("stacks the Agents at rest into one button, named by all of them, that opens the list", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    await render();
    expect(agentButtons()).toEqual([]);
    expect(stack()!.querySelectorAll(".desktop-project-reach-mark")).toHaveLength(2);
    expect(stack()!.getAttribute("aria-label")).toBe("秘书小陈 and Codex");
    await act(async () => stack()!.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(panel()?.dataset.agents).toBe("秘书小陈,Codex");
    expect(stack()!.getAttribute("aria-expanded")).toBe("true");
  });
  it("opens the same dialog from any Agent, marking the one that opened it", async () => {
    connections = [connection("c1", "秘书小陈"), connection("c2", "Codex")];
    sessions = [working("g-c2")];
    await render();
    await act(async () => agentButton("c2").click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(agentButton("c2").getAttribute("aria-expanded")).toBe("true");
    expect(stack()!.getAttribute("aria-expanded")).toBe("false");
    await close();
    await act(async () => stack()!.click());
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(stack()!.getAttribute("aria-expanded")).toBe("true");
    expect(agentButton("c2").getAttribute("aria-expanded")).toBe("false");
  });
  it("offers no way to share with people while inviting Agents comes first", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    expect(share()).toBeNull();
    await act(async () => stack()!.click());
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(panel()?.dataset.panel).toBe("agents");
  });
  it("disappears when the dialog removes the last one, leaving the empty seat, and the dialog stays", async () => {
    connections = [connection("c1", "秘书小陈")];
    await render();
    await act(async () => stack()!.click());
    connections = [];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-answered]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(marks()).toEqual([]);
    expect(row()).toBeNull();
    expect(invite()).not.toBeNull();
    expect(panel()?.dataset.panel).toBe("agents");
  });
  it("stacks three at rest and counts the rest, in the same button that opens the whole list", async () => {
    connections = ["A", "B", "C", "D", "E"].map(name => connection(name, name));
    await render();
    expect(marks()).toHaveLength(3);
    expect(stack()!.querySelector(".desktop-titlebar-cloud-agent-count")?.textContent).toBe("+2");
    expect(stack()!.getAttribute("aria-label")).toBe("A, B, C, D, and E");
    await act(async () => stack()!.click());
    expect(panel()?.dataset.panel).toBe("agents");
    expect(stack()!.getAttribute("aria-expanded")).toBe("true");
  });
  it("replaces the invite dialog with the persistent decision when an Agent asks to join", async () => {
    connections = [connection("c1", "Codex")];
    await render();
    await act(async () => stack()!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-invited]")!.click());
    pending = [request("r1", "Claude Code")];
    await act(async () => document.querySelector<HTMLButtonElement>("[data-answered]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect(agentButton("r1").dataset.waiting).toBe("true");
    expect(panel()).toBeNull();
    expect(document.querySelector('[data-cloud-agent-request-card="r1"]')?.textContent).toContain("Claude Code");
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

describe("An Agent's card in the Header", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });
  it("shows, after a moment on the mark, when it last worked, who it is and how it got in", async () => {
    connections = [connection("c1", "Codex")];
    sessions = [working("g-c1")];
    await render();
    await act(async () => { agentButton("c1").dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
    expect(card()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(card()?.dataset.cloudAgentCard).toBe("c1");
    expect(card()?.dataset.live).toBe("true");
    expect(card()?.getAttribute("aria-hidden")).toBe("true");
    expect(card()?.querySelector(".desktop-cloud-agent-card-when")?.textContent).toBe("Working now");
    expect(card()?.querySelector(".desktop-cloud-agent-card-name")?.textContent).toBe("Codex");
    expect([...card()!.querySelectorAll(".desktop-cloud-agent-card-fact")].map(fact => fact.textContent))
      .toEqual(["Approved by you", "Access ends Nov 29"]);
    expect(card()?.querySelector(".desktop-project-reach-mark")?.getAttribute("style")).toContain("56px");
    await act(async () => { agentButton("c1").dispatchEvent(new PointerEvent("pointerout", { bubbles: true })); });
    expect(card()).toBeNull();
  });
  it("follows the pointer across the Agents at rest, one face at a time", async () => {
    connections = [connection("c1", "Cursor"), connection("c2", "Grok Bot")];
    sessions = [{ grant_id: "g-c2", state: "closed", created_at: ago(7300), closed_at: ago(7200), lease_until: ago(7170) }];
    await render();
    const [first, second] = stack()!.querySelectorAll(".desktop-project-reach-mark");
    await hover(second!, "pointermove");
    expect(card()?.dataset.cloudAgentCard).toBe("c2");
    expect(card()?.querySelector(".desktop-cloud-agent-card-when")?.textContent).toBe("Last worked 2 hours ago");
    await act(async () => { first!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })); });
    expect(card()?.dataset.cloudAgentCard).toBe("c1");
    expect(card()?.querySelector(".desktop-cloud-agent-card-when")?.textContent).toBe("No recent work");
  });
  it("never puts a hover card on top of an unanswered request's persistent card", async () => {
    pending = [request("r1", "Claude Code")];
    await render();
    await hover(agentButton("r1"));
    expect(card()).toBeNull();
    expect(document.querySelectorAll("[data-cloud-agent-request-card]")).toHaveLength(1);
    await act(async () => agentButton("r1").click());
    expect(panel()).toBeNull();
    expect(document.activeElement?.getAttribute("data-agent-decision")).toBe("reject");
  });
  it("shows only the face's name card, never the stack's or an ancestor editor's tooltip", async () => {
    connections = ["Cursor", "Codex", "Gemini", "Claude Code"].map(name => connection(name, name));
    await render(project(), true, true);
    const face = stack()!.querySelector(".desktop-project-reach-mark")!;
    await hover(face, "pointermove");
    await act(async () => { face.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(600); });
    expect(card()?.querySelector(".desktop-cloud-agent-card-name")?.textContent).toBe("Cursor");
    expect(stack()!.hasAttribute("data-tooltip")).toBe(false);
    expect(document.querySelector("[role=tooltip]")).toBeNull();
    expect(row()?.dataset.tooltipDisabled).toBe("true");
  });
  it("says since when an Agent is here when its access does not end", async () => {
    connections = [{ ...connection("c1", "Codex"), expires_at: null as unknown as string }];
    await render();
    await hover(stack()!.querySelector(".desktop-project-reach-mark")!, "pointermove");
    expect([...card()!.querySelectorAll(".desktop-cloud-agent-card-fact")].map(fact => fact.textContent))
      .toEqual(["Approved by you", "Here since Oct 30"]);
  });
});
