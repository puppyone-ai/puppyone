import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentSessionController } from "../application/AgentSessionController";
import type { AgentSubmissionStage } from "../application/agent-controller-state";
import type { AgentPromptReferenceMention } from "../domain/agent-contract";
import { listAgentRuntimes, listVisibleAgentRuntimes } from "../domain/agent-backend-routing";
import type { AgentChatTabPresentation } from "../domain/agent-chat-presentation";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { deriveAgentSessionControls } from "../domain/agent-session-controls";
import { activeAgentDegradedRecovery } from "../domain/agent-degraded-recovery";
import { AgentApprovalDock } from "./AgentApprovalDock";
import { AgentComposer, DEFAULT_AGENT_COMPOSER_PLACEHOLDER_ID } from "./AgentComposer";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentPanelLayout } from "./AgentPanelLayout";
import { AgentPanelStatus } from "./AgentPanelStatus";
import { BuiltInAgentCompute } from "./built-in-agent/BuiltInAgentCompute";
import type { AgentSessionControlId } from "../domain/agent-session-controls";
import { AgentQuestionDock } from "./AgentQuestionDock";
import { AgentRecoverySurface } from "./AgentRecoverySurface";
import { AgentRuntimeLauncher } from "./AgentRuntimeLauncher";
import { useTranscriptScope } from "./transcript/useTranscriptScope";
import { AgentTranscript } from "./AgentTranscript";
import { agentHistoryNotice } from "./agent-history-presentation";
import { readinessStatusCode, sessionStatusCode } from "./agentPanelPresentation";
import { useAgentReferenceIngestion } from "./useAgentReferenceIngestion";
import type { AgentWorkspaceReferenceResolver } from "./useAgentReferenceIngestion";
import { useAgentRoutingPreferences } from "./useAgentRoutingPreferences";
import { useAgentSessionPreparation } from "./useAgentSessionPreparation";

type AgentChatTabPanelProps = {
  presented: boolean;
  commandTarget: boolean;
  focusRequest?: number;
  controller: AgentSessionController;
  workspaceId: string;
  onPresentationChange: (presentation: AgentChatTabPresentation) => void;
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
  presented,
  commandTarget,
  focusRequest,
  controller,
  workspaceId,
  onPresentationChange,
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
  const { t } = useLocalization();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [pendingConnectionModel, setPendingConnectionModel] = useState<string | null>(null);
  const [computeReady, setComputeReady] = useState(false);
  const [computeReset, setComputeReset] = useState(0);
  const selectedModelCapabilities = state.inspection?.models.find((model) => model.model === state.selectedModel)?.modelCapabilities;
  const referenceCapabilities = useMemo(() => {
    const base = state.inspection?.capabilities?.referenceInputs;
    if (!base || !state.inspection?.capabilities?.modelConnections) return base;
    return { ...base, attachments: { ...base.attachments, image: { ...base.attachments.image, accepted: selectedModelCapabilities?.images === "supported" } } };
  }, [state.inspection?.capabilities, selectedModelCapabilities]);
  const referenceIngestion = useAgentReferenceIngestion({
    controller,
    workspaceId,
    capabilities: referenceCapabilities,
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
  // An unconfigured first-use connection is onboarding, not a failed Agent session.
  // Saved routes, history, credentials errors and actual runtime failures retain recovery UI.
  const computeOnboarding = Boolean(capabilities?.modelConnections && readiness?.code === "RUNTIME_SETUP_REQUIRED"
    && !state.selectedModel && !state.session && !hasCommittedTranscript && !state.error && !failed);
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
  const routingReady = Boolean(agentRuntimeSelected && !pendingConnectionModel && (!capabilities?.modelConnections || computeReady) && (!modelSelectionAvailable || (
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
  const composerPlaceholder = computeOnboarding ? t(DEFAULT_AGENT_COMPOSER_PLACEHOLDER_ID) : unavailable || failed
    ? t("agent.composer.placeholder.preparing")
    : !agentRuntimeSelected
      ? t("agent.composer.placeholder.chooseAgent")
      : modelSelectionAvailable && !state.selectedModel
        ? t("agent.composer.placeholder.chooseModel")
        : state.projection.rows.length > 0 || state.projection.messages.length > 0
          ? t("agent.composer.placeholder.followUp")
          : t(DEFAULT_AGENT_COMPOSER_PLACEHOLDER_ID);
  const degradedRecovery = activeAgentDegradedRecovery(state.projection);
  const sessionStatus = state.session?.terminalState;
  const statusCode = degradedRecovery
    ? "needs-attention"
    : state.session ? sessionStatusCode(sessionStatus) : readinessStatusCode(readiness);
  const title = state.session?.title || (agentRuntimeSelected ? runtimeLabel : t("agent.header.newChat"));
  const hasStatus = (unavailable && !computeOnboarding) || failed || Boolean(state.error);
  const hasSubmittedConversation = hasCommittedTranscript
    || Boolean(state.pendingPrompt)
    || Boolean(state.pendingIntent)
    || state.projection.approvals.length > 0
    || state.projection.questions.length > 0;
  const showReadyEmptyState = (routingReady || computeOnboarding)
    && state.initialized
    && !loading
    && !hasStatus
    && !hasSubmittedConversation
    && !agentHistoryNotice(state.projection)
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
  const selectSessionControl = (id: AgentSessionControlId, value: string) => {
    if (id === "model" && controller.requiresNewModelConnectionSession(value)) {
      setPendingConnectionModel(value);
      return;
    }
    routingPreferences.selectSessionControl(id, value);
  };

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
      {capabilities?.modelConnections && <BuiltInAgentCompute key={`${state.selectedRuntimeId}:${state.selectedModel}:${computeReset}`}
        models={runtimeModels} selectedModel={state.selectedModel} disabled={loading || submissionPending || Boolean(state.projection.runningTurnId)}
        onSelectModel={(model) => selectSessionControl("model", model)} onCatalogChange={() => void controller.refreshModelConnections()} onReadyChange={setComputeReady} />}
      {capabilities?.readOnly && <p role="status">{t("settings.modelConnections.readOnly")}</p>}
      {pendingConnectionModel && <div role="alertdialog" aria-label={t("settings.modelConnections.newConversation")}>
        <p>{t("settings.modelConnections.switchWarning")}</p>
        <button type="button" onClick={() => {
          const model = pendingConnectionModel; setPendingConnectionModel(null);
          void controller.startNewModelConnection(model);
        }}>{t("settings.modelConnections.newConversation")}</button>
        <button type="button" onClick={() => { setPendingConnectionModel(null); setComputeReset((value) => value + 1); }}>{t("common.action.cancel")}</button>
      </div>}
      {state.projection.approvals[0] && <AgentApprovalDock
        key={state.projection.approvals[0].requestId}
        approval={state.projection.approvals[0]} queueLength={state.projection.approvals.length}
        resolving={replyInFlight(state.projection.approvals[0]?.replyStatus)} runtimeLabel={runtimeLabel}
        onResolve={(decision) => void controller.resolveApproval(decision)}
      />}
      {state.projection.questions[0] && <AgentQuestionDock
        key={state.projection.questions[0].requestId} request={state.projection.questions[0]}
        queueLength={state.projection.questions.length} resolving={replyInFlight(state.projection.questions[0]?.replyStatus)}
        onResolve={(resolution) => void controller.resolveQuestion(resolution)}
      />}
      {degradedRecovery && <AgentRecoverySurface
        recovery={degradedRecovery.recovery}
        runtimeLabel={runtimeLabel}
        submitting={submissionPending}
        onContinue={() => void controller.continueFromRecovery(
          degradedRecovery.turnId,
          t("agent.recovery.degraded.prompt"),
        )}
      />}
      <AgentComposer
        focusRequest={focusRequest}
        draft={state.draft} draftMentions={state.draftMentions} onDraftChange={handleDraftChange}
        onDraftDocumentChange={handleDraftDocumentChange}
        disabled={Boolean(capabilities?.readOnly) || loading || unavailable || failed || !routingReady || state.projection.approvals.length > 0 || state.projection.questions.length > 0}
        running={Boolean(state.projection.runningTurnId)} stopping={state.stopping} submitting={submissionPending}
        placeholder={composerPlaceholder} runtimeLabel={runtimeLabel}
        configurationDisabled={loading || submissionPending}
        sessionControls={capabilities?.modelConnections ? sessionControls.filter((control) => control.id !== "model") : sessionControls}
        onSelectSessionControl={selectSessionControl}
        commands={capabilities?.slashCommands ? inspection?.commands ?? [] : []}
        references={state.references} getReferencePreviewUrl={controller.getReferencePreviewUrl}
        referenceCapabilities={referenceCapabilities}
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
