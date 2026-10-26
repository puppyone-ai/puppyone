import { describe, expect, it, vi } from "vitest";
import { ProjectNavigation, type ProjectNavigationTarget } from "../../../../src/features/app-shell/projectNavigation";

const local = (path: string): ProjectNavigationTarget => ({ kind: "local", path });
const cloud = (projectId: string): ProjectNavigationTarget => ({ kind: "cloud", projectId });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("window project navigation", () => {
  it("serializes Local and Cloud selections and commits only the latest intent", async () => {
    const wait = deferred();
    const committed: ProjectNavigationTarget[] = [];
    const open = vi.fn(async (target, isCurrent) => {
      if (target.path === "B") await wait.promise;
      if (isCurrent()) committed.push(target);
    });
    const navigation = new ProjectNavigation(open, vi.fn());
    const idle = navigation.select(local("B"));
    await Promise.resolve();
    navigation.select(cloud("C"));
    navigation.select(local("D"));
    expect(navigation.getSnapshot()).toEqual(local("D"));
    expect(open).toHaveBeenCalledTimes(1);
    wait.resolve(); await idle;
    expect(open.mock.calls.map(([target]) => target)).toEqual([local("B"), local("D")]);
    expect(committed).toEqual([local("D")]);
    expect(navigation.getSnapshot()).toBeNull();
  });

  it("honors A -> B -> A even while A is still displayed", async () => {
    const wait = deferred();
    let displayed = "A";
    const navigation = new ProjectNavigation(async (target, isCurrent) => {
      if (target.kind !== "local") return;
      if (target.path === "B") await wait.promise;
      if (isCurrent()) displayed = target.path;
    }, vi.fn());
    const idle = navigation.select(local("B")); await Promise.resolve();
    navigation.select(local("A"));
    wait.resolve(); await idle;
    expect(displayed).toBe("A");
  });

  it("keeps the displayed project on failure and allows retry", async () => {
    let displayed = "A";
    const failure = new Error("offline");
    const open = vi.fn().mockRejectedValueOnce(failure).mockImplementation(async target => { displayed = target.path; });
    const onError = vi.fn();
    const navigation = new ProjectNavigation(open, onError);
    await navigation.select(local("B"));
    expect(displayed).toBe("A");
    expect(onError).toHaveBeenCalledWith(failure, local("B"));
    await navigation.select(local("B"));
    expect(displayed).toBe("B");
  });

  it("suppresses obsolete errors and still opens the queued target", async () => {
    const wait = deferred();
    const onError = vi.fn();
    const open = vi.fn(async target => {
      if (target.kind === "cloud") { await wait.promise; throw new Error("old request"); }
    });
    const navigation = new ProjectNavigation(open, onError);
    const idle = navigation.select(cloud("B")); await Promise.resolve();
    navigation.select(local("C")); wait.resolve(); await idle;
    expect(onError).not.toHaveBeenCalled();
    expect(open.mock.calls.map(([target]) => target)).toEqual([cloud("B"), local("C")]);
  });

  it("deduplicates pending targets and fences cancelled requests", async () => {
    const wait = deferred();
    const commit = vi.fn();
    const open = vi.fn(async (_target, isCurrent) => { await wait.promise; if (isCurrent()) commit(); });
    const navigation = new ProjectNavigation(open, vi.fn());
    const idle = navigation.select(cloud("B")); await Promise.resolve();
    expect(navigation.select(cloud("B"))).toBe(idle);
    navigation.select(local("C")); navigation.cancel();
    wait.resolve(); await idle;
    expect(open).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    expect(navigation.getSnapshot()).toBeNull();
  });
});
