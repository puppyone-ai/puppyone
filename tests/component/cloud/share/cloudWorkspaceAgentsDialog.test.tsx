/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsDialog, type AgentsControl } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog";
import type { AgentRequest } from "../../../../src/features/cloud/share/agentLinks";
import type { WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { user_id: "alice" } as DesktopCloudSession;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const agent = (id: string, name: string, change: Partial<WorkspaceAgent> = {}): WorkspaceAgent => ({ id, name,
  admission: "sign_in", grant_id: `g-${id}`, connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z",
  active: false, lastActiveAt: null, activityKnown: true, ...change });
const request = (id: string, name: string): AgentRequest => ({ id, name, admission: "sign_in", requested_at: ago(1),
  expires_at: new Date(Date.now() + 600_000).toISOString() });
const link = { id: "l1", admission: "sign_in", created_at: ago(120), expires_at: "2026-11-12T12:00:00Z" } as const;
let root: Root;
let inventory: { links: unknown[]; connections: unknown[] };
let calls: { path: string; method?: string; body?: unknown }[];
let failChanges: boolean;
const onChanged = vi.fn();
const onClose = vi.fn();
const control = (): AgentsControl => ({ session, apiBaseUrl: API, projectId: "project-1", projectName: "Launch plan",
  onInvited: vi.fn(), onChanged });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const select = <T extends HTMLElement = HTMLButtonElement>(selector: string) => document.querySelector<T>(selector)!;
const tiles = () => [...document.querySelectorAll<HTMLElement>(".desktop-cloud-agent-tile")]
  .map(tile => tile.dataset.cloudAgentRow ?? tile.dataset.cloudAgentRequest);
const render = async (agents: readonly WorkspaceAgent[] = [], requests: readonly AgentRequest[] = []) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsDialog control={control()} agents={agents}
    requests={requests} onClose={onClose} />)));
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  inventory = { links: [], connections: [] }; calls = []; failChanges = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (init.method) {
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (failChanges) throw new Error("offline");
      if (init.method === "DELETE") inventory = { links: [], connections: [] };
      return {};
    }
    return inventory;
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("The Agents dialog", () => {
  it("is titled Agents, names the project, and meets everyone in one row, the one at work first", async () => {
    await render([agent("c1", "Codex", { lastActiveAt: ago(120) }), agent("c2", "Claude Code", { active: true })]);
    expect(dialog().getAttribute("aria-label")).toBe("Agents");
    expect(select<HTMLElement>("h2").textContent).toBe("Agents");
    expect(select<HTMLElement>(".desktop-cloud-agents-dialog-project").textContent).toBe("Launch plan");
    expect(tiles()).toEqual(["c2", "c1"]);
    const state = (id: string) => select<HTMLElement>(`[data-cloud-agent-row="${id}"] .desktop-cloud-agent-state`);
    expect(state("c2").textContent).toBe("Working now");
    expect(state("c2").dataset.live).toBe("true");
    expect(state("c1").textContent).toBe("2 hours ago");
    // Inviting is right under them, as a sentence and the prompt it names.
    expect(select<HTMLElement>(".desktop-cloud-agent-invite h3").textContent)
      .toBe("Copy this prompt and paste it into your agent’s chat to invite it.");
    expect(select(".desktop-cloud-agent-share-copy").textContent).toBe("Copy prompt");
  });

  it("says nobody is here yet and puts copying the prompt first", async () => {
    await render();
    expect(document.querySelector(".desktop-cloud-agents-roster")).toBeNull();
    expect(select<HTMLElement>(".desktop-cloud-agents-empty").textContent).toBe("No agents in this project yet.");
    expect(select(".desktop-cloud-agent-share-copy").dataset.desktopDialogInitialFocus).toBe("true");
    await render([agent("c1", "Codex")]);
    expect(select(".desktop-cloud-agent-share-copy").dataset.desktopDialogInitialFocus).toBeUndefined();
  });

  it("puts an Agent asking to join at the front of the row, and lets it in from its tile", async () => {
    await render([agent("c1", "Codex")], [request("r1", "Claude Code")]);
    expect(tiles()).toEqual(["r1", "c1"]);
    const asking = select<HTMLElement>('[data-cloud-agent-request="r1"]');
    expect(asking.dataset.asking).toBe("");
    expect(asking.querySelector(".desktop-cloud-agent-state")?.textContent).toBe("Wants to join");
    expect(select('[data-cloud-agent-request="r1"] .desktop-cloud-agent-request-allow').getAttribute("aria-label"))
      .toBe("Allow Claude Code");
    await act(async () => select('[data-cloud-agent-request="r1"] .desktop-cloud-agent-request-allow').click());
    expect(calls).toEqual([{ path: "/agent-links/connections/r1/decision", method: "POST", body: { decision: "approve" } }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("turns an Agent away, and says when an answer did not go through", async () => {
    await render([], [request("r1", "Claude Code")]);
    failChanges = true;
    await act(async () => select(".desktop-cloud-agent-request-deny").click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toBe("That didn’t work. Try again.");
    expect(select(".desktop-cloud-agent-request-deny").disabled).toBe(false);
    failChanges = false;
    await act(async () => select(".desktop-cloud-agent-request-deny").click());
    expect(calls.at(-1)).toEqual({ path: "/agent-links/connections/r1/decision", method: "POST", body: { decision: "reject" } });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("removes an Agent only after asking once on its tile", async () => {
    await render([agent("c1", "Codex"), agent("c2", "Cursor")]);
    const remove = select('[data-cloud-agent-remove="c1"]');
    expect(remove.getAttribute("aria-label")).toBe("Remove Codex");
    await act(async () => remove.click());
    const tile = select<HTMLElement>('[data-cloud-agent-row="c1"]');
    expect(tile.dataset.confirming).toBe("true");
    expect(document.activeElement).toBe(tile.querySelector(".desktop-cloud-agent-tile-keep"));
    await act(async () => select(".desktop-cloud-agent-tile-keep").click());
    expect(tile.dataset.confirming).toBeUndefined();
    expect(calls).toEqual([]);
    await act(async () => select('[data-cloud-agent-remove="c1"]').click());
    await act(async () => select(".desktop-cloud-agent-tile-confirm").click());
    expect(calls).toEqual([{ path: "/projects/project-1/access/grants/g-c1", method: "PATCH", body: { state: "revoked" } }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("says a removal failed and keeps the Agent", async () => {
    failChanges = true;
    await render([agent("c1", "Codex")]);
    await act(async () => select('[data-cloud-agent-remove="c1"]').click());
    await act(async () => select(".desktop-cloud-agent-tile-confirm").click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toBe("That didn’t work. Try again.");
    expect(tiles()).toEqual(["c1"]);
    expect(select<HTMLElement>('[data-cloud-agent-row="c1"]').dataset.confirming).toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("folds the open links away at the foot, with how many there are", async () => {
    inventory = { links: [link], connections: [] };
    await render([agent("c1", "Codex")]);
    const toggle = select(".desktop-cloud-agents-links-toggle");
    expect(toggle.textContent).toBe("Manage links1 open");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".desktop-cloud-agents-links")).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(select<HTMLElement>(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)).not.toBeNull();
    expect(select<HTMLElement>('[data-cloud-agent-link="l1"]').textContent)
      .toBe("Only agents you approveMade 2 hours agoExpires Nov 12");
  });

  it("says when no link is open", async () => {
    await render([agent("c1", "Codex")]);
    expect(select(".desktop-cloud-agents-links-toggle").textContent).toBe("Manage linksnone open");
    await act(async () => select(".desktop-cloud-agents-links-toggle").click());
    expect(select<HTMLElement>(".desktop-cloud-agents-links-none").textContent).toBe("No invite links are open.");
  });

  it("removes every Agent and link at once, only after asking", async () => {
    inventory = { links: [link], connections: [] };
    await render([agent("c1", "Codex")]);
    await act(async () => select(".desktop-cloud-agents-links-toggle").click());
    await act(async () => select(".desktop-cloud-agent-share-stop").click());
    expect(select<HTMLElement>('.desktop-cloud-agents-remove-all[data-confirming] > span').textContent)
      .toBe("Remove every agent and close every link?");
    expect(calls).toEqual([]);
    await act(async () => select(".desktop-cloud-agents-remove-all .desktop-cloud-agent-tile-confirm").click());
    expect(calls).toEqual([{ path: "/projects/project-1/agent-links", method: "DELETE", body: undefined }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("closes from its own button", async () => {
    await render();
    await act(async () => select<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
