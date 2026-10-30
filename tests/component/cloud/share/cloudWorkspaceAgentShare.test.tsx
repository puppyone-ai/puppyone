/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentShare } from "../../../../src/features/cloud/share/CloudWorkspaceAgentShare";
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
let inventory: { links: unknown[]; connections: unknown[] };
let created: { admission: string; workbench_id: string; secret: string }[];
let denied: boolean;

const select = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const primary = () => select(".desktop-cloud-agent-share-copy");
const render = async () => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentShare projectId="project-1"
    projectName="Launch plan" session={session} apiBaseUrl={API} />)));
};

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

describe("Connecting an agent from Share", () => {
  it("defaults to the choice that needs the owner's sign-in and creates nothing until asked", async () => {
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
    expect(primary().textContent).toContain("Paste it");
  });

  it("returns the button to its label so a second agent can be connected", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => primary().click());
      expect(primary().textContent).toContain("Paste it");
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(primary().textContent).toBe("Copy for your agent");
      expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    } finally { vi.useRealTimers(); }
  });

  it("reports a failed link in the button itself and lets it be retried", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => primary().click());
    expect(primary().textContent).toContain("Try again");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    await act(async () => primary().click());
    expect(primary().textContent).toContain("Paste it");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("states the risk of any agent with the link before it is chosen", async () => {
    await render();
    expect(select('[data-agent-admission="link"]').textContent).toContain("run commands and edit every file");
    await act(async () => select('[data-agent-admission="link"]').click());
    expect(select('[data-agent-admission="link"]').getAttribute("aria-checked")).toBe("true");
    expect(select('[data-agent-admission="sign_in"]').textContent).toContain("sign-in link");
    await act(async () => primary().click());
    expect(created[0].admission).toBe("link");
  });

  it("moves between the two choices with the arrow keys, as one tab stop", async () => {
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
      await act(async () => select(".desktop-cloud-agent-list button").click());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("says what Stop would end: how many links are open and when an agent's access runs out", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }, { id: "l2", admission: "link", expires_at: "2026-11-06T00:00:00Z" }],
      connections: [agent, { ...agent, id: "c2", name: "Codex", grant_id: "g2", admission: "link", expires_at: "2026-11-06T12:00:00Z" }] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-reach-header")?.textContent).toContain("2 active links");
    const [approved, expiring] = document.querySelectorAll(".desktop-cloud-agent-list li");
    expect(approved.querySelector(".desktop-cloud-agent-expiry")).toBeNull();
    expect(expiring.querySelector(".desktop-cloud-agent-expiry")?.textContent).toContain("Expires Nov");
  });

  it("explains Stop by its open link when nothing has connected yet", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }], connections: [] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-reach-header")?.textContent).toContain("1 active link");
    expect(document.querySelector(".desktop-cloud-agent-reach-header h4")).toBeNull();
    expect(document.querySelector(".desktop-cloud-agent-list")).toBeNull();
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).not.toBeNull();
  });

  it("stops every link and connected agent at once", async () => {
    inventory = { links: [{ id: "l1", admission: "link", expires_at: "2026-11-06T00:00:00Z" }], connections: [agent] };
    await render();
    await act(async () => select(".desktop-cloud-agent-share-stop").click());
    expect(cloudApiRequest).toHaveBeenCalledWith("/projects/project-1/agent-links", session, undefined,
      { method: "DELETE" }, API);
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).toBeNull();
  });

  it("offers nothing to stop when nothing is shared", async () => {
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
