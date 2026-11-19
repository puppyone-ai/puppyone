import { liveWorkbench } from "../../../fixtures/cloud/repositories/liveWorkspace";
/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAgentClient, type CloudAgentRun } from "../../../../src/features/cloud/agent/cloudAgentClient";
import { CloudAgentController } from "../../../../src/features/cloud/agent/CloudAgentController";
import { projectCloudAgentRuns } from "../../../../src/features/cloud/agent/cloudAgentProjection";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "actor", user_email: "fixture@example.com",
  session_generation: "generation", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const originalBridge = window.puppyoneDesktop;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
const calls: Request[] = [];
let handle: (request: Request) => Promise<unknown>;
let cleanup: (() => void) | undefined;
function run(values: Partial<CloudAgentRun> = {}): CloudAgentRun {
  return { id: "11111111-1111-4111-8111-111111111111", project_id: "project", workbench_id: "workbench-project", agent_id: "configured-agent",
    session_id: "22222222-2222-4222-8222-222222222222", request_id: "request", prompt: "Edit notes",
    state: "running", sequence: 1, stop_requested: false, snapshot: {}, publication: null, tools: [],
    created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", ...values };
}
const controller = (key = "fixture", scope = false) => new CloudAgentController(new CloudAgentClient(scope
  ? { kind: "scope", project_id: "project", scope_id: "restricted-scope" }
  : { kind: "project_root", project_id: "project" }, session, API), key);
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
beforeEach(() => {
  localStorage.clear(); calls.length = 0;
  handle = async () => { throw new Error("Unexpected request"); };
  window.puppyoneDesktop = { ...originalBridge, requestCloudSessionApi: async (request: Request) => {
    if (request.path.endsWith("/workbench")) return request.method === "POST" ? liveWorkbench() : { workspace: liveWorkbench() };
    calls.push(request);
    return { transport: "puppyone-cloud-ipc-v1", ok: true, data: await handle(request) };
  } } as NonNullable<typeof window.puppyoneDesktop>;
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); window.puppyoneDesktop = originalBridge; });

describe("Cloud Agent durable client", () => {
  it("opens immediately without creating an Agent, session or run", async () => {
    localStorage.setItem("fixture", "null");
    const chat = controller(); chat.toggle();
    expect(chat.getSnapshot()).toMatchObject({ open: true, loading: true });
    await chat.load();
    expect(chat.getSnapshot().loading).toBe(false);
    expect(calls).toEqual([]);
  });

  it("binds a submission to the current workspace without exposing credentials", async () => {
    handle = async request => run({ request_id: JSON.parse(request.body!).request_id });
    const chat = controller(); await chat.load();
    expect(await chat.submit("Edit notes")).toBe(true);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ workbench_id: "workbench-project", project_id: "project", prompt: "Edit notes" });
    expect(calls[0]).toMatchObject({ expectedSession: { userId: "actor", generation: "generation" } });
    expect(JSON.stringify(calls)).not.toMatch(/Bearer|access_token|refresh_token/);
  });
  it("rejects a restricted Scope before requesting a whole workspace", async () => {
    const chat = controller("scope", true); await chat.load();
    expect(await chat.submit("Edit notes")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("recovers a lost accepted receipt with the same UUID and no second admission", async () => {
    let accepted: CloudAgentRun;
    handle = async request => {
      if (request.method === "POST") {
        accepted = run({ request_id: JSON.parse(request.body!).request_id });
        throw new Error("Connection lost after admission");
      }
      return accepted!;
    };
    const chat = controller(); await chat.load(); chat.setDraft("Edit notes");
    expect(await chat.submit("Edit notes")).toBe(false);
    const uuid = chat.getSnapshot().pending!.request_id;
    expect(await chat.submit("Edit notes")).toBe(true);
    expect(calls.filter(request => request.method === "POST")).toHaveLength(1);
    expect(calls[1]!.path).toContain(uuid);
    expect(chat.getSnapshot().runs).toHaveLength(1);
    expect(chat.getSnapshot().sessions[0]?.agent_id).toBe("configured-agent");
  });

  it("keeps a draft after rejection and never clears later edits on a delayed receipt", async () => {
    handle = async () => { throw httpError(403); };
    const chat = controller(); await chat.load(); chat.setDraft("Edit notes");
    await chat.submit("Edit notes");
    expect(chat.getSnapshot()).toMatchObject({ draft: "Edit notes", pending: null });
    let finish: (value: CloudAgentRun) => void = () => {};
    let awaitingReceipt = false;
    handle = () => new Promise(resolve => { finish = resolve; awaitingReceipt = true; });
    const sending = chat.submit("Edit notes");
    chat.setDraft("Next instruction");
    await vi.waitFor(() => expect(awaitingReceipt).toBe(true));
    finish(run({ request_id: chat.getSnapshot().pending!.request_id })); await sending;
    expect(chat.getSnapshot().draft).toBe("Next instruction");
  });

  it("restores a persisted accepted run without submitting it again", async () => {
    const accepted = run({ state: "succeeded", sequence: 8, snapshot: { text: "Saved answer" } });
    localStorage.setItem("fixture", JSON.stringify({ sessionId: accepted.session_id, agentId: accepted.agent_id, pending: null }));
    handle = async request => request.path.startsWith("/chat/") ? [{ id: accepted.session_id, agent_id: accepted.agent_id, mode: "cloud_pi", title: "Notes" }]
      : request.path.includes("/sessions/") ? [accepted] : accepted;
    const chat = controller(); await chat.load();
    expect(chat.getSnapshot().runs[0]?.snapshot.text).toBe("Saved answer");
    expect(calls.every(request => request.method !== "POST")).toBe(true);
  });

  it("keeps a 500 submission unresolved across reopen and retries its receipt before admission", async () => {
    let available = false;
    handle = async request => {
      if (!available) throw httpError(500);
      if (request.path.includes("/requests/")) throw httpError(404);
      return run({ request_id: JSON.parse(request.body!).request_id, state: "succeeded", snapshot: { text: "Connected" } });
    };
    const chat = controller(); await chat.load(); chat.setDraft("Connection test");
    expect(await chat.submit("Connection test")).toBe(false);
    const requestId = chat.getSnapshot().pending!.request_id;
    expect(chat.getSnapshot().error).toMatchObject({ status: 500 });
    chat.setOpen(false); chat.setOpen(true); await chat.load();
    expect(chat.getSnapshot()).toMatchObject({ draft: "Connection test", pending: { request_id: requestId }, runs: [] });
    expect(calls.filter(request => request.method === "POST")).toHaveLength(1);
    available = true;
    expect(await chat.submit("Connection test")).toBe(true);
    expect(calls.at(-2)?.path).toContain(`/requests/project/${requestId}`);
    expect(JSON.parse(calls.at(-1)!.body!).request_id).toBe(requestId);
    expect(chat.getSnapshot()).toMatchObject({ draft: "", pending: null, error: null });
  });

  it("reuses an approval decision ID after transport loss and stops only on an explicit command", async () => {
    const waiting = run({ state: "waiting_approval", tools: [{ call_id: "tool", name: "write", input: { path: "notes.md" }, state: "waiting" }] });
    handle = async request => run({ ...waiting, request_id: JSON.parse(request.body!).request_id });
    const chat = controller(); await chat.load(); await chat.submit("Edit notes");
    let attempt = 0;
    let stopRequested = false;
    handle = async request => {
      if (request.path.includes("/approvals/")) {
        if (++attempt === 1) throw new Error("Approval receipt lost");
        return waiting;
      }
      if (request.path.endsWith("/stop")) stopRequested = true;
      return { ...waiting, stop_requested: stopRequested };
    };
    await chat.approve("tool", true); await chat.approve("tool", true);
    const decisions = calls.filter(request => request.path.includes("/approvals/")).map(request => JSON.parse(request.body!));
    expect(decisions).toHaveLength(2); expect(decisions[0]).toEqual(decisions[1]);
    chat.setOpen(false);
    expect(calls.some(request => request.path.endsWith("/stop"))).toBe(false);
    await chat.stop(); expect(chat.getSnapshot().runs[0]?.stop_requested).toBe(true);
    expect(calls.filter(request => request.path.endsWith("/stop"))).toHaveLength(1);
  });

  it("uses authoritative reset snapshots, ignores older facts, and refreshes once after publication", async () => {
    vi.useFakeTimers();
    const chat = controller(); await chat.load();
    handle = async request => run({ request_id: JSON.parse(request.body!).request_id, sequence: 4, snapshot: { text: "Old fragment" } });
    await chat.submit("Edit notes");
    let accepted = run({ state: "running", sequence: 3, snapshot: { text: "Stale" } });
    handle = async request => {
      if (request.path.includes("/sessions/")) return [accepted];
      if (request.path.startsWith("/chat/")) return [];
      if (request.path.includes("/events")) {
        accepted = run({ state: "succeeded", sequence: 9, snapshot: { text: "Replaced answer" }, publication: { status: "committed" } });
        return [{ id: 9, event: "reset", data: accepted }];
      }
      return accepted;
    };
    const published = vi.fn(); cleanup = chat.observe(published);
    await vi.advanceTimersByTimeAsync(10);
    expect(chat.getSnapshot().runs[0]?.snapshot.text).toBe("Replaced answer");
    expect(published).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); expect(published).toHaveBeenCalledTimes(1);
  });

  it("does not treat EOF as completion or unknown/conflict outcomes as success", async () => {
    vi.useFakeTimers(); const chat = controller(); await chat.load();
    handle = async request => run({ request_id: JSON.parse(request.body!).request_id });
    await chat.submit("Edit notes");
    handle = async request => request.path.includes("/sessions/") ? [run()] : request.path.startsWith("/chat/") || request.path.includes("/events") ? [] : run();
    cleanup = chat.observe(vi.fn()); await vi.advanceTimersByTimeAsync(300);
    expect(chat.getSnapshot().runs[0]?.state).toBe("running");
    for (const state of ["outcome_unknown", "conflict"] as const) {
      expect(projectCloudAgentRuns([run({ state, snapshot: { text: "Unconfirmed result" } })]).terminalState).toBeNull();
    }
    chat.newChat(); expect(chat.getSnapshot().sessionId).not.toBeNull();
  });
});
