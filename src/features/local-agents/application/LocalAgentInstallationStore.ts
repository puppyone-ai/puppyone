import type { LocalAgentInstallationProgressEvent, LocalAgentInstallationSnapshot } from "../../../../shared/local-agent-installation/types";
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
  refreshing: boolean;
  progress: LocalAgentInstallationProgressEvent | null;
};

const INITIAL_STATE: LocalAgentInstallationStoreSnapshot = Object.freeze({
  ids: [],
  phase: "idle",
  snapshot: null,
  hasFailures: false,
  refreshing: false,
  progress: null,
});

let nextRequestId = 0;

export class LocalAgentInstallationStore {
  private state: LocalAgentInstallationStoreSnapshot = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private disposed = false;
  private requestGeneration = 0;
  private activeRequestId: string | null = null;
  private observedGeneration = 0;
  private observedScanId: string | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeChanges: (() => void) | null = null;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.state;

  /** Window-scoped cache, not a view lifecycle. Closing a view does not cancel
   * the first scan or stop receiving another window's explicit refresh. */
  ensureLoaded = () => {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    this.unsubscribeProgress = subscribeToLocalAgentInstallationProgress(this.handleProgress);
    this.unsubscribeChanges = subscribeToLocalAgentInstallationChanges(this.handleChanged);
    void this.discover(false);
  };

  dispose = () => {
    this.disposed = true;
    this.unsubscribeProgress?.();
    this.unsubscribeChanges?.();
    this.unsubscribeProgress = null;
    this.unsubscribeChanges = null;
    this.requestGeneration += 1;
    this.activeRequestId = null;
  };

  refresh = () => this.discover(true);

  private discover = async (refresh: boolean) => {
    if (this.disposed) return;
    const generation = ++this.requestGeneration;
    const requestId = `local-agent-installation:${++nextRequestId}`;
    this.activeRequestId = requestId;
    this.patch({ phase: "loading", progress: null, hasFailures: false, refreshing: this.state.snapshot !== null });
    try {
      const snapshot = normalizeLocalAgentInstallationSnapshot(
        await discoverLocalAgentInstallations(refresh, requestId),
      );
      if (generation !== this.requestGeneration) return;
      this.activeRequestId = null;
      if (this.acceptScan(snapshot)) this.applySnapshot(snapshot, "ready");
      else this.patch({ phase: this.state.snapshot ? "ready" : "error", progress: null, refreshing: false });
    } catch {
      if (generation !== this.requestGeneration) return;
      this.activeRequestId = null;
      this.patch({ phase: "error", progress: null, refreshing: false });
    }
  };

  private handleProgress = (value: unknown) => {
    if (this.disposed) return;
    try {
      const progress = normalizeLocalAgentInstallationProgress(value);
      if (progress.requestId !== this.activeRequestId) return;
      if (this.state.snapshot && progress.generation <= this.state.snapshot.generation) return;
      const previous = this.state.progress;
      if (previous?.generation === progress.generation
        && (progress.completedAgentCount <= previous.completedAgentCount
          || progress.totalAgentCount !== previous.totalAgentCount)) return;
      if (!this.acceptScan(progress)) return;
      this.patch({
        ids: normalizeAvailableLocalAgentIds([...this.state.ids, ...progress.availableAgentIds]),
        phase: "loading",
        hasFailures: progress.results.some(({ status, reasonCode }) => status === "failed" || reasonCode === "environment-unavailable"),
        progress,
      });
    } catch {
      // Progress is advisory; the final invoke result remains authoritative.
    }
  };

  private handleChanged = (value: unknown) => {
    if (this.disposed) return;
    try {
      const snapshot = normalizeLocalAgentInstallationSnapshot(value);
      if (!this.acceptScan(snapshot)) return;
      this.applySnapshot(snapshot, this.activeRequestId ? "loading" : "ready");
    } catch {
      // Ignore malformed cross-window notifications.
    }
  };

  private acceptScan(scan: { generation: number; scanId: string }) {
    if (scan.generation < this.observedGeneration
      || (scan.generation === this.observedGeneration && scan.scanId !== this.observedScanId)) return false;
    this.observedGeneration = scan.generation;
    this.observedScanId = scan.scanId;
    return true;
  }

  private applySnapshot(snapshot: LocalAgentInstallationSnapshot, phase: LocalAgentInstallationDiscoveryPhase) {
    this.replace({
      ids: normalizeAvailableLocalAgentIds([...snapshot.availableAgentIds, ...(snapshot.retainedAgentIds ?? [])]),
      phase,
      snapshot,
      hasFailures: snapshot.results.some(({ status, reasonCode }) => status === "failed" || reasonCode === "environment-unavailable"),
      progress: null,
      refreshing: phase === "loading" && this.state.refreshing,
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
