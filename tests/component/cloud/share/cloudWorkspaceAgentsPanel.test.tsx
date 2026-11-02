/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentsPanel } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsPanel";
import type { WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = (id: string, name: string, active: boolean): WorkspaceAgent => ({ id, name, admission: "sign_in",
  grant_id: `g-${id}`, connected_at: "2026-10-30T00:00:00Z", expires_at: "2026-11-29T00:00:00Z",
  active, lastActiveAt: null, activityKnown: true });
const anchor = { current: document.createElement("button") };
let root: Root;
const surface = () => document.querySelector<HTMLElement>(".desktop-cloud-agents-panel")!;
const render = async (onManage = vi.fn(), renderAgentMark?: Parameters<typeof CloudWorkspaceAgentsPanel>[0]["renderAgentMark"]) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceAgentsPanel anchor={anchor}
    agents={[agent("c1", "Claude Code", true), agent("c2", "Codex", false)]}
    renderAgentMark={renderAgentMark} onManage={onManage} onClose={vi.fn()} />)));
};
beforeEach(() => { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("The Agents in a project, at a glance", () => {
  it("says who is here and when each was last here, and nothing else", async () => {
    await render();
    expect(surface().textContent).toBe("Claude CodeActive nowCodexNo recent activityManage agents");
  });
  it("changes nothing itself: Manage agents is the one thing to press", async () => {
    await render();
    expect(surface().querySelectorAll("button")).toHaveLength(1);
    expect(surface().querySelector("button")?.textContent).toBe("Manage agents");
  });
  it("hands over to Manage agents", async () => {
    const onManage = vi.fn();
    await render(onManage);
    await act(async () => surface().querySelector<HTMLButtonElement>("[data-cloud-agents-manage]")!.click());
    expect(onManage).toHaveBeenCalledTimes(1);
  });
  it("draws an Agent with the mark the shell lends it", async () => {
    await render(vi.fn(), ({ name, active }) => <i data-mark={name} data-working={active} />);
    const row = surface().querySelector('[data-cloud-agent-row="c1"]')!;
    expect(row.querySelector("[data-mark]")?.getAttribute("data-working")).toBe("true");
    expect(row.querySelector(".desktop-cloud-agent-lamp")).toBeNull();
  });
});
