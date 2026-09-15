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
    expect(session.widths).toEqual([120, 96, 180, 220]);

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
    expect(session.widths).toEqual([96, 180, 120, 220]);

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
    expect(session.widths).toEqual([96, 120, 220]);
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
