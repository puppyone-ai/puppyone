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
const seat = () => select(".desktop-cloud-agent-seat-button");
const steps = () => document.querySelector<HTMLElement>(".desktop-cloud-agent-invite-steps");
const status = () => document.querySelector('[role="status"]')?.textContent;
const render = async (agents: readonly WorkspaceAgent[] = [agent("c1", "Codex")], requests: readonly AgentRequest[] = []) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsDialog control={control()} agents={agents}
    requests={requests} onClose={vi.fn()} />)));
  await act(async () => { await Promise.resolve(); });
};

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
  it("ends the row with an empty seat that invites, and makes nothing until it is pressed", async () => {
    await render();
    const tiles = [...document.querySelectorAll<HTMLElement>(".desktop-cloud-agent-tile")];
    expect(tiles.at(-1)?.classList.contains("desktop-cloud-agent-invite-seat")).toBe(true);
    expect(seat().textContent).toBe("Invite agent");
    expect(seat().getAttribute("aria-expanded")).toBe("false");
    expect(steps()).toBeNull();
    expect(document.querySelector(".desktop-cloud-agent-prompt, .desktop-cloud-agent-invite h3")).toBeNull();
    expect(created).toEqual([]);
  });

  it("copies one line that asks the agent to connect, and says what happens next in three steps", async () => {
    await render();
    await act(async () => seat().click());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ admission: "sign_in", workbench_id: "workbench-1" });
    expect(created[0].secret).toMatch(/^pai_[A-Za-z0-9_-]{43}$/);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(`Connect to my puppyone project "Launch plan" by following ${LINK}`);
    expect(onInvited).toHaveBeenCalledTimes(1);
    expect(seat().textContent).toBe("Copied");
    expect(seat().getAttribute("aria-expanded")).toBe("true");
    expect([...steps()!.querySelectorAll("li")].map(step => step.querySelector(".desktop-cloud-agent-invite-step-text")!.firstChild!.textContent))
      .toEqual(["Invite copied", "Paste it into your agent’s chat", "It will ask to join above. Allow it."]);
    // Which agents can come, as their marks and nothing else.
    expect([...steps()!.querySelectorAll<HTMLElement>("[data-agent-brand]")].map(logo => logo.dataset.agentBrand))
      .toEqual(["claude", "codex", "cursor", "gemini", "github-copilot", "opencode", "hermes", "devin"]);
    expect(status()).toBe("Copied. Paste it to your agent.");
  });

  it("folds the steps away on a press anywhere else, and keeps them for a press on them", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => { steps()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(steps()).not.toBeNull();
    await act(async () => { select(".desktop-cloud-agents-dialog-project").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(steps()).toBeNull();
    expect(seat().textContent).toBe("Invite agent");
  });

  it("gives way to the Agent as soon as it asks to join in the row", async () => {
    await render();
    await act(async () => seat().click());
    await render([agent("c1", "Codex")], [request("r1", "Cursor")]);
    expect(steps()).toBeNull();
    expect(document.querySelector('[data-cloud-agent-request="r1"]')).not.toBeNull();
  });

  it("makes a new invite on every press, each for one agent", async () => {
    await render();
    await act(async () => seat().click());
    await act(async () => seat().click());
    expect(created).toHaveLength(2);
    expect(created[0].secret).not.toBe(created[1].secret);
  });

  it("says an invite failed and stays ready to try again", async () => {
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => seat().click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toContain("Try again");
    expect(steps()).toBeNull();
    expect(seat().disabled).toBe(false);
    await act(async () => seat().click());
    expect(steps()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("tells a non-owner why, without copying or telling the Header", async () => {
    denied = true;
    await render();
    await act(async () => seat().click());
    expect(select<HTMLElement>('[role="alert"]').textContent).toContain("owner");
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(onInvited).not.toHaveBeenCalled();
  });
});

describe("Inviting the first Agent", () => {
  it("is the whole page while nobody is here: a large seat, one line, and the button to press first", async () => {
    await render([]);
    expect(document.querySelector(".desktop-cloud-agents-roster")).toBeNull();
    expect(select<HTMLElement>(".desktop-cloud-agents-first h3").textContent).toBe("Invite your first agent");
    expect(select<HTMLElement>(".desktop-cloud-agents-first p").textContent)
      .toBe("Claude Code, Codex, Cursor or any agent you chat with can work in this project.");
    const button = select(".desktop-cloud-agents-first .desktop-cloud-agent-share-copy");
    expect(button.textContent).toBe("Copy invite");
    expect(button.dataset.desktopDialogInitialFocus).toBe("true");
    // The large seat does the same for a pointer, without a second tab stop.
    expect(select(".desktop-cloud-agent-seat-large").tabIndex).toBe(-1);
    await act(async () => button.click());
    expect(created).toHaveLength(1);
    expect(button.textContent).toBe("Copied");
    expect(steps()).not.toBeNull();
    await act(async () => select(".desktop-cloud-agent-seat-large").click());
    expect(created).toHaveLength(2);
  });
});
