import type { AgentProjection } from "../domain/agent-projection-types";
import type {
  AgentDraftReference,
  AgentPromptReferenceMention,
  AgentLocalConnection,
  AgentRuntimeInspection,
  AgentRuntimeId,
  AgentSessionMetadata,
  AgentSessionControl,
} from "../domain/agent-contract";
import type { AgentErrorDescriptor } from "./agent-error";

export type AgentControllerPhase =
  | "idle"
  | "discovering"
  | "restoring"
  | "ready"
  | "creating"
  | "running"
  | "waiting"
  | "runtime-exited"
  | "failed";

export type AgentSessionPreparation = "idle" | "preparing" | "ready" | "failed";
export type AgentSubmissionStage = "preparing-session" | "starting-turn" | null;

export type AgentControllerState = {
  phase: AgentControllerPhase;
  inspection: AgentRuntimeInspection | null;
  session: AgentSessionMetadata | null;
  /** Main-owned business state. Renderer-only fields are derived from this checkpoint. */
  control: AgentSessionControl | null;
  replicaStatus: "detached" | "subscribing" | "live" | "stale";
  projection: AgentProjection;
  selectedRuntimeId: AgentRuntimeId | null;
  selectedProviderId: string | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedMode: string | null;
  localConnections: AgentLocalConnection[];
  localConnectionsPhase: "idle" | "loading" | "ready" | "error";
  localConnectionsScannedAt: string | null;
  localConnectionsError: AgentErrorDescriptor | null;
  draft: string;
  /** Atomic file-reference spans inside draft. Images remain media references. */
  draftMentions: AgentPromptReferenceMention[];
  /** Optimistic prompt shown while the native backend accepts the turn. */
  pendingPrompt: string | null;
  /** Immutable prompt/config/reference capture while native turn acceptance is pending. */
  pendingIntent: import("../domain/agent-contract").AgentSubmissionIntent | null;
  /** Lifecycle of the reusable native session prepared for the selected runtime. */
  sessionPreparation: AgentSessionPreparation;
  references: AgentDraftReference[];
  error: AgentErrorDescriptor | null;
  submitting: boolean;
  stopping: boolean;
  resolvingBlocker: boolean;
  initialized: boolean;
};

export const agentControllerTransitions: Readonly<Record<AgentControllerPhase, readonly AgentControllerPhase[]>> = Object.freeze({
  idle: ["discovering", "restoring", "creating", "ready", "failed"],
  discovering: ["restoring", "ready", "failed"],
  restoring: ["ready", "running", "failed", "runtime-exited"],
  ready: ["discovering", "restoring", "creating", "running", "waiting", "failed", "runtime-exited"],
  creating: ["ready", "running", "failed", "runtime-exited"],
  running: ["running", "waiting", "ready", "failed", "runtime-exited"],
  waiting: ["waiting", "running", "ready", "failed", "runtime-exited"],
  "runtime-exited": ["discovering", "restoring", "creating", "ready", "failed"],
  failed: ["discovering", "restoring", "creating", "ready", "runtime-exited"],
});

export function phaseForProjection(projection: AgentProjection, current: AgentControllerPhase): AgentControllerPhase {
  if (projection.runningTurnId) {
    return projection.approvals.length || projection.questions.length ? "waiting" : "running";
  }
  return projection.terminalState ? "ready" : current;
}
