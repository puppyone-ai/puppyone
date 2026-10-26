import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentSessionController } from "../application/AgentSessionController";
import type { AgentPromptReferenceMention } from "../domain/agent-contract";
import type { AgentChatTabPresentation } from "../domain/agent-chat-presentation";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { AgentApprovalDock } from "./AgentApprovalDock";
import { AgentComposer } from "./AgentComposer";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentProviderActivities } from "./AgentProviderActivities";
import { AgentPanelLayout } from "./AgentPanelLayout";
import { AgentPanelStatus } from "./AgentPanelStatus";
import { BuiltInAgentCompute, type ComputeAccessRequired } from "./built-in-agent/BuiltInAgentCompute";
import { usePaymentsExperience } from "../../payments";
import type { AgentSessionControlId } from "../domain/agent-session-controls";
import { AgentQuestionDock } from "./AgentQuestionDock";
import { AgentRecoverySurface } from "./AgentRecoverySurface";
import { AgentRuntimeLauncher } from "./AgentRuntimeLauncher";
import { useTranscriptScope } from "./transcript/useTranscriptScope";
import { AgentTranscript } from "./AgentTranscript";
import { useAgentReferenceIngestion } from "./useAgentReferenceIngestion";
import type { AgentWorkspaceReferenceResolver } from "./useAgentReferenceIngestion";
import { useAgentRoutingPreferences } from "./useAgentRoutingPreferences";
import { useAgentSessionPreparation } from "./useAgentSessionPreparation";

import { deriveAgentChatRuntime, deriveAgentChatViewModel } from "./agentChatViewModel";

type AgentChatTabPanelProps = {
  presented: boolean;
  commandTarget: boolean;
  focusRequest?: number;
  controller: AgentSessionController;
  workspaceId: string;
  onPresentationChange: (presentation: AgentChatTabPresentation) => void;
  onOpenFile?: (path: string) => void;
  onOpenAccount: () => void;
  onOpenModelConnections: () => void;
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
  onOpenAccount,
  onOpenModelConnections,
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
  /** The panel is a render entry for the payment fork; the compute dock obeys it. */
  const payments = usePaymentsExperience();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [pendingConnectionModel, setPendingConnectionModel] = useState<string | null>(null);
  const [computeReady, setComputeReady] = useState(false);
  const [computeReset, setComputeReset] = useState(0);
  const [computeAccessRequired, setComputeAccessRequired] = useState<ComputeAccessRequired>(null);
  const [computeAccessPrompt, setComputeAccessPrompt] = useState(false);
  const runtime = useMemo(() => deriveAgentChatRuntime(state, hiddenRuntimeIds, t), [state, hiddenRuntimeIds, t]);
  const routingPreferences = useAgentRoutingPreferences({
    active: commandTarget, controller, state, runtimeModels: runtime.runtimeModels, preferredRuntimeId, preferredRoute, preferredModel,
    onPreferredRuntimeChange, onPreferredRouteChange, onPreferredModelChange,
  });
  const view = useMemo(() => deriveAgentChatViewModel(state, runtime, {
    presented, pendingConnectionModel, computeReady, computeAccessRequired, preferencesReady: routingPreferences.preferencesReady,
  }, t), [state, runtime, presented, pendingConnectionModel, computeReady, computeAccessRequired, routingPreferences.preferencesReady, t]);
  const { routingReady, canRequestComputeAccess, runtimeLabel, runtimeIconKey, showReadyEmptyState, degradedRecovery } = view;
  const referenceIngestion = useAgentReferenceIngestion({
    controller, workspaceId, capabilities: view.referenceCapabilities, resolveWorkspaceReference,
  });
  const sessionKey = useTranscriptScope(controller, state.session?.id ?? null, state.selectedRuntimeId);
  const viewport = useMemo(() => ({ sessionKey, value: controller.readViewport() }), [controller, sessionKey]).value;
  useAgentSessionPreparation(controller, state, commandTarget && routingReady);
  const { title, runtimeLabel: presentationRuntimeLabel, sessionId, statusCode, running } = view.presentation;
  useEffect(() => {
    onPresentationChange({ title, runtimeLabel: presentationRuntimeLabel, runtimeIconKey, sessionId, statusCode, running });
  }, [onPresentationChange, title, presentationRuntimeLabel, runtimeIconKey, sessionId, statusCode, running]);

  const handleViewportChange = useCallback((scrollTop: number, measurements: Record<string, number>, pinned: boolean, geometry: AgentViewportGeometry) => {
    controller.rememberViewport(scrollTop, measurements, pinned, geometry);
  }, [controller]);
  const handleDraftChange = useCallback((draft: string) => controller.setDraft(draft), [controller]);
  const handleDraftDocumentChange = useCallback((draft: string, mentions: AgentPromptReferenceMention[]) => {
    controller.setDraftDocument(draft, mentions);
  }, [controller]);
  const handleSubmit = useCallback(async (prompt: string) => {
    if (!routingReady && canRequestComputeAccess) {
      setComputeAccessPrompt(true);
      return false;
    }
    if (!routingReady) return false;
    setComputeAccessPrompt(false);
    return controller.submit(prompt);
  }, [controller, routingReady, canRequestComputeAccess]);
  const selectSessionControl = (id: AgentSessionControlId, value: string) => {
    if (id === "model" && controller.requiresNewModelConnectionSession(value)) {
      setPendingConnectionModel(value);
      return;
    }
    routingPreferences.selectSessionControl(id, value);
  };

  if (view.showRuntimeLauncher) {
    return <AgentPanelLayout
      ariaLabel={t("agent.panel.chat", { agent: bidiIsolate(t("agent.name")) })}
      phase="selecting-runtime"
      conversation={<AgentRuntimeLauncher
        agentRuntimes={view.agentRuntimes}
        onLaunch={routingPreferences.selectRuntime}
        onRefresh={() => void controller.initialize(true)}
      />}
    />;
  }

  return <AgentPanelLayout
    ariaLabel={t("agent.panel.chat", { agent: bidiIsolate(runtimeLabel) })}
    phase={state.phase} announcement={referenceIngestion.announcement}
    onDragOver={referenceIngestion.onDragOver} onDrop={referenceIngestion.onDrop}
    status={view.showStatus ? <AgentPanelStatus
      unavailable={view.unavailable} failed={view.failed} runtimeExited={state.phase === "runtime-exited"} error={view.panelError}
      runtimeLabel={runtimeLabel} readiness={view.readiness}
      onRetry={() => void controller.initialize(true)}
      recovery={state.displayRecovery} stopRequest={state.stopRequest}
      onPauseRecovery={() => controller.pauseDisplayRecovery()} onRetryRecovery={() => void controller.retryDisplayRecovery()}
      onManageExecutions={() => void controller.manageExecutions()}
    /> : null}
    conversationOverlay={showReadyEmptyState
      ? <AgentEmptyState runtimeIconKey={runtimeIconKey} runtimeLabel={runtimeLabel} />
      : null}
    conversation={<AgentTranscript
      key={sessionKey} projection={state.projection} loading={view.startupLoading}
      pendingSubmissionId={view.pendingSubmissionId}
      pendingPrompt={state.pendingPrompt} pendingReferences={view.pendingReferences}
      pendingPromptMentions={view.pendingPromptMentions}
      submissionStage={view.submissionStage} working={view.working}
      runtimeLabel={runtimeLabel} initialScrollTop={viewport.scrollTop}
      initialMeasurements={viewport.measurements} initialPinned={viewport.pinned} initialGeometry={viewport.geometry}
      onViewportChange={handleViewportChange} onOpenFile={onOpenFile}
    />}
    dock={view.startupLoading ? null : <>
      {view.modelConnections && <BuiltInAgentCompute key={`${state.selectedRuntimeId}:${state.selectedModel}:${computeReset}`}
        models={view.runtimeModels} payments={payments} selectedModel={state.selectedModel} disabled={view.computeDisabled}
        onSelectModel={(model) => selectSessionControl("model", model)} onCatalogChange={() => void controller.refreshModelConnections()}
        onOpenAccount={onOpenAccount} onOpenModelConnections={onOpenModelConnections} onReadyChange={setComputeReady}
        onAccessRequiredChange={setComputeAccessRequired} accessPrompt={computeAccessPrompt} />}
      {view.readOnly && <p role="status">{t("settings.modelConnections.readOnly")}</p>}
      {pendingConnectionModel && <div role="alertdialog" aria-label={t("settings.modelConnections.newConversation")}>
        <p>{t("settings.modelConnections.switchWarning")}</p>
        <button type="button" onClick={() => {
          const model = pendingConnectionModel; setPendingConnectionModel(null);
          void controller.startNewModelConnection(model);
        }}>{t("settings.modelConnections.newConversation")}</button>
        <button type="button" onClick={() => { setPendingConnectionModel(null); setComputeReset((value) => value + 1); }}>{t("common.action.cancel")}</button>
      </div>}
      {view.approval && <AgentApprovalDock
        key={view.approval.requestId}
        approval={view.approval} queueLength={state.projection.approvals.length}
        resolving={view.approvalResolving} runtimeLabel={runtimeLabel}
        onResolve={(decision) => void controller.resolveApproval(decision)}
      />}
      {view.question && <AgentQuestionDock
        key={view.question.requestId} request={view.question}
        queueLength={state.projection.questions.length} resolving={view.questionResolving}
        onResolve={(resolution) => void controller.resolveQuestion(resolution)}
      />}
      {degradedRecovery && <AgentRecoverySurface
        recovery={degradedRecovery.recovery}
        runtimeLabel={runtimeLabel}
        submitting={view.submissionPending}
        onContinue={() => void controller.continueFromRecovery(
          degradedRecovery.turnId,
          t("agent.recovery.degraded.prompt"),
        )}
      />}
      <AgentProviderActivities activities={state.projection.activities} />
      <AgentComposer
        focusRequest={focusRequest}
        draft={state.draft} draftMentions={state.draftMentions} onDraftChange={handleDraftChange}
        onDraftDocumentChange={handleDraftDocumentChange}
        disabled={view.composerDisabled}
        running={view.running} stopping={state.stopping} submitting={view.submissionPending}
        placeholder={view.composerPlaceholder} runtimeLabel={runtimeLabel}
        configurationDisabled={view.configurationDisabled}
        sessionControls={view.sessionControls}
        onSelectSessionControl={selectSessionControl}
        commands={view.commands}
        references={state.references} getReferencePreviewUrl={controller.getReferencePreviewUrl}
        referenceCapabilities={view.referenceCapabilities}
        steerAvailable={view.steerAvailable} queueAvailable={view.queueAvailable}
        onRemoveReference={(id) => controller.removeReference(id)} onRetryReference={(id) => controller.retryReference(id)}
        onAddExternalFiles={referenceIngestion.addExternalFiles} onDrop={referenceIngestion.onEditorDrop}
        onPaste={referenceIngestion.onPaste}
        onPickWorkspaceReferences={referenceIngestion.pickWorkspaceReferences}
        onSubmit={handleSubmit} onStop={() => void controller.stop()}
      />
    </>}
  />;
}
