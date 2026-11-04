/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentInvite } from "../../../../src/features/cloud/share/CloudWorkspaceAgentInvite";
import type { AgentRequest } from "../../../../src/features/cloud/share/agentLinks";
import type { WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { writeClipboardText } from "../../../../src/lib/clipboard";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { user_id: "alice" } as DesktopCloudSession;
const LINK = "https://cloud-fixture.puppyone.ai/agent/pai_fixture";
let root: Root;
let inventory: { links: unknown[]; connections: unknown[]; open_links_enabled?: boolean };
let created: { admission: string; workbench_id: string; secret: string }[];
let decisions: { id: string; decision: string }[];
let denied: boolean;
let decisionFails: boolean;

const select = <T extends HTMLElement = HTMLButtonElement>(selector: string) => document.querySelector<T>(selector)!;
const stub = () => select(".desktop-cloud-agent-ticket-stub .desktop-cloud-agent-share-copy");
const again = () => document.querySelector<HTMLButtonElement>(".desktop-cloud-agent-ticket-again");
const ticket = () => select<HTMLElement>(".desktop-cloud-agent-ticket");
const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const status = () => document.querySelector('[role="status"]')?.textContent;
const doorRows = () => [...document.querySelectorAll<HTMLElement>(".desktop-cloud-agent-door-row")]
  .map(row => [row.dataset.door, row.textContent]);
const agent = (id: string, name: string): WorkspaceAgent => ({ id, name, admission: "sign_in", grant_id: `g-${id}`,
  active: false, lastActiveAt: null, activityKnown: true } as WorkspaceAgent);
const request = (id: string, name: string): AgentRequest => ({ id, name, admission: "sign_in",
  requested_at: "2026-11-04T10:00:00Z", expires_at: "2026-11-04T10:10:00Z" });
const render = async (props: Partial<ComponentProps<typeof CloudWorkspaceAgentInvite>> = {}) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentInvite projectId="project-1"
    projectName="Launch plan" session={session} apiBaseUrl={API} {...props} />)));
};
const copyFromStub = async () => { stub().focus(); await act(async () => stub().click()); };

beforeEach(() => {
  inventory = { links: [], connections: [] }; created = []; decisions = []; denied = false; decisionFails = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (path === "/projects/project-1/workbench") return { workspace: { id: "workbench-1" } };
    if (path === "/projects/project-1/agent-links" && init.method === "POST") {
      if (denied) throw Object.assign(new Error("denied"), { status: 403 });
      created.push(JSON.parse(String(init.body)));
      return { agent_url: LINK };
    }
    if (path === "/projects/project-1/agent-links") return inventory;
    const decision = /^\/agent-links\/connections\/([^/]+)\/decision$/.exec(path);
    if (decision) {
      if (decisionFails) throw new Error("offline");
      decisions.push({ id: decision[1], decision: JSON.parse(String(init.body)).decision });
      return {};
    }
    throw new Error(`Unexpected ${path}`);
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Inviting an Agent with a ticket", () => {
  it("is a ticket for one agent to this project, with the prompt printed on it and a stub that copies it", async () => {
    await render();
    expect(text(".desktop-cloud-agent-ticket-eyebrow")).toBe("Admit one agent");
    expect(text(".desktop-cloud-agent-ticket-title")).toBe("Launch plan");
    expect(text(".desktop-cloud-agent-ticket-meta")).toBe("Only agents you approve");
    const prompt = select<HTMLElement>(".desktop-cloud-agent-prompt-text");
    expect(prompt.getAttribute("aria-label")).toBe("Prompt for your agent");
    // It reads true up to the link, which only copying makes.
    expect(prompt.textContent).toBe('Connect to my puppyone project "Launch plan" by following https://cloud-fixture.puppyone.ai/agent/••••••');
    expect(stub().textContent).toBe("Copy");
    expect(text(".desktop-cloud-agent-ticket-give")).toBe("Give it to your agent");
    expect(doorRows()).toEqual([["empty", "Nobody at the door yet"]]);
    // The ticket and the door are pictures; what to do is also said in words.
    const section = select<HTMLElement>(".desktop-cloud-agent-invite");
    expect(document.getElementById(section.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Paste it into your chat with the agent, then allow it here when it asks to join.");
    expect(document.querySelector("[data-cloud-agent-demo], h3")).toBeNull();
    expect(created).toEqual([]);
  });

  it("copies one line that asks the agent to connect, and tears the stub off", async () => {
    await render();
    await copyFromStub();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ admission: "sign_in", workbench_id: "workbench-1" });
    expect(created[0].secret).toMatch(/^pai_[A-Za-z0-9_-]{43}$/);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(
      `Connect to my puppyone project "Launch plan" by following ${LINK}`);
    expect(ticket().hasAttribute("data-handed-out")).toBe(true);
    expect(text(".desktop-cloud-agent-ticket-eyebrow")).toBe("Handed out");
    expect(text(".desktop-cloud-agent-ticket-meta")).toBe("Now paste it into your chat with the agent.");
    expect(document.querySelector(".desktop-cloud-agent-prompt-text")).toBeNull();
    // The stub is gone for good: hidden, and its button cannot be pressed or reached.
    expect(select<HTMLElement>(".desktop-cloud-agent-ticket-stub").getAttribute("aria-hidden")).toBe("true");
    expect(stub().disabled).toBe(true);
    expect(again()?.textContent).toBe("Copied");
    expect(document.activeElement).toBe(again());
    expect(status()).toContain("Paste it");
  });

  it("copies a new link again, for a second agent, once the first is said to be copied", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => stub().click());
      expect(again()?.textContent).toBe("Copied");
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(again()?.textContent).toBe("Copy again");
      expect(status()).toBe("");
      await act(async () => again()!.click());
      expect(created).toHaveLength(2);
      expect(ticket().hasAttribute("data-handed-out")).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("wakes whoever waits at the door while the Header awaits the agent", async () => {
    await render({ waiting: true });
    expect(doorRows()).toEqual([["waiting", "Waiting for your agent…"]]);
    expect(status()).toBe("Waiting for your agent…");
    await render({ waiting: false });
    expect(doorRows()).toEqual([["empty", "Nobody at the door yet"]]);
  });

  it("lets an agent at the door in, or turns it away, right on the ticket", async () => {
    const onChanged = vi.fn();
    await render({ door: { agents: [], requests: [request("r1", "Claude Code"), request("r2", "Codex")], onChanged } });
    expect(doorRows()).toEqual([["knocking", "Claude CodeAt the doorDenyLet in"], ["knocking", "CodexAt the doorDenyLet in"]]);
    expect(status()).toBe("Claude Code, At the door");
    await act(async () => select('[data-cloud-agent-request="r1"] .desktop-cloud-agent-request-allow').click());
    await act(async () => select('[data-cloud-agent-request="r2"] .desktop-cloud-agent-request-deny').click());
    expect(decisions).toEqual([{ id: "r1", decision: "approve" }, { id: "r2", decision: "reject" }]);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(select('[data-cloud-agent-request="r1"] .desktop-cloud-agent-request-allow').getAttribute("aria-label"))
      .toBe("Let in Claude Code");
  });

  it("says when letting in failed, and lets it be tried again", async () => {
    decisionFails = true;
    await render({ door: { agents: [], requests: [request("r1", "Claude Code")], onChanged: vi.fn() } });
    await act(async () => select(".desktop-cloud-agent-request-allow").click());
    expect(text('.desktop-cloud-agent-door [role="alert"]')).toBe("That didn’t work. Try again.");
    expect(select(".desktop-cloud-agent-request-allow").disabled).toBe(false);
  });

  it("says who came in since the ticket was handed out, and only them", async () => {
    const onChanged = vi.fn();
    await render({ door: { agents: [agent("a1", "Codex")], requests: [], onChanged } });
    await copyFromStub();
    await render({ door: { agents: [agent("a1", "Codex"), agent("a2", "Claude Code")], requests: [], onChanged } });
    expect(doorRows()).toEqual([["joined", "Claude CodeJoined. Getting to work."]]);
    expect(status()).toBe("Claude Code, Joined. Getting to work.");
  });

  it("leaves the agents at the door to the Agents card where it has none of its own", async () => {
    await render({ waiting: true });
    expect(document.querySelector("[data-cloud-agent-request]")).toBeNull();
  });

  it("offers no choice while the deployment keeps open links closed", async () => {
    await render();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.querySelector('[data-agent-admission="link"]')).toBeNull();
    await act(async () => stub().click());
    expect(created[0].admission).toBe("sign_in");
  });

  it("keeps open links closed when an older server does not say", async () => {
    await render();
    expect(document.body.textContent).not.toContain("Any agent with the link");
  });

  it("defaults to the choice that needs the owner's sign-in and creates nothing until asked", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="sign_in"]').getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("you allow it here");
    expect(created).toEqual([]);
  });

  it("states the risk of any agent with the link before it is chosen, and prints the choice on the ticket", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="link"]').textContent).toContain("gets its own copy of the project");
    await act(async () => select('[data-agent-admission="link"]').click());
    expect(select('[data-agent-admission="link"]').getAttribute("aria-checked")).toBe("true");
    expect(ticket().dataset.admission).toBe("link");
    expect(text(".desktop-cloud-agent-ticket-meta")).toBe("Any agent with the link");
    await act(async () => stub().click());
    expect(created[0].admission).toBe("link");
  });

  it("moves between the two choices with the arrow keys, as one tab stop", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    const approved = select('[data-agent-admission="sign_in"]');
    const anyone = select('[data-agent-admission="link"]');
    expect([approved.tabIndex, anyone.tabIndex]).toEqual([0, -1]);
    approved.focus();
    await act(async () => approved.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(anyone.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(anyone);
    expect([approved.tabIndex, anyone.tabIndex]).toEqual([-1, 0]);
    await act(async () => anyone.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(approved.getAttribute("aria-checked")).toBe("true");
  });

  it("says a link failed, and keeps the stub on the ticket ready to retry", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => stub().click());
    expect(text('[role="alert"]')).toContain("Try again");
    expect(ticket().hasAttribute("data-handed-out")).toBe(false);
    expect(stub().textContent).toBe("Copy");
    expect(stub().disabled).toBe(false);
    await act(async () => stub().click());
    expect(ticket().hasAttribute("data-handed-out")).toBe(true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("tells a non-owner why it failed, without copying", async () => {
    denied = true;
    await render();
    await act(async () => stub().click());
    expect(text('[role="alert"]')).toContain("owner");
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(ticket().hasAttribute("data-handed-out")).toBe(false);
  });

  it("tells the Header at once when a link is made, and not when it fails", async () => {
    const onInvited = vi.fn();
    denied = true;
    await render({ onInvited });
    await act(async () => stub().click());
    expect(onInvited).not.toHaveBeenCalled();
    denied = false;
    await act(async () => stub().click());
    expect(onInvited).toHaveBeenCalledTimes(1);
  });

  it("asks a dialog to put focus on the stub, the one thing to do", async () => {
    await render({ initialFocus: true });
    expect(stub().dataset.desktopDialogInitialFocus).toBe("true");
    await render();
    expect(stub().dataset.desktopDialogInitialFocus).toBeUndefined();
  });

  it("stays usable if the list cannot be read", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(stub().disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
