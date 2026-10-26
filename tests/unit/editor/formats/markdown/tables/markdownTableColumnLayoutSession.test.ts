import { describe, expect, it } from "vitest";
import {
  createEmbeddedTableColumnLayoutBrowserPersistence,
  createEmbeddedTableColumnLayoutSessionStore,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedTableColumnLayoutSession";

describe("Markdown table column layout session", () => {
  it("keeps widths stable through content edits and source movement", () => {
    const persistence = createEmbeddedTableColumnLayoutBrowserPersistence(createMemoryStorage())!;
    const store = createEmbeddedTableColumnLayoutSessionStore({ persistence });
    const first = store.acquire({
      featureId: "markdown-table",
      initialWidths: [120, 180],
      mappedRange: { from: 20, to: 80 },
      persistenceNamespace: "/notes/table.md",
      sourceIdentity: "table:v1",
    });
    store.setWidths(first.sessionId, first.mountToken, [160, 200]);
    store.mapTransaction({
      continuities: [{
        featureId: "markdown-table",
        oldRange: { from: 20, to: 80 },
        newRange: { from: 20, to: 86 },
        sequenceChange: { kind: "preserve" },
      }],
      mapPos: (position) => position,
      touchesRange: () => true,
    });

    const afterEdit = store.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 96],
      mappedRange: { from: 20, to: 86 },
      persistenceNamespace: "/notes/table.md",
      sourceIdentity: "table:v2",
    });
    expect(afterEdit.sessionId).toBe(first.sessionId);
    expect(afterEdit.widths).toEqual([160, 200]);

    store.mapTransaction({
      continuities: [],
      mapPos: (position) => position + 12,
      touchesRange: () => false,
    });
    const afterPrefixEdit = store.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 96],
      mappedRange: { from: 32, to: 98 },
      persistenceNamespace: "/notes/table.md",
      sourceIdentity: "table:v2",
    });
    expect(afterPrefixEdit.sessionId).toBe(first.sessionId);
    expect(afterPrefixEdit.widths).toEqual([160, 200]);

    const reopenedStore = createEmbeddedTableColumnLayoutSessionStore({ persistence });
    expect(reopenedStore.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 96],
      mappedRange: { from: 32, to: 98 },
      persistenceNamespace: "/notes/table.md",
      sourceIdentity: "table:v2",
    }).widths).toEqual([160, 200]);
  });

  it("moves widths with their semantic columns and initializes only inserted tracks", () => {
    const store = createEmbeddedTableColumnLayoutSessionStore();
    let session = store.acquire({
      featureId: "markdown-table",
      initialWidths: [120, 180, 220],
      mappedRange: { from: 0, to: 60 },
      sourceIdentity: "table:v1",
    });

    store.mapTransaction(transactionMapping(
      { from: 0, to: 60 },
      { from: 0, to: 70 },
      { kind: "insert", index: 1, count: 1 },
    ));
    session = store.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 104, 96, 96],
      mappedRange: { from: 0, to: 70 },
      sourceIdentity: "table:v2",
    });
    // The inserted track starts at the Markdown floor until automatic layout runs.
    expect(session.widths).toEqual([120, 48, 180, 220]);

    store.mapTransaction(transactionMapping(
      { from: 0, to: 70 },
      { from: 0, to: 70 },
      { kind: "move", fromIndex: 0, toIndex: 2 },
    ));
    session = store.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 96, 96, 96],
      mappedRange: { from: 0, to: 70 },
      sourceIdentity: "table:v3",
    });
    expect(session.widths).toEqual([48, 180, 120, 220]);

    store.mapTransaction(transactionMapping(
      { from: 0, to: 70 },
      { from: 0, to: 62 },
      { kind: "delete", index: 1, count: 1 },
    ));
    session = store.acquire({
      featureId: "markdown-table",
      initialWidths: [96, 96, 96],
      mappedRange: { from: 0, to: 62 },
      sourceIdentity: "table:v4",
    });
    expect(session.widths).toEqual([48, 120, 220]);
  });

  it("keeps automatic tracks reflowable and explicit tracks fixed", () => {
    const written: string[] = [];
    const removed: string[] = [];
    const store = createEmbeddedTableColumnLayoutSessionStore({
      persistence: {
        read: () => undefined,
        write: (key) => { written.push(key); },
        remove: (key) => { removed.push(key); },
      },
    });
    let session = store.acquire({
      featureId: "markdown-table",
      initialWidths: [200, 300],
      initialLayoutWidth: 640,
      mappedRange: { from: 0, to: 40 },
      persistenceNamespace: "/notes/table.md",
      sourceIdentity: "table:v1",
    });
    expect(session.explicit).toBe(false);
    expect(session.autoLayoutWidth).toBe(640);

    // A new reading width reflows without persisting or becoming explicit.
    session = store.setAutoWidths(session.sessionId, session.mountToken, [150, 250], 480)!;
    expect(session).toMatchObject({ widths: [150, 250], explicit: false, autoLayoutWidth: 480 });
    expect(written).toEqual([]);

    // The user's own widths persist and stop following the reading column.
    session = store.setWidths(session.sessionId, session.mountToken, [260, 220])!;
    expect(session).toMatchObject({ widths: [260, 220], explicit: true, autoLayoutWidth: null });
    expect(written).toHaveLength(1);
    expect(store.setAutoWidths(session.sessionId, session.mountToken, [1, 2], 900)).toBeNull();

    // Reset returns the table to automatic layout and forgets the stored widths.
    session = store.resetToAuto(session.sessionId, session.mountToken)!;
    expect(session).toMatchObject({ explicit: false, autoLayoutWidth: null });
    expect(removed).toEqual(written);
  });

  it("re-lays automatic tracks out when a column is added or removed, not when one moves", () => {
    const store = createEmbeddedTableColumnLayoutSessionStore();
    const acquire = (initialWidths: number[], to: number, sourceIdentity: string) => store.acquire({
      featureId: "markdown-table",
      initialWidths,
      initialLayoutWidth: 640,
      mappedRange: { from: 0, to },
      sourceIdentity,
    });
    let session = acquire([200, 300], 40, "table:v1");
    store.mapTransaction(transactionMapping(
      { from: 0, to: 40 },
      { from: 0, to: 40 },
      { kind: "move", fromIndex: 0, toIndex: 1 },
    ));
    session = acquire([96, 96], 40, "table:v2");
    expect(session).toMatchObject({ widths: [300, 200], autoLayoutWidth: 640 });

    store.mapTransaction(transactionMapping(
      { from: 0, to: 40 },
      { from: 0, to: 50 },
      { kind: "insert", index: 2, count: 1 },
    ));
    session = acquire([96, 96, 96], 50, "table:v3");
    expect(session.autoLayoutWidth).toBeNull();
  });
});

describe("Markdown table column layout persistence", () => {
  it("restores only the matching document revision and column count", () => {
    const storage = createMemoryStorage();
    const persistence = createEmbeddedTableColumnLayoutBrowserPersistence(storage)!;
    const matchingKey = JSON.stringify(["/notes/table.md", "table:v1", 10]);
    persistence.write(matchingKey, [140, 320]);

    expect(persistence.read(matchingKey, 2)).toEqual([140, 320]);
    expect(persistence.read(
      JSON.stringify(["/notes/table.md", "table:v2", 10]),
      2,
    )).toBeUndefined();
    expect(persistence.read(matchingKey, 3)).toBeUndefined();

    const migratedKey = JSON.stringify(["/notes/table.md", "table:v2", 10]);
    persistence.write(migratedKey, [160, 340], matchingKey);
    expect(persistence.read(matchingKey, 2)).toBeUndefined();
    expect(persistence.read(migratedKey, 2)).toEqual([160, 340]);
  });
});

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function transactionMapping(
  oldRange: { from: number; to: number },
  newRange: { from: number; to: number },
  sequenceChange:
    | { kind: "insert"; index: number; count: number }
    | { kind: "delete"; index: number; count: number }
    | { kind: "move"; fromIndex: number; toIndex: number },
) {
  return {
    continuities: [{
      featureId: "markdown-table",
      oldRange,
      newRange,
      sequenceChange,
    }],
    mapPos: (position: number) => position,
    touchesRange: () => true,
  };
}
