import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPort, DocumentPersistencePort } from "../packages/shared-ui/src/core/types";
import { withEditorDocumentOperations } from "../packages/shared-ui/src/editor/document-session/documentResourceOperations";
import { closeAllDocumentWorkingCopies, closeDocumentWorkingCopy, getDocumentWorkingCopiesUnderResource, getOrCreateDocumentWorkingCopy } from "../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { StructuredDocumentModel } from "../packages/shared-ui/src/editor/document-session/StructuredDocumentModel";
import { ResourceOperationQueue } from "../packages/shared-ui/src/editor/document-session/ResourceOperationQueue";

afterEach(async () => { await closeAllDocumentWorkingCopies("app-close").catch(() => undefined); });
function open(persistence: DocumentPersistencePort, path: string) {
  const binding = getOrCreateDocumentWorkingCopy({ documentId: path, initialContent: "0", saveMode: "manual", persistence });
  const model = binding.models.getOrCreate("number", () => new StructuredDocumentModel("number", "0", (content) => ({ document: Number(content), error: null }), String));
  binding.session.attachSource(model);
  model.edit(1); binding.session.reportRevision({ revision: model.getSnapshot().revision, origin: "local-edit" });
  return { binding, model };
}

describe("scoped document operations", () => {
  it("does not retire a moved model through a close queued against its former address", async () => {
    const persistence: DocumentPersistencePort = { kind: "local-fs", storageIdentity: "operations:move-close", persist: async () => ({ ok: true, version: "saved" }) };
    const current = open(persistence, "old.txt");
    let completeMove!: () => void;
    const port = withEditorDocumentOperations({ listChildren: async () => [], documentPersistence: persistence,
      moveNode: () => new Promise<void>((resolve) => { completeMove = resolve; }) });
    const moving = port.moveNode!("old.txt", "new.txt");
    await vi.waitFor(() => expect(completeMove).toBeDefined());
    const closing = closeDocumentWorkingCopy({ storageIdentity: persistence.storageIdentity, resourcePath: "old.txt" });
    const rejected = expect(closing).rejects.toThrow("document moved");
    await Promise.resolve(); completeMove(); await moving; await rejected;
    expect(getDocumentWorkingCopiesUnderResource(persistence.storageIdentity, "new.txt")).toEqual([current.binding]);
    await closeDocumentWorkingCopy({ storageIdentity: persistence.storageIdentity, resourcePath: "new.txt" });
  });

  it("rejects an already queued operation when the preceding operation becomes uncertain", async () => {
    const queue = new ResourceOperationQueue();
    const scopes = [{ storageIdentity: "hold-test", resource: "folder" }];
    let release!: () => void;
    let releaseHold!: () => void;
    const first = queue.run(scopes, async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      releaseHold = queue.hold(scopes, "first");
    }, "first");
    const mutate = vi.fn(async () => undefined);
    const second = queue.run(scopes, mutate);
    const rejected = expect(second).rejects.toThrow(/reconciled first/);
    await Promise.resolve(); release(); await first; await rejected;
    expect(mutate).not.toHaveBeenCalled();
    await queue.run(scopes, async () => releaseHold(), "first");
    await queue.run(scopes, mutate);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("copies the acknowledged source while retaining its editing model", async () => {
    const events: string[] = [];
    const persistence: DocumentPersistencePort = { kind: "local-fs", storageIdentity: "operations:copy", persist: async () => {
      events.push("save"); return { ok: true, version: "v2" };
    } };
    const current = open(persistence, "note.txt");
    const port = withEditorDocumentOperations({ listChildren: async () => [], documentPersistence: persistence,
      copyNode: async () => { events.push("copy"); expect(current.model.edit(99)).toBe(false); return { path: "note copy.txt" }; } });
    await port.copyNode!("note.txt", null);
    expect(events).toEqual(["save", "copy"]);
    expect(current.binding.session.documentId).toBe("note.txt");
    expect(current.model.undo()).toBe(true);
  });

  it("renames only after saving the affected document, preserving its model and undo", async () => {
    const events: string[] = [];
    const persistence: DocumentPersistencePort = { kind: "local-fs", storageIdentity: "operations:move", persist: vi.fn(async ({ path }) => {
      events.push(`save:${path}`);
      if (path === "unrelated.txt") return { ok: false as const, kind: "error" as const, message: "unrelated failure" };
      return { ok: true as const, version: "v2" };
    }) };
    const affected = open(persistence, "old.txt");
    const unrelated = open(persistence, "unrelated.txt");
    const port = withEditorDocumentOperations({ listChildren: async () => [], documentPersistence: persistence,
      renameNode: async () => { events.push("rename"); expect(affected.model.edit(99)).toBe(false); } });
    await port.renameNode!("old.txt", "new.txt");
    expect(events).toEqual(["save:old.txt", "rename"]);
    const retained = getDocumentWorkingCopiesUnderResource(persistence.storageIdentity, "new.txt")[0];
    expect(retained).toBe(affected.binding);
    expect(retained.session.documentId).toBe("new.txt");
    expect(affected.model.undo()).toBe(true);
    expect(affected.model.readSnapshot().content).toBe("0");
    expect(unrelated.binding.session.hasUnpersistedChanges()).toBe(true);
    unrelated.binding.session.reconcileExternalBaseline("0", "v3");
  });

  it("keeps input and identity when the pre-operation save fails", async () => {
    const persistence: DocumentPersistencePort = { kind: "local-fs", storageIdentity: "operations:failure", persist: vi.fn(async () => ({ ok: false as const, kind: "error" as const, message: "disk full" })) };
    const current = open(persistence, "note.txt");
    const remove = vi.fn(async () => undefined);
    const port = withEditorDocumentOperations({ listChildren: async () => [], documentPersistence: persistence, deleteNode: remove });
    await expect(port.deleteNode!("note.txt")).rejects.toMatchObject({ result: { status: "failed" } });
    expect(remove).not.toHaveBeenCalled();
    expect(current.model.edit(2)).toBe(true);
    expect(current.binding.session.documentId).toBe("note.txt");
    current.binding.session.reconcileExternalBaseline("0");
  });

  it("does not repeat a mutation with an unknown delivery result", async () => {
    const remove = vi.fn(async () => { throw new Error("transport lost"); });
    const raw: DataPort = { listChildren: async () => [], documentPersistence: { kind: "local-fs", storageIdentity: "operations:unknown", persist: vi.fn() }, deleteNode: remove };
    const port = withEditorDocumentOperations(raw);
    await expect(port.deleteNode!("note.txt")).rejects.toMatchObject({ result: { status: "indeterminate" } });
    await expect(port.deleteNode!("note.txt")).rejects.toMatchObject({ result: { status: "indeterminate" } });
    expect(remove).toHaveBeenCalledTimes(1);
    raw.resolveNode = async () => null;
    await port.deleteNode!("note.txt");
  });

  it("reconciles a completed readonly move after its transport acknowledgement is lost", async () => {
    const move = vi.fn(async () => { throw new Error("transport lost after rename"); });
    const port = withEditorDocumentOperations({ listChildren: async () => [], moveNode: move,
      resolveNode: async (path) => path === "new.png" ? { id: path, path, name: path, type: "image" } : null,
      documentPersistence: { kind: "local-fs", storageIdentity: "operations:readonly-reconcile", persist: vi.fn() } });
    await expect(port.moveNode!("old.png", "new.png")).rejects.toMatchObject({ result: { status: "indeterminate" } });
    await closeDocumentWorkingCopy({ storageIdentity: "operations:readonly-reconcile", resourcePath: "new.png" });
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("waits for overlapping ranges while allowing unrelated operations", async () => {
    const queue = new ResourceOperationQueue();
    let release!: () => void;
    const events: string[] = [];
    const first = queue.run([{ storageIdentity: "a", resource: "folder" }], async () => { events.push("first"); await new Promise<void>((resolve) => { release = resolve; }); });
    const second = queue.run([{ storageIdentity: "a", resource: "folder/note" }], async () => { events.push("second"); });
    await queue.run([{ storageIdentity: "a", resource: "other" }], async () => { events.push("other"); });
    expect(events).toEqual(["first", "other"]);
    release(); await Promise.all([first, second]);
    expect(events).toEqual(["first", "other", "second"]);
  });
});
