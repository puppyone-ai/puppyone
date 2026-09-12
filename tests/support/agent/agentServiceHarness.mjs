import { AgentSessionActor } from "../../../electron/main/agent/domain/agent-session-actor.mjs";
import { vi } from "vitest";
import { createAgentService } from "../../../electron/main/agent/agent-service.mjs";
import { createCodexRuntimeDefinition } from "../../../electron/main/agent/runtimes/codex/codex-runtime-definition.mjs";
import { AgentRuntimeRegistry } from "../../../electron/main/agent/runtime/agent-runtime-registry.mjs";

export function createServiceHarness({
  capabilities = { manualApprovals: true },
  attachmentStore = null,
  resumeSessionError = null,
  nativeSessions = [],
  resumeEvents = [],
  historicalEvents = [],
} = {}) {
  const adapters = [];
  const persisted = new Map();
  const runtimeRegistry = new AgentRuntimeRegistry([createCodexRuntimeDefinition({
    appVersion: "test",
    discovery: {
      discover: vi.fn(async () => ({
        provider: "codex",
        status: "ready",
        code: "READY",
        version: "0.144.1",
        minimumVersion: "0.144.1",
        executablePath: "/usr/local/bin/codex",
        environment: {},
        message: "ready",
        selectable: true,
      })),
    },
    adapterFactory: (options) => {
      const adapter = createFakeAdapter(
        options,
        capabilities,
        resumeSessionError,
        nativeSessions,
        resumeEvents,
        historicalEvents,
      );
      adapters.push(adapter);
      return adapter;
    },
  })]);
  const persistence = {
    findLatest: vi.fn(async (root) => Array.from(persisted.values()).find((entry) => (
      entry.workspaceRoot === root && entry.availability === "available"
    )) ?? null),
    findById: vi.fn(async (id, root) => {
      const entry = persisted.get(id);
      return entry?.workspaceRoot === root ? entry : null;
    }),
    list: vi.fn(async (root) => Array.from(persisted.values()).filter((entry) => (
      entry.workspaceRoot === root && entry.availability === "available"
    ))),
    save: vi.fn(async (entry, options = {}) => persisted.set(entry.sessionId, {
      ...entry,
      ...(options.promoteCatalog ? { availability: "available" } : {}),
    })),
    upsertNative: vi.fn(async (entry) => {
      const existing = Array.from(persisted.values()).find((candidate) => (
        candidate.workspaceRoot === entry.workspaceRoot
        && candidate.runtimeId === entry.runtimeId
        && candidate.providerSessionId === entry.providerSessionId
      ));
      const saved = {
        ...entry,
        sessionId: existing?.sessionId ?? `discovered-${persisted.size + 1}`,
        origin: "native-discovery",
        availability: "available",
      };
      persisted.set(saved.sessionId, saved);
      return saved;
    }),
    reconcileNative: vi.fn(async ({ workspaceRoot, runtimeId, providerSessionIds }) => {
      const seen = new Set(providerSessionIds);
      const unavailableSessionIds = [];
      for (const [sessionId, entry] of persisted) {
        if (entry.workspaceRoot === workspaceRoot && entry.runtimeId === runtimeId && !seen.has(entry.providerSessionId)) {
          persisted.set(sessionId, { ...entry, availability: "unavailable" });
          unavailableSessionIds.push(sessionId);
        }
      }
      return { unavailableSessionIds };
    }),
    markUnavailable: vi.fn(async (id) => {
      const entry = persisted.get(id);
      if (!entry) return false;
      persisted.set(id, { ...entry, availability: "unavailable" });
      return true;
    }),
    archive: vi.fn(async () => undefined),
    remove: vi.fn(async (id) => persisted.delete(id)),
  };
  const service = createAgentService({
    runtimeRegistry,
    persistence,
    conversationCatalog: {
      list: persistence.list,
      getRevision: async () => 0,
      getCoverage: async () => ({ truncated: false, capacity: 500, retained: persisted.size }),
      applyNativePage: async ({ entries, scope, reconcileMissing, guard }) => {
        guard();
        await Promise.all(entries.map((entry) => persistence.upsertNative(entry)));
        if (reconcileMissing) await persistence.reconcileNative(scope);
        return { indexed: entries.length, truncated: false };
      },
    },
    logger: { warn: vi.fn() },
    attachmentStore,
  });
  return { service, adapters, persistence, runtimeRegistry };
}

export function createSender(id) {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

export function ipcSnapshot() {
  const actor = new AgentSessionActor();
  return {
    ...actor.snapshot(),
    session: {
      id: "session-1",
      runtimeId: "codex",
      provider: "codex",
      providerSessionId: "thread-1",
      workspaceRoot: "/canonical/workspace",
      title: "Session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      terminalState: "idle",
      selectedModel: null,
      activeTurnId: null,
      lastSequence: 0,
    },
    account: null,
    models: [],
    capabilities: null,
    events: [],
    partial: false,
    firstAvailableSequence: 0,
    lastSequence: 0,
  };
}

export function semanticReferenceCapabilities() {
  return {
    schemaVersion: 1,
    workspace: { files: true, directories: true },
    attachments: {
      image: { accepted: true, mimeTypes: ["image/png"] },
      text: { accepted: false },
      audio: { accepted: false },
      video: { accepted: false },
      binary: { accepted: false },
    },
    limits: {
      maxCount: 32,
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    },
    steer: false,
    attachmentOnly: false,
  };
}

function createFakeAdapter(
  options,
  capabilities,
  resumeSessionError = null,
  nativeSessions = [],
  resumeEvents = [],
  historicalEvents = [],
) {
  const adapter = {
    disposed: false,
    inspect: vi.fn(async () => ({
      account: { account: { type: "chatgpt", email: "user@example.com", planType: "plus" }, requiresOpenaiAuth: true },
      models: [{ id: "gpt-5", model: "gpt-5", displayName: "GPT-5", isDefault: true }],
      capabilities,
      warnings: [],
    })),
    createSession: vi.fn(async () => ({
      providerSessionId: "thread-1",
      title: "Test session",
      model: "gpt-5",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    resumeSession: vi.fn(async ({ threadId }) => {
      if (resumeSessionError) throw resumeSessionError;
      for (const event of resumeEvents) options.onEvent(event);
      return {
        providerSessionId: threadId,
        title: "Test session",
        model: "gpt-5",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
    readHistory: vi.fn(async () => historicalEvents),
    discoverSessions: vi.fn(async () => ({ supported: true, sessions: nativeSessions, nextCursor: null })),
    startTurn: vi.fn(async () => {
      options.onEvent({
        type: "turn.started",
        providerSessionId: "thread-1",
        turnId: "turn-1",
        payload: { status: "running" },
      });
      return { turnId: "turn-1" };
    }),
    referenceMentionDelivery: vi.fn(() => "path"),
    steerTurn: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    resolveApproval: vi.fn(),
    dispose: vi.fn(function dispose() { this.disposed = true; }),
    emit: options.onEvent,
    exit: options.onExit,
    confirmPersistence: (id = "thread-1") => options.onSessionPersisted({ providerSessionId: id, sourceScopeId: "default" }),
  };
  adapter.getSessionHistoryPort = () => ({
    discover: (request) => adapter.discoverSessions(request),
    sourceScopeId: "default",
    hydrate: async () => ({ events: await adapter.readHistory(), coverage: "unknown", providerSessionId: adapter.resumeSession.mock.calls.at(-1)?.[0].threadId ?? "thread-1" }),
  });
  adapter.disposeNative = adapter.dispose;
  return adapter;
}
