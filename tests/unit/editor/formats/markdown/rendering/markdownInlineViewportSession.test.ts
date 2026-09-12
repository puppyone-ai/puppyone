import { describe, expect, it } from "vitest";
import {
  createEmbeddedInlineViewportSessionStore,
  invertEmbeddedInlineViewportSequenceChange,
  mapEmbeddedInlineViewportPosition,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedInlineViewportSession";
import {
  denormalizeInlineScrollOffset,
  mapInlineScrollOffset,
  normalizeInlineScrollOffset,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableInlineViewportController";

describe("Markdown embedded inline viewport sessions", () => {
  it("keeps one semantic anchor across an explicitly continuous Widget replacement", () => {
    const store = createEmbeddedInlineViewportSessionStore();
    const first = store.acquire({
      featureId: "markdown-table",
      mappedRange: { from: 10, to: 30 },
      sourceIdentity: "table-a",
    });
    store.capture(first.sessionId, first.mountToken, {
      kind: "anchored",
      itemIndex: 2,
      offsetWithinItemPx: 7,
      fallbackLogicalOffsetPx: 247,
    });

    store.mapTransaction({
      continuities: [{
        featureId: "markdown-table",
        oldRange: { from: 10, to: 30 },
        newRange: { from: 10, to: 36 },
        sequenceChange: { kind: "insert", index: 1, count: 1 },
      }],
      mapPos: (position) => position,
      touchesRange: () => true,
    });
    store.detach(first.sessionId, first.mountToken);

    const replacement = store.acquire({
      featureId: "markdown-table",
      mappedRange: { from: 10, to: 36 },
      sourceIdentity: "table-b",
    });
    expect(replacement.sessionId).toBe(first.sessionId);
    expect(replacement.position).toEqual({
      kind: "anchored",
      itemIndex: 3,
      offsetWithinItemPx: 7,
      fallbackLogicalOffsetPx: 247,
    });
    expect(replacement.lifecycle).toBe("mounted");

    // Disposal from the replaced DOM cannot detach the newer mount.
    store.detach(first.sessionId, first.mountToken);
    expect(store.get(replacement.sessionId)?.lifecycle).toBe("mounted");
  });

  it("maps non-overlapping edits but rejects overlapping replacement without continuity", () => {
    const store = createEmbeddedInlineViewportSessionStore();
    const session = store.acquire({
      featureId: "markdown-table",
      mappedRange: { from: 20, to: 40 },
      sourceIdentity: "table",
    });

    store.mapTransaction({
      continuities: [],
      mapPos: (position) => position + 5,
      touchesRange: () => false,
    });
    expect(store.get(session.sessionId)?.mappedRange).toEqual({ from: 25, to: 45 });

    store.mapTransaction({
      continuities: [],
      mapPos: (position) => position,
      touchesRange: () => true,
    });
    expect(store.get(session.sessionId)).toBeUndefined();

    const recreated = store.acquire({
      featureId: "markdown-table",
      mappedRange: { from: 25, to: 45 },
      sourceIdentity: "different-table",
    });
    expect(recreated.sessionId).not.toBe(session.sessionId);
    expect(recreated.position).toEqual({ kind: "start" });
  });

  it("expires detached sessions and bounds their least-recently-used set", () => {
    let timestamp = 0;
    const store = createEmbeddedInlineViewportSessionStore({
      detachedTtlMs: 100,
      maxDetachedSessions: 2,
      now: () => timestamp,
    });
    const createDetached = (index: number) => {
      timestamp += 1;
      const session = store.acquire({
        featureId: "markdown-table",
        mappedRange: { from: index * 10, to: index * 10 + 5 },
        sourceIdentity: `table-${index}`,
      });
      store.detach(session.sessionId, session.mountToken);
      return session;
    };

    const first = createDetached(1);
    const second = createDetached(2);
    const third = createDetached(3);
    expect(store.get(first.sessionId)).toBeUndefined();
    expect(store.values().map((session) => session.sessionId)).toEqual([
      second.sessionId,
      third.sessionId,
    ]);

    timestamp += 101;
    expect(store.values()).toEqual([]);
  });
});

describe("Markdown inline viewport anchor math", () => {
  it("maps insert, delete, and move operations without using raw pixels as identity", () => {
    const anchor = {
      kind: "anchored" as const,
      itemIndex: 3,
      offsetWithinItemPx: 4,
      fallbackLogicalOffsetPx: 304,
    };
    expect(mapEmbeddedInlineViewportPosition(anchor, {
      kind: "insert",
      index: 1,
      count: 2,
    })).toMatchObject({ itemIndex: 5 });
    expect(mapEmbeddedInlineViewportPosition(anchor, {
      kind: "delete",
      index: 2,
      count: 2,
    })).toMatchObject({ itemIndex: 2 });
    expect(mapEmbeddedInlineViewportPosition(anchor, {
      kind: "move",
      fromIndex: 1,
      toIndex: 4,
    })).toMatchObject({ itemIndex: 2 });
    expect(invertEmbeddedInlineViewportSequenceChange({
      kind: "move",
      fromIndex: 1,
      toIndex: 4,
    })).toEqual({ kind: "move", fromIndex: 4, toIndex: 1 });
  });

  it("normalizes every RTL browser scroll model to zero-at-inline-start", () => {
    const maximum = 400;
    for (const behavior of [
      "negative",
      "positive-ascending",
      "positive-descending",
    ] as const) {
      for (const logical of [0, 75, maximum]) {
        const raw = denormalizeInlineScrollOffset(logical, maximum, "rtl", behavior);
        expect(normalizeInlineScrollOffset(raw, maximum, "rtl", behavior)).toBe(logical);
      }
    }
    expect(normalizeInlineScrollOffset(75, maximum, "ltr", "negative")).toBe(75);
  });

  it("maps the table offset proportionally onto a differently sized scrollbar range", () => {
    expect(mapInlineScrollOffset(0, 1200, 800)).toBe(0);
    expect(mapInlineScrollOffset(600, 1200, 800)).toBe(400);
    expect(mapInlineScrollOffset(1200, 1200, 800)).toBe(800);
    expect(mapInlineScrollOffset(200, 0, 800)).toBe(0);
  });
});
