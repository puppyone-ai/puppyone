/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { createResourceDragPreviewStore } from "../src/platform/resourceDragPreviewStore";
import type { ResourceDragState } from "../src/platform/resourceDragSession";

afterEach(() => { delete window.puppyoneDesktop; });
it("shares one native subscription and ignores late previews and another session's cleanup", async () => {
  const store = createResourceDragPreviewStore();
  let update!: (state: ResourceDragState) => void;
  let finish!: (state: unknown) => void;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((handler) => { update = handler; return unsubscribe; });
  const preview = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  window.puppyoneDesktop = { resourceDragSessionSupported: true, onResourceDragState: subscribe, previewResourceDrag: preview } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const stopA = store.subscribe(vi.fn()), stopB = store.subscribe(vi.fn());
  try {
    expect(subscribe).toHaveBeenCalledOnce();
    const event = new Event("dragenter");
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
    window.dispatchEvent(event); window.dispatchEvent(event);
    expect(preview).toHaveBeenCalledOnce();
    const entries = [{ path: "puppyone-local://workspace/a/a.md", name: "a.md", entryType: "file" as const }];
    update({ id: "new", entries });
    finish({ id: "old", entries });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot()?.id).toBe("new");
    update({ id: "old", entries: null });
    expect(store.getSnapshot()?.id).toBe("new");
    update({ id: "new", entries: null });
    expect(store.getSnapshot()).toBeNull();
    stopA();
    expect(unsubscribe).not.toHaveBeenCalled();
  } finally { stopA(); stopB(); }
  expect(unsubscribe).toHaveBeenCalledOnce();
});
