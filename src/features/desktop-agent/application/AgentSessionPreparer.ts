import type { AgentSessionSnapshot } from "../domain/agent-contract";
import type { AgentControllerState } from "./agent-controller-state";
import { formatAgentError } from "./agent-error";
import type { AgentClientProvider } from "./AgentClientPort";

type AgentSessionPreparerOptions = {
  workspaceRoot: string;
  bridgeProvider: AgentClientProvider;
  readState: () => AgentControllerState;
  patch: (patch: Partial<AgentControllerState>) => void;
  createSession: () => Promise<AgentSessionSnapshot>;
  applySnapshot: (snapshot: AgentSessionSnapshot) => Promise<void>;
};

/** Owns concurrency and stale-result cleanup for reusable native-session preparation. */
export class AgentSessionPreparer {
  private preparationPromise: Promise<boolean> | null = null;
  private epoch = 0;
  private disposed = false;

  constructor(private readonly options: AgentSessionPreparerOptions) {}

  prepare() {
    const state = this.options.readState();
    if (this.disposed) return Promise.resolve(false);
    if (state.session) {
      if (state.sessionPreparation !== "ready") this.options.patch({ sessionPreparation: "ready" });
      return Promise.resolve(true);
    }
    if (this.preparationPromise) return this.preparationPromise;
    if (!canPrepareSession(state)) return Promise.resolve(false);

    const epoch = ++this.epoch;
    const selection = sessionSelection(state);
    const preparation = Promise.resolve().then(async () => {
      try {
        const snapshot = await this.options.createSession();
        if (!this.isCurrent(epoch, selection)) {
          await this.closeStale(snapshot);
          return false;
        }
        await this.options.applySnapshot(snapshot);
        return true;
      } catch (error) {
        if (this.isCurrent(epoch, selection)) {
          this.options.patch({
            sessionPreparation: "failed",
            error: formatAgentError(error),
          });
        }
        return false;
      }
    }).finally(() => {
      if (this.preparationPromise !== preparation) return;
      this.preparationPromise = null;
      const latest = this.options.readState();
      if (!this.disposed && latest.sessionPreparation === "idle" && canPrepareSession(latest)) {
        void this.prepare();
      }
    });
    this.preparationPromise = preparation;
    this.options.patch({ sessionPreparation: "preparing", error: null });
    return preparation;
  }

  /** Invalidates only an in-flight prewarm; the stale native session is closed on arrival. */
  invalidateSelection() {
    if (this.disposed || !this.preparationPromise || this.options.readState().session) return false;
    this.epoch += 1;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
  }

  private isCurrent(epoch: number, selection: string) {
    const state = this.options.readState();
    return !this.disposed
      && epoch === this.epoch
      && selection === sessionSelection(state)
      && !state.session;
  }

  private async closeStale(snapshot: AgentSessionSnapshot) {
    const bridge = this.options.bridgeProvider();
    if (!bridge?.closeAgentSession) return;
    try {
      await bridge.closeAgentSession({
        rootPath: this.options.workspaceRoot,
        sessionId: snapshot.session.id,
        removePersistence: true,
      });
    } catch {
      // A stale renderer must never publish state; native shutdown is best effort.
    }
  }
}

function canPrepareSession(state: AgentControllerState) {
  if (!state.initialized || state.session || state.projection.runningTurnId) return false;
  if (state.phase !== "ready" || state.inspection?.readiness?.status !== "ready") return false;
  if (!state.selectedRuntimeId) return false;
  return !state.inspection.capabilities?.modelSelection || Boolean(state.selectedModel);
}

function sessionSelection(state: AgentControllerState) {
  return [state.selectedRuntimeId, state.selectedModel, state.selectedEffort, state.selectedMode].join("\u0000");
}
