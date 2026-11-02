/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsDialog } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog";
import type { WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { user_id: "alice" } as DesktopCloudSession;
const claude = { id: "c1", name: "Claude Code", admission: "sign_in", grant_id: "g1",
  connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-06T12:00:00Z" } as const;
const codex = { id: "c2", name: "Codex", admission: "link", grant_id: "g2",
  connected_at: "2026-10-30T00:00:00Z", expires_at: null } as const;
const link = { id: "l1", admission: "sign_in", expires_at: "2026-11-06T00:00:00Z" } as const;
const known = (agent: typeof claude | typeof codex, active: boolean): WorkspaceAgent =>
  ({ ...agent, active, lastActiveAt: null, activityKnown: true });
let root: Root;
let inventory: { links: unknown[]; connections: unknown[] };
const onChanged = vi.fn();
const onClose = vi.fn();
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const row = (id: string) => document.querySelector<HTMLElement>(`[data-cloud-agent-managed="${id}"]`)!;
const render = async (agents: readonly WorkspaceAgent[] = []) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsDialog projectId="project-1" session={session}
    apiBaseUrl={API} agents={agents} onChanged={onChanged} onClose={onClose} />)));
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  inventory = { links: [], connections: [] };
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _change, init = {}) => {
    if (init.method === "DELETE") { inventory = { links: [], connections: [] }; return {}; }
    if (path === "/projects/project-1/access/grants/g1") {
      expect(JSON.parse(String(init.body))).toEqual({ state: "revoked" });
      inventory = { ...inventory, connections: inventory.connections.filter(agent => agent !== claude) };
      return {};
    }
    return inventory;
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Manage agents", () => {
  it("is a dialog of its own", async () => {
    await render();
    expect(dialog().getAttribute("aria-label")).toBe("Manage agents");
    expect(dialog().getAttribute("aria-modal")).toBe("true");
  });
  it("states what is known about each Agent", async () => {
    inventory = { links: [], connections: [claude, codex] };
    await render([known(claude, true), known(codex, false)]);
    expect(row("c1").textContent).toContain("Active now · Approved by you · Access ends Nov");
    expect(row("c2").textContent).toContain("No recent activity · Joined with a link");
    expect(row("c2").textContent).not.toContain("Access ends");
  });
  it("removes one Agent, names which, and tells the Header", async () => {
    inventory = { links: [], connections: [claude, codex] };
    await render();
    const remove = row("c1").querySelector<HTMLButtonElement>("button")!;
    expect(remove.getAttribute("aria-label")).toBe("Remove Claude Code");
    await act(async () => remove.click());
    await act(async () => { await Promise.resolve(); });
    expect(row("c1")).toBeNull();
    expect(row("c2")).not.toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it("says a removal failed and keeps the row", async () => {
    inventory = { links: [], connections: [claude] };
    await render();
    vi.mocked(cloudApiRequest).mockRejectedValueOnce(new Error("offline"));
    await act(async () => row("c1").querySelector<HTMLButtonElement>("button")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(row("c1")).not.toBeNull();
  });
  it("shows each open invite link, so what would be removed can be seen", async () => {
    inventory = { links: [link, { ...link, id: "l2" }], connections: [] };
    await render();
    const links = document.querySelector(".desktop-cloud-agents-links")!;
    expect(links.querySelector("h3")?.textContent).toBe("Open invite links");
    expect(links.querySelectorAll("li")).toHaveLength(2);
    expect(links.textContent).toContain("Expires Nov");
  });
  it("removes every Agent and link at once, and says so", async () => {
    inventory = { links: [link], connections: [claude] };
    await render();
    const all = document.querySelector<HTMLButtonElement>(".desktop-cloud-agent-share-stop")!;
    expect(all.textContent).toBe("Remove all agents and links");
    await act(async () => all.click());
    await act(async () => { await Promise.resolve(); });
    expect(cloudApiRequest).toHaveBeenCalledWith("/projects/project-1/agent-links", session, undefined, { method: "DELETE" }, API);
    expect(document.querySelector(".desktop-cloud-agents-empty")?.textContent).toBe("No agents in this project.");
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).toBeNull();
  });
  it("does not repeat one Agent's Remove as a second action", async () => {
    inventory = { links: [], connections: [claude] };
    await render();
    expect(document.querySelector(".desktop-cloud-agent-share-stop")).toBeNull();
  });
  it("closes from its own button", async () => {
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>(".desktop-dialog-header button")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
