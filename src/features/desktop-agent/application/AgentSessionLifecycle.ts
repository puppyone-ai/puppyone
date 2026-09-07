import { createEmptyAgentDisplay as createAgentProjection } from "../../../../shared/agent-contract/display-state.mjs";
import type { AgentSessionSnapshot } from "../domain/agent-contract";
import type { AgentClientPort, AgentClientProvider } from "./AgentClientPort";
import type { AgentControllerState } from "./agent-controller-state";
import { AgentKnownError, createAgentError, formatAgentError } from "./agent-error";

type StatePatch = (patch: Partial<AgentControllerState>) => void;

type AgentSessionLifecycleOptions = {
  workspaceRoot: string;
  bridgeProvider: AgentClientProvider;
  readState: () => AgentControllerState;
  patch: StatePatch;
  createSession: () => Promise<AgentSessionSnapshot>;
  applySnapshot: (snapshot: AgentSessionSnapshot) => Promise<void>;
  deleteSessionUi: (sessionId: string) => void;
};

/** Owns one tab's live connection; durable locator indexing remains main-owned. */
export class AgentSessionLifecycle {
  constructor(private readonly options: AgentSessionLifecycleOptions) {}

  async newSession() {
    const state = this.options.readState();
    if (state.projection.runningTurnId) {
      this.options.patch({ error: createAgentError("active-turn") });
      return;
    }
    const previousSessionId = state.session?.id ?? null;
    try {
      await this.closeActiveSession(false);
      if (previousSessionId) this.options.deleteSessionUi(previousSessionId);
      this.options.patch({
        phase: "creating",
        session: null,
        projection: createAgentProjection(),
        error: null,
        pendingPrompt: null,
        pendingIntent: null,
        sessionPreparation: "preparing",
        submitting: false,
        references: [],
        draftMentions: [],
      });
      const snapshot = await this.options.createSession();
      await this.options.applySnapshot(snapshot);
      this.options.patch({ phase: "ready" });
    } catch (error) {
      this.options.patch({
        phase: "failed",
        error: formatAgentError(error),
        sessionPreparation: "failed",
      });
    }
  }

  async compactSession() {
    const sessionId = this.options.readState().session?.id;
    if (!sessionId) return;
    try {
      await this.requireBridge("compactAgentSession").compactAgentSession({
        rootPath: this.options.workspaceRoot,
        sessionId,
      });
    } catch (error) {
      this.options.patch({ error: formatAgentError(error) });
    }
  }

  async closeSession() {
    if (this.options.readState().projection.runningTurnId) {
      this.options.patch({ error: createAgentError("active-turn") });
      return false;
    }
    try {
      await this.closeActiveSession(false);
      return true;
    } catch (error) {
      this.options.patch({ error: formatAgentError(error) });
      return false;
    }
  }

  /**
   * Releases a native session created while Workbench topology was only
   * reserved. No committed tab owns this resource, so active-turn close
   * policy does not apply to rollback.
   */
  async rollbackPreparation() {
    await this.closeActiveSession(false);
  }

  private async closeActiveSession(removePersistence: boolean) {
    const session = this.options.readState().session;
    const sessionId = session?.id;
    const bridge = this.options.bridgeProvider();
    if (!sessionId || !bridge?.closeAgentSession) return;
    await bridge.closeAgentSession({ rootPath: this.options.workspaceRoot, sessionId, ...(session?.instanceId ? { instanceId: session.instanceId } : {}), removePersistence });
  }

  private requireBridge<K extends keyof AgentClientPort>(...methods: K[]): AgentClientPort {
    const bridge = this.options.bridgeProvider();
    if (!bridge || methods.some((method) => typeof bridge[method] !== "function")) {
      throw new AgentKnownError("native-bridge-unavailable");
    }
    return bridge;
  }
}
