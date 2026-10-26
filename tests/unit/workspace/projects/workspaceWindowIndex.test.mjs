import { describe, expect, it } from "vitest";
import { WorkspaceWindowIndex } from "../../../../electron/main/workspace/workspace-window-index.mjs";

describe("open workspace window membership", () => {
  it("retains the other window's membership on detach or close", () => {
    const index = new WorkspaceWindowIndex();
    const first = { isDestroyed: () => false }, second = { isDestroyed: () => false };
    index.add("/a", first); index.add("/a", second); index.add("/a", first);
    index.remove("/a", first); expect(index.has("/a")).toBe(true);
    index.remove("/a", second); expect(index.has("/a")).toBe(false);
  });
  it("prunes destroyed windows without dropping a live membership", () => {
    const index = new WorkspaceWindowIndex();
    const live = { isDestroyed: () => false };
    index.add("/a", { isDestroyed: () => true }); index.add("/a", live);
    expect(index.has("/a")).toBe(true);
    index.remove("/a", live); expect(index.has("/a")).toBe(false);
  });
});
