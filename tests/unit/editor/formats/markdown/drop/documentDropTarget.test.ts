import { describe, expect, it, vi } from "vitest";
import { createDocumentDropRegistry } from "../../../../../../src/shared-ui/editor/resource/DocumentDropTarget";

const target = (accepts: boolean) => ({
  containsPoint: () => accepts,
  insert: vi.fn(async () => true),
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
    expect(registry.find(10, 10)).toBe(second);
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
});
