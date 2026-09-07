import { describe, expect, it, vi } from "vitest";
import type {
  DocumentPersistencePort,
  DocumentPersistenceRequest,
} from "@puppyone/shared-ui";
import { DocumentEditingSession } from "../packages/shared-ui/src/editor/document-session/DocumentEditingSession";
import type { EditorSourceSnapshot } from "../packages/shared-ui/src/editor/sourceSnapshot";

describe("DocumentEditingSession", () => {
  it("starts persistence in the next microtask without waiting for a timer", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "two" });

    expect(persist).not.toHaveBeenCalled();
    await nextMicrotask();
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      path: "notes.md",
      content: "two",
      revision: "r2",
      baseVersion: "v1",
      reason: "edit",
    }));
    expect(session.getState().storageVersion).toBe("v2");
  });

  it("coalesces edits from one JavaScript turn to the newest snapshot", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "two" });
    source.change({ revision: "r3", content: "three" });
    await nextMicrotask();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      revision: "r3",
      content: "three",
    }));
  });

  it("keeps one write in flight and persists only the newest following edit", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const second = deferred<{ ok: true; version: string }>();
    const requests: DocumentPersistenceRequest[] = [];
    const persist = vi.fn((request: DocumentPersistenceRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();
    source.change({ revision: "r3", content: "three" });
    source.change({ revision: "r4", content: "four" });
    await nextMicrotask();

    expect(requests.map(({ revision }) => revision)).toEqual(["r2"]);
    first.resolve({ ok: true, version: "v2" });
    await nextMicrotask();
    expect(requests.map(({ revision }) => revision)).toEqual(["r2", "r4"]);
    expect(requests[1]).toMatchObject({ content: "four", baseVersion: "v2" });

    second.resolve({ ok: true, version: "v3" });
    await session.flushCurrent("document-close");
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({
      currentRevision: "r4",
      persistedRevision: "r4",
      storageVersion: "v3",
    });
  });

  it("does not treat the filesystem echo of an in-flight save as an external conflict", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const second = deferred<{ ok: true; version: string }>();
    const requests: DocumentPersistenceRequest[] = [];
    const persist = vi.fn((request: DocumentPersistenceRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();
    source.change({ revision: "r3", content: "three" });
    await nextMicrotask();

    expect(session.reconcileExternalBaseline("two", "v2")).toBe("acknowledged");
    expect(session.getState()).toMatchObject({ status: "saving", error: null });

    first.resolve({ ok: true, version: "v2" });
    await nextMicrotask();
    expect(requests[1]).toMatchObject({ content: "three", baseVersion: "v2" });

    second.resolve({ ok: true, version: "v3" });
    await session.flushCurrent("document-close");
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({
      status: "saved",
      error: null,
      storageVersion: "v3",
    });
  });

  it("acknowledges matching external bytes before scheduled autosave without writing them back", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "agent and editor converged" });
    expect(session.reconcileExternalBaseline("agent and editor converged", "agent-v2"))
      .toBe("acknowledged");
    await nextMicrotask();

    expect(persist).not.toHaveBeenCalled();
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({
      status: "clean",
      storageVersion: "agent-v2",
      currentRevision: "r2",
      persistedRevision: "r2",
    });
  });

  it("never turns model initialization or projection replacement into persistence", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "model:2", content: "projection-only replacement" }, false);
    await nextMicrotask();

    expect(persist).not.toHaveBeenCalled();
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({ status: "clean", error: null });
  });

  it.each(["auto", "manual"] as const)("accepts external content after an unsaved edit was undone (%s)", async (mode) => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const session = createSession(persist, mode);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "temporary edit" });
    source.change({ revision: "r3", content: "one" });

    expect(session.reconcileExternalBaseline("agent edit", "agent-v2")).toBe("applied");
    await nextMicrotask();
    expect(source.snapshot().content).toBe("agent edit");
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("accepts an external update after detached edits were undone without restoring the obsolete snapshot", () => {
    const session = createSession(vi.fn(), "manual");
    const first = bindSource(session, { revision: "r1", content: "one" });
    first.change({ revision: "r2", content: "temporary edit" });
    first.change({ revision: "r3", content: "one" });
    first.detach();
    expect(session.reconcileExternalBaseline("agent edit", "agent-v2")).toBe("applied");
    const remounted = bindSource(session, { revision: "r4", content: "one" });
    expect(remounted.snapshot().content).toBe("agent edit");
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it("does not leave a phantom edit when model revisions change during a successful save", async () => {
    const write = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => write.promise);
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    const saved = session.requestSave();
    source.change({ revision: "remounted:r1", content: "two" }, false);
    write.resolve({ ok: true, version: "v2" });
    await saved;

    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.reconcileExternalBaseline("agent edit", "agent-v3")).toBe("applied");
    expect(source.snapshot().content).toBe("agent edit");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a conditional write that discovers its candidate already on disk", async () => {
    const persist = vi.fn(async () => ({
      ok: false as const, kind: "conflict" as const, content: "two", version: "agent-v2",
    }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    await session.requestSave();

    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({ error: null, storageVersion: "agent-v2" });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("settles queued saves when a rejected older write finds the latest edit already on disk", async () => {
    const write = deferred<{ ok: false; kind: "conflict"; content: string; version: string }>();
    const persist = vi.fn(() => write.promise);
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    const firstSave = session.requestSave();
    source.change({ revision: "r3", content: "three" });
    const latestSave = session.requestSave();
    write.resolve({ ok: false, kind: "conflict", content: "three", version: "agent-v3" });
    await Promise.all([firstSave, latestSave]);

    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(source.snapshot().content).toBe("three");
    expect(session.getState()).toMatchObject({ error: null, storageVersion: "agent-v3" });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not let a converged conditional-write result erase a newer known external conflict", async () => {
    const write = deferred<{ ok: false; kind: "conflict"; content: string; version: string }>();
    const session = createSession(vi.fn(() => write.promise), "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    const saved = session.requestSave();
    const rejected = expect(saved).rejects.toThrow("changed outside the editor");
    session.reconcileExternalBaseline("newer external", "agent-v3");
    write.resolve({ ok: false, kind: "conflict", content: "two", version: "v2" });
    await rejected;
    expect(session.getState().status).toBe("conflict");
    expect(source.snapshot().content).toBe("two");
    await session.resolveExternalConflict("reload-external");
    expect(source.snapshot().content).toBe("newer external");
  });

  it("promotes a pending edit to the navigation drain reason", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const second = deferred<{ ok: true; version: string }>();
    const requests: DocumentPersistenceRequest[] = [];
    const persist = vi.fn((request: DocumentPersistenceRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });

    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();
    source.change({ revision: "r3", content: "three" });
    const drain = session.flushCurrent("document-switch");

    first.resolve({ ok: true, version: "v2" });
    await nextMicrotask();
    expect(requests[1]).toMatchObject({
      revision: "r3",
      content: "three",
      baseVersion: "v2",
      reason: "document-switch",
    });
    second.resolve({ ok: true, version: "v3" });
    await drain;
  });

  it("captures the exact final snapshot before an editor model is destroyed", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "closing text" });

    source.detach();
    session.dispose();
    await session.flushCurrent("destroy");

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      revision: "r2",
      content: "closing text",
      reason: "destroy",
    }));
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it("drains a newer revision that arrives during an app-close write", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const second = deferred<{ ok: true; version: string }>();
    const requests: DocumentPersistenceRequest[] = [];
    const persist = vi.fn((request: DocumentPersistenceRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "first close snapshot" });

    const closePromise = session.flushCurrent("app-close");
    source.change({ revision: "r3", content: "last close snapshot" });
    first.resolve({ ok: true, version: "v2" });
    await nextMicrotask();

    expect(requests[1]).toMatchObject({
      revision: "r3",
      content: "last close snapshot",
      baseVersion: "v2",
      reason: "app-close",
    });
    second.resolve({ ok: true, version: "v3" });
    await closePromise;
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it("writes an undo after the older edited value has crossed storage", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const requests: DocumentPersistenceRequest[] = [];
    const persist = vi.fn((request: DocumentPersistenceRequest) => {
      requests.push(request);
      return requests.length === 1
        ? first.promise
        : Promise.resolve({ ok: true as const, version: "v3" });
    });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();

    source.change({ revision: "r3", content: "one" }, false);
    const drain = session.flushCurrent("document-switch");
    first.resolve({ ok: true, version: "v2" });
    await drain;

    expect(requests.map(({ content }) => content)).toEqual(["two", "one"]);
    expect(requests[1]).toMatchObject({ baseVersion: "v2", reason: "document-switch" });
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it("does not write twice when a newer revision has the in-flight content", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => first.promise);
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();

    source.change({ revision: "r3", content: "two" });
    const drain = session.flushCurrent("document-switch");
    first.resolve({ ok: true, version: "v2" });
    await drain;

    expect(persist).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: "clean",
      currentRevision: "r3",
      persistedRevision: "r3",
    });
  });

  it("applies an external baseline only while clean", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });

    expect(session.reconcileExternalBaseline("external", "external-v1")).toBe("applied");
    expect(session.getState()).toMatchObject({ status: "clean", storageVersion: "external-v1" });

    source.change({ revision: "r2", content: "local" });
    expect(session.reconcileExternalBaseline("agent edit", "external-v2")).toBe("conflict");
    expect(session.getState()).toMatchObject({
      status: "conflict",
      error: { code: "external-conflict" },
      storageVersion: "external-v1",
    });
    await expect(session.requestSave()).rejects.toThrow("changed outside the editor");
    expect(persist).not.toHaveBeenCalled();

    await session.resolveExternalConflict("reload-external");
    expect(source.snapshot()).toMatchObject({ content: "agent edit" });
    expect(session.getState()).toMatchObject({
      status: "clean",
      storageVersion: "external-v2",
    });
  });

  it.each([
    ["empty file", ""],
    ["CJK and emoji", "你好，外部 Agent 👋\n第二行"],
    ["CRLF line endings", "first\r\nsecond\r\n"],
    ["trailing whitespace", "value  \n\n"],
    ["large text snapshot", `${"0123456789abcdef".repeat(16_384)}\n`],
  ])("adopts a byte-exact %s external snapshot without persistence", (_label, content) => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });

    expect(session.reconcileExternalBaseline(content, "external-v2")).toBe("applied");

    expect(source.snapshot().content).toBe(content);
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(session.getState()).toMatchObject({ status: "clean", storageVersion: "external-v2" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not let a remounted editor mark detached unsaved content clean", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist, "manual");
    const firstSource = bindSource(session, { revision: "r1", content: "one" });
    firstSource.change({ revision: "r2", content: "two" });
    firstSource.detach();

    const secondSource = bindSource(session, { revision: "r3", content: "two" });
    expect(session.hasUnpersistedChanges()).toBe(true);
    expect(session.getState().status).toBe("dirty");

    await session.requestSave();
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      revision: "r3",
      content: "two",
      reason: "manual",
    }));
    secondSource.detach();
  });

  it("cancels a queued follow-up write when an external conflict arrives", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => first.promise);
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();
    source.change({ revision: "r3", content: "three" });
    await nextMicrotask();

    expect(session.reconcileExternalBaseline("agent update", "agent-v2")).toBe("conflict");
    first.resolve({ ok: true, version: "v2" });
    await nextMicrotask();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: "conflict",
      error: { code: "external-conflict" },
    });
    await expect(session.flushCurrent("document-switch"))
      .rejects.toThrow("changed outside the editor");
  });

  it("surfaces a failed conditional write and keeps the dirty snapshot retryable", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("File changed outside PuppyOne"))
      .mockResolvedValueOnce({ ok: true, version: "v3" });
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });

    await expect(session.flushCurrent("document-switch")).rejects.toThrow("outside PuppyOne");
    expect(session.hasUnpersistedChanges()).toBe(true);
    expect(session.getState()).toMatchObject({
      status: "error",
      error: { code: "persistence-failed", detail: "File changed outside PuppyOne" },
    });

    await session.requestSave();
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("turns a structured conditional-write conflict into a recoverable external conflict", async () => {
    const persist = vi.fn(async () => ({
      ok: false as const,
      kind: "conflict" as const,
      content: "agent version",
      version: "agent-v2",
    }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "human version" });

    await expect(session.requestSave()).rejects.toThrow("changed outside the editor");
    expect(session.getState()).toMatchObject({
      status: "conflict",
      error: { code: "external-conflict" },
      storageVersion: "v1",
    });
    expect(source.snapshot().content).toBe("human version");

    await session.resolveExternalConflict("reload-external");
    expect(source.snapshot().content).toBe("agent version");
    expect(session.getState()).toMatchObject({
      status: "clean",
      storageVersion: "agent-v2",
    });
  });

  it("retries an explicitly kept local snapshot against the version returned by conditional-write conflict", async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        kind: "conflict" as const,
        content: "agent version",
        version: "agent-v2",
      })
      .mockResolvedValueOnce({ ok: true as const, version: "saved-v3" });
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "human version" });

    await expect(session.requestSave()).rejects.toThrow("changed outside the editor");
    await session.resolveExternalConflict("keep-local");

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "human version",
      baseVersion: "agent-v2",
      reason: "manual",
    }));
    expect(session.getState()).toMatchObject({
      storageVersion: "saved-v3",
      error: null,
    });
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it.each([
    ["not-found", "The file was removed"],
    ["permission-denied", "The file is read-only"],
    ["io", "The disk is unavailable"],
  ] as const)(
    "keeps local content retryable after a structured %s persistence failure",
    async (kind, message) => {
      const persist = vi.fn(async () => ({ ok: false as const, kind, message }));
      const session = createSession(persist, "manual");
      const source = bindSource(session, { revision: "r1", content: "one" });
      source.change({ revision: "r2", content: "human version" });

      await expect(session.requestSave()).rejects.toThrow(message);

      expect(source.snapshot().content).toBe("human version");
      expect(session.hasUnpersistedChanges()).toBe(true);
      expect(session.getState()).toMatchObject({
        status: "error",
        error: { code: "persistence-failed", detail: message },
        storageVersion: "v1",
      });
    },
  );

  it("settles the drain when an adapter throws before returning a Promise", async () => {
    const session = createSession(() => {
      throw new Error("Desktop bridge unavailable");
    }, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });

    await expect(session.flushCurrent("document-switch"))
      .rejects.toThrow("Desktop bridge unavailable");
    expect(session.getState()).toMatchObject({
      status: "error",
      error: { code: "persistence-failed", detail: "Desktop bridge unavailable" },
    });
  });
});

function createSession(
  persist: DocumentPersistencePort["persist"],
  saveMode: "auto" | "manual" = "auto",
) {
  return new DocumentEditingSession({
    documentId: "notes.md",
    initialContent: "one",
    initialVersion: "v1",
    saveMode,
    persistence: { kind: "local-fs", storageIdentity: "test:document-session", persist },
  });
}

function bindSource(
  session: DocumentEditingSession,
  initialSnapshot: EditorSourceSnapshot,
) {
  let snapshot = initialSnapshot;
  const detach = session.attachSource({
    readSnapshot: () => snapshot,
    replaceContent: (content) => {
      snapshot = { revision: `${snapshot.revision}:external`, content };
      return snapshot;
    },
  });
  session.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
  return {
    change(nextSnapshot: EditorSourceSnapshot, dirty = true) {
      snapshot = nextSnapshot;
      session.reportRevision({
        revision: snapshot.revision,
        origin: dirty ? "local-edit" : "model-initialization",
      });
    },
    snapshot: () => snapshot,
    detach,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function nextMicrotask() {
  await Promise.resolve();
  await Promise.resolve();
}
