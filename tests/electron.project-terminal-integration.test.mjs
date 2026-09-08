import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTerminalService } from "../electron/main/terminal-service.mjs";
import { createProjectSessionService } from "../electron/main/workspace/project-sessions/project-session-service.mjs";
import { registerTerminalIpcHandlers } from "../electron/main/ipc/terminal-ipc.mjs";

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function terminal() {
  let exit, data;
  return { pid: 123, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: (fn) => { data = fn; }, onExit: (fn) => { exit = fn; },
    emitExit: () => exit?.({ exitCode: 0, signal: 15 }), emitData: (value) => data?.(value) };
}
async function harness({ initializeWorkspaceEditReview = async () => {} } = {}) {
  const roots = await Promise.all(["a", "b"].map(async (id) => { const root = await mkdtemp(path.join(os.tmpdir(), `project-terminal-${id}-`)); temporary.push(root); return root; }));
  const owner = { id: 601, isDestroyed: () => false, send: vi.fn() };
  const terminals = [];
  const service = createTerminalService({ appVersion: "test", initializeWorkspaceEditReview, closeTimeoutMs: 10,
    ptyService: { spawn: () => { const value = terminal(); terminals.push(value); return value; } } });
  const projects = createProjectSessionService({ participants: [{ name: "terminal", closeProject: service.closeSessionsForWorkspaceRoot }] });
  const contexts = roots.map((root, index) => projects.open(owner.id, { path: root, workspace: { id: String(index) } }));
  const handlers = new Map();
  registerTerminalIpcHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) }, terminalService: service, projectSessions: projects });
  const call = (name, index, request) => handlers.get(name)({ sender: owner }, { rootPath: roots[index], projectContext: contexts[index], ...request });
  return { contexts, call, owner, projects, service, terminals };
}

describe("project-owned Terminal IPC and native shutdown", () => {
  it("cancels preflight creation and reserves the ID before asynchronous preparation", async () => {
    let proceed;
    const preflight = new Promise((resolve) => { proceed = resolve; });
    const initializeWorkspaceEditReview = vi.fn(() => preflight);
    const h = await harness({ initializeWorkspaceEditReview });
    const first = h.call("terminal:create", 0, { id: "terminal-pending" });
    await vi.waitFor(() => expect(initializeWorkspaceEditReview).toHaveBeenCalledOnce());
    await expect(h.call("terminal:create", 0, { id: "terminal-pending" })).resolves.toHaveProperty("projectFailure.code", "SESSION_EXISTS");
    const closing = h.projects.close(h.owner.id, h.contexts[0]);
    proceed();
    await expect(first).resolves.toHaveProperty("projectFailure.code", "PROJECT_STALE");
    await expect(closing).resolves.toEqual({ closed: true });
    expect(h.terminals).toHaveLength(0);
  });
  it("keeps A output while B opens and rejects commands with B's context for A's terminal", async () => {
    const h = await harness();
    const a = await h.call("terminal:create", 0, { id: "terminal-a" });
    const b = await h.call("terminal:create", 1, { id: "terminal-b" });
    h.call("terminal:input", 1, { id: a.id, instanceId: a.instanceId, data: "wrong project" });
    expect(h.terminals[0].write).not.toHaveBeenCalled();
    h.call("terminal:input", 0, { id: a.id, instanceId: a.instanceId, data: "A command" });
    expect(h.terminals[0].write).toHaveBeenCalledWith("A command");
    h.terminals[0].emitData("A output while B is shown");
    expect(h.owner.send).toHaveBeenCalledWith("terminal:data", expect.objectContaining({ id: a.id, data: "A output while B is shown" }));
    h.terminals[0].kill.mockImplementation(h.terminals[0].emitExit);
    expect(await h.projects.close(h.owner.id, h.contexts[0])).toEqual({ closed: true });
    expect(h.terminals[1].kill).not.toHaveBeenCalled();
    h.terminals[1].kill.mockImplementation(h.terminals[1].emitExit);
    await h.call("terminal:close", 1, b);
  });

  it("waits for actual exit, shares close, and accepts only confirmed repeated closure", async () => {
    const h = await harness(); const session = await h.call("terminal:create", 0, { id: "terminal-a" });
    const first = h.call("terminal:close", 0, session);
    const second = h.call("terminal:close", 0, session);
    await Promise.resolve();
    expect(h.service.getSessionCount()).toBe(1);
    expect(h.terminals[0].kill).toHaveBeenCalledOnce();
    h.terminals[0].emitExit();
    await Promise.all([first, second]);
    expect(h.service.getSessionCount()).toBe(0);
    await expect(h.call("terminal:close", 0, session)).resolves.toBe(true);
    await expect(h.call("terminal:close", 0, { ...session, instanceId: "unknown" })).resolves.toMatchObject({ projectFailure: { code: "SESSION_NOT_FOUND" } });
  });

  it("retains a timed-out close and retries without losing the native handle", async () => {
    const h = await harness(); await h.call("terminal:create", 0, { id: "terminal-a" });
    expect(await h.projects.close(h.owner.id, h.contexts[0])).toMatchObject({ closed: false });
    expect(h.service.getSessionCount()).toBe(1);
    expect(h.projects.snapshot(h.owner.id).projects[0].state).toBe("closing");
    h.terminals[0].kill.mockImplementation(h.terminals[0].emitExit);
    expect(await h.projects.close(h.owner.id, h.contexts[0])).toEqual({ closed: true });
    expect(h.service.getSessionCount()).toBe(0);
  });
});
