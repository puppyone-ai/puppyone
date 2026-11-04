/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsDialog, type AgentsControl } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog";
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
const PASTE = "Paste it into your agent’s chat, then allow it when it shows up above.";
const agent = (id: string, name: string): WorkspaceAgent => ({ id, name, admission: "sign_in", grant_id: `g-${id}`,
  connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z", active: false, lastActiveAt: null, activityKnown: true });
const request = (id: string, name: string): AgentRequest => ({ id, name, admission: "sign_in",
  requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() });
let root: Root;
let created: { admission: string; workbench_id: string; secret: string }[];
let denied: boolean;
const onInvited = vi.fn();
const control = (): AgentsControl => ({ session, apiBaseUrl: API, projectId: "project-1", projectName: "Launch plan",
  onInvited, onChanged: vi.fn() });
const select = <T extends HTMLElement = HTMLButtonElement>(selector: string) => document.querySelector<T>(selector)!;
const seat = () => select("[data-cloud-agent-invite-seat]");
const steps = () => document.querySelector<HTMLElement>(".desktop-cloud-agent-invite-steps");
const copy = () => select(".desktop-cloud-agent-invite-steps .desktop-cloud-agent-share-copy");
const stepNumbers = () => [...(steps()?.querySelectorAll<HTMLElement>("li") ?? [])].map(step => step.dataset.inviteStep);
const prompt = () => steps()?.querySelector(".desktop-cloud-agent-invite-prompt")?.textContent;
const drawing = () => document.querySelector<HTMLElement>(".desktop-cloud-agent-paste-art");
const render = async (agents: readonly WorkspaceAgent[] = [agent("c1", "Codex")], requests: readonly AgentRequest[] = []) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsDialog control={control()} agents={agents}
    requests={requests} onClose={vi.fn()} />)));
  await act(async () => { await Promise.resolve(); });
};
const press = (element: Element) => act(async () => { element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });

beforeEach(() => {
  created = []; denied = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (path === "/projects/project-1/workbench") return { workspace: { id: "workbench-1" } };
    if (path === "/projects/project-1/agent-links" && init.method === "POST") {
      if (denied) throw Object.assign(new Error("denied"), { status: 403 });
      created.push(JSON.parse(String(init.body)));
      return { agent_url: LINK };
    }
    return { links: [], connections: [] };
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Inviting an Agent from the row", () => {
  it("ends the row with an empty seat, and shows nothing until it is pressed", async () => {
    await render();
    const tiles = [...document.querySelectorAll<HTMLElement>(".desktop-cloud-agent-tile")];
    expect(tiles.at(-1)?.classList.contains("desktop-cloud-agent-invite-seat")).toBe(true);
    expect(seat().textContent).toBe("Invite agent");
    expect(seat().getAttribute("aria-expanded")).toBe("false");
    expect(steps()).toBeNull();
  });

  it("shows only the first step when pressed: the prompt to copy and Copy, and makes nothing yet", async () => {
    await render();
    await act(async () => seat().click());
    expect(seat().getAttribute("aria-expanded")).toBe("true");
    expect(stepNumbers()).toEqual(["1"]);
    expect(steps()!.querySelector(".desktop-cloud-agent-invite-step-text")!.firstChild!.textContent)
      .toBe("Copy this onboarding prompt for your agent");
    // It reads true up to the link, which only copying makes.
    expect(prompt()).toBe('Connect to my puppyone project "Launch plan" by following https://cloud-fixture.puppyone.ai/agent/••••••');
    expect(copy().textContent).toBe("Copy");
    expect(document.activeElement).toBe(copy());
    expect(drawing()).toBeNull();
    expect(created).toEqual([]);
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it("copies one line on Copy, then shows the one thing left to do beside a drawing of it", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ admission: "sign_in", workbench_id: "workbench-1" });
    expect(created[0].secret).toMatch(/^pai_[A-Za-z0-9_-]{43}$/);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(`Connect to my puppyone project "Launch plan" by following ${LINK}`);
    expect(onInvited).toHaveBeenCalledTimes(1);
    expect(copy().textContent).toBe("Copied");
    expect(select<HTMLElement>('[data-invite-step="1"]').dataset.done).toBe("true");
    // What was copied, with the invite's secret masked past its start.
    expect(prompt()).toBe('Connect to my puppyone project "Launch plan" by following https://cloud-fixture.puppyone.ai/agent/pai_fixt••••••');
    expect(stepNumbers()).toEqual(["1", "2"]);
    expect(select<HTMLElement>('[data-invite-step="2"] .desktop-cloud-agent-invite-step-text').firstChild!.textContent).toBe(PASTE);
    expect([...steps()!.querySelectorAll<HTMLElement>("[data-agent-brand]")].map(logo => logo.dataset.agentBrand))
      .toEqual(["claude", "codex", "cursor", "gemini", "github-copilot", "opencode", "hermes", "devin"]);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(PASTE);
  });

  it("draws pasting as a picture: nothing in it to press or read, another agent each pass", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    const art = drawing()!;
    expect(art.getAttribute("aria-hidden")).toBe("true");
    expect(art.querySelector("button, input, textarea, a, [role]")).toBeNull();
    expect(art.textContent).toMatch(/^(⌘V|Ctrl\+V)$/);
    expect(art.dataset.drawnAgent).toBe("claude");
    // Its parts' own passes do not count; the drawing's own pass does.
    await act(async () => { art.querySelector(".desktop-cloud-agent-paste-sheet")!.dispatchEvent(new Event("animationiteration", { bubbles: true })); });
    expect(art.dataset.drawnAgent).toBe("claude");
    await act(async () => { art.dispatchEvent(new Event("animationiteration", { bubbles: true })); });
    expect(art.dataset.drawnAgent).toBe("codex");
  });

  it("folds the steps away on the seat or anywhere else, and starts over when opened again", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    await press(steps()!);
    expect(steps()).not.toBeNull();
    await press(select(".desktop-cloud-agents-dialog-project"));
    expect(steps()).toBeNull();
    expect(seat().getAttribute("aria-expanded")).toBe("false");
    await act(async () => seat().click());
    expect(stepNumbers()).toEqual(["1"]);
    expect(prompt()).toContain("/agent/••••••");
    await act(async () => seat().click());
    expect(steps()).toBeNull();
  });

  it("gives way to the Agent as soon as it asks to join in the row", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    await render([agent("c1", "Codex")], [request("r1", "Cursor")]);
    expect(steps()).toBeNull();
    expect(document.querySelector('[data-cloud-agent-request="r1"]')).not.toBeNull();
  });

  it("makes a new invite on every press of Copy, each for one agent", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    await act(async () => copy().click());
    expect(created).toHaveLength(2);
    expect(created[0].secret).not.toBe(created[1].secret);
  });

  it("says an invite failed and stays on the first step, ready to try again", async () => {
    await render();
    await act(async () => seat().click());
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => copy().click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toContain("Try again");
    expect(stepNumbers()).toEqual(["1"]);
    expect(copy().textContent).toBe("Copy");
    expect(copy().disabled).toBe(false);
    await act(async () => copy().click());
    expect(stepNumbers()).toEqual(["1", "2"]);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("tells a non-owner why, without copying or telling the Header", async () => {
    denied = true;
    await render();
    await act(async () => seat().click());
    await act(async () => copy().click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toContain("owner");
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(onInvited).not.toHaveBeenCalled();
  });
});

describe("Inviting the first Agent", () => {
  it("opens on the first step while nobody is here, with Copy the first thing to press", async () => {
    await render([]);
    expect(document.querySelector(".desktop-cloud-agents-roster")).toBeNull();
    expect(select<HTMLElement>(".desktop-cloud-agents-first h3").textContent).toBe("Invite your first agent");
    expect(select<HTMLElement>(".desktop-cloud-agents-first p").textContent)
      .toBe("Claude Code, Codex, Cursor or any agent you chat with can work in this project.");
    expect(seat().getAttribute("aria-expanded")).toBe("true");
    expect(stepNumbers()).toEqual(["1"]);
    expect(copy().dataset.desktopDialogInitialFocus).toBe("true");
    expect(created).toEqual([]);
    await act(async () => copy().click());
    expect(stepNumbers()).toEqual(["1", "2"]);
    // The large seat folds the steps away and opens them again, as the row's seat does.
    await act(async () => seat().click());
    expect(steps()).toBeNull();
    await act(async () => seat().click());
    expect(stepNumbers()).toEqual(["1"]);
  });
});
