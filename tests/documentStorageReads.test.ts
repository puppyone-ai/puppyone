import { describe, expect, it, vi } from "vitest";
import type { DocumentPersistencePort, FileContent } from "@puppyone/shared-ui";
import { DocumentEditingSession } from "../packages/shared-ui/src/editor/document-session/DocumentEditingSession";
import { readDocumentStorageSnapshot } from "../packages/shared-ui/src/editor/document-session/documentStorageReads";

describe("document storage observation ordering", () => {
  it.each(["one", "two"])("revalidates a delayed read of %s after a save without conflicting with the next edit", async (oldContent) => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(file("two", "v2"));
    const accept = vi.fn((content: FileContent) => harness.session.reconcileExternalBaseline(content.content!, content.version));
    const read = readDocumentStorageSnapshot({ readFile, documentPersistence: { ...harness.persistence } }, "notes.md", {
      signal: new AbortController().signal, accept,
    });
    harness.edit("two");
    await harness.session.requestSave();
    harness.edit("three");
    stale.resolve(file(oldContent, oldContent === "one" ? "v1" : "v2"));
    await read;

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledExactlyOnceWith(file("two", "v2"));
    expect(harness.content()).toBe("three");
    expect(harness.session.getState()).toMatchObject({ status: "dirty", error: null, storageVersion: "v2" });
    await harness.session.requestSave();
    expect(harness.persistence.persist).toHaveBeenLastCalledWith(expect.objectContaining({ content: "three", baseVersion: "v2" }));
    harness.session.dispose();
  });

  it("adopts a real external revert over local typing instead of suppressing known content", async () => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(file("one", "v1"));
    const read = readDocumentStorageSnapshot({ readFile, documentPersistence: harness.persistence }, "notes.md", {
      signal: new AbortController().signal,
      accept: (content) => harness.session.reconcileExternalBaseline(content.content!, content.version),
    });
    harness.edit("two");
    await harness.session.requestSave();
    harness.edit("three");
    stale.resolve(file("one", "v1"));
    await read;
    expect(harness.session.getState().status).toBe("clean");
    expect(harness.content()).toBe("one");
    expect(harness.persistence.persist).toHaveBeenCalledTimes(1);
    expect(harness.content()).toBe("one");
    harness.session.dispose();
  });

  it("revalidates obsolete read errors after a successful save", async () => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(file("two", "v2"));
    const accept = vi.fn();
    const read = readDocumentStorageSnapshot({ readFile, documentPersistence: harness.persistence }, "notes.md", {
      signal: new AbortController().signal, accept,
    });
    harness.edit("two");
    await harness.session.requestSave();
    stale.reject(new Error("obsolete read failed"));
    await read;
    expect(accept).toHaveBeenCalledExactlyOnceWith(file("two", "v2"));
    harness.session.dispose();
  });

  it("keeps unrelated resources and storage identities independent", async () => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn(() => stale.promise);
    const accept = vi.fn();
    const controller = new AbortController();
    const reads = [
      readDocumentStorageSnapshot({ readFile, documentPersistence: harness.persistence }, "other.md", { signal: controller.signal, accept }),
      readDocumentStorageSnapshot({ readFile, documentPersistence: { ...harness.persistence, storageIdentity: "other-repo" } }, "notes.md", { signal: controller.signal, accept }),
    ];
    harness.edit("two");
    await harness.session.requestSave();
    stale.resolve(file("one", "v1"));
    await Promise.all(reads);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledTimes(2);
    harness.session.dispose();
  });

  it("does not retry or publish a cancelled pane read", async () => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn(() => stale.promise);
    const accept = vi.fn();
    const controller = new AbortController();
    const read = readDocumentStorageSnapshot({ readFile, documentPersistence: harness.persistence }, "notes.md", { signal: controller.signal, accept });
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    harness.edit("two");
    await harness.session.requestSave();
    controller.abort();
    stale.resolve(file("one", "v1"));
    await rejected;
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
    harness.session.dispose();
  });

  it("revalidates a read overtaken by a newer accepted read", async () => {
    const harness = createHarness();
    const stale = deferred<FileContent>();
    const readFile = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(file("agent", "agent-v2"));
    const accept = vi.fn();
    const options = { signal: new AbortController().signal, accept };
    const dataPort = { readFile, documentPersistence: harness.persistence };
    const read = readDocumentStorageSnapshot(dataPort, "notes.md", options);
    await readDocumentStorageSnapshot(dataPort, "notes.md", options);
    stale.resolve(file("one", "v1"));
    await read;
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(accept.mock.calls.map(([content]) => content.content)).toEqual(["agent", "agent"]);
    harness.session.dispose();
  });
});

function createHarness() {
  let snapshot = { content: "one", revision: "r1" };
  const persistence: DocumentPersistencePort = {
    kind: "local-fs", storageIdentity: "test:storage-reads",
    persist: vi.fn(async () => ({ ok: true, version: "v2" })),
  };
  const session = new DocumentEditingSession({
    documentId: "notes.md", initialContent: "one", initialVersion: "v1", saveMode: "manual", persistence,
  });
  session.attachSource({
    readSnapshot: () => snapshot,
    replaceContent: (content) => (snapshot = { content, revision: `${snapshot.revision}:external` }),
  });
  session.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
  return {
    persistence, session, content: () => snapshot.content,
    edit(content: string) {
      snapshot = { content, revision: `${snapshot.revision}:edit` };
      session.reportRevision({ revision: snapshot.revision, origin: "local-edit" });
    },
  };
}

function file(content: string, version: string): FileContent {
  return { path: "notes.md", name: "notes.md", type: "markdown", content, version };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
