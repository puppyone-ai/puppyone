import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  WORKSPACE_WATCH_REARM_MIN_DELAY_MS,
  createWorkspaceWatchService,
} from "../../../../electron/main/workspace-watch-service.mjs";

function createFakeFsWatch() {
  const watchers = [];
  const fsModule = {
    promises: {
      readFile: vi.fn(async () => Buffer.from("after")),
    },
    watch(_rootPath, _options, listener) {
      const watcher = new EventEmitter();
      watcher.close = vi.fn();
      watcher._listener = listener;
      watchers.push(watcher);
      return watcher;
    },
  };
  return { fsModule, watchers };
}

function createSender(id = 1) {
  const events = [];
  return {
    events,
    sender: {
      id,
      isDestroyed: () => false,
      once: () => {},
      send: (channel, payload) => events.push({ channel, payload }),
    },
  };
}

describe("workspace content watch re-arm", () => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  afterEach(() => {
    for (const handle of timers.splice(0)) {
      realClearTimeout(handle);
    }
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    vi.restoreAllMocks();
  });

  it("detaches renderer lifecycle listeners when subscriptions stop", () => {
    const { fsModule } = createFakeFsWatch();
    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const sender = new EventEmitter();
    Object.assign(sender, {
      id: 9,
      isDestroyed: () => false,
      send: () => {},
    });

    for (let index = 0; index < 12; index += 1) {
      const subscription = service.start(sender, "/tmp");
      expect(sender.listenerCount("destroyed")).toBe(1);
      service.stop(subscription.subscriptionId);
      expect(sender.listenerCount("destroyed")).toBe(0);
    }

    service.closeAll();
  });

  it("keeps a Main-owned activity subscription alive without renderer clients", () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const listener = vi.fn();
    const stop = service.subscribeActivity("/tmp", listener);

    expect(service.getWatcherCount()).toBe(1);
    watchers[0]._listener("change", "notes/background.md");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "/tmp",
      path: "notes/background.md",
    }));

    stop();
    expect(service.getWatcherCount()).toBe(0);
    expect(watchers[0].close).toHaveBeenCalledOnce();
  });

  it("stops only subscriptions for one removed Workspace Folder", () => {
    const { fsModule } = createFakeFsWatch();
    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const first = service.start(createSender(7).sender, "/tmp/workspace-a");
    const second = service.start(createSender(7).sender, "/tmp/workspace-b");

    expect(service.getWatcherCount()).toBe(2);
    expect(service.stopForWorkspaceRoot(7, "/tmp/workspace-b")).toBe(1);
    expect(service.getWatcherCount()).toBe(1);
    expect(service.stop(first.subscriptionId)).toEqual({ ok: true });
    expect(service.stop(second.subscriptionId)).toEqual({ ok: true });
    service.closeAll();
  });

  it("re-arms after watcher error and broadcasts a recovery event", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    }) ;
    globalThis.clearTimeout = (handle) => {
      realClearTimeout(handle);
    };

    // Stub edit-review side effects by watching a temp-looking path; initialize
    // may fail harmlessly. Use a real path that exists.
    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const { events, sender } = createSender(7);
    const started = service.start(sender, "/tmp");
    expect(started.subscriptionId).toBeTruthy();
    expect(watchers).toHaveLength(1);

    watchers[0].emit("error", new Error("watch failed"));
    expect(events.some((event) => event.payload?.eventType === "error")).toBe(true);

    const rearm = queued.find((entry) => entry.ms === WORKSPACE_WATCH_REARM_MIN_DELAY_MS);
    expect(rearm).toBeTruthy();
    rearm.callback();
    expect(watchers).toHaveLength(2);
    expect(events.some((event) => event.payload?.recovered === true)).toBe(true);

    // Post-recovery change events still deliver.
    const baseline = events.length;
    watchers[1]._listener("change", "file.txt");
    const debounce = queued.find((entry) => entry.ms === 200 && entry !== rearm);
    expect(debounce).toBeTruthy();
    debounce.callback();
    expect(events.length).toBeGreaterThan(baseline);
    expect(events.at(-1)?.payload?.path).toBe("file.txt");

    service.stop(started.subscriptionId);
    service.closeAll();
  });

  it("does not report recovery when re-arming fails", () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const initialWatch = fsModule.watch;
    fsModule.watch = vi.fn((...args) => {
      if (watchers.length > 0) throw new Error("root is unavailable");
      return initialWatch(...args);
    });
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => realClearTimeout(handle);
    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const { events, sender } = createSender(9);
    service.start(sender, "/tmp");

    watchers[0].emit("error", new Error("watch failed"));
    queued.find((entry) => entry.ms === WORKSPACE_WATCH_REARM_MIN_DELAY_MS)?.callback();

    expect(events.some((event) => event.payload?.recovered === true)).toBe(false);
    expect(queued.filter((entry) => entry.ms >= WORKSPACE_WATCH_REARM_MIN_DELAY_MS)).toHaveLength(2);
    service.closeAll();
  });

  it("does not echo an internal save to its writer but still notifies other windows", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => {
      realClearTimeout(handle);
    };

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const writer = createSender(11);
    const observer = createSender(12);
    service.start(writer.sender, "/tmp");
    service.start(observer.sender, "/tmp");

    watchers[0]._listener("rename", "notes/example.md");
    expect(service.noteInternalWrite({
      rootPath: "/tmp",
      path: "notes/example.md",
      senderId: 11,
      version: fingerprint("after"),
    })).toEqual({ tracked: true });
    // Atomic replacement may emit more than one final-path event on macOS.
    watchers[0]._listener("rename", "notes/example.md");

    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();
    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    expect(writer.events).toHaveLength(0);
    expect(observer.events[0]?.payload?.path).toBe("notes/example.md");

    service.closeAll();
  });

  it("preserves every changed path coalesced in one debounce window", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => realClearTimeout(handle);

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const observer = createSender(15);
    service.start(observer.sender, "/tmp");

    watchers[0]._listener("change", "notes/first.md");
    watchers[0]._listener("change", "notes/second.md");
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    expect(observer.events[0]?.payload).toMatchObject({
      path: null,
      paths: ["notes/first.md", "notes/second.md"],
    });
    service.closeAll();
  });

  it("deduplicates repeated native events for one resource in a debounce window", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => realClearTimeout(handle);

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const observer = createSender(16);
    service.start(observer.sender, "/tmp");

    watchers[0]._listener("rename", "notes/repeated.md");
    watchers[0]._listener("change", "notes/repeated.md");
    watchers[0]._listener("rename", "notes/repeated.md");
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    expect(observer.events[0]?.payload).toMatchObject({
      path: "notes/repeated.md",
      paths: ["notes/repeated.md"],
    });
    service.closeAll();
  });

  it("uses a bulk invalidation when the native watcher cannot identify a path", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => realClearTimeout(handle);

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const observer = createSender(17);
    service.start(observer.sender, "/tmp");

    watchers[0]._listener("change", null);
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    expect(observer.events[0]?.payload?.path).toBeNull();
    expect(observer.events[0]?.payload).not.toHaveProperty("paths");
    service.closeAll();
  });

  it("filters an own-write path per sender without hiding other paths in the same batch", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => realClearTimeout(handle);

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const writer = createSender(18);
    const observer = createSender(19);
    service.start(writer.sender, "/tmp");
    service.start(observer.sender, "/tmp");
    service.noteInternalWrite({
      rootPath: "/tmp",
      path: "notes/ours.md",
      senderId: 18,
      version: fingerprint("after"),
    });

    watchers[0]._listener("rename", "notes/ours.md");
    watchers[0]._listener("change", "notes/agent.md");
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    await vi.waitFor(() => expect(writer.events).toHaveLength(1));
    expect(writer.events[0]?.payload).toMatchObject({
      path: "notes/agent.md",
      paths: ["notes/agent.md"],
    });
    expect(observer.events[0]?.payload).toMatchObject({
      path: null,
      paths: ["notes/ours.md", "notes/agent.md"],
    });
    service.closeAll();
  });

  it("correlates an internal save when fs.watch fires just after the write returns", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => {
      realClearTimeout(handle);
    };

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const writer = createSender(21);
    const observer = createSender(22);
    service.start(writer.sender, "/tmp");
    service.start(observer.sender, "/tmp");

    service.noteInternalWrite({
      rootPath: "/tmp",
      path: "notes/example.md",
      senderId: 21,
      version: fingerprint("after"),
    });
    watchers[0]._listener("rename", "notes/example.md");
    watchers[0]._listener("rename", "notes/example.md");
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(observer.events).toHaveLength(1));
    expect(writer.events).toHaveLength(0);

    service.closeAll();
  });

  it("does not suppress a newer external edit on the same path", async () => {
    const { fsModule, watchers } = createFakeFsWatch();
    fsModule.promises.readFile.mockResolvedValue(Buffer.from("agent update"));
    const queued = [];
    globalThis.setTimeout = ((callback, ms, ...args) => {
      const entry = { callback, ms, args };
      queued.push(entry);
      const handle = realSetTimeout(() => {}, 0);
      timers.push(handle);
      return handle;
    });
    globalThis.clearTimeout = (handle) => {
      realClearTimeout(handle);
    };

    const service = createWorkspaceWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
    });
    const writer = createSender(31);
    const observer = createSender(32);
    service.start(writer.sender, "/tmp");
    service.start(observer.sender, "/tmp");

    service.noteInternalWrite({
      rootPath: "/tmp",
      path: "notes/example.md",
      senderId: 31,
      version: fingerprint("our save"),
    });
    watchers[0]._listener("change", "notes/example.md");
    queued.filter((entry) => entry.ms === 200).at(-1)?.callback();

    await vi.waitFor(() => expect(writer.events).toHaveLength(1));
    expect(observer.events).toHaveLength(1);
    expect(writer.events[0]?.payload?.path).toBe("notes/example.md");

    service.closeAll();
  });
});

function fingerprint(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
