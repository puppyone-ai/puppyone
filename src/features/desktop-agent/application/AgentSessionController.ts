import type { AgentViewportGeometry } from "../domain/agent-ui-state";
import { createEmptyAgentDisplay as createAgentProjection } from "../../../../shared/agent-contract/display-state.mjs";
import { assertAgentSessionSnapshot } from "../../../../shared/agent-contract/schema.mjs";
import {
  agentProviderIdForModel,
  chooseAgentModel,
  chooseAgentProvider,
  listAgentInferenceProviders,
} from "../domain/agent-provider-routing";
import type {
  AgentApprovalDecision,
  AgentQuestionResolution,
  AgentSessionSnapshot,
} from "../domain/agent-contract";
import { AgentSessionOpenError } from "../domain/agent-session-open-error";
import { AgentSessionReplica } from "./AgentSessionReplica";
import { agentControllerTransitions, type AgentControllerState } from "./agent-controller-state";
import { AgentKnownError, createAgentError, formatAgentError } from "./agent-error";
import { SessionUiStateStore, type SessionUiState } from "./SessionUiStateStore";
import { LocalAgentConnectionLoader } from "./LocalAgentConnectionLoader";
import type { AgentClientPort, AgentClientProvider } from "./AgentClientPort";
import { AgentSessionLifecycle } from "./AgentSessionLifecycle";
import { AgentSessionPreparer } from "./AgentSessionPreparer";
import {
  AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS,
  hasFreshAgentRuntimeInspection,
} from "./agent-runtime-discovery-cache";
import { planAgentRuntimeSwitch } from "./agent-runtime-selection";
import { chooseAgentEffort, chooseAgentMode } from "./agent-controller-values";
import { AgentReferenceDraftManager } from "./AgentReferenceDraftManager";
import {
  AgentTurnSubmissionCoordinator,
} from "./AgentTurnSubmissionCoordinator";

export type { AgentControllerPhase, AgentControllerState } from "./agent-controller-state";
export { agentControllerTransitions } from "./agent-controller-state";
export { formatAgentError } from "./agent-error";

type Listener = () => void;

export class AgentSessionController {
  readonly workspaceRoot: string;
  private state: AgentControllerState;
  private listeners = new Set<Listener>();
  private readonly sessionReplica: AgentSessionReplica;
  private initializePromise: Promise<void> | null = null;
  private readonly sessionUi = new SessionUiStateStore();
  private readonly localConnectionLoader: LocalAgentConnectionLoader;
  private readonly sessionLifecycle: AgentSessionLifecycle;
  private readonly sessionPreparer: AgentSessionPreparer;
  private readonly referenceDrafts: AgentReferenceDraftManager;
  private readonly submission: AgentTurnSubmissionCoordinator;
  private lastInspectionAt = 0;
  private disposed = false;

  constructor(
    workspaceRoot: string,
    private readonly bridgeProvider: AgentClientProvider,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.state = {
      phase: "idle",
      inspection: null,
      session: null,
      control: null,
      replicaStatus: "detached",
      projection: createAgentProjection(),
      selectedRuntimeId: null,
      selectedProviderId: null,
      selectedModel: null,
      selectedEffort: null,
      selectedMode: null,
      localConnections: [],
      localConnectionsPhase: "idle",
      localConnectionsScannedAt: null,
      localConnectionsError: null,
      draft: "",
      draftMentions: [],
      pendingPrompt: null,
      pendingIntent: null,
      sessionPreparation: "idle",
      references: [],
      error: null,
      submitting: false,
      stopping: false,
      initialized: false,
    };
    this.localConnectionLoader = new LocalAgentConnectionLoader(
      workspaceRoot,
      bridgeProvider,
      (patch) => this.patch(patch),
    );
    this.referenceDrafts = new AgentReferenceDraftManager({
      workspaceRoot,
      bridgeProvider,
      readState: this.getSnapshot,
      patch: (patch) => this.patch(patch),
      appendText: (text) => this.appendDroppedText(text),
    });
    this.submission = new AgentTurnSubmissionCoordinator({
      workspaceRoot,
      bridgeProvider,
      references: this.referenceDrafts,
      readState: this.getSnapshot,
      patch: (patch) => this.patch(patch),
      writeDraft: (draft, draftMentions) => this.writeCurrentSessionUi({ draft, draftMentions }),
      prepareSession: () => this.prepareSession(),
    });
    this.sessionReplica = new AgentSessionReplica(
      workspaceRoot,
      bridgeProvider,
      this.getSnapshot,
      (patch) => this.patch(patch),
    );
    this.sessionLifecycle = new AgentSessionLifecycle({
      workspaceRoot,
      bridgeProvider,
      readState: this.getSnapshot,
      patch: (patch) => this.patch(patch),
      createSession: () => this.createSession(),
      applySnapshot: (snapshot) => this.applySnapshot(snapshot),
      deleteSessionUi: (sessionId) => this.sessionUi.delete(sessionId),
    });
    this.sessionPreparer = new AgentSessionPreparer({
      workspaceRoot,
      bridgeProvider,
      readState: this.getSnapshot,
      patch: (patch) => this.patch(patch),
      createSession: () => this.createSession(),
      applySnapshot: (snapshot) => this.applySnapshot(snapshot),
    });
    this.sessionReplica.connect();
  }

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Releases renderer subscriptions only; it never sends a runtime stop. */
  dispose({ preserveDraft = false } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.submission.dispose();
    this.sessionPreparer.dispose();
    this.sessionReplica.dispose();
    this.localConnectionLoader.dispose();
    this.sessionUi.clear();
    if (!preserveDraft) void this.referenceDrafts.revoke([
      ...this.state.references,
      ...(this.state.pendingIntent?.references ?? []),
    ]);
    this.referenceDrafts.disposeRendererResources();
    this.listeners.clear();
  }

  async initialize(refresh = false) {
    return this.initializeRuntime(refresh, true);
  }

  /** Discover the runtime catalog without implicitly restoring any conversation. */
  async inspectRuntimes(refresh = false) {
    return this.initializeRuntime(refresh, false);
  }

  /** Rebuilds only the display replica; never creates/resumes a native session. */
  async attachLiveSession(sessionId: string, runtimeId: string) {
    await this.initializeForRuntime(runtimeId);
    this.sessionReplica.connect();
    const snapshot = await this.sessionReplica.attachSession(sessionId);
    if (!snapshot) throw new Error("The live Agent session is unavailable for display recovery.");
    this.applySnapshotState(snapshot);
    await this.sessionReplica.activateSessionFeed(sessionId);
  }

  exportDisplayDraft() {
    return { text: this.state.draft, mentions: this.state.draftMentions,
      references: this.state.references.filter((reference) => reference.status === "ready"),
      referenceEpoch: this.referenceDrafts.referenceEpoch };
  }

  restoreDisplayDraft(draft: ReturnType<AgentSessionController["exportDisplayDraft"]>) {
    this.referenceDrafts.restoreEpoch(draft.referenceEpoch);
    this.setDraftDocument(draft.text, draft.mentions);
    this.patch({ references: draft.references });
  }

  /** Selects a creation recipe before first discovery without restoring history. */
  async initializeForRuntime(runtimeId: string) {
    if (!runtimeId) return false;
    if (this.initializePromise) await this.initializePromise;
    if (this.state.initialized || this.state.inspection || this.state.session) {
      if (this.state.selectedRuntimeId === runtimeId) return true;
      return this.selectRuntime(runtimeId);
    }
    this.patch({ selectedRuntimeId: runtimeId });
    await this.initializeRuntime(false, false);
    return this.getSnapshot().inspection?.selectedRuntimeId === runtimeId;
  }

  /**
   * Binds a direct-creation recipe synchronously, then lets the mounted Chat
   * surface own discovery progress and recovery instead of blocking topology.
   */
  beginInitializeForRuntime(runtimeId: string) {
    void this.initializeForRuntime(runtimeId).catch((error: unknown) => {
      this.patch({
        phase: "failed",
        error: formatAgentError(error),
        initialized: true,
        sessionPreparation: "failed",
      });
    });
  }

  private async initializeRuntime(refresh: boolean, restoreLatest: boolean) {
    if (this.initializePromise) return this.initializePromise;
    if (restoreLatest && !refresh && hasFreshAgentRuntimeInspection(this.state, this.lastInspectionAt)) return;
    this.initializePromise = this.runInitialize(refresh, restoreLatest).finally(() => { this.initializePromise = null; });
    return this.initializePromise;
  }

  async discoverLocalConnections(refresh = false) {
    return this.localConnectionLoader.discover(refresh);
  }

  async selectRuntime(runtimeId: string) {
    const plan = planAgentRuntimeSwitch(this.state, runtimeId);
    if (!plan) return false;
    if (plan.alreadySelected) return true;
    this.submission.invalidate();
    await this.referenceDrafts.rotate([
      ...this.state.references,
    ]);
    this.patch(plan.patch);
    try {
      if (plan.sessionId) {
        await this.requireBridge("closeAgentSession").closeAgentSession({
          rootPath: this.workspaceRoot,
          sessionId: plan.sessionId,
          removePersistence: false,
        });
        this.sessionUi.delete(plan.sessionId);
      }
      // A runtime switch means "new chat". Native history is resumed only
      // through openSavedSession(), never as an implicit side effect here.
      await this.initializeRuntime(false, false);
      return this.state.selectedRuntimeId === runtimeId;
    } catch (error) {
      this.patch({ phase: "failed", error: formatAgentError(error) });
      return false;
    }
  }

  async openSavedSession(sessionId: string, runtimeId: string) {
    if (this.state.projection.runningTurnId) {
      this.patch({ error: createAgentError("active-turn") });
      return false;
    }
    const pendingReferences = this.state.pendingIntent?.references ?? [];
    this.submission.invalidate();
    this.sessionReplica.connect();
    const bridge = this.requireBridge("discoverAgentRuntimes", "openAgentSession");
    await this.referenceDrafts.reset([
      ...this.state.references,
      ...pendingReferences,
    ]);
    if (this.state.session) {
      await this.requireBridge("closeAgentSession").closeAgentSession({
        rootPath: this.workspaceRoot,
        sessionId: this.state.session.id,
        removePersistence: false,
      });
    }
    this.patch({
      phase: "discovering",
      session: null,
      projection: createAgentProjection(),
      selectedRuntimeId: runtimeId,
      error: null,
      references: [],
      sessionPreparation: "preparing",
    });
    try {
      const inspection = await bridge.discoverAgentRuntimes({
        rootPath: this.workspaceRoot,
        runtimeId,
        refresh: false,
      });
      const selectedModel = chooseAgentModel(inspection, null, null);
      const selectedModelEntry = inspection.models.find((model) => model.model === selectedModel);
      this.patch({
        inspection,
        selectedRuntimeId: inspection.selectedRuntimeId,
        selectedProviderId: agentProviderIdForModel(selectedModelEntry)
          || chooseAgentProvider(inspection, null, selectedModel),
        selectedModel,
        selectedEffort: chooseAgentEffort(selectedModelEntry, null),
        selectedMode: chooseAgentMode(inspection, null),
        initialized: true,
        phase: "restoring",
      });
      const result = await bridge.openAgentSession({
        rootPath: this.workspaceRoot,
        sessionId,
        runtimeId,
      });
      if (result.status === "failed") throw new AgentSessionOpenError(result.error);
      await this.applySnapshot(result.snapshot);
      this.patch({
        phase: result.snapshot.session.activeTurnId ? "running" : "ready",
        sessionPreparation: "ready",
      });
      return true;
    } catch (error) {
      this.patch({ phase: "failed", error: formatAgentError(error), sessionPreparation: "failed" });
      throw error;
    }
  }

  private async runInitialize(refresh: boolean, restoreLatest: boolean) {
    this.sessionReplica.connect();
    const bridge = restoreLatest
      ? this.requireBridge("discoverAgentRuntimes", "resumeAgentSession")
      : this.requireBridge("discoverAgentRuntimes");
    this.patch({ phase: "discovering", error: null });
    try {
      const inspection = await bridge.discoverAgentRuntimes({
        rootPath: this.workspaceRoot,
        runtimeId: this.state.selectedRuntimeId,
        refresh,
      });
      this.lastInspectionAt = Date.now();
      const runtimeId = inspection.selectedRuntimeId
        || null;
      const selectedModel = chooseAgentModel(inspection, this.state.selectedModel, null);
      const selectedModelEntry = inspection.models.find((model) => model.model === selectedModel);
      const selectedProviderId = agentProviderIdForModel(selectedModelEntry)
        || chooseAgentProvider(inspection, this.state.selectedProviderId, selectedModel);
      const selectedMode = chooseAgentMode(inspection, this.state.selectedMode);
      const selectedEffort = chooseAgentEffort(selectedModelEntry, this.state.selectedEffort);
      this.patch({ inspection, selectedRuntimeId: runtimeId, selectedProviderId, selectedModel, selectedEffort, selectedMode, initialized: true });
      if (!runtimeId || !inspection.readiness || inspection.readiness.status !== "ready") {
        this.patch({ phase: "ready", sessionPreparation: "idle" });
        return;
      }
      if (!restoreLatest) {
        this.patch({ phase: "ready", sessionPreparation: "idle" });
        return;
      }
      this.patch({ phase: "restoring" });
      const sessionId = this.state.session?.id;
      const restored = await bridge.resumeAgentSession({
        rootPath: this.workspaceRoot, runtimeId,
        ...(sessionId ? { sessionId } : {}),
      });
      if (sessionId && !restored) throw new Error("This Agent conversation is no longer available. Start a new conversation to continue.");
      if (restored) await this.applySnapshot(restored);
      this.patch({
        phase: restored?.session.activeTurnId ? "running" : "ready",
        sessionPreparation: restored ? "ready" : "idle",
      });
    } catch (error) {
      this.patch({
        phase: "failed",
        error: formatAgentError(error),
        initialized: true,
        sessionPreparation: "failed",
      });
    }
  }

  selectProvider(providerId: string | null) {
    if (this.state.projection.runningTurnId || this.state.pendingPrompt) return this.state.selectedModel;
    const selectedProviderId = providerId && listAgentInferenceProviders(this.state.inspection).some((provider) => provider.id === providerId)
      ? providerId
      : null;
    const selectedModel = chooseAgentModel(this.state.inspection, null, selectedProviderId);
    const selectedModelEntry = this.state.inspection?.models.find((model) => model.model === selectedModel);
    const preparationInvalidated = selectedProviderId !== this.state.selectedProviderId
      || selectedModel !== this.state.selectedModel
      ? this.sessionPreparer.invalidateSelection()
      : false;
    this.patch({
      selectedProviderId,
      selectedModel,
      selectedEffort: chooseAgentEffort(selectedModelEntry, null),
      error: null,
      ...(preparationInvalidated ? { sessionPreparation: "idle" as const } : {}),
    });
    return selectedModel;
  }

  selectModel(model: string | null) {
    if (this.state.projection.runningTurnId || this.state.pendingPrompt) return;
    const selectedModelEntry = model
      ? this.state.inspection?.models.find((candidate) => candidate.model === model) ?? null
      : null;
    const selectedModel = selectedModelEntry?.model ?? null;
    const preserveEffort = selectedModel === this.state.selectedModel ? this.state.selectedEffort : null;
    const selectedEffort = chooseAgentEffort(selectedModelEntry, preserveEffort);
    const preparationInvalidated = selectedModel !== this.state.selectedModel || selectedEffort !== this.state.selectedEffort
      ? this.sessionPreparer.invalidateSelection()
      : false;
    this.patch({
      selectedProviderId: selectedModelEntry ? agentProviderIdForModel(selectedModelEntry) : this.state.selectedProviderId,
      selectedModel,
      selectedEffort,
      error: null,
      ...(preparationInvalidated ? { sessionPreparation: "idle" as const } : {}),
    });
  }

  selectEffort(effort: string | null) {
    if (this.state.projection.runningTurnId || this.state.pendingPrompt) return;
    const selectedModel = this.state.inspection?.models.find((model) => model.model === this.state.selectedModel);
    const selectedEffort = chooseAgentEffort(selectedModel, effort);
    const preparationInvalidated = selectedEffort !== this.state.selectedEffort
      ? this.sessionPreparer.invalidateSelection()
      : false;
    this.patch({
      selectedEffort,
      error: null,
      ...(preparationInvalidated ? { sessionPreparation: "idle" as const } : {}),
    });
  }

  selectMode(mode: string | null) {
    if (this.state.projection.runningTurnId || this.state.pendingPrompt) return;
    const selectedMode = chooseAgentMode(this.state.inspection, mode);
    const preparationInvalidated = selectedMode !== this.state.selectedMode
      ? this.sessionPreparer.invalidateSelection()
      : false;
    this.patch({
      selectedMode,
      ...(preparationInvalidated ? { sessionPreparation: "idle" as const } : {}),
    });
  }

  setDraft(draft: string) {
    this.setDraftDocument(draft, []);
  }

  setDraftDocument(draft: string, draftMentions: AgentControllerState["draftMentions"]) {
    const mentions = draftMentions.map((mention) => ({ ...mention }));
    this.patch({ draft, draftMentions: mentions });
    this.writeCurrentSessionUi({ draft, draftMentions: mentions });
  }

  async addWorkspacePaths(
    paths: string[],
    visualPreviews?: Parameters<AgentReferenceDraftManager["addWorkspacePaths"]>[1],
  ) {
    return this.referenceDrafts.addWorkspacePaths(paths, visualPreviews);
  }

  getReferencePreviewUrl = (id: string) => this.referenceDrafts.previewUrl(id);

  captureReferenceAcquisition = () => this.referenceDrafts.captureAcquisition();

  async pickWorkspaceReferences() {
    return this.referenceDrafts.pickWorkspaceReferences();
  }

  async addPathTextOrDraft(text: string) {
    return this.referenceDrafts.addPathTextOrDraft(text);
  }

  async stageExternalFiles(files: File[]) {
    return this.referenceDrafts.stageExternalFiles(files);
  }

  removeReference(id: string) {
    this.referenceDrafts.remove(id);
  }

  retryReference(id: string) {
    this.referenceDrafts.retry(id);
  }

  appendDroppedText(text: string) {
    const value = text.trim();
    if (!value) return;
    const draft = this.state.draft ? `${this.state.draft}\n${value}` : value;
    this.setDraftDocument(draft, this.state.draftMentions);
  }

  rememberViewport(scrollTop: number, measurements: Record<string, number> = {}, pinned = true, geometry?: AgentViewportGeometry) {
    this.writeCurrentSessionUi({ scrollTop, measurements, pinned, ...(geometry ? { geometry } : {}) });
  }

  readViewport() {
    return this.readSessionUi(this.uiKey());
  }

  async newSession() {
    if (this.state.projection.runningTurnId) return this.sessionLifecycle.newSession();
    const pendingReferences = this.state.pendingIntent?.references ?? [];
    this.submission.invalidate();
    await this.referenceDrafts.reset([
      ...this.state.references,
      ...pendingReferences,
    ]);
    return this.sessionLifecycle.newSession();
  }

  async closeTabSession() {
    const closed = await this.sessionLifecycle.closeSession();
    if (!closed) return false;
    const pendingReferences = this.state.pendingIntent?.references ?? [];
    this.submission.invalidate();
    await this.referenceDrafts.reset([
      ...this.state.references,
      ...pendingReferences,
    ]);
    return true;
  }

  /** Closes prepared native ownership before releasing renderer resources. */
  async rollbackPreparation() {
    try {
      await this.sessionLifecycle.rollbackPreparation();
    } finally {
      this.dispose();
    }
  }

  prepareSession() {
    return this.sessionPreparer.prepare();
  }

  async submit(prompt: string) {
    return this.submission.submit(prompt);
  }

  async continueFromRecovery(turnId: string, prompt: string) {
    return this.submission.continueFromRecovery(turnId, prompt);
  }

  async stop() {
    const sessionId = this.state.session?.id;
    const turnId = this.state.projection.runningTurnId;
    if (!sessionId || !turnId) return;
    const bridge = this.requireBridge("interruptAgentTurn");
    this.patch({ stopping: true, error: null });
    try {
      await bridge.interruptAgentTurn({
        rootPath: this.workspaceRoot,
        sessionId,
        turnId,
        commandId: controlCommandId("interrupt"),
        ...commandPreconditions(this.state),
      });
    } catch (error) {
      this.patch({ stopping: false, error: formatAgentError(error) });
    }
  }

  async resolveApproval(decision: AgentApprovalDecision) {
    const approval = this.state.projection.approvals[0];
    const session = this.state.session;
    if (!approval || !session) return;
    const bridge = this.requireBridge("resolveAgentApproval");
    this.patch({ error: null });
    try {
      await bridge.resolveAgentApproval({
        rootPath: this.workspaceRoot,
        sessionId: session.id,
        turnId: approval.turnId,
        requestId: approval.requestId,
        commandId: controlCommandId("approval"),
        ...commandPreconditions(this.state),
        decision,
      });
    } catch (error) {
      this.patch({ error: formatAgentError(error) });
      await this.sessionReplica.repairFrom(this.state.projection.lastSequence);
    }
  }

  async resolveQuestion(resolution: Omit<AgentQuestionResolution, "rootPath" | "sessionId" | "turnId" | "requestId">) {
    const question = this.state.projection.questions[0];
    const session = this.state.session;
    if (!question || !session) return;
    const bridge = this.requireBridge("resolveAgentQuestion");
    this.patch({ error: null });
    try {
      await bridge.resolveAgentQuestion({
        ...resolution,
        rootPath: this.workspaceRoot,
        sessionId: session.id,
        turnId: question.turnId,
        requestId: question.requestId,
        commandId: controlCommandId("question"),
        ...commandPreconditions(this.state),
      });
    } catch (error) {
      this.patch({ error: formatAgentError(error) });
      await this.sessionReplica.repairFrom(this.state.projection.lastSequence);
    }
  }

  compactSession() {
    return this.sessionLifecycle.compactSession();
  }

  private async createSession() {
    const bridge = this.requireBridge("createAgentSession");
    return bridge.createAgentSession({
      rootPath: this.workspaceRoot,
      runtimeId: this.state.selectedRuntimeId,
      model: this.state.selectedModel,
      effort: this.state.selectedEffort,
      mode: this.state.selectedMode,
    });
  }

  private async applySnapshot(snapshot: AgentSessionSnapshot) {
    this.applySnapshotState(snapshot);
    const feedSnapshot = await this.sessionReplica.attachSession(snapshot.session.id);
    if (!feedSnapshot || this.disposed || this.state.session?.id !== snapshot.session.id) return;
    this.applySnapshotState(feedSnapshot);
    await this.sessionReplica.activateSessionFeed(snapshot.session.id);
  }

  private applySnapshotState(snapshot: AgentSessionSnapshot) {
    assertAgentSessionSnapshot(snapshot);
    const inspection = this.state.inspection ? {
      ...this.state.inspection,
      runtime: snapshot.runtime ?? snapshot.session.runtime ?? this.state.inspection.runtime,
      account: snapshot.account,
      providers: snapshot.providers ?? this.state.inspection.providers ?? [],
      models: snapshot.models,
      modes: snapshot.modes ?? this.state.inspection.modes ?? [],
      commands: snapshot.commands ?? this.state.inspection.commands ?? [],
      capabilities: snapshot.capabilities,
    } : null;
    const requestedModel = snapshot.session.selectedModel
      || this.state.selectedModel
      || chooseAgentModel(inspection, null, null);
    const selectedModel = chooseAgentModel(inspection, requestedModel, null);
    const selectedModelEntry = inspection?.models.find((model) => model.model === selectedModel);
    const selectedProviderId = agentProviderIdForModel(selectedModelEntry)
      || chooseAgentProvider(inspection, this.state.selectedProviderId, selectedModel);
    const projection = snapshot.display;
    const session = snapshot.session;
    this.patch({
      session,
      control: snapshot.control ?? null,
      replicaStatus: snapshot.cursor ? "subscribing" : "detached",
      inspection,
      selectedRuntimeId: snapshot.session.runtimeId || snapshot.session.provider || this.state.selectedRuntimeId,
      selectedProviderId,
      selectedModel,
      selectedEffort: chooseAgentEffort(
        selectedModelEntry,
        snapshot.session.selectedEffort || this.state.selectedEffort,
      ),
      selectedMode: snapshot.session.selectedMode || this.state.selectedMode || chooseAgentMode(inspection, null),
      projection,
      stopping: false,
      sessionPreparation: "ready",
    });
  }

  private patch(patch: Partial<AgentControllerState>) {
    if (this.disposed) return;
    if (patch.phase && patch.phase !== this.state.phase && !agentControllerTransitions[this.state.phase].includes(patch.phase)) {
      throw new Error(`Invalid Agent controller transition: ${this.state.phase} -> ${patch.phase}`);
    }
    let next = { ...this.state, ...patch };
    if (patch.session === null && patch.control === undefined) {
      next = { ...next, control: null, replicaStatus: "detached" };
    }
    if (next.control && next.session) next = deriveControlReplicaState(next);
    this.state = next;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.error("Agent display subscriber failed", error); }
    }
  }

  private requireBridge<K extends keyof AgentClientPort>(...methods: K[]): AgentClientPort {
    const bridge = this.bridgeProvider();
    if (!bridge || methods.some((method) => typeof bridge[method] !== "function")) {
      throw new AgentKnownError("native-bridge-unavailable");
    }
    return bridge;
  }

  private uiKey() {
    return this.state.session?.id || `${this.workspaceRoot}:new`;
  }

  private readSessionUi(key: string): SessionUiState {
    return this.sessionUi.read(key);
  }

  private writeCurrentSessionUi(value: Partial<SessionUiState>) {
    const key = this.uiKey();
    this.sessionUi.patch(key, value);
  }

}

function deriveControlReplicaState(state: AgentControllerState): AgentControllerState {
  if (!state.control || !state.session) return state;
  const view = state.projection.presentation;
  const admitted = state.pendingIntent && state.control.commands.some(command => command.commandId === state.pendingIntent?.id);
  const localPending = state.pendingIntent && !admitted ? state.pendingIntent.prompt : null;
  return {
    ...state,
    phase: state.phase === "discovering" || state.phase === "restoring" ? state.phase : view.phase,
    session: { ...state.session, activeTurnId: state.projection.runningTurnId, terminalState: view.terminalState },
    pendingPrompt: view.pendingPrompt ?? localPending,
    submitting: view.submitting || Boolean(state.pendingIntent),
    stopping: view.stopping,
  };
}

function controlCommandId(kind: string) {
  const identity = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${identity}`;
}

function commandPreconditions(state: AgentControllerState) {
  const control = state.control;
  if (!control) return {};
  return {
    expectedSessionEpoch: control.sessionEpoch,
    expectedAdapterGeneration: control.adapterGeneration,
    expectedRunGeneration: control.runGeneration,
  };
}

export const agentSessionControllerLimits = Object.freeze({
  discoveryCacheTtlMs: AGENT_RUNTIME_DISCOVERY_CACHE_TTL_MS,
});
