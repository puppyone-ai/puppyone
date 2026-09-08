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

  it("ignores an obsolete conditional-write result after a newer disk snapshot", async () => {
    const write = deferred<{ ok: false; kind: "conflict"; content: string; version: string }>();
    const session = createSession(vi.fn(() => write.promise), "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    const saved = session.requestSave();
    session.reconcileExternalBaseline("newer external", "agent-v3");
    write.resolve({ ok: false, kind: "conflict", content: "two", version: "v2" });
    await saved;
    await session.flushCurrent("document-switch");
    expect(session.getState()).toMatchObject({ status: "clean", storageVersion: "agent-v3", error: null });
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

  it("adopts disk updates over unsaved local edits without writing them back", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    expect(session.reconcileExternalBaseline("external", "external-v1")).toBe("applied");
    source.change({ revision: "r2", content: "local" });
    expect(session.reconcileExternalBaseline("agent edit", "external-v2")).toBe("applied");
    expect(source.snapshot().content).toBe("agent edit");
    expect(session.getState()).toMatchObject({ status: "clean", error: null, storageVersion: "external-v2" });
    await session.requestSave();
    expect(persist).not.toHaveBeenCalled();
  });

  it("cancels autosave before it starts when disk replaces unsaved input", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "unexpected" }));
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "unsaved input" });
    session.reconcileExternalBaseline("disk content", "disk-v2");
    await nextMicrotask();
    expect(persist).not.toHaveBeenCalled();
    expect(source.snapshot().content).toBe("disk content");
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it.each(["success", "failure"])("saves only new typing after adopting disk while an old %s is pending", async (outcome) => {
    const first = deferred<{ ok: true; version: string }>();
    const persist = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ok: true, version: "v4" });
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "old input" });
    await nextMicrotask();
    session.reconcileExternalBaseline("disk content", "disk-v3");
    source.change({ revision: "r3", content: "disk content plus new typing" });
    await nextMicrotask();
    if (outcome === "success") first.resolve({ ok: true, version: "v2" });
    else first.reject(new Error("obsolete failure"));
    await session.flushCurrent("app-close");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "disk content plus new typing", baseVersion: "disk-v3",
    }));
    expect(source.snapshot().content).toBe("disk content plus new typing");
    expect(session.getState()).toMatchObject({ storageVersion: "v4", error: null });
    expect(session.hasUnpersistedChanges()).toBe(false);
  });

  it("initializes a remounted model from adopted disk content while retiring an obsolete save", async () => {
    const write = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => write.promise);
    const session = createSession(persist);
    const first = bindSource(session, { revision: "r1", content: "one" });
    first.change({ revision: "r2", content: "discarded input" });
    await nextMicrotask();
    first.detach();
    session.reconcileExternalBaseline("disk content", "disk-v3");
    const remounted = bindSource(session, { revision: "new:r1", content: "obsolete projection" });
    expect(remounted.snapshot().content).toBe("disk content");
    write.resolve({ ok: true, version: "v2" });
    await session.flushCurrent("app-close");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ status: "clean", storageVersion: "disk-v3", error: null });
  });

  it("waits for an obsolete dispatched save to retire before completing close without writing disk back", async () => {
    const write = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => write.promise);
    const session = createSession(persist);
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "discarded input" });
    await nextMicrotask();
    session.reconcileExternalBaseline("disk content", "disk-v3");
    const closed = vi.fn();
    const closing = session.flushCurrent("app-close").then(closed);
    await nextMicrotask();
    expect(closed).not.toHaveBeenCalled();
    write.resolve({ ok: true, version: "v2" });
    await closing;
    expect(persist).toHaveBeenCalledTimes(1);
    expect(source.snapshot().content).toBe("disk content");
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

  it("cancels queued old edits and ignores a late save acknowledgement after adopting disk", async () => {
    const first = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => first.promise);
    const onPersisted = vi.fn();
    const session = new DocumentEditingSession({
      documentId: "notes.md", initialContent: "one", initialVersion: "v1", saveMode: "auto",
      persistence: { kind: "local-fs", storageIdentity: "test:late-save", persist }, onPersisted,
    });
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "two" });
    await nextMicrotask();
    source.change({ revision: "r3", content: "three" });
    await nextMicrotask();
    expect(session.reconcileExternalBaseline("agent update", "agent-v2")).toBe("applied");
    first.resolve({ ok: true, version: "v2" });
    await session.flushCurrent("document-switch");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(onPersisted).not.toHaveBeenCalled();
    expect(source.snapshot().content).toBe("agent update");
    expect(session.getState()).toMatchObject({ status: "clean", error: null, storageVersion: "agent-v2" });
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

  it("adopts the disk snapshot returned by a rejected conditional write", async () => {
    const persist = vi.fn(async () => ({
      ok: false as const, kind: "conflict" as const, content: "agent version", version: "agent-v2",
    }));
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "human version" });
    await session.requestSave();
    expect(source.snapshot().content).toBe("agent version");
    expect(session.getState()).toMatchObject({ status: "clean", storageVersion: "agent-v2", error: null });
    expect(session.hasUnpersistedChanges()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("saves new typing against the adopted disk version without replaying discarded edits", async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({ ok: false, kind: "conflict", content: "agent version", version: "agent-v2" })
      .mockResolvedValueOnce({ ok: true, version: "saved-v3" });
    const session = createSession(persist, "manual");
    const source = bindSource(session, { revision: "r1", content: "one" });
    source.change({ revision: "r2", content: "discarded human version" });
    await session.requestSave();
    source.change({ revision: "r3", content: "agent version plus new input" });
    await session.requestSave();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "agent version plus new input", baseVersion: "agent-v2", reason: "manual",
    }));
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
