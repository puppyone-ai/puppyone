import { describe, expect, it, vi } from "vitest";
import {
  discardActiveDocumentSessions,
  flushActiveDocumentSessions,
  hasUnsavedDocumentSessions,
  registerActiveDocumentSession,
  subscribeUnsavedDocumentSessions,
} from "../../../../src/shared-ui/editor/document-session/activeDocumentSessions";
import { DocumentEditingSession } from "../../../../src/shared-ui/editor/document-session/DocumentEditingSession";
import type { DocumentEditingSessionHandle } from "../../../../src/shared-ui/editor/document-session/types";
import type { DocumentPersistenceRequest } from "../../../../src/shared-ui/core/types";

describe("unsaved documents in a window", () => {
  function editableSession(
    persist = vi.fn(async (_request: DocumentPersistenceRequest) => ({ ok: true as const, version: "next" })),
  ) {
    const session = new DocumentEditingSession({
      documentId: "notes.md",
      initialContent: "saved",
      initialVersion: "base",
      saveMode: "manual",
      persistence: { kind: "local-fs", storageIdentity: "test", persist },
    });
    let content = "saved";
    let revision = 0;
    session.attachSource({
      readSnapshot: () => ({ content, revision: String(revision) }),
      replaceContent: (next: string) => {
        content = next;
        return { content, revision: String(revision) };
      },
    });
    const type = (next: string) => {
      content = next;
      revision += 1;
      session.reportRevision({ revision: String(revision), origin: "local-edit" });
    };
    return { session, persist, type };
  }

  it("reports when a window starts and stops holding unsaved edits", async () => {
    const { session, type } = editableSession();
    const listener = vi.fn();
    const stopListening = subscribeUnsavedDocumentSessions(listener);
    const unregister = registerActiveDocumentSession(session);

    try {
      expect(hasUnsavedDocumentSessions()).toBe(false);
      type("edited");
      expect(hasUnsavedDocumentSessions()).toBe(true);
      expect(listener).toHaveBeenLastCalledWith(true);

      await session.requestSave();
      expect(hasUnsavedDocumentSessions()).toBe(false);
      expect(listener).toHaveBeenLastCalledWith(false);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      stopListening();
      unregister();
      await Promise.resolve();
    }
  });

  it("writes nothing after a host gives up its edits", async () => {
    const { session, persist, type } = editableSession();
    const unregister = registerActiveDocumentSession(session);

    try {
      type("edited");
      discardActiveDocumentSessions();
      expect(hasUnsavedDocumentSessions()).toBe(false);

      await flushActiveDocumentSessions("app-close");
      await session.requestSave();
      type("typed while closing");
      await flushActiveDocumentSessions("app-close");

      expect(persist).not.toHaveBeenCalled();
      expect(session.hasUnpersistedChanges()).toBe(false);
    } finally {
      unregister();
      await Promise.resolve();
    }
  });

  it("still flushes edits when a host does not give them up", async () => {
    const { session, persist, type } = editableSession();
    const unregister = registerActiveDocumentSession(session);

    try {
      type("edited");
      await flushActiveDocumentSessions("app-close");
      expect(persist).toHaveBeenCalledOnce();
      expect(persist.mock.lastCall?.[0]).toMatchObject({ content: "edited" });
    } finally {
      unregister();
      await Promise.resolve();
    }
  });
});

describe("active Document Session registry", () => {
  it("drains every registered session and forgets unmounted sessions", async () => {
    const first = mockSession();
    const unmounted = mockSession();
    const unregisterFirst = registerActiveDocumentSession(first);
    const unregisterUnmounted = registerActiveDocumentSession(unmounted);
    unregisterUnmounted();
    await Promise.resolve();

    try {
      await flushActiveDocumentSessions("document-switch");
      expect(first.flushCurrent).toHaveBeenCalledWith("document-switch");
      expect(unmounted.flushCurrent).not.toHaveBeenCalled();
    } finally {
      unregisterFirst();
      await Promise.resolve();
    }
  });

  it("waits for all sessions and reports every failed drain", async () => {
    const successful = mockSession();
    const failed = mockSession(async () => {
      throw new Error("disk full");
    });
    const unregisterSuccessful = registerActiveDocumentSession(successful);
    const unregisterFailed = registerActiveDocumentSession(failed);

    try {
      await expect(flushActiveDocumentSessions()).rejects.toMatchObject({
        name: "AggregateError",
        message: "Unable to save 1 open document: disk full",
      });
      expect(successful.flushCurrent).toHaveBeenCalledOnce();
      expect(failed.flushCurrent).toHaveBeenCalledOnce();
    } finally {
      unregisterSuccessful();
      unregisterFailed();
      await Promise.resolve();
    }
  });

  it("does not retire a session during React StrictMode's cleanup/setup probe", async () => {
    const session = mockSession();
    const unregisterProbe = registerActiveDocumentSession(session);
    unregisterProbe();
    const unregisterLive = registerActiveDocumentSession(session);
    await Promise.resolve();

    expect(session.dispose).not.toHaveBeenCalled();
    await flushActiveDocumentSessions();
    expect(session.flushCurrent).toHaveBeenCalledOnce();

    unregisterLive();
    await Promise.resolve();
    expect(session.dispose).toHaveBeenCalledOnce();
    await flushActiveDocumentSessions();
    expect(session.flushCurrent).toHaveBeenCalledOnce();
  });

  it("keeps an unmounted dirty session registered until its destroy write is durable", async () => {
    const write = deferred<{ ok: true; version: string }>();
    const persist = vi.fn(() => write.promise);
    const session = new DocumentEditingSession({
      documentId: "old.md",
      initialContent: "before",
      initialVersion: "v1",
      saveMode: "auto",
      persistence: {
        kind: "local-fs",
        storageIdentity: "test:active-document-sessions",
        persist,
      },
    });
    session.attachSource({
      readSnapshot: () => ({ revision: "r2", content: "after" }),
      replaceContent: (content) => ({ revision: "external", content }),
    });
    session.reportRevision({ revision: "r2", origin: "local-edit" });
    const unregister = registerActiveDocumentSession(session);

    unregister();
    await Promise.resolve();
    let closeSettled = false;
    const closeDrain = flushActiveDocumentSessions().then(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    write.resolve({ ok: true, version: "v2" });
    await closeDrain;
    expect(closeSettled).toBe(true);
    expect(persist).toHaveBeenCalledOnce();

    await flushActiveDocumentSessions();
    expect(persist).toHaveBeenCalledOnce();
  });
});

function mockSession(
  flush: () => Promise<void> = async () => undefined,
): DocumentEditingSessionHandle {
  return {
    documentId: "notes.md",
    dispose: vi.fn(),
    flushCurrent: vi.fn(flush),
    hasUnpersistedChanges: () => false,
    subscribe: () => () => undefined,
  } as unknown as DocumentEditingSessionHandle;
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
