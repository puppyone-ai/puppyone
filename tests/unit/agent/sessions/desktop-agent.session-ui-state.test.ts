import { describe, expect, it } from "vitest";
import { SessionUiStateStore } from "../../../../src/features/desktop-agent/application/SessionUiStateStore";

describe("SessionUiStateStore", () => {
  it("bounds reconstructible caches without evicting unsent drafts", () => {
    const store = new SessionUiStateStore(2, 10);
    store.patch("old", { draft: "old" });
    store.patch("kept", { draft: "kept", measurements: { row: 100 } });
    store.read("old");
    store.patch("new", { draft: "new" });

    expect(store.read("old").draft).toBe("old");
    expect(store.read("kept").draft).toBe("kept");
    expect(store.read("kept").measurements).toEqual({});
    expect(store.read("new").draft).toBe("new");
    store.delete("kept");
    expect(store.read("kept").draft).toBe("");
  });

  it("retains only the newest bounded measurement entries and returns defensive copies", () => {
    const store = new SessionUiStateStore(2, 2);
    store.patch("session", { measurements: { first: 1, second: 2, third: 3 } });

    const snapshot = store.read("session");
    expect(snapshot.measurements).toEqual({ second: 2, third: 3 });
    snapshot.measurements.third = 99;
    expect(store.read("session").measurements.third).toBe(3);
  });

  it("keeps geometry provenance and reading anchors as defensive Renderer-only memory", () => {
    const store = new SessionUiStateStore();
    const geometry = { layoutSignature: "420|font-a|14|20", anchor: { kind: "row" as const, rowId: "one", offset: 12 } };
    store.patch("session", { measurements: { one: 40 }, geometry });
    geometry.anchor.offset = 99;
    const restored = store.read("session");
    expect(restored.geometry?.anchor).toEqual({ kind: "row", rowId: "one", offset: 12 });
    restored.geometry!.layoutSignature = "different";
    expect(store.read("session").geometry?.layoutSignature).toBe("420|font-a|14|20");
  });

  it("rejects invalid cache limits", () => {
    expect(() => new SessionUiStateStore(0, 10)).toThrow(/positive integer/i);
    expect(() => new SessionUiStateStore(1, Number.NaN)).toThrow(/positive integer/i);
  });
});
