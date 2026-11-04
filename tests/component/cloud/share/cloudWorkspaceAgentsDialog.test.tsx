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
let root: Root;
let calls: { path: string; method?: string; body?: unknown }[];
let failChanges: boolean;
const onChanged = vi.fn();
const onClose = vi.fn();
const control = (): AgentsControl => ({ session, apiBaseUrl: API, projectId: "project-1", projectName: "Launch plan",
  onInvited: vi.fn(), onChanged });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const select = <T extends HTMLElement = HTMLButtonElement>(selector: string) => document.querySelector<T>(selector)!;
const tiles = () => [...document.querySelectorAll<HTMLElement>(".desktop-cloud-agent-tile")]
  .map(tile => tile.dataset.cloudAgentRow ?? tile.dataset.cloudAgentRequest ?? (tile.classList.contains("desktop-cloud-agent-invite-seat") ? "seat" : null));
const render = async (agents: readonly WorkspaceAgent[] = [], requests: readonly AgentRequest[] = []) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsDialog control={control()} agents={agents}
    requests={requests} onClose={onClose} />)));
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  calls = []; failChanges = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (init.method) {
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (failChanges) throw new Error("offline");
      return {};
    }
    return { links: [], connections: [] };
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
    expect(tiles()).toEqual(["c2", "c1", "seat"]);
    const state = (id: string) => select<HTMLElement>(`[data-cloud-agent-row="${id}"] .desktop-cloud-agent-state`);
    expect(state("c2").textContent).toBe("Working now");
    expect(state("c2").dataset.live).toBe("true");
    expect(state("c1").textContent).toBe("2 hours ago");
    // Inviting the next one is the seat at the end of the same row.
    expect(select(".desktop-cloud-agent-seat-button").textContent).toBe("Invite agent");
  });

  it("is only the first invite while nobody is here, and the row once someone is", async () => {
    await render();
    expect(document.querySelector(".desktop-cloud-agents-roster")).toBeNull();
    expect(select<HTMLElement>(".desktop-cloud-agents-first h3").textContent).toBe("Invite your first agent");
    await render([agent("c1", "Codex")]);
    expect(document.querySelector(".desktop-cloud-agents-first")).toBeNull();
    expect(document.querySelector("[data-desktop-dialog-initial-focus]")).toBeNull();
  });

  it("puts an Agent asking to join at the front of the row, and lets it in from its tile", async () => {
    await render([agent("c1", "Codex")], [request("r1", "Claude Code")]);
    expect(tiles()).toEqual(["r1", "c1", "seat"]);
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
    expect(tiles()).toEqual(["c1", "seat"]);
    expect(select<HTMLElement>('[data-cloud-agent-row="c1"]').dataset.confirming).toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("has no links to look after: an invite is spent once it lets an Agent in, and never asks to be read", async () => {
    await render([agent("c1", "Codex")]);
    expect(document.querySelector(".desktop-cloud-agents-links-toggle, .desktop-cloud-agents-links, .desktop-cloud-agents-dialog-foot")).toBeNull();
    expect(document.body.textContent).not.toContain("Remove all");
    // Opening the dialog reads nothing of its own; the Header already holds who is here.
    expect(cloudApiRequest).not.toHaveBeenCalled();
  });

  it("closes from its own button", async () => {
    await render();
    await act(async () => select<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
