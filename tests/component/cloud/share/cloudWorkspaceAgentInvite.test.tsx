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
const copyButton = () => select(".desktop-cloud-agent-share-copy");
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
  it("is one sentence and the prompt it names, with the button that copies it on the prompt", async () => {
    await render();
    expect(document.querySelector("h3")?.textContent).toBe("Copy this prompt and paste it into your agent’s chat to invite it.");
    const preview = select(".desktop-cloud-agent-prompt-text");
    expect(preview.getAttribute("aria-label")).toBe("Prompt for your agent");
    // It reads true up to the link, which only copying makes.
    expect(preview.textContent).toBe('Connect to my puppyone project "Launch plan" by following https://cloud-fixture.puppyone.ai/agent/••••••');
    expect(copyButton().parentElement?.classList.contains("desktop-cloud-agent-prompt")).toBe(true);
    expect(copyButton().textContent).toBe("Copy prompt");
    // Nothing waits here for the Agent: no ticket, no door, no wait.
    expect(document.querySelector(".desktop-cloud-agent-ticket, .desktop-cloud-agent-door, .desktop-cloud-agent-invite-note")).toBeNull();
    expect(created).toEqual([]);
  });

  it("copies one line that asks the agent to connect, and says so plainly", async () => {
    await render();
    await act(async () => copyButton().click());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ admission: "sign_in", workbench_id: "workbench-1" });
    expect(created[0].secret).toMatch(/^pai_[A-Za-z0-9_-]{43}$/);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(`Connect to my puppyone project "Launch plan" by following ${LINK}`);
    expect(copyButton().textContent).toBe("Copied");
    expect(copyButton().dataset.copied).toBe("true");
    expect(copyButton().querySelector("svg")).not.toBeNull();
    expect(select(".desktop-cloud-agent-prompt").hasAttribute("data-copied")).toBe(true);
    expect(status()).toBe("Copied. Paste it to your agent.");
  });

  it("returns the button to its label so a second agent can be invited", async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => copyButton().click());
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(copyButton().textContent).toBe("Copy prompt");
      expect(status()).toBe("");
      await act(async () => copyButton().click());
      expect(created).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("offers no choice while the deployment keeps open links closed", async () => {
    await render();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    await act(async () => copyButton().click());
    expect(created[0].admission).toBe("sign_in");
  });

  it("defaults to the choice that needs the owner's sign-in, and states the risk of the other", async () => {
    inventory = { links: [], connections: [], open_links_enabled: true };
    await render();
    expect(select('[data-agent-admission="sign_in"]').getAttribute("aria-checked")).toBe("true");
    expect(select('[data-agent-admission="link"]').textContent).toContain("gets its own copy of the project");
    await act(async () => select('[data-agent-admission="link"]').click());
    await act(async () => copyButton().click());
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
  });

  it("says a link failed, and stays ready to retry", async () => {
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline")); // The first list refresh.
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => copyButton().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(copyButton().textContent).toBe("Copy prompt");
    expect(copyButton().disabled).toBe(false);
    await act(async () => copyButton().click());
    expect(copyButton().textContent).toBe("Copied");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("tells a non-owner why it failed, without copying", async () => {
    denied = true;
    await render();
    await act(async () => copyButton().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("owner");
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it("tells the Header at once when a link is made, and not when it fails", async () => {
    const onInvited = vi.fn();
    denied = true;
    await render({ onInvited });
    await act(async () => copyButton().click());
    expect(onInvited).not.toHaveBeenCalled();
    denied = false;
    await act(async () => copyButton().click());
    expect(onInvited).toHaveBeenCalledTimes(1);
  });

  it("asks a dialog to put focus on copying when that is the one thing to do", async () => {
    await render({ initialFocus: true });
    expect(copyButton().dataset.desktopDialogInitialFocus).toBe("true");
    await render();
    expect(copyButton().dataset.desktopDialogInitialFocus).toBeUndefined();
  });
});
