import { listEnabledAgentRuntimes } from "../domain/agent-backend-routing";
import type {
  AgentRuntimeCatalogEntry,
  AgentSessionListItem,
  AgentSessionsListResponse,
} from "../domain/agent-contract";
import type { AgentClientPort } from "./AgentClientPort";
import { AgentKnownError } from "./agent-error";

const HISTORY_PAGE_SIZE = 20;
export const AGENT_HISTORY_CATALOG_TIMEOUT_MS = 8_000;
export const AGENT_HISTORY_RUNTIME_TIMEOUT_MS = 8_000;
export const AGENT_HISTORY_SOURCE_TIMEOUT_MS = 20_000;

type Listener = () => void;
export type AgentHistoryClientPort = Pick<AgentClientPort, "discoverAgentRuntimes" | "listAgentSessions">;
export type AgentHistoryClientProvider = () => AgentHistoryClientPort | null | undefined;
type NativeScanContinuation = Readonly<{ cursor: string; scanId: string }>;
type CursorMap = Readonly<Record<string, NativeScanContinuation>>;

export type ConversationHistoryState = Readonly<{
  sessions: readonly AgentSessionListItem[];
  runtimes: readonly AgentRuntimeCatalogEntry[];
  loading: boolean;
  loaded: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  nextCursors: CursorMap;
  sources: Readonly<Record<string, AgentSessionsListResponse["discovery"]>>;
  catalogCoverage: AgentSessionsListResponse["catalogCoverage"] | null;
  error: string | null;
}>;

const INITIAL_STATE: ConversationHistoryState = Object.freeze({
  sessions: [],
  runtimes: [],
  loading: false,
  loaded: false,
  refreshing: false,
  loadingMore: false,
  nextCursors: Object.freeze({}),
  sources: Object.freeze({}),
  catalogCoverage: null,
  error: null,
});

/** Page-scoped, query-only state owner. It never creates or resumes a live Chat session. */
export class ConversationHistoryController {
  private state = INITIAL_STATE;
  private readonly listeners = new Set<Listener>();
  private generation = 0;
  private catalogRequest = 0;
  private active = false;
  private catalogLoaded = false;
  private runtimeInspectionComplete = false;
  private autoRefreshGeneration = -1;
  private refreshPromise: Promise<void> | null = null;
  private loadMorePromise: Promise<void> | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly clientProvider: AgentHistoryClientProvider,
  ) {}

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  activate() {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    this.catalogLoaded = false;
    this.runtimeInspectionComplete = false;
    this.autoRefreshGeneration = -1;
    this.patch({ loading: true, loaded: false, error: null, nextCursors: Object.freeze({}), sources: Object.freeze({}), catalogCoverage: null });
    void this.loadInitialCatalog(generation);
    void this.inspectRuntimes(generation);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.refreshPromise = null;
    this.loadMorePromise = null;
  }

  refresh() {
    if (!this.active) return Promise.resolve();
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    const operation = this.runRefresh(generation).finally(() => {
      if (this.refreshPromise === operation) this.refreshPromise = null;
    });
    this.refreshPromise = operation;
    return operation;
  }

  loadMore() {
    if (!this.active) return Promise.resolve();
    if (this.loadMorePromise) return this.loadMorePromise;
    const generation = this.generation;
    const operation = this.runLoadMore(generation).finally(() => {
      if (this.loadMorePromise === operation) this.loadMorePromise = null;
    });
    this.loadMorePromise = operation;
    return operation;
  }

  private async loadInitialCatalog(generation: number) {
    try {
      await this.loadCatalog(generation);
    } catch (error) {
      if (this.isCurrent(generation)) this.patch({ error: messageOf(error) });
    } finally {
      if (this.isCurrent(generation)) {
        this.catalogLoaded = true;
        this.maybeAutoRefresh(generation);
      }
    }
  }

  private async inspectRuntimes(generation: number) {
    try {
      const client = this.requireClient();
      const inspection = await withDeadline(
        client.discoverAgentRuntimes({
          rootPath: this.workspaceRoot,
          refresh: false,
        }),
        AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
        "Agent runtime discovery",
      );
      if (!this.isCurrent(generation)) return;
      this.patch({ runtimes: Object.freeze(listEnabledAgentRuntimes(inspection, null)) });
    } catch (error) {
      if (this.isCurrent(generation)) this.patch({ error: this.state.error ?? messageOf(error) });
    } finally {
      if (this.isCurrent(generation)) {
        this.runtimeInspectionComplete = true;
        this.maybeAutoRefresh(generation);
      }
    }
  }

  private maybeAutoRefresh(generation: number) {
    if (!this.isCurrent(generation) || !this.catalogLoaded || !this.runtimeInspectionComplete) return;
    if (this.autoRefreshGeneration === generation) return;
    this.autoRefreshGeneration = generation;
    if (historyRuntimes(this.state.runtimes).length === 0) {
      this.finishInitialLoad(generation);
      return;
    }
    void this.refresh().finally(() => this.finishInitialLoad(generation));
  }

  private finishInitialLoad(generation: number) {
    if (this.isCurrent(generation)) this.patch({ loading: false, loaded: true });
  }

  private async runRefresh(generation: number) {
    if (this.loadMorePromise) return;
    const runtimes = historyRuntimes(this.state.runtimes);
    if (runtimes.length === 0) return;
    this.patch({ refreshing: true, error: null, nextCursors: Object.freeze({}), sources: Object.freeze({}) });
    try {
      await Promise.all(runtimes.map((runtime) => this.loadSource(generation, runtime.descriptor.id)));
    } finally {
      if (this.isCurrent(generation)) this.patch({ refreshing: false });
    }
  }

  private async runLoadMore(generation: number) {
    if (this.refreshPromise) return;
    const pending = Object.entries(this.state.nextCursors);
    if (pending.length === 0) return;
    this.patch({ loadingMore: true, error: null });
    try {
      await Promise.all(pending.map(([runtimeId, continuation]) => this.loadSource(generation, runtimeId, continuation)));
    } finally {
      if (this.isCurrent(generation)) this.patch({ loadingMore: false });
    }
  }

  private async loadSource(generation: number, runtimeId: string, continuation?: NativeScanContinuation) {
    try {
      const response = await withDeadline(this.requireClient().listAgentSessions({
        rootPath: this.workspaceRoot, runtimeId, discoverNative: true, limit: HISTORY_PAGE_SIZE,
        ...(continuation ? { cursor: continuation.cursor, scanId: continuation.scanId } : {}),
      }), AGENT_HISTORY_SOURCE_TIMEOUT_MS, `${runtimeId} history`);
      if (!this.isCurrent(generation)) return;
      if (response.discovery.runtimeId !== runtimeId) throw new Error("History response has a different Agent identity.");
      const cursors = { ...this.state.nextCursors };
      const discovery = response.discovery;
      if (discovery.nextCursor && discovery.scanId) {
        cursors[runtimeId] = { cursor: discovery.nextCursor, scanId: discovery.scanId };
      } else if (discovery.status === "failed" && discovery.retryable !== false && continuation) {
        cursors[runtimeId] = continuation;
      } else {
        delete cursors[runtimeId];
      }
      const sources = Object.freeze({ ...this.state.sources, [runtimeId]: discovery });
      // Each response contains this source's catalog. Merge it immediately,
      // without waiting for another source or for a second catalog read.
      const others = this.state.sessions.filter((entry) => (entry.runtimeId ?? entry.provider) !== runtimeId);
      const incoming = response.sessions.filter((entry) => (entry.runtimeId ?? entry.provider) === runtimeId);
      const retained = discovery.status === "failed"
        ? this.state.sessions.filter((entry) => (entry.runtimeId ?? entry.provider) === runtimeId) : [];
      const sourceSessions = [...new Map([...retained, ...incoming].map((entry) => [entry.id, entry])).values()];
      this.catalogRequest += 1;
      this.patch({ sources, nextCursors: Object.freeze(cursors),
        sessions: Object.freeze(sortSessions([...others, ...sourceSessions])),
        catalogCoverage: response.catalogCoverage ?? this.state.catalogCoverage,
        error: sourceWarnings(sources),
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const sources = Object.freeze({ ...this.state.sources, [runtimeId]: {
        runtimeId, status: "failed" as const, indexed: 0, nextCursor: continuation?.cursor ?? null,
        scanId: continuation?.scanId ?? null, retryable: true, warnings: [messageOf(error)],
      } });
      this.patch({ sources, error: sourceWarnings(sources) });
    }
  }

  private async loadCatalog(generation: number) {
    const request = ++this.catalogRequest;
    const response = await withDeadline(
      this.requireClient().listAgentSessions({
        rootPath: this.workspaceRoot,
        includeArchived: false,
        discoverNative: false,
      }),
      AGENT_HISTORY_CATALOG_TIMEOUT_MS,
      "Chat history catalog",
    );
    if (this.isCurrent(generation) && request === this.catalogRequest) this.patch({
      sessions: Object.freeze(sortSessions(response.sessions)), catalogCoverage: response.catalogCoverage ?? null,
    });
    return response;
  }

  private requireClient() {
    const client = this.clientProvider();
    if (!client) throw new AgentKnownError("native-bridge-unavailable");
    return client;
  }

  private isCurrent(generation: number) {
    return this.active && generation === this.generation;
  }

  private patch(patch: Partial<ConversationHistoryState>) {
    if (!this.active) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }
}

function historyRuntimes(runtimes: readonly AgentRuntimeCatalogEntry[]) {
  return runtimes.filter((entry) => (
    entry.readiness.status === "ready"
    && entry.descriptor.ownership?.session === "runtime"
  ));
}

function sortSessions(sessions: AgentSessionListItem[]) {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (reason) => {
        globalThis.clearTimeout(timeout);
        reject(reason);
      },
    );
  });
}

export const conversationHistoryLimits = Object.freeze({ pageSize: HISTORY_PAGE_SIZE });

function sourceWarnings(sources: Readonly<Record<string, AgentSessionsListResponse["discovery"]>>) {
  const warnings = Object.entries(sources).flatMap(([id, source]) => source.warnings.map((warning) => `${id}: ${warning}`));
  return warnings.length ? warnings.join("\n") : null;
}
