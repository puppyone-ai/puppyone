// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitEditorLayout, getEditorLayoutSnapshot, registerEditorLayoutParticipant,
  type EditorLayoutParticipant, type EditorLayoutRegistration } from "../../../../packages/shared-ui/src/editor/runtime/editorLayout";

const registrations: EditorLayoutRegistration[] = [];
const roots: HTMLElement[] = [];
function root() { const element = document.body.appendChild(document.createElement("div")); roots.push(element); return element; }
function register(element: HTMLElement, overrides: Partial<EditorLayoutParticipant> = {}) {
  const value = registerEditorLayoutParticipant(element, { prepare() {}, read: () => true, write() {}, commit() {}, ...overrides });
  registrations.push(value);
  return value;
}
afterEach(() => { registrations.splice(0).forEach(value => value.dispose()); roots.splice(0).forEach(value => value.remove()); vi.restoreAllMocks(); });

describe("document layout ownership", () => {
  it("keeps each window's queue and participants independent", async () => {
    const first = root();
    const otherDocument = document.implementation.createHTMLDocument();
    const second = otherDocument.body.appendChild(otherDocument.createElement("div"));
    const firstCommit = vi.fn(), secondCommit = vi.fn();
    register(first, { commit: firstCommit });
    register(second, { commit: secondCommit }).invalidate("geometry");
    commitEditorLayout(first, () => {});
    expect(firstCommit).toHaveBeenCalledTimes(1); expect(secondCommit).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(secondCommit).toHaveBeenCalledTimes(1);
    expect(getEditorLayoutSnapshot(otherDocument).participants).toBe(1);
  });
  it("reads all surviving affected panes before any writes or engine commits", () => {
    const host = root(), unrelated = root();
    const panes = [0, 1, 2].map(() => host.appendChild(document.createElement("div")));
    const calls: string[] = [];
    [...panes, unrelated].forEach((element, index) => register(element, {
      prepare: () => { calls.push(`prepare:${index}`); },
      read: () => { calls.push(`read:${index}`); return true; },
      write: () => { calls.push(`write:${index}`); },
      commit: () => { calls.push(`commit:${index}`); },
    }));
    commitEditorLayout(host, () => { calls.push("mutation"); panes[1].remove(); });
    expect(calls).toEqual(["prepare:0", "prepare:1", "prepare:2", "mutation", "read:0", "read:2", "write:0", "write:2", "commit:0", "commit:2"]);
  });

  it("coalesces nested host mutations into one outer commit", () => {
    const host = root(), read = vi.fn(() => true), commit = vi.fn(), prepare = vi.fn();
    register(host, { prepare, read, commit });
    commitEditorLayout(host, () => commitEditorLayout(host, () => {}));
    expect(prepare).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1);
  });

  it("settles partial mutations while preserving the host exception", () => {
    const host = root(); let width = "";
    register(host, { commit() { width = host.style.width; } });
    expect(() => commitEditorLayout(host, () => { host.style.width = "250px"; throw new Error("cancel"); })).toThrow("cancel");
    expect(width).toBe("250px");
  });

  it("never calls a disposed or replaced participant, including queued invalidations", async () => {
    const host = root(), oldCommit = vi.fn(), newCommit = vi.fn();
    const old = register(host, { commit: oldCommit });
    old.invalidate("content");
    const replacement = register(host, { commit: newCommit });
    old.dispose(); old.dispose(); old.invalidate("geometry");
    await Promise.resolve();
    expect(oldCommit).not.toHaveBeenCalled(); expect(newCommit).not.toHaveBeenCalled();
    replacement.invalidate("geometry"); await Promise.resolve();
    expect(newCommit).toHaveBeenCalledTimes(1);
  });

  it("merges invalidation reasons and lets unchanged participants skip measurement", async () => {
    const host = root(), read = vi.fn(() => false), write = vi.fn(), commit = vi.fn();
    const value = register(host, { read, write, commit });
    value.invalidate("appearance"); value.invalidate("geometry"); value.invalidate("appearance");
    await Promise.resolve();
    expect(read).toHaveBeenCalledExactlyOnceWith(new Set(["appearance", "geometry"]));
    expect(write).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it.each(["prepare", "read", "write", "commit"] as const)("quarantines a throwing %s without blocking host or siblings", phase => {
    const host = root(), sibling = host.appendChild(document.createElement("div"));
    const onError = vi.fn(), good = vi.fn(), mutate = vi.fn();
    register(host, { [phase]: () => { throw new Error("broken pane"); }, onError });
    register(sibling, { commit: good });
    commitEditorLayout(host, mutate); commitEditorLayout(host, mutate);
    expect(mutate).toHaveBeenCalledTimes(2); expect(good).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), phase);
  });

  it("isolates an error reporter and bounds feedback without starving siblings", async () => {
    const host = root(), sibling = host.appendChild(document.createElement("div"));
    const good = vi.fn(), report = vi.fn(() => { throw new Error("reporter failed"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let loop: EditorLayoutRegistration;
    const commit = vi.fn(() => loop.invalidate("geometry"));
    loop = register(host, { commit, onError: report });
    register(sibling, { commit: good });
    commitEditorLayout(host, () => {}); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(3); expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), "convergence");
    expect(getEditorLayoutSnapshot(document).pending).toBe(0);
    commitEditorLayout(host, () => {}); expect(good).toHaveBeenCalledTimes(2); expect(commit).toHaveBeenCalledTimes(3);
  });

  it("shares observation and makes old unsubscribe/late delivery harmless", () => {
    let deliver: ResizeObserverCallback = () => {};
    const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
    vi.spyOn(window, "ResizeObserver").mockImplementation(function(callback: ResizeObserverCallback) {
      deliver = callback;
      return { observe, unobserve, disconnect };
    });
    const host = root(), target = host.appendChild(document.createElement("div"));
    const first = register(host), second = register(target);
    const oldCallback = vi.fn(), currentCallback = vi.fn(), commit = vi.fn();
    const stop = first.observe(target, oldCallback);
    stop();
    second.observe(target, currentCallback);
    stop(); // Must not unobserve the replacement's subscription.
    const sibling = host.appendChild(document.createElement("div"));
    const third = register(sibling, { commit });
    third.observe(target, () => {});
    expect(observe).toHaveBeenCalledTimes(2); expect(unobserve).toHaveBeenCalledTimes(1);
    deliver([{ target, contentRect: target.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], {} as ResizeObserver);
    expect(oldCallback).not.toHaveBeenCalled(); expect(currentCallback).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1);
    first.dispose(); second.dispose(); third.dispose();
    deliver([{ target, contentRect: target.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], {} as ResizeObserver);
    expect(currentCallback).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(getEditorLayoutSnapshot(document)).toMatchObject({ participants: 0, observedElements: 0, pending: 0 });
  });
});
