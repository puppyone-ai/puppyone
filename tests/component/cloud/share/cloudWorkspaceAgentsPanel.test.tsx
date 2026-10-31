/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsPanel } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsPanel";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { writeClipboardText } from "../../../../src/lib/clipboard";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { user_id: "alice" } as DesktopCloudSession;
const LINK = "https://cloud-fixture.puppyone.ai/agent/pai_fixture";
const agent = { id: "c1", name: "Claude Code", admission: "sign_in", grant_id: "g1",
  connected_at: "2026-10-30T00:00:00Z", expires_at: null };
let root: Root;
let inventory: { links: unknown[]; connections: unknown[]; open_links_enabled?: boolean };
let created: { admission: string; workbench_id: string; secret: string }[];
let denied: boolean;

const select = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const primary = () => select("[data-cloud-agent-invite]");
type PanelProps = ComponentProps<typeof CloudWorkspaceAgentsPanel>;
const anchor = { current: document.createElement("button") };
const render = async (props: Partial<PanelProps> = {}) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsPanel anchor={anchor} projectId="project-1"
    projectName="Launch plan" session={session} apiBaseUrl={API} onClose={vi.fn()} {...props} />)));
};
const row = (id: string) => document.querySelector<HTMLElement>(`[data-cloud-agent-row="${id}"]`)!;
const remove = (id: string) => row(id).querySelector<HTMLButtonElement>(".desktop-cloud-agent-remove")!;

beforeEach(() => {
  inventory = { links: [], connections: [] }; created = []; denied = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (path === "/projects/project-1/workbench") return { workspace: { id: "workbench-1" } };
    if (path === "/projects/project-1/agent-links" && init.method === "POST") {
      if (denied) throw Object.assign(new Error("denied"), { status: 403 });
      created.push(JSON.parse(String(init.body)));
      return { agent_url: LINK };
    }
    if (path === "/projects/project-1/access/grants/g1") {
      expect(JSON.parse(String(init.body))).toEqual({ state: "revoked" });
      inventory = { links: [], connections: [] }; return {};
    }
    if (path === "/projects/project-1/agent-links") return inventory;
    throw new Error(`Unexpected ${path}`);
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("The Agents in a project", () => {
  it("offers no choice while the deployment keeps open links closed", async () => {
    await render();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.querySelector('[data-agent-admission="link"]')).toBeNull();
    await act(async () => primary().click());
    expect(created[0].admission).toBe("sign_in");
  });

  it("keeps open links closed when an older server does not say", async () => {
    inventory = { links: [], connections: [] };
    await render();
    expect(document.body.textContent).not.toContain("Any agent with the link");
  });

  it("falls back to sign-in when open links close while the panel is open", async () => {
    vi.useFakeTimers();
    try {
      inventory = { links: [], connections: [], open_links_enabled: true };
      await render();
      await act(async () => select('[data-agent-admission="link"]').click());
      inventory = { links: [], connections: [], open_links_enabled: false };
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(document.querySelector('[data-agent-admission="link"]')).toBeNull();
      await act(async () => primary().click());
      expect(created[0].admission).toBe("sign_in");
    } finally { vi.useRealTimers(); }
  });

  it("defaults to the choice that needs the owner's sign-in and creates nothing until asked", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="sign_in"]').getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("sign-in link");
    expect(created).toEqual([]);
  });

  it("copies one line that asks the agent to connect", async () => {
    await render();
    await act(async () => primary().click());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ admission: "sign_in", workbench_id: "workbench-1" });
    expect(created[0].secret).toMatch(/^pai_[A-Za-z0-9_-]{43}$/);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(LINK));
    const copied = vi.mocked(writeClipboardText).mock.calls[0][0];
    expect(copied).toContain('"Launch plan"');
    expect(copied).toContain("sign-in link");
    expect(copied.split("\n")).toHaveLength(1);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Paste it");
    expect(primary().textContent).toBe("Copied. Paste it to your agent.");
  });

  it("returns the button to its label so a second agent can be connected", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => primary().click());
      expect(primary().textContent).toBe("Copied. Paste it to your agent.");
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(primary().textContent).toBe("Invite new agents");
      expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    } finally { vi.useRealTimers(); }
  });

  it("says a link failed beside the button, which stays ready to retry", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => primary().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(primary().textContent).toBe("Invite new agents");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    await act(async () => primary().click());
    expect(primary().textContent).toBe("Copied. Paste it to your agent.");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("states the risk of any agent with the link before it is chosen", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="link"]').textContent).toContain("gets its own copy of the project");
    await act(async () => select('[data-agent-admission="link"]').click());
    expect(select('[data-agent-admission="link"]').getAttribute("aria-checked")).toBe("true");
    expect(select('[data-agent-admission="sign_in"]').textContent).toContain("sign-in link");
    await act(async () => primary().click());
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

  it("tells a non-owner why it failed, without copying", async () => {
    denied = true;
    await render();
    await act(async () => primary().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("owner");
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it("shows an agent as soon as it connects, and removes it", async () => {
    vi.useFakeTimers();
    try {
      await render();
      expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
      inventory = { links: [], connections: [agent] };
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(document.querySelector(".desktop-cloud-agent-list")?.textContent).toContain("Claude Code");
      await act(async () => remove("c1").click());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("says who is here and when they were last here, and nothing else", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }],
      connections: [{ ...agent, expires_at: "2026-11-06T12:00:00Z" }] };
    await render({ agents: [{ ...agent, admission: "sign_in", active: true, lastActiveAt: null, activityKnown: true }] });
    expect(document.querySelector(".desktop-cloud-agent-state")?.textContent).toBe("Active now");
    expect(document.querySelector("[data-cloud-agent-row]")?.textContent).toBe("Claude CodeActive now");
    expect(document.querySelector(".desktop-cloud-workspace-share")?.textContent).toBe("Claude CodeActive nowInvite new agents");
  });

  it("only invites with a line of its own while nobody is here", async () => {
    await render();
    expect(document.querySelector(".desktop-cloud-workspace-share")?.textContent).toBe("Invite new agents");
  });

  it("names the Agent that Remove would remove", async () => {
    inventory = { links: [], connections: [agent] };
    await render();
    expect(remove("c1").getAttribute("aria-label")).toBe("Remove from project Claude Code");
  });

  it("draws an Agent with the mark the shell lends it", async () => {
    inventory = { links: [], connections: [agent] };
    await render({ agents: [{ ...agent, admission: "sign_in", active: true, lastActiveAt: null, activityKnown: true }],
      renderAgentMark: ({ name, active }: { name: string; active: boolean }) => <i data-mark={name} data-working={active} /> });
    const line = row("c1");
    expect(line.querySelector("[data-mark]")?.getAttribute("data-working")).toBe("true");
    expect(line.querySelector(".desktop-cloud-agent-lamp")).toBeNull();
  });

  it("agrees with the Header about who is active", async () => {
    inventory = { links: [], connections: [agent, { ...agent, id: "c2", name: "Codex", grant_id: "g2" }] };
    await render({ agents: [{ ...agent, admission: "sign_in", active: true, lastActiveAt: null, activityKnown: true },
      { ...agent, admission: "sign_in", id: "c2", name: "Codex", grant_id: "g2", active: false, lastActiveAt: null, activityKnown: true }] });
    const [busy, quiet] = document.querySelectorAll(".desktop-cloud-agent-list li");
    expect(busy.textContent).toContain("Active now");
    expect(busy.querySelector("[data-active]")).not.toBeNull();
    expect(quiet.textContent).toContain("No recent activity");
    expect(quiet.querySelector("[data-active]")).toBeNull();
  });

  it("tells the Header at once when a change is made here", async () => {
    inventory = { links: [], connections: [agent] };
    const onChanged = vi.fn();
    await render({ onChanged });
    await act(async () => primary().click());
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => remove("c1").click());
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("says a removal failed without losing the row", async () => {
    inventory = { links: [], connections: [agent] };
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => remove("c1").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(row("c1")).not.toBeNull();
  });

  it("stays usable if the list cannot be read", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect((primary()).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
