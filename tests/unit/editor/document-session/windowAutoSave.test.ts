/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerActiveDocumentSession } from "../../../../src/shared-ui/editor/document-session/activeDocumentSessions";
import { DocumentEditingSession } from "../../../../src/shared-ui/editor/document-session/DocumentEditingSession";
import { AUTO_SAVE_IDLE_MS } from "../../../../src/shared-ui/editor/document-session/autoSavePolicy";
import type { DocumentPersistenceRequest } from "../../../../src/shared-ui/core/types";

describe("auto-save when the person leaves the window", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function typingSession(documentId: string, saveMode: "auto" | "manual" = "auto") {
    const persist = vi.fn(async (_request: DocumentPersistenceRequest) => ({ ok: true as const, version: "next" }));
    const session = new DocumentEditingSession({
      documentId, initialContent: "saved", initialVersion: "base", saveMode,
      persistence: { kind: "cloud", storageIdentity: `test:${documentId}`, persist },
    });
    let content = "saved";
    let revision = 0;
    session.attachSource({
      readSnapshot: () => ({ content, revision: String(revision) }),
      replaceContent: (next: string) => { content = next; return { content, revision: String(revision) }; },
    });
    const type = (next: string) => {
      content = next;
      revision += 1;
      session.reportRevision({ revision: String(revision), origin: "local-edit" });
    };
    return { session, persist, type };
  }

  it("writes every registered document's pending typing when the window loses focus", async () => {
    const first = typingSession("first.md");
    const second = typingSession("second.md");
    const idle = typingSession("idle.md");
    const stops = [first, second, idle].map(({ session }) => registerActiveDocumentSession(session));
    try {
      first.type("first draft");
      second.type("second draft");
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);

      expect(first.persist).toHaveBeenCalledWith(expect.objectContaining({ content: "first draft" }));
      expect(second.persist).toHaveBeenCalledWith(expect.objectContaining({ content: "second draft" }));
      expect(idle.persist).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_IDLE_MS * 3);
      expect(first.persist).toHaveBeenCalledTimes(1);
      expect(second.persist).toHaveBeenCalledTimes(1);
    } finally {
      stops.forEach((stop) => stop());
      [first, second, idle].forEach(({ session }) => session.dispose());
    }
  });

  it("writes pending typing when the window is hidden, but not when it becomes visible", async () => {
    const document_ = typingSession("hidden.md");
    const stop = registerActiveDocumentSession(document_.session);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      document_.type("before hide");
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(document_.persist).not.toHaveBeenCalled();

      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(document_.persist).toHaveBeenCalledWith(expect.objectContaining({ content: "before hide" }));
    } finally {
      visibility.mockRestore();
      stop();
      document_.session.dispose();
    }
  });

  it("leaves manual-save documents alone and never writes a retired session twice", async () => {
    const manual = typingSession("manual.md", "manual");
    const retired = typingSession("retired.md");
    const stopManual = registerActiveDocumentSession(manual.session);
    const stopRetired = registerActiveDocumentSession(retired.session);
    try {
      manual.type("manual draft");
      retired.type("closing draft");
      stopRetired();
      await vi.advanceTimersByTimeAsync(0);
      // Retirement drains its own final snapshot exactly once.
      expect(retired.persist).toHaveBeenCalledTimes(1);
      expect(retired.persist).toHaveBeenCalledWith(expect.objectContaining({ content: "closing draft", reason: "destroy" }));

      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_IDLE_MS);
      expect(manual.persist).not.toHaveBeenCalled();
      expect(retired.persist).toHaveBeenCalledTimes(1);
    } finally {
      stopManual();
      manual.session.dispose();
    }
  });
});
