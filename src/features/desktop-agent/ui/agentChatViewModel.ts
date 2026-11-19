import type { MessageFormatter } from "@puppyone/localization/core";
import type { AgentControllerState, AgentSubmissionStage } from "../application/agent-controller-state";
import type { AgentErrorDescriptor } from "../application/agent-error";
import { listAgentRuntimes, listVisibleAgentRuntimes } from "../domain/agent-backend-routing";
import { activeAgentDegradedRecovery } from "../domain/agent-degraded-recovery";
import { deriveAgentSessionControls } from "../domain/agent-session-controls";
import { agentHistoryNotice } from "./agent-history-presentation";
import { readinessStatusCode, sessionStatusCode } from "./agentPanelPresentation";

export type AgentChatViewOptions = {
  presented: boolean;
  pendingConnectionModel: string | null;
  computeReady: boolean;
  computeAccessRequired: string | null;
  preferencesReady: boolean;
};

/** Runtime inventory is also the input to the existing routing-preference hook. */
export function deriveAgentChatRuntime(state: AgentControllerState, hiddenRuntimeIds: readonly string[], t: MessageFormatter) {
  const { inspection } = state;
  const runtime = state.session?.runtime || inspection?.runtime
    || inspection?.runtimes?.find((entry) => entry.descriptor.id === state.selectedRuntimeId)?.descriptor;
  // A direct recipe remains bound even when its runtime needs setup. Only the
  // chooser filters not-installed runtimes from subsequent selection.
  const agentRuntimeSelected = listAgentRuntimes(inspection).some((entry) => (
    entry.descriptor.id === state.selectedRuntimeId
    && (Boolean(state.session) || !hiddenRuntimeIds.includes(entry.descriptor.id))
  ));
  let runtimeIconKey: string | null = null;
  if (state.selectedRuntimeId) runtimeIconKey = runtime?.iconKey || state.selectedRuntimeId;
  return {
    agentRuntimeSelected,
    agentRuntimes: listVisibleAgentRuntimes(inspection, hiddenRuntimeIds),
    runtimeLabel: runtime?.displayName || t("agent.name"),
    runtimeIconKey,
    runtimeModels: agentRuntimeSelected ? inspection?.models ?? [] : [],
  };
}
type RuntimeView = ReturnType<typeof deriveAgentChatRuntime>;

/** All admission and display policy is derived from the same immutable snapshot. */
export function deriveAgentChatViewModel(state: AgentControllerState, runtime: RuntimeView, options: AgentChatViewOptions, t: MessageFormatter) {
  const activity = deriveActivity(state, options.presented);
  const readiness = state.inspection?.readiness;
  const capabilities = state.inspection?.capabilities;
  const unavailable = Boolean(readiness && readiness.status !== "ready");
  const computeOnboarding = isComputeOnboarding(state, activity);
  const routingReady = isRoutingReady(state, runtime, options);
  const canRequestComputeAccess = canRequestAccess(state, runtime, options, { unavailable, computeOnboarding, failed: activity.failed });
  const hasStatus = hasPanelStatus(state, unavailable, computeOnboarding, activity.failed);
  const degradedRecovery = activeAgentDegradedRecovery(state.projection);
  const policy = { ...activity, unavailable, computeOnboarding, routingReady, canRequestComputeAccess, hasStatus };
  return {
    ...runtime, ...policy,
    readiness: readiness ?? undefined,
    referenceCapabilities: deriveReferenceCapabilities(state),
    degradedRecovery,
    presentation: derivePresentation(state, runtime, Boolean(degradedRecovery), t),
    composerPlaceholder: composerPlaceholder(state, runtime, policy, t),
    composerDisabled: composerDisabled(state, policy),
    showReadyEmptyState: showReadyEmptyState(state, policy),
    showRuntimeLauncher: state.initialized && Boolean(state.inspection) && !runtime.agentRuntimeSelected && !activity.loading && !activity.failed,
    showStatus: Boolean(hasStatus || state.stopRequest),
    panelError: panelError(state, runtime.runtimeLabel),
    modelConnections: Boolean(capabilities?.modelConnections),
    readOnly: Boolean(capabilities?.readOnly),
    ...deriveComposerConfiguration(state),
    ...derivePendingTranscript(state),
    approval: state.projection.approvals[0],
    approvalResolving: replyInFlight(state.projection.approvals[0]?.replyStatus),
    question: state.projection.questions[0],
    questionResolving: replyInFlight(state.projection.questions[0]?.replyStatus),
  };
}

function deriveActivity(state: AgentControllerState, presented: boolean) {
  const loading = ["discovering", "restoring", "creating"].includes(state.phase);
  const failed = ["failed", "runtime-exited"].includes(state.phase);
  const hasCommittedTranscript = [state.projection.rows, state.projection.parts, state.projection.messages, state.projection.activities]
    .some((entries) => entries.length > 0);
  const submissionPending = state.submitting || Boolean(state.pendingPrompt);
  const running = Boolean(state.projection.runningTurnId);
  return {
    loading, failed, hasCommittedTranscript, submissionPending, running,
    startupLoading: presented && (!state.initialized || loading) && !state.pendingPrompt && !hasCommittedTranscript,
    configurationDisabled: loading || submissionPending,
    computeDisabled: loading || submissionPending || running,
    working: state.submitting || running,
    submissionStage: submissionStage(state, submissionPending),
  };
}

function submissionStage(state: AgentControllerState, pending: boolean): AgentSubmissionStage {
  if (!pending || state.projection.runningTurnId) return null;
  // Main admission replaces the preview before the native turn starts. Keep
  // feedback for attachment-only inputs; preview text is not a lifecycle signal.
  if (!state.session || state.sessionPreparation === "preparing") return "preparing-session";
  return "starting-turn";
}

function isComputeOnboarding(state: AgentControllerState, activity: ReturnType<typeof deriveActivity>) {
  // First-use setup is onboarding. Saved routes, history, credentials errors and
  // actual runtime failures retain recovery UI.
  return Boolean(state.inspection?.capabilities?.modelConnections && state.inspection?.readiness?.code === "RUNTIME_SETUP_REQUIRED"
    && !state.selectedModel && !state.session && !activity.hasCommittedTranscript && !state.error && !activity.failed);
}

function isRoutingReady(state: AgentControllerState, runtime: RuntimeView, options: AgentChatViewOptions) {
  if (!runtime.agentRuntimeSelected || options.pendingConnectionModel || !options.preferencesReady) return false;
  const capabilities = state.inspection?.capabilities;
  if (capabilities?.modelConnections && !options.computeReady) return false;
  if (!capabilities?.modelSelection) return true;
  return Boolean(state.selectedModel && runtime.runtimeModels.some((model) => model.model === state.selectedModel));
}

function canRequestAccess(state: AgentControllerState, runtime: RuntimeView, options: AgentChatViewOptions,
  policy: { unavailable: boolean; computeOnboarding: boolean; failed: boolean }) {
  return Boolean(state.inspection?.capabilities?.modelConnections && runtime.agentRuntimeSelected && options.computeAccessRequired
    && !options.pendingConnectionModel && !policy.failed && !state.error && (policy.computeOnboarding || !policy.unavailable));
}

function hasPanelStatus(state: AgentControllerState, unavailable: boolean, onboarding: boolean, failed: boolean) {
  const recoveryVisible = Boolean(state.displayRecovery && state.displayRecovery.stage !== "silent");
  const nonRecoveryError = Boolean(state.error && !(state.error.code === "event-gap" && state.displayRecovery));
  return (unavailable && !onboarding) || failed || nonRecoveryError || recoveryVisible;
}

type PanelPolicy = ReturnType<typeof deriveActivity> & {
  unavailable: boolean; computeOnboarding: boolean; routingReady: boolean; canRequestComputeAccess: boolean; hasStatus: boolean;
};
function composerDisabled(state: AgentControllerState, policy: PanelPolicy) {
  return Boolean(state.inspection?.capabilities?.readOnly) || state.replicaStatus === "stale" || state.replicaStatus === "subscribing"
    || policy.loading || (policy.unavailable && !policy.canRequestComputeAccess) || policy.failed
    || (!policy.routingReady && !policy.canRequestComputeAccess) || state.projection.approvals.length > 0 || state.projection.questions.length > 0;
}

function showReadyEmptyState(state: AgentControllerState, policy: PanelPolicy) {
  const hasSubmittedConversation = policy.hasCommittedTranscript || Boolean(state.pendingPrompt) || Boolean(state.pendingIntent)
    || state.projection.approvals.length > 0 || state.projection.questions.length > 0;
  return (policy.routingReady || policy.computeOnboarding) && state.initialized && !policy.loading && !policy.hasStatus
    && !hasSubmittedConversation && !agentHistoryNotice(state.projection) && !state.projection.connectionStatus;
}

function composerPlaceholder(state: AgentControllerState, runtime: RuntimeView, policy: PanelPolicy, t: MessageFormatter) {
  if (policy.computeOnboarding) return t("agent.composer.placeholder.default");
  if (policy.unavailable || policy.failed) return t("agent.composer.placeholder.preparing");
  if (!runtime.agentRuntimeSelected) return t("agent.composer.placeholder.chooseAgent");
  if (state.inspection?.capabilities?.modelSelection && !state.selectedModel) return t("agent.composer.placeholder.chooseModel");
  if (state.projection.rows.length > 0 || state.projection.messages.length > 0) return t("agent.composer.placeholder.followUp");
  return t("agent.composer.placeholder.default");
}

function derivePresentation(state: AgentControllerState, runtime: RuntimeView, degraded: boolean, t: MessageFormatter) {
  let statusCode = readinessStatusCode(state.inspection?.readiness);
  if (state.session) statusCode = sessionStatusCode(state.session.terminalState);
  if (degraded) statusCode = "needs-attention";
  return {
    title: state.session?.title || (runtime.agentRuntimeSelected ? runtime.runtimeLabel : t("agent.header.newChat")),
    runtimeLabel: runtime.agentRuntimeSelected ? runtime.runtimeLabel : null,
    runtimeIconKey: runtime.runtimeIconKey,
    sessionId: state.session?.id ?? null,
    statusCode,
    running: Boolean(state.projection.runningTurnId),
  };
}

function panelError(state: AgentControllerState, runtime: string): AgentErrorDescriptor | null {
  if (state.error) return state.error;
  if (state.phase === "runtime-exited") return { code: "runtime-exited", params: { runtime } };
  return null;
}

function deriveReferenceCapabilities(state: AgentControllerState) {
  const base = state.inspection?.capabilities?.referenceInputs;
  if (!base || !state.inspection?.capabilities?.modelConnections) return base;
  const selected = state.inspection.models.find((model) => model.model === state.selectedModel)?.modelCapabilities;
  return { ...base, attachments: { ...base.attachments, image: { ...base.attachments.image, accepted: selected?.images === "supported" } } };
}

function deriveComposerConfiguration(state: AgentControllerState) {
  const capabilities = state.inspection?.capabilities;
  const controls = deriveAgentSessionControls(state.inspection, {
    selectedEffort: state.selectedEffort, selectedMode: state.selectedMode, selectedModel: state.selectedModel,
  });
  return {
    sessionControls: capabilities?.modelConnections ? controls.filter((control) => control.id !== "model") : controls,
    commands: capabilities?.slashCommands ? state.inspection?.commands ?? [] : [],
    steerAvailable: Boolean(capabilities?.steer), queueAvailable: Boolean(capabilities?.queue),
  };
}

function derivePendingTranscript(state: AgentControllerState) {
  let pendingReferences = state.pendingIntent?.references ?? [];
  if (state.pendingPrompt === null) pendingReferences = [];
  return {
    pendingSubmissionId: state.pendingIntent?.id,
    pendingReferences,
    pendingPromptMentions: state.pendingIntent?.promptMentions ?? [],
  };
}

function replyInFlight(status: string | null | undefined) {
  return status != null && ["dispatching", "accepted", "outcome-unknown"].includes(status);
}
