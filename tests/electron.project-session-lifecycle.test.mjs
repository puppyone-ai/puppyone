import { describe, expect, it, vi } from "vitest";
import { createProjectSessionService } from "../electron/main/workspace/project-sessions/project-session-service.mjs";

const folder = (id) => ({ path: `/projects/${id}`, workspace: { id, path: `/projects/${id}` } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

describe("project lifetime independent of presentation", () => {
  it("retains both projects, scopes shutdown, and never authorizes a recent-only root", async () => {
    const closeProject = vi.fn();
    const host = createProjectSessionService({ participants: [{ name: "test", closeProject }] });
    const a = host.open(1, folder("a"));
    host.open(1, folder("b"));
    expect(host.open(1, folder("a"))).toBe(a);
    expect(closeProject).not.toHaveBeenCalled();
    expect(host.roots(1)).toEqual(["/projects/a", "/projects/b"]);
    expect(() => host.require(1, { ...a, rootPath: "/recent/c" })).toThrow();
    await host.close(1, a);
    expect(host.roots(1)).toEqual(["/projects/b"]);
    expect(closeProject.mock.calls.every(([owner, root]) => owner === 1 && root === "/projects/a")).toBe(true);
  });

  it("registers pending admission before async work and waits for late rollback", async () => {
    const wait = deferred();
    const released = deferred();
    const host = createProjectSessionService();
    const a = host.open(1, folder("a"));
    const create = host.run(1, a, async (operation) => {
      await wait.promise;
      try { operation.assertCurrent(); } finally { released.resolve(); }
    });
    const rejected = expect(create).rejects.toMatchObject({ code: "PROJECT_STALE" });
    await Promise.resolve();
    let closed = false;
    const closing = host.close(1, a).then(() => { closed = true; });
    expect(() => host.run(1, a, () => {})).toThrow();
    await Promise.resolve();
    expect(closed).toBe(false);
    wait.resolve();
    await Promise.all([closing, rejected, released.promise]);
    expect(host.snapshot(1).projects).toHaveLength(0);
  });

  it("shares concurrent close and protects a reopened project from old callbacks", async () => {
    const wait = deferred();
    const host = createProjectSessionService({ participants: [{ name: "test", closeProject: () => wait.promise }] });
    const a = host.open(1, folder("a"));
    const first = host.close(1, a);
    expect(host.close(1, a)).toBe(first);
    expect(() => host.open(1, folder("a"))).toThrow();
    wait.resolve();
    await first;
    const reopened = host.open(1, folder("a"));
    expect(reopened.generation).not.toBe(a.generation);
    await expect(host.close(1, a)).resolves.toEqual({ closed: true });
    expect(host.require(1, reopened)).toBe(reopened);
    expect(() => host.run(1, a, () => {})).toThrow();
  });

  it("retains a failed close for retry and refuses cross-window access", async () => {
    const closeProject = vi.fn().mockRejectedValue(new Error("native failure"));
    const sender = { send: vi.fn(), isDestroyed: () => false };
    const host = createProjectSessionService({ getSender: () => sender, participants: [{ name: "terminal", closeProject }] });
    const a = host.open(1, folder("a"));
    expect(() => host.require(2, a)).toThrow();
    expect(() => host.open(2, folder("a"))).toThrow();
    await expect(host.close(1, a)).resolves.toEqual({ closed: false, failures: ["terminal"] });
    expect(host.snapshot(1).projects[0].state).toBe("closing");
    closeProject.mockResolvedValue(undefined);
    await expect(host.close(1, a)).resolves.toEqual({ closed: true });
    expect(sender.send.mock.calls.at(-1)[1].projects).toEqual([]);
    expect(host.snapshot(1).revision).toBeGreaterThan(1);
  });

  it("window close fences all future admission, including projects without allocated sessions", async () => {
    const host = createProjectSessionService();
    host.open(1, folder("a"));
    host.open(1, folder("b"));
    await host.closeWindow(1);
    expect(() => host.open(1, folder("c"))).toThrow();
    expect(host.snapshot(1).projects).toEqual([]);
  });
});
