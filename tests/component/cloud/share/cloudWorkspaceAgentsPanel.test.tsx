/** @vitest-environment happy-dom */
import { act, useState, type ComponentProps } from "react";
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
const primary = () => select(".desktop-cloud-agent-share-copy");
type PanelProps = ComponentProps<typeof CloudWorkspaceAgentsPanel>;
const anchor = { current: document.createElement("button") };
/** The Header owns which Agent is unfolded; this stands in for it. */
function Panel({ initial = null, ...props }: Partial<PanelProps> & { initial?: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(initial);
  return <CloudWorkspaceAgentsPanel anchor={anchor} projectId="project-1" projectName="Launch plan" session={session}
    apiBaseUrl={API} expandedAgentId={expanded} onExpandAgent={setExpanded} onClose={vi.fn()} {...props} />;
}
const render = async (props: Partial<PanelProps> & { initial?: string | null } = {}) => {
  await act(async () => root.render(withTestLocalization(<Panel {...props} />)));
};
const row = (id: string) => document.querySelector<HTMLElement>(`[data-cloud-agent-row="${id}"]`)!;
const unfold = async (id: string) => { await act(async () => row(id).querySelector<HTMLButtonElement>(".desktop-cloud-agent-row")!.click()); };

beforeEach(() => {
  inventory = { links: [], connections: [] }; created = []; denied = false;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (path === "/projects/project-1/workbench") return { workspace: { id: "workbench-1" } };
    if (path === "/projects/project-1/agent-links" && init.method === "POST") {
      if (denied) throw Object.assign(new Error("denied"), { status: 403 });
      created.push(JSON.parse(String(init.body)));
      return { agent_url: LINK };
    }
    if (path === "/projects/project-1/agent-links" && init.method === "DELETE") {
      inventory = { links: [], connections: [] }; return { stopped: true };
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
    expect(document.body.textContent).toContain("then open the link it sends you");
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
    expect(primary().textContent).toBe("Copied");
  });

  it("returns the button to its label so a second agent can be connected", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => primary().click());
      expect(primary().textContent).toBe("Copied");
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(primary().textContent).toBe("Copy invite");
      expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    } finally { vi.useRealTimers(); }
  });

  it("says a link failed beside the button, which stays ready to retry", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => primary().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(primary().textContent).toBe("Copy invite");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    await act(async () => primary().click());
    expect(primary().textContent).toBe("Copied");
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

  it("shows an agent as soon as it connects, and removes it from its own details", async () => {
    vi.useFakeTimers();
    try {
      await render();
      expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
      inventory = { links: [], connections: [agent] };
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(document.querySelector(".desktop-cloud-agent-list")?.textContent).toContain("Claude Code");
      expect(document.querySelector(".desktop-cloud-agent-remove")).toBeNull();
      await unfold("c1");
      await act(async () => select(".desktop-cloud-agent-remove").click());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("opens on the Agent that was pressed, and one row at a time", async () => {
    inventory = { links: [], connections: [agent, { ...agent, id: "c2", name: "Codex", grant_id: "g2" }] };
    await render({ initial: "c2" });
    expect(row("c1").querySelector(".desktop-cloud-agent-detail")).toBeNull();
    expect(row("c2").querySelector(".desktop-cloud-agent-detail")).not.toBeNull();
    await unfold("c1");
    expect(row("c1").querySelector(".desktop-cloud-agent-row")?.getAttribute("aria-expanded")).toBe("true");
    expect(row("c2").querySelector(".desktop-cloud-agent-detail")).toBeNull();
    await unfold("c1");
    expect(document.querySelector(".desktop-cloud-agent-detail")).toBeNull();
  });

  it("says how each Agent got in and when its access ends", async () => {
    inventory = { links: [], connections: [agent,
      { ...agent, id: "c2", name: "Codex", grant_id: "g2", admission: "link", expires_at: "2026-11-06T12:00:00Z" }] };
    await render({ initial: "c1" });
    expect(row("c1").querySelector("dl")?.textContent).toContain("Approved by you");
    expect(row("c1").querySelector("dl")?.textContent).not.toContain("Access ends");
    await unfold("c2");
    expect(row("c2").querySelector("dl")?.textContent).toContain("Joined with a link");
    expect(row("c2").querySelector("dl")?.textContent).toContain("Access ends");
  });

  it("says what Remove all would end: how many invites are still open", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }, { id: "l2", admission: "link", expires_at: "2026-11-06T00:00:00Z" }],
      connections: [agent] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-foot")?.textContent).toContain("2 invite links still open");
    expect(select(".desktop-cloud-agent-share-stop").getAttribute("aria-label")).toBe("Remove every agent and invite link");
  });

  it("explains Remove all by its open invite when nothing has connected yet", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }], connections: [] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-foot")?.textContent).toContain("1 invite link still open");
    expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).not.toBeNull();
  });

  it("removes every link and connected agent at once", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }], connections: [agent] };
    await render();
    await act(async () => select(".desktop-cloud-agent-share-stop").click());
    expect(cloudApiRequest).toHaveBeenCalledWith("/projects/project-1/agent-links", session, undefined,
      { method: "DELETE" }, API);
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).toBeNull();
  });

  it("does not repeat one Agent's Remove as a second action", async () => {
    inventory = { links: [], connections: [agent] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-foot")).toBeNull();
  });

  it("states what is true now on the row and keeps when access ends for the details", async () => {
    inventory = { links: [], connections: [{ ...agent, expires_at: "2026-11-06T12:00:00Z" }] };
    await render({ agents: [{ ...agent, admission: "sign_in", active: true, lastActiveAt: null, activityKnown: true }] });
    expect(document.querySelector(".desktop-cloud-agent-state")?.textContent).toBe("Active now");
    expect(document.body.textContent).not.toContain("Access ends");
  });

  it("draws an Agent with the mark the shell lends it", async () => {
    inventory = { links: [], connections: [agent] };
    await render({ agents: [{ ...agent, admission: "sign_in", active: true, lastActiveAt: null, activityKnown: true }],
      renderAgentMark: ({ name, active }: { name: string; active: boolean }) => <i data-mark={name} data-working={active} /> });
    const line = document.querySelector(".desktop-cloud-agent-list li")!;
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
    await render({ onChanged, initial: "c1" });
    await act(async () => primary().click());
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => select(".desktop-cloud-agent-remove").click());
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("offers nothing to end when nothing is shared", async () => {
    await render();
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).toBeNull();
  });

  it("stays usable if the list cannot be read", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect((primary()).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
