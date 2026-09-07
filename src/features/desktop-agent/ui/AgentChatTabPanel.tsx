import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentSessionController } from "../application/AgentSessionController";
import type { AgentSubmissionStage } from "../application/agent-controller-state";
import type { AgentPromptReferenceMention } from "../domain/agent-contract";
import { listAgentRuntimes, listVisibleAgentRuntimes } from "../domain/agent-backend-routing";
import type { AgentChatTabPresentation } from "../domain/agent-chat-tabs";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { deriveAgentSessionControls } from "../domain/agent-session-controls";
import { AgentApprovalDock } from "./AgentApprovalDock";
import { AgentChangesControl } from "./AgentChangesControl";
import { AgentComposer, DEFAULT_AGENT_COMPOSER_PLACEHOLDER_ID } from "./AgentComposer";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentPanelLayout } from "./AgentPanelLayout";
import { AgentPanelStatus } from "./AgentPanelStatus";
import { AgentQuestionDock } from "./AgentQuestionDock";
import { AgentRuntimeLauncher } from "./AgentRuntimeLauncher";
import { useTranscriptScope } from "./transcript/useTranscriptScope";
import { AgentTranscript } from "./AgentTranscript";
import { readinessStatusCode, sessionStatusCode } from "./agentPanelPresentation";
import { useAgentReferenceIngestion } from "./useAgentReferenceIngestion";
import type { AgentWorkspaceReferenceResolver } from "./useAgentReferenceIngestion";
import { useAgentRoutingPreferences } from "./useAgentRoutingPreferences";
import { useAgentSessionPreparation } from "./useAgentSessionPreparation";

type AgentChatTabPanelProps = {
  /** Compatibility alias for the legacy single-Group Agent panel. */
  active?: boolean;
  presented?: boolean;
  commandTarget?: boolean;
  controller: AgentSessionController;
  workspaceId: string;
  onPresentationChange: (presentation: AgentChatTabPresentation) => void;
  onViewChanges?: () => void;
  onOpenFile?: (path: string) => void;
  preferredRuntimeId: string | null;
  onPreferredRuntimeChange?: (runtimeId: string | null) => void;
  preferredRoute: Readonly<AgentRoutePreference>;
  onPreferredRouteChange?: (route: AgentRoutePreference) => void;
  preferredModel: string | null;
  onPreferredModelChange?: (model: string) => void;
  hiddenRuntimeIds: readonly string[];
  resolveWorkspaceReference?: AgentWorkspaceReferenceResolver;
};

export function AgentChatTabPanel({
  active = false,
  presented: presentedProp,
  commandTarget: commandTargetProp,
  controller,
  workspaceId,
  onPresentationChange,
  onViewChanges,
  onOpenFile,
  preferredRuntimeId,
  onPreferredRuntimeChange,
  preferredRoute,
  onPreferredRouteChange,
  preferredModel,
  onPreferredModelChange,
  hiddenRuntimeIds,
  resolveWorkspaceReference,
}: AgentChatTabPanelProps) {
  const presented = presentedProp ?? active;
  const commandTarget = commandTargetProp ?? active;
  const { t } = useLocalization();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const referenceIngestion = useAgentReferenceIngestion({
    controller,
    workspaceId,
    capabilities: state.inspection?.capabilities?.referenceInputs,
    resolveWorkspaceReference,
  });
  const inspection = state.inspection;
  const readiness = inspection?.readiness;
  const runtime = state.session?.runtime
    || inspection?.runtime
    || inspection?.runtimes?.find((entry) => entry.descriptor.id === state.selectedRuntimeId)?.descriptor;
  const runtimeLabel = runtime?.displayName || t("agent.name");
  const capabilities = inspection?.capabilities;
  const unavailable = Boolean(readiness && readiness.status !== "ready");
  const loading = state.phase === "discovering" || state.phase === "restoring" || state.phase === "creating";
  const failed = state.phase === "failed" || state.phase === "runtime-exited";
  const hasCommittedTranscript = [state.projection.rows, state.projection.parts, state.projection.messages, state.projection.activities]
    .some((entries) => entries.length > 0);
  const startupLoading = presented && (!state.initialized || loading) && !state.pendingPrompt && !hasCommittedTranscript;
  const sessionKey = useTranscriptScope(controller, state.session?.id ?? null, state.selectedRuntimeId);
  const viewport = useMemo(() => ({ sessionKey, value: controller.readViewport() }), [controller, sessionKey]).value;
  const agentRuntimes = listVisibleAgentRuntimes(inspection, hiddenRuntimeIds);
  const selectedRuntimeRegistered = listAgentRuntimes(inspection).some((entry) => (
    entry.descriptor.id === state.selectedRuntimeId
    && (Boolean(state.session) || !hiddenRuntimeIds.includes(entry.descriptor.id))
  ));
  // A direct creation recipe remains bound even when its runtime needs setup.
  // Only the chooser filters not-installed runtimes from subsequent selection.
  const agentRuntimeSelected = selectedRuntimeRegistered;
  const runtimeIconKey = state.selectedRuntimeId
    ? runtime?.iconKey || state.selectedRuntimeId
    : null;
  const runtimeModels = agentRuntimeSelected ? inspection?.models ?? [] : [];
  const routingPreferences = useAgentRoutingPreferences({
    active: commandTarget, controller, state, runtimeModels, preferredRuntimeId, preferredRoute, preferredModel,
    onPreferredRuntimeChange, onPreferredRouteChange, onPreferredModelChange,
  });
  const sessionControls = useMemo(() => deriveAgentSessionControls(inspection, {
    selectedEffort: state.selectedEffort,
    selectedMode: state.selectedMode,
    selectedModel: state.selectedModel,
  }), [inspection, state.selectedEffort, state.selectedMode, state.selectedModel]);
  const modelSelectionAvailable = Boolean(capabilities?.modelSelection);
  const routingReady = Boolean(agentRuntimeSelected && (!modelSelectionAvailable || (
    state.selectedModel && runtimeModels.some((model) => model.model === state.selectedModel)
  )) && routingPreferences.preferencesReady);
  const preparingSession = state.sessionPreparation === "preparing";
  const submissionPending = state.submitting || Boolean(state.pendingPrompt);
  // Main admission replaces the local preview before the native turn starts.
  // Keep the submission feedback throughout that interval, including inputs
  // made only of attachments; preview text is not a lifecycle signal.
  const submissionStage: AgentSubmissionStage = submissionPending && !state.projection.runningTurnId
    ? !state.session || preparingSession ? "preparing-session" : "starting-turn"
    : null;
  useAgentSessionPreparation(controller, state, commandTarget && routingReady);
  const composerPlaceholder = unavailable || failed
    ? t("agent.composer.placeholder.preparing")
    : !agentRuntimeSelected
      ? t("agent.composer.placeholder.chooseAgent")
      : modelSelectionAvailable && !state.selectedModel
        ? t("agent.composer.placeholder.chooseModel")
        : state.projection.rows.length > 0 || state.projection.messages.length > 0
          ? t("agent.composer.placeholder.followUp")
          : t(DEFAULT_AGENT_COMPOSER_PLACEHOLDER_ID);
  const sessionStatus = state.session?.terminalState;
  const statusCode = state.session ? sessionStatusCode(sessionStatus) : readinessStatusCode(readiness);
  const title = state.session?.title || (agentRuntimeSelected ? runtimeLabel : t("agent.header.newChat"));
  const hasStatus = unavailable || failed || Boolean(state.error);
  const hasSubmittedConversation = hasCommittedTranscript
    || Boolean(state.pendingPrompt)
    || Boolean(state.pendingIntent)
    || state.projection.approvals.length > 0
    || state.projection.questions.length > 0;
  const showReadyEmptyState = routingReady
    && state.initialized
    && !loading
    && !hasStatus
    && !hasSubmittedConversation
    && !state.projection.partialHistory
    && !state.projection.connectionStatus;
  useEffect(() => {
    onPresentationChange({
      title,
      runtimeLabel: agentRuntimeSelected ? runtimeLabel : null,
      runtimeIconKey,
      sessionId: state.session?.id ?? null,
      statusCode,
      running: Boolean(state.projection.runningTurnId),
    });
  }, [agentRuntimeSelected, onPresentationChange, runtimeIconKey, runtimeLabel, state.projection.runningTurnId, state.session?.id, statusCode, title]);

  const handleViewportChange = useCallback((scrollTop: number, measurements: Record<string, number>, pinned: boolean, geometry: AgentViewportGeometry) => {
    controller.rememberViewport(scrollTop, measurements, pinned, geometry);
  }, [controller]);
  const handleDraftChange = useCallback((draft: string) => controller.setDraft(draft), [controller]);
  const handleDraftDocumentChange = useCallback((draft: string, mentions: AgentPromptReferenceMention[]) => {
    controller.setDraftDocument(draft, mentions);
  }, [controller]);
  const handleSubmit = useCallback((prompt: string) => controller.submit(prompt), [controller]);

  if (state.initialized && inspection && !agentRuntimeSelected && !loading && !failed) {
    return <AgentPanelLayout
      ariaLabel={t("agent.panel.chat", { agent: bidiIsolate(t("agent.name")) })}
      phase="selecting-runtime"
      conversation={<AgentRuntimeLauncher
        agentRuntimes={agentRuntimes}
        onLaunch={routingPreferences.selectRuntime}
        onRefresh={() => void controller.initialize(true)}
      />}
    />;
  }

  return <AgentPanelLayout
    ariaLabel={t("agent.panel.chat", { agent: bidiIsolate(runtimeLabel) })}
    phase={state.phase} announcement={referenceIngestion.announcement}
    onDragOver={referenceIngestion.onDragOver} onDrop={referenceIngestion.onDrop}
    status={hasStatus ? <AgentPanelStatus
      unavailable={unavailable} failed={failed} error={state.error ?? (state.phase === "runtime-exited" ? { code: "runtime-exited", params: { runtime: runtimeLabel } } : null)}
      runtimeLabel={runtimeLabel} readiness={readiness ?? undefined}
      onRetry={() => void controller.initialize(true)}
    /> : null}
    conversationOverlay={showReadyEmptyState
      ? <AgentEmptyState runtimeIconKey={runtimeIconKey} runtimeLabel={runtimeLabel} />
      : null}
    conversation={<AgentTranscript
      key={sessionKey} projection={state.projection} loading={startupLoading}
      pendingSubmissionId={state.pendingIntent?.id}
      pendingPrompt={state.pendingPrompt} pendingReferences={state.pendingPrompt !== null ? state.pendingIntent?.references ?? [] : []}
      pendingPromptMentions={state.pendingIntent?.promptMentions ?? []}
      submissionStage={submissionStage} working={state.submitting || Boolean(state.projection.runningTurnId)}
      runtimeLabel={runtimeLabel} initialScrollTop={viewport.scrollTop}
      initialMeasurements={viewport.measurements} initialPinned={viewport.pinned} initialGeometry={viewport.geometry}
      onViewportChange={handleViewportChange} onOpenFile={onOpenFile}
    />}
    dock={startupLoading ? null : <>
      {state.projection.approvals[0] && <AgentApprovalDock
        approval={state.projection.approvals[0]} queueLength={state.projection.approvals.length}
        resolving={replyInFlight(state.projection.approvals[0]?.replyStatus)} runtimeLabel={runtimeLabel}
        onResolve={(decision) => void controller.resolveApproval(decision)}
      />}
      {state.projection.questions[0] && <AgentQuestionDock
        key={state.projection.questions[0].requestId} request={state.projection.questions[0]}
        queueLength={state.projection.questions.length} resolving={replyInFlight(state.projection.questions[0]?.replyStatus)}
        onResolve={(resolution) => void controller.resolveQuestion(resolution)}
      />}
      <AgentComposer
        floatingAccessory={state.projection.approvals.length === 0 && state.projection.questions.length === 0 ? <AgentChangesControl projection={state.projection} onViewChanges={onViewChanges} /> : null}
        draft={state.draft} draftMentions={state.draftMentions} onDraftChange={handleDraftChange}
        onDraftDocumentChange={handleDraftDocumentChange}
        disabled={loading || unavailable || failed || !routingReady || state.projection.approvals.length > 0 || state.projection.questions.length > 0}
        running={Boolean(state.projection.runningTurnId)} stopping={state.stopping} submitting={submissionPending}
        placeholder={composerPlaceholder} runtimeLabel={runtimeLabel}
        configurationDisabled={loading || submissionPending}
        sessionControls={sessionControls}
        onSelectSessionControl={routingPreferences.selectSessionControl}
        commands={capabilities?.slashCommands ? inspection?.commands ?? [] : []}
        references={state.references} getReferencePreviewUrl={controller.getReferencePreviewUrl}
        referenceCapabilities={capabilities?.referenceInputs}
        steerAvailable={Boolean(capabilities?.steer)} queueAvailable={Boolean(capabilities?.queue)}
        onRemoveReference={(id) => controller.removeReference(id)} onRetryReference={(id) => controller.retryReference(id)}
        onAddExternalFiles={referenceIngestion.addExternalFiles} onDrop={referenceIngestion.onEditorDrop}
        onPaste={referenceIngestion.onPaste}
        onPickWorkspaceReferences={referenceIngestion.pickWorkspaceReferences}
        onSubmit={handleSubmit} onStop={() => void controller.stop()}
      />
    </>}
  />;
}

function replyInFlight(status: string | null | undefined) {
  return status != null && ["dispatching", "accepted", "outcome-unknown"].includes(status);
}
