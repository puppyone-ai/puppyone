import { describe, expect, it, vi } from "vitest";
import { createDocumentDropRegistry } from "../../../../../../src/shared-ui/editor/resource/DocumentDropTarget";

const target = (accepts: boolean) => ({
  containsPoint: () => accepts,
  prepareInsert: vi.fn(() => vi.fn(async () => true)),
});

describe("createDocumentDropRegistry", () => {
  it("returns null when nothing is registered", () => {
    expect(createDocumentDropRegistry().find(10, 10)).toBeNull();
  });

  it("prefers the most recently installed accepting target", () => {
    const registry = createDocumentDropRegistry();
    const first = target(true);
    const second = target(true);
    registry.install(first);
    registry.install(second);
    registry.find(10, 10)?.prepareInsert({ x: 10, y: 10 });
    expect(second.prepareInsert).toHaveBeenCalledOnce();
    expect(first.prepareInsert).not.toHaveBeenCalled();
  });

  it("skips a registered target that does not contain the point", () => {
    const registry = createDocumentDropRegistry();
    registry.install(target(false));
    expect(registry.find(10, 10)).toBeNull();
  });

  it("stops routing to a target after it uninstalls", () => {
    const registry = createDocumentDropRegistry();
    const dispose = registry.install(target(true));
    dispose();
    expect(registry.find(10, 10)).toBeNull();
  });
  it("cancels a prepared insertion instead of retargeting a newer document", async () => {
    const registry = createDocumentDropRegistry();
    const complete = vi.fn(async () => true);
    const dispose = registry.install({ containsPoint: () => true, prepareInsert: () => complete });
    const finish = registry.find(10, 10)!.prepareInsert({ x: 10, y: 10 });
    dispose();
    const next = target(true);
    registry.install(next);
    expect(await finish({ kind: "workspace-entry", path: "p.png", name: "p.png" })).toBe(true);
    expect(complete).toHaveBeenCalledWith(null);
    expect(next.prepareInsert).not.toHaveBeenCalled();
  });
});
