/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentPeople, CloudWorkspaceAgentMark } from "../../../../src/app/CloudWorkspaceAgentPeople";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { AgentRequest, ConnectedAgent } from "../../../../src/features/cloud/share/agentLinks";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", async original => ({
  ...await original<typeof import("../../../../src/lib/cloudApi")>(), cloudApiRequest: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { api_base_url: API, user_id: "alice", session_generation: "1" } as DesktopCloudSession;
const context = (id = "p1"): ProjectCloudContext => ({ status: "resolved", projectId: id, projectName: "My project",
  target: { kind: "project_root", project_id: id }, capabilities: ["content.read"] });
const request = (id: string, name: string, avatar?: string): AgentRequest => ({ id, name, avatar,
  admission: "sign_in", requested_at: new Date(Date.now() - 30_000).toISOString(),
  expires_at: new Date(Date.now() + 600_000).toISOString() });
let root: Root;
let pending: AgentRequest[];
let connections: ConnectedAgent[];
let failDecision: boolean;
let failInventory: boolean;
let delayDecision: (() => Promise<void>) | undefined;
const card = () => document.querySelector<HTMLElement>("[data-cloud-agent-request-card]");
const decision = (answer: "approve" | "reject") => card()!.querySelector<HTMLButtonElement>(`[data-agent-decision=${answer}]`)!;
const writes = () => vi.mocked(cloudApiRequest).mock.calls.filter(call => String(call[0]).endsWith("/decision"));
const render = async (id = "p1", activeSession = session, apiBaseUrl = API) => {
  await act(async () => root.render(withTestLocalization(<CloudWorkspaceHeaderTools context={context(id)} session={activeSession}
    apiBaseUrl={apiBaseUrl} onSessionChange={vi.fn()} renderPeople={people => <CloudWorkspaceAgentPeople {...people} />}
    renderAgentMark={agent => <CloudWorkspaceAgentMark {...agent} />} />)));
};
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  pending = [request("r1", "My helper", "codex")]; connections = [];
  failDecision = false; failInventory = false; delayDecision = undefined;
  vi.mocked(cloudApiRequest).mockImplementation(async (path, _session, _signal, options) => {
    if (String(path).endsWith("/decision")) {
      if (failDecision) throw new Error("network unavailable");
      await delayDecision?.();
      const identity = String(path).split("/").at(-2);
      const applicant = pending.find(value => value.id === identity)!;
      const answer = JSON.parse(String(options?.body)).decision;
      pending = pending.filter(value => value.id !== identity);
      if (answer === "approve") connections.push({ ...applicant, grant_id: `g-${identity}`, connected_at: new Date().toISOString() });
      return { state: answer === "approve" ? "approved" : "rejected" };
    }
    if (String(path).endsWith("/agent-links")) {
      if (failInventory) throw new Error("network unavailable");
      return { connections, pending: String(path).includes("/p2/") ? [] : pending, links: [] };
    }
    return [];
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("An Agent asking to join below the Header", () => {
  it("appears without a hover or click, on the Agent's own name card, without taking the editor's focus", async () => {
    const editor = document.createElement("input"); document.body.append(editor); editor.focus();
    await render();
    expect(card()?.dataset.cloudAgentRequestCard).toBe("r1");
    expect(card()?.classList.contains("desktop-cloud-agent-card")).toBe(true);
    expect(card()?.getAttribute("role")).toBe("region");
    expect(card()?.getAttribute("aria-label")).toBe("My helper · Wants to join");
    expect(card()?.querySelector(".desktop-cloud-agent-card-name")?.textContent).toBe("My helper");
    expect(card()?.querySelector(".desktop-project-reach-mark")?.getAttribute("data-reach-brand")).toBe("codex");
    expect(card()?.textContent).toContain("My project");
    expect(card()?.textContent).toContain("Can read and edit this project’s files and run commands.");
    expect(card()?.querySelectorAll("button")).toHaveLength(2);
    expect(document.activeElement).toBe(editor);
    expect(writes()).toHaveLength(0);
  });
  it("has no close action, and survives outside clicks, Escape, pointer leave, blur and another render", async () => {
    await render();
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      card()!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(1000);
    });
    await render();
    expect(card()?.dataset.cloudAgentRequestCard).toBe("r1");
    expect(card()?.querySelector('[aria-label="Close"]')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>("[data-cloud-workspace-agent=r1]")!.click());
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(decision("reject"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("keeps both choices disabled while the answer is in flight, then advances to the next request", async () => {
    pending.push(request("r2", "Second helper"));
    let finish!: () => void;
    delayDecision = () => new Promise(resolve => { finish = resolve; });
    await render();
    expect(card()?.textContent).toContain("2 waiting");
    await act(async () => { decision("approve").click(); decision("reject").click(); });
    expect(card()?.dataset.cloudAgentRequestCard).toBe("r1");
    expect(decision("approve").disabled).toBe(true);
    expect(decision("reject").disabled).toBe(true);
    expect(writes()).toHaveLength(1);
    await act(async () => finish());
    expect(card()?.dataset.cloudAgentRequestCard).toBe("r2");
    expect(decision("approve").disabled).toBe(false);
    expect(card()?.textContent).not.toContain("2 waiting");
    delayDecision = undefined;
    await act(async () => decision("reject").click());
    expect(card()).toBeNull();
    expect(writes().map(call => JSON.parse(String(call[3]?.body)).decision)).toEqual(["approve", "reject"]);
    expect(writes().map(call => call[0])).toEqual(["/agent-links/connections/r1/decision", "/agent-links/connections/r2/decision"]);
  });
  it("leaves a failed answer visible and retryable instead of dismissing or admitting the Agent", async () => {
    failDecision = true;
    await render();
    await act(async () => decision("approve").click());
    expect(card()?.querySelector("[role=alert]")?.textContent).toBe("That didn’t work. Try again.");
    expect(decision("approve").disabled).toBe(false);
    expect(connections).toHaveLength(0);
    failDecision = false;
    await act(async () => decision("reject").click());
    expect(card()).toBeNull();
    expect(connections).toHaveLength(0);
  });
  it("ends the wait when the server removes an expired request or one decided elsewhere", async () => {
    await render();
    pending = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(card()).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("does not lose an unanswered request when refreshing the inventory fails", async () => {
    await render();
    failInventory = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(card()?.dataset.cloudAgentRequestCard).toBe("r1");
    expect(decision("reject").disabled).toBe(false);
  });
  it("does not carry a request or a late decision's refresh into another project", async () => {
    let finish!: () => void;
    delayDecision = () => new Promise(resolve => { finish = resolve; });
    await render();
    await act(async () => decision("reject").click());
    await render("p2");
    expect(card()).toBeNull();
    const callsBefore = vi.mocked(cloudApiRequest).mock.calls.length;
    await act(async () => finish());
    expect(vi.mocked(cloudApiRequest).mock.calls).toHaveLength(callsBefore);
    expect(card()).toBeNull();
  });
  it("clears a previous identity's request when the account is no longer signed in", async () => {
    await render();
    await act(async () => root.render(withTestLocalization(<CloudWorkspaceHeaderTools context={context()} session={null}
      apiBaseUrl={API} onSessionChange={vi.fn()} />)));
    expect(card()).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
