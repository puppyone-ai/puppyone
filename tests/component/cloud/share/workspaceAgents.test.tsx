/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceAgents, useWorkspaceAgents, workspaceAgentStatus,
  type WorkspaceAgent } from "../../../../src/features/cloud/share/useWorkspaceAgents";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { AgentSession, ConnectedAgent } from "../../../../src/features/cloud/share/agentLinks";
import { useLocalization } from "@puppyone/localization/react";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { user_id: "alice" } as DesktopCloudSession;
const now = Date.parse("2026-10-30T12:00:00Z");
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
const agent: ConnectedAgent = { id: "c1", name: "秘书小陈", admission: "sign_in", grant_id: "g1",
  connected_at: at(9000), expires_at: "2026-11-29T00:00:00Z" };
const closed = (grant: string, secondsAgo: number, length = 1): AgentSession => ({ grant_id: grant, state: "closed",
  created_at: at(secondsAgo + length), closed_at: at(secondsAgo), lease_until: at(secondsAgo - 30) });
const one = (sessions: readonly AgentSession[] | null) => resolveWorkspaceAgents([agent], sessions, now)[0];

describe("What the Header says about an Agent", () => {
  it("is active while a session is open", () => {
    const open: AgentSession = { grant_id: "g1", state: "active", created_at: at(900), closed_at: null, lease_until: at(-30) };
    expect(one([open])).toMatchObject({ active: true, activityKnown: true });
  });
  it("stays active between the one-second connections of a running task", () => {
    expect(one([closed("g1", 60)]).active).toBe(true);
  });
  it("goes quiet once the Agent has really stopped, and remembers when", () => {
    const quiet = one([closed("g1", 600), closed("g1", 3000)]);
    expect(quiet).toMatchObject({ active: false, lastActiveAt: at(600) });
  });
  it("does not count a session nobody closed whose lease ran out", () => {
    const abandoned: AgentSession = { grant_id: "g1", state: "active", created_at: at(4000), closed_at: null, lease_until: at(3900) };
    expect(one([abandoned]).active).toBe(false);
  });
  it("never credits one Agent with another's session", () => {
    expect(one([closed("g2", 5)])).toMatchObject({ active: false, lastActiveAt: null });
  });
  it("separates sessions it could not read from there being none", () => {
    expect(one(null)).toMatchObject({ activityKnown: false, active: false });
    expect(one([])).toMatchObject({ activityKnown: true, active: false });
  });
});

function Status({ value }: { value: WorkspaceAgent }) {
  return <output>{workspaceAgentStatus(value, useLocalization()) ?? "unknown"}</output>;
}

describe("How the status reads", () => {
  let root: Root;
  const read = async (value: WorkspaceAgent) => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(withTestLocalization(<Status value={value} />)));
    return host.textContent;
  };
  afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });
  it("says active, when it was last active, or nothing recent, and stays silent when unknown", async () => {
    expect(await read({ ...agent, active: true, lastActiveAt: null, activityKnown: true })).toBe("Active now");
    expect(await read({ ...agent, active: false, lastActiveAt: new Date(Date.now() - 300_000).toISOString(), activityKnown: true })).toContain("Last active 5 minutes ago");
    expect(await read({ ...agent, active: false, lastActiveAt: null, activityKnown: true })).toBe("No recent activity");
    expect(await read({ ...agent, active: false, lastActiveAt: null, activityKnown: false })).toBe("unknown");
  });
});

describe("Keeping the Header current", () => {
  let root: Root; let seen: readonly WorkspaceAgent[]; let refresh: () => Promise<void>;
  let connections: ConnectedAgent[]; let listError: Error | null; let sessionsError: Error | null; let visibility: DocumentVisibilityState;
  const listCalls = () => vi.mocked(cloudApiRequest).mock.calls.filter(([path]) => String(path).endsWith("/agent-links")).length;
  function Probe({ target }: { target: Parameters<typeof useWorkspaceAgents>[0] }) {
    const value = useWorkspaceAgents(target); seen = value.agents; refresh = value.refresh; return null;
  }
  const mount = async (target: Parameters<typeof useWorkspaceAgents>[0] = { session, projectId: "p", apiBaseUrl: API }) => {
    await act(async () => root.render(<Probe target={target} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  };
  const tick = async (ms = 10_000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    connections = [agent]; listError = null; sessionsError = null; visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.mocked(cloudApiRequest).mockImplementation(async path => {
      if (String(path).endsWith("/agent-links")) { if (listError) throw listError; return { links: [], connections }; }
      if (sessionsError) throw sessionsError;
      return [];
    });
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(cloudApiRequest).mockReset(); document.body.replaceChildren(); });

  it("shows an Agent as soon as it is allowed and drops it when it is removed", async () => {
    connections = []; await mount(); expect(seen).toEqual([]);
    connections = [agent]; await tick(); expect(seen.map(item => item.name)).toEqual(["秘书小陈"]);
    connections = []; await tick(); expect(seen).toEqual([]);
  });
  it("updates at once when asked, without waiting for the next poll", async () => {
    await mount(); connections = [];
    await act(async () => refresh());
    expect(seen).toEqual([]);
  });
  it("keeps the marks through a bad network instead of emptying the Header", async () => {
    await mount(); listError = new Error("offline"); await tick();
    expect(seen).toHaveLength(1);
  });
  it("stops asking once the server says this person is not the owner", async () => {
    listError = Object.assign(new Error("denied"), { status: 403 }); await mount();
    const calls = listCalls(); await tick(); await tick();
    expect(seen).toEqual([]); expect(listCalls()).toBe(calls);
  });
  it("still lists the Agent when only its activity could not be read", async () => {
    sessionsError = new Error("offline"); await mount();
    expect(seen[0]).toMatchObject({ name: "秘书小陈", activityKnown: false });
  });
  it("does not poll a hidden window, and catches up when it returns", async () => {
    await mount(); visibility = "hidden";
    const calls = listCalls(); await tick(30_000); expect(listCalls()).toBe(calls);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(listCalls()).toBe(calls + 1);
  });
  it("asks for nothing without a target, and forgets the Agents when the target goes away", async () => {
    await mount(null); expect(cloudApiRequest).not.toHaveBeenCalled();
    await mount(); expect(seen).toHaveLength(1);
    await mount(null); expect(seen).toEqual([]);
  });
  it("ignores an answer that arrives after a newer one", async () => {
    await mount();
    let release = (_: unknown) => {}; const slow = new Promise(resolve => { release = resolve; });
    vi.mocked(cloudApiRequest).mockImplementationOnce(async () => { await slow; return { links: [], connections: [agent] }; });
    const stale = refresh(); connections = [];
    await act(async () => refresh());
    await act(async () => { release(null); await stale; });
    expect(seen).toEqual([]);
  });
});
