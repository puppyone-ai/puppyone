/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentInvite } from "../../../../src/features/cloud/share/CloudWorkspaceAgentInvite";
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
let denied: boolean;

const select = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const primary = () => select(".desktop-cloud-agent-share-copy");
const status = () => document.querySelector('[role="status"]')?.textContent;
const render = async (props: Partial<ComponentProps<typeof CloudWorkspaceAgentInvite>> = {}) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentInvite projectId="project-1"
    projectName="Launch plan" session={session} apiBaseUrl={API} {...props} />)));
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
    if (path === "/projects/project-1/agent-links") return inventory;
    throw new Error(`Unexpected ${path}`);
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Inviting an Agent", () => {
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

  it("defaults to the choice that needs the owner's sign-in and creates nothing until asked", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="sign_in"]').getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("you allow it here");
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
    expect(copied).toBe(`Connect to my puppyone project "Launch plan" by following ${LINK}`);
    expect(status()).toContain("Paste it");
    expect(primary().textContent).toBe("Copied");
  });

  it("returns the button to its label so a second agent can be invited", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => primary().click());
      expect(primary().textContent).toBe("Copied");
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(primary().textContent).toBe("Copy prompt");
      expect(status()).toBe("");
    } finally { vi.useRealTimers(); }
  });

  it("says it waits for the agent under the step while the Header does", async () => {
    await render({ waiting: true });
    expect(status()).toBe("Waiting for your agent…");
    expect(document.querySelector(".desktop-cloud-agent-invite-hint + .desktop-cloud-agent-invite-note svg")).not.toBeNull();
    await render({ waiting: false });
    expect(document.querySelector(".desktop-cloud-agent-invite-note")).toBeNull();
  });

  it("says a link failed beside the button, which stays ready to retry", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => primary().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(primary().textContent).toBe("Copy prompt");
    expect(primary().disabled).toBe(false);
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
    expect(select('[data-agent-admission="sign_in"]').textContent).toContain("you allow it here");
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

  it("shows the start of the prompt and the step after it, and mints no link until it is copied", async () => {
    await render();
    expect(document.querySelector("h3")?.textContent).toBe("Invite an agent");
    const preview = document.querySelector(".desktop-cloud-agent-prompt-text");
    expect(preview?.getAttribute("aria-label")).toBe("Prompt for your agent");
    // The button that copies it sits on the prompt itself, so the two read as one thing.
    expect(primary().parentElement?.classList.contains("desktop-cloud-agent-prompt")).toBe(true);
    expect(primary().textContent).toBe("Copy prompt");
    // It reads true up to the link, which only copying makes.
    expect(preview?.textContent).toBe('Connect to my puppyone project "Launch plan" by following https://cloud-fixture.puppyone.ai/agent/');
    expect(document.querySelector(".desktop-cloud-agent-invite-hint")?.textContent)
      .toBe("Paste it into your chat with the agent, then allow it here when it asks to join.");
    expect(created).toEqual([]);
  });

  it("tells the Header at once when a link is made, and not when it fails", async () => {
    const onInvited = vi.fn();
    denied = true;
    await render({ onInvited });
    await act(async () => primary().click());
    expect(onInvited).not.toHaveBeenCalled();
    denied = false;
    await act(async () => primary().click());
    expect(onInvited).toHaveBeenCalledTimes(1);
  });

  it("shows how inviting goes while no Agent is here, and only as an illustration", async () => {
    await render();
    const demo = document.querySelector<HTMLElement>("[data-cloud-agent-demo]")!;
    expect(demo.getAttribute("aria-hidden")).toBe("true");
    expect(demo.dataset.cloudAgentDemo).toBe("Claude Code");
    expect(demo.textContent).toContain('Connect to my puppyone project "Launch plan"');
    expect(demo.textContent).toContain("Wants to join");
    expect(demo.querySelector("button")).toBeNull();
    // Each pass of the loop shows another Agent; its parts' own passes do not count.
    await act(async () => demo.querySelector("p")!.dispatchEvent(new Event("animationiteration", { bubbles: true })));
    expect(demo.dataset.cloudAgentDemo).toBe("Claude Code");
    await act(async () => demo.dispatchEvent(new Event("animationiteration", { bubbles: true })));
    expect(demo.dataset.cloudAgentDemo).toBe("Codex");
  });

  it("leaves the illustration out once Agents are here", async () => {
    await render({ compact: true });
    await act(async () => select("[data-cloud-agent-invite-open]").click());
    expect(document.querySelector("[data-cloud-agent-demo]")).toBeNull();
  });

  it("waits behind one row among the Agents, and opens the form rather than copying", async () => {
    await render({ compact: true });
    expect(document.querySelector("h3")).toBeNull();
    const row = select("[data-cloud-agent-invite-open]");
    expect(row.textContent).toBe("Invite another agent");
    await act(async () => row.click());
    expect(created).toEqual([]);
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(document.querySelector("h3")?.textContent).toBe("Invite an agent");
    // The row it replaced is gone, so focus lands on what to press next.
    expect(document.activeElement).toBe(primary());
  });

  it("says the wait under the row while the form is closed", async () => {
    await render({ compact: true, waiting: true });
    expect(document.querySelector(".desktop-cloud-agent-invite-note")?.textContent).toBe("Waiting for your agent…");
  });

  it("keeps the full form beside the Agents where a deployment offers a choice of who gets in", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render({ compact: true });
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(primary().textContent).toBe("Copy prompt");
  });

  it("stays usable if the list cannot be read", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect((primary()).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
