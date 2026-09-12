import { describe, expect, it, vi } from "vitest";
import {
  flushActiveDocumentSessions,
  registerActiveDocumentSession,
} from "../../../../packages/shared-ui/src/editor/document-session/activeDocumentSessions";
import { DocumentEditingSession } from "../../../../packages/shared-ui/src/editor/document-session/DocumentEditingSession";
import type { DocumentEditingSessionHandle } from "../../../../packages/shared-ui/src/editor/document-session/types";

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
