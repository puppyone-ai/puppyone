import type { LocalAgentInstallationSnapshot } from "../../../../shared/local-agent-installation/types";
import {
  discoverLocalAgentInstallations,
  subscribeToLocalAgentInstallationChanges,
  subscribeToLocalAgentInstallationProgress,
} from "../infrastructure/electron/localAgentInstallationClient";
import {
  normalizeAvailableLocalAgentIds,
  normalizeLocalAgentInstallationProgress,
  normalizeLocalAgentInstallationSnapshot,
  type LocalAgentInstallationDiscoveryPhase,
} from "../model/localAgentInstallationAvailability";

export type LocalAgentInstallationStoreSnapshot = {
  ids: LocalAgentInstallationSnapshot["availableAgentIds"];
  phase: LocalAgentInstallationDiscoveryPhase;
  snapshot: LocalAgentInstallationSnapshot | null;
  hasFailures: boolean;
};

const INITIAL_STATE: LocalAgentInstallationStoreSnapshot = Object.freeze({
  ids: [],
  phase: "idle",
  snapshot: null,
  hasFailures: false,
});

let nextRequestId = 0;

export class LocalAgentInstallationStore {
  private state: LocalAgentInstallationStoreSnapshot = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private activeConsumers = 0;
  private requestGeneration = 0;
  private activeRequestId: string | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeChanges: (() => void) | null = null;
  private lastLifecycleRefreshAt = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.state;

  activate = () => {
    this.activeConsumers += 1;
    if (this.activeConsumers === 1) {
      this.unsubscribeProgress = subscribeToLocalAgentInstallationProgress(this.handleProgress);
      this.unsubscribeChanges = subscribeToLocalAgentInstallationChanges(this.handleChanged);
      window.addEventListener("focus", this.handleLifecycleRefresh);
      document.addEventListener("visibilitychange", this.handleLifecycleRefresh);
      void this.discover(this.state.snapshot !== null);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeConsumers = Math.max(0, this.activeConsumers - 1);
      if (this.activeConsumers === 0) {
        this.unsubscribeProgress?.();
        this.unsubscribeChanges?.();
        this.unsubscribeProgress = null;
        this.unsubscribeChanges = null;
        window.removeEventListener("focus", this.handleLifecycleRefresh);
        document.removeEventListener("visibilitychange", this.handleLifecycleRefresh);
        this.requestGeneration += 1;
        this.activeRequestId = null;
      }
    };
  };

  refresh = () => this.discover(true);

  private discover = async (refresh: boolean) => {
    const generation = ++this.requestGeneration;
    const requestId = `local-agent-installation:${++nextRequestId}`;
    this.activeRequestId = requestId;
    this.patch({ phase: "loading" });
    try {
      const snapshot = normalizeLocalAgentInstallationSnapshot(
        await discoverLocalAgentInstallations(refresh, requestId),
      );
      if (generation !== this.requestGeneration) return;
      this.activeRequestId = null;
      this.applySnapshot(snapshot, "ready");
    } catch {
      if (generation !== this.requestGeneration) return;
      this.activeRequestId = null;
      this.patch({ phase: "error" });
    }
  };

  private handleProgress = (value: unknown) => {
    try {
      const progress = normalizeLocalAgentInstallationProgress(value);
      if (progress.requestId !== this.activeRequestId) return;
      this.patch({
        ids: normalizeAvailableLocalAgentIds([...this.state.ids, ...progress.availableAgentIds]),
        phase: "loading",
        hasFailures: progress.results.some(({ status }) => status === "failed") || this.state.hasFailures,
      });
    } catch {
      // Progress is advisory; the final invoke result remains authoritative.
    }
  };

  private handleChanged = (value: unknown) => {
    try {
      const snapshot = normalizeLocalAgentInstallationSnapshot(value);
      if (this.state.snapshot && snapshot.generation < this.state.snapshot.generation) return;
      this.applySnapshot(snapshot, this.activeRequestId ? "loading" : "ready");
    } catch {
      // Ignore malformed cross-window notifications.
    }
  };

  private handleLifecycleRefresh = () => {
    if (this.activeConsumers === 0 || document.visibilityState === "hidden" || this.state.phase === "loading") return;
    const now = Date.now();
    if (now - this.lastLifecycleRefreshAt < 1_000) return;
    this.lastLifecycleRefreshAt = now;
    void this.discover(true);
  };

  private applySnapshot(snapshot: LocalAgentInstallationSnapshot, phase: LocalAgentInstallationDiscoveryPhase) {
    const failedIds = new Set(
      snapshot.results.filter(({ status }) => status === "failed").map(({ agentId }) => agentId),
    );
    const retainedIds = this.state.ids.filter((agentId) => failedIds.has(agentId));
    this.replace({
      ids: normalizeAvailableLocalAgentIds([...snapshot.availableAgentIds, ...retainedIds]),
      phase,
      snapshot,
      hasFailures: snapshot.results.some(({ status }) => status === "failed"),
    });
  }

  private patch(patch: Partial<LocalAgentInstallationStoreSnapshot>) {
    this.replace({ ...this.state, ...patch });
  }

  private replace(next: LocalAgentInstallationStoreSnapshot) {
    this.state = Object.freeze(next);
    for (const listener of this.listeners) listener();
  }
}
