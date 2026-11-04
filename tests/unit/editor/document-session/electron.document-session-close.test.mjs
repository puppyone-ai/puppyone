import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createApplicationQuitIntent,
  createDocumentSessionCloseCoordinator,
  DOCUMENT_SESSION_CLOSE_CANCELLED_CHANNEL,
  DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL,
  DOCUMENT_SESSION_FLUSH_RESULT_CHANNEL,
} from "../../../../electron/main/document-session-close-coordinator.mjs";

describe("Electron application quit intent", () => {
  it("resumes a macOS quit after the asynchronous last-window drain", () => {
    const app = { quit: vi.fn() };
    const intent = createApplicationQuitIntent({ app, platform: "darwin" });

    intent.resumeAfterLastWindowClosed();
    expect(app.quit).not.toHaveBeenCalled();

    intent.markRequested();
    intent.resumeAfterLastWindowClosed();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("cancels quit intent when a failed document window stays open", () => {
    const app = { quit: vi.fn() };
    const intent = createApplicationQuitIntent({ app, platform: "darwin" });
    intent.markRequested();
    intent.cancel();

    intent.resumeAfterLastWindowClosed();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("retains the native non-macOS last-window quit behavior", () => {
    const app = { quit: vi.fn() };
    const intent = createApplicationQuitIntent({ app, platform: "win32" });

    intent.resumeAfterLastWindowClosed();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});

describe("Electron document close coordination", () => {
  it("keeps the window alive until the renderer drains all Document Sessions", async () => {
    const harness = createHarness();
    harness.webContents.emit("did-finish-load");

    const firstClose = harness.window.requestClose();
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    expect(harness.window.destroyed).toBe(false);
    const request = harness.webContents.sent[0];
    expect(request.channel).toBe(DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL);

    harness.reply(request.payload.requestId, { ok: true });
    await nextMicrotask();

    expect(harness.window.destroyed).toBe(true);
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("keeps the window open when persistence fails and the user declines data loss", async () => {
    const onCloseCancelled = vi.fn();
    const harness = createHarness({ dialogResponse: 0, onCloseCancelled });
    harness.webContents.emit("did-finish-load");
    harness.window.requestClose();
    const request = harness.webContents.sent[0];

    harness.reply(request.payload.requestId, { ok: false, error: "File changed outside PuppyOne" });
    await nextMicrotask();

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      harness.window,
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        detail: "Keep the window open and try again to avoid losing changes.",
      }),
    );
    expect(harness.window.destroyed).toBe(false);
    expect(onCloseCancelled).toHaveBeenCalledWith(harness.window);
    expect(harness.webContents.sent[1]).toEqual({
      channel: DOCUMENT_SESSION_CLOSE_CANCELLED_CHANNEL,
      payload: { requestId: request.payload.requestId },
    });

    // Declining the destructive choice returns the coordinator to an idle
    // state, so a later close can retry persistence.
    harness.window.requestClose();
    const flushRequests = harness.webContents.sent.filter(
      ({ channel }) => channel === DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL,
    );
    expect(flushRequests).toHaveLength(2);
    const retry = flushRequests[1];
    harness.reply(retry.payload.requestId, { ok: true });
    await nextMicrotask();
    expect(harness.window.destroyed).toBe(true);
  });

  describe("when a window asks what to do with unsaved edits", () => {
    const flushRequests = (harness) => harness.webContents.sent
      .filter(({ channel }) => channel === DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL);

    it("starts the flush immediately when there is nothing to ask", () => {
      const harness = createHarness({ resolveCloseChoice: () => "save" });
      harness.webContents.emit("did-finish-load");
      harness.window.requestClose();

      expect(flushRequests(harness)).toHaveLength(1);
      expect(flushRequests(harness)[0].payload.discard).toBeUndefined();
    });

    it("does not start the save deadline until the person has answered", async () => {
      vi.useFakeTimers();
      try {
        let answer;
        const harness = createHarness({
          timeoutMs: 1_000,
          resolveCloseChoice: () => new Promise((resolve) => { answer = resolve; }),
        });
        harness.webContents.emit("did-finish-load");
        harness.window.requestClose();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(flushRequests(harness)).toHaveLength(0);
        expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
        expect(harness.window.destroyed).toBe(false);

        answer("save");
        await vi.advanceTimersByTimeAsync(0);
        expect(flushRequests(harness)).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks the renderer to drop edits when the person chooses not to save", async () => {
      const harness = createHarness({ resolveCloseChoice: async () => "discard" });
      harness.webContents.emit("did-finish-load");
      harness.window.requestClose();
      await nextMicrotask();

      const [request] = flushRequests(harness);
      expect(request.payload.discard).toBe(true);
      harness.reply(request.payload.requestId, { ok: true });
      await nextMicrotask();
      expect(harness.window.destroyed).toBe(true);
    });

    it("keeps the window and stops a quit when the person cancels", async () => {
      const onCloseCancelled = vi.fn();
      const harness = createHarness({ resolveCloseChoice: async () => "cancel", onCloseCancelled });
      harness.webContents.emit("did-finish-load");
      harness.window.requestClose();
      await nextMicrotask();

      expect(flushRequests(harness)).toHaveLength(0);
      expect(harness.window.destroyed).toBe(false);
      expect(onCloseCancelled).toHaveBeenCalledWith(harness.window);
    });

    it("can be asked again after a cancel", async () => {
      const resolveCloseChoice = vi.fn().mockResolvedValueOnce("cancel").mockResolvedValueOnce("save");
      const harness = createHarness({ resolveCloseChoice });
      harness.webContents.emit("did-finish-load");
      harness.window.requestClose();
      await nextMicrotask();
      harness.window.requestClose();
      await nextMicrotask();

      expect(resolveCloseChoice).toHaveBeenCalledTimes(2);
      expect(flushRequests(harness)).toHaveLength(1);
    });

    it("keeps the window when asking fails", async () => {
      const harness = createHarness({ resolveCloseChoice: async () => { throw new Error("no dialog"); } });
      harness.webContents.emit("did-finish-load");
      harness.window.requestClose();
      await nextMicrotask();

      expect(harness.window.destroyed).toBe(false);
      expect(flushRequests(harness)).toHaveLength(0);
    });
  });

  it("ignores a forged acknowledgement from a different renderer", async () => {
    const harness = createHarness();
    harness.webContents.emit("did-finish-load");
    harness.window.requestClose();
    const requestId = harness.webContents.sent[0].payload.requestId;

    harness.reply(requestId, { ok: true }, { id: 999 });
    await nextMicrotask();
    expect(harness.window.destroyed).toBe(false);

    harness.reply(requestId, { ok: true });
    await nextMicrotask();
    expect(harness.window.destroyed).toBe(true);
  });

  it("supports a non-destructive durability drain for Git Auto Commit", async () => {
    const harness = createHarness();
    harness.webContents.emit("did-finish-load");

    const pending = harness.coordinator.requestFlush(harness.webContents, "git-auto-commit");
    const request = harness.webContents.sent[0];
    expect(request).toMatchObject({
      channel: DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL,
      payload: { reason: "git-auto-commit" },
    });
    harness.reply(request.payload.requestId, { ok: true });

    await expect(pending).resolves.toMatchObject({ ok: true, kind: null });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.window.destroyed).toBe(false);
  });

  it("cancels an autonomous drain when its workspace ownership is released", async () => {
    const harness = createHarness();
    harness.webContents.emit("did-finish-load");
    const controller = new AbortController();
    const pending = harness.coordinator.requestFlush(
      harness.webContents,
      "git-auto-commit",
      { signal: controller.signal },
    );

    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, kind: "cancelled" });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("blocks an autonomous drain when the renderer is unavailable or crashes", async () => {
    const unavailable = createHarness();
    await expect(unavailable.coordinator.requestFlush(
      unavailable.webContents,
      "git-auto-commit",
    )).resolves.toMatchObject({ ok: false, kind: "renderer-unavailable" });

    const crashed = createHarness();
    crashed.webContents.emit("did-finish-load");
    const pending = crashed.coordinator.requestFlush(crashed.webContents, "git-auto-commit");
    crashed.webContents.emit("render-process-gone");
    await expect(pending).resolves.toMatchObject({ ok: false, kind: "renderer-unavailable" });
    expect(crashed.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("times out an autonomous drain without presenting a destructive close dialog", async () => {
    const harness = createHarness({ timeoutMs: 5 });
    harness.webContents.emit("did-finish-load");

    await expect(harness.coordinator.requestFlush(harness.webContents, "git-auto-commit"))
      .resolves.toMatchObject({ ok: false, kind: "timeout" });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.window.destroyed).toBe(false);
  });

  it("waits for native resources after saving documents and restores editing on close failure", async () => {
    let resolveClose;
    const closeResources = vi.fn(() => new Promise((resolve) => { resolveClose = resolve; }));
    const harness = createHarness({ closeResources });
    harness.webContents.emit("did-finish-load");
    harness.window.requestClose();
    const requestId = harness.webContents.sent[0].payload.requestId;
    expect(closeResources).not.toHaveBeenCalled();
    harness.reply(requestId, { ok: true });
    await nextMicrotask();
    expect(closeResources).toHaveBeenCalledOnce();
    expect(harness.window.destroyed).toBe(false);
    resolveClose(false);
    await nextMicrotask();
    expect(harness.window.destroyed).toBe(false);
    expect(harness.webContents.sent).toContainEqual({ channel: DOCUMENT_SESSION_CLOSE_CANCELLED_CHANNEL, payload: { requestId } });
    closeResources.mockResolvedValue(true);
    harness.window.requestClose();
    harness.reply(harness.webContents.sent.at(-1).payload.requestId, { ok: true });
    await nextMicrotask();
    expect(harness.window.destroyed).toBe(true);
  });

  it("does not begin resource shutdown when saving is cancelled", async () => {
    const closeResources = vi.fn();
    const harness = createHarness({ closeResources });
    harness.webContents.emit("did-finish-load");
    harness.window.requestClose();
    harness.reply(harness.webContents.sent[0].payload.requestId, { ok: false, error: "save failed" });
    await nextMicrotask();
    expect(closeResources).not.toHaveBeenCalled();
    expect(harness.window.destroyed).toBe(false);
  });

  it("drains resources before closing an unready window without touching destroyed properties", async () => {
    const harness = createHarness();
    let event;

    expect(() => {
      event = harness.window.requestClose();
    }).not.toThrow();

    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.window.destroyed).toBe(true));
    expect(harness.window.destroyed).toBe(true);
    expect(harness.webContents.sent).toHaveLength(0);
    expect(() => harness.window.webContents).toThrow("Object has been destroyed");
  });
});

function createHarness({
  dialogResponse = 0,
  onCloseCancelled = () => undefined,
  timeoutMs = 1_000,
  closeResources = async () => true,
  resolveCloseChoice,
} = {}) {
  let resultListener = null;
  const trustedIpc = {
    on: vi.fn((channel, listener) => {
      expect(channel).toBe(DOCUMENT_SESSION_FLUSH_RESULT_CHANNEL);
      resultListener = listener;
    }),
  };
  const dialog = {
    showMessageBox: vi.fn(async () => ({ response: dialogResponse })),
  };
  const coordinator = createDocumentSessionCloseCoordinator({
    dialog,
    timeoutMs,
    logger: { error: vi.fn() },
    onCloseCancelled,
    closeResources,
    ...(resolveCloseChoice ? { resolveCloseChoice } : {}),
  });
  coordinator.registerIpc(trustedIpc);
  const window = new FakeWindow();
  const webContents = window.webContents;
  coordinator.attachWindow(window);

  return {
    coordinator,
    dialog,
    webContents,
    window,
    reply(requestId, payload, sender = webContents) {
      resultListener({ sender }, { requestId, ...payload });
    },
  };
}

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.attachedWebContents = new FakeWebContents();
  }

  get webContents() {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.attachedWebContents;
  }

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    return this.requestClose();
  }

  requestClose() {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
    if (event.preventDefault.mock.calls.length === 0) {
      this.destroyed = true;
      this.attachedWebContents.destroyed = true;
      this.emit("closed");
    }
    return event;
  }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = 42;
    this.destroyed = false;
    this.sent = [];
  }

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
}

async function nextMicrotask() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
