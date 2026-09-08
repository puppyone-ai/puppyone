import { isAgentEventEnvelope } from "../agent-events.mjs";
import { randomUUID } from "node:crypto";
import { normalizeCapabilitySnapshot, sanitizeAgentEventEnvelope, sanitizeAgentRuntimeDescriptor } from "../../../../shared/agent-contract/schema.mjs";
import { normalizeAgentEventWorkspacePaths } from "./agent-event-workspace-paths.mjs";
import { AgentSessionActor } from "./agent-session-actor.mjs";
import { projectAgentControlView } from "./agent-control-view.mjs";

const MAX_REPLAY_EVENTS = 1_000;

export function createAgentSessionRecord({
  id,
  ownerId,
  sender,
  workspaceRoot,
  runtimeId,
  runtime,
  model,
  effort,
  mode,
  events = [],
  sequence = 0,
  createdAt,
  title,
  terminalState = "idle",
}) {
  const restoredEvents = Array.isArray(events)
    ? events
      .filter(isAgentEventEnvelope)
      .slice(-MAX_REPLAY_EVENTS)
      .map((event) => normalizeAgentEventWorkspacePaths(sanitizeAgentEventEnvelope(event), workspaceRoot))
    : [];
  const highestSequence = restoredEvents.reduce((highest, event) => Math.max(highest, event.sequence), 0);
  const actor = new AgentSessionActor({
    events: restoredEvents,
    sequence: Math.max(normalizeSequence(sequence), highestSequence),
    terminalState,
  });
  const session = {
    id,
    instanceId: randomUUID(),
    ownerId,
    sender,
    workspaceRoot,
    runtimeId,
    runtime: runtime ? { ...runtime } : { id: runtimeId, displayName: runtimeId },
    providerSessionId: null,
    adapter: null,
    actor,
    referenceClaims: new Map(),
    privateReferencePaths: new Map(),
    activeReferenceTokens: [],
    account: null,
    providers: [],
    models: [],
    modes: [],
    commands: [],
    capabilities: null,
    selectedModel: model,
    selectedEffort: effort,
    selectedMode: mode,
    title: title || `${runtime?.displayName || "Agent"} session`,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    persistTimer: null,
    interruptFallbackTimer: null,
    closing: false,
    lifecycleEventSeen: false,
  };
  Object.defineProperties(session, {
    activeTurnId: { enumerable: true, get: () => actor.control.execution.activeTurnId },
    activeTurnStartedAtMs: { enumerable: true, get: () => actor.control.execution.startedAtMs },
    lastStartedTurnId: { enumerable: true, get: () => actor.control.execution.activeTurnId },
    pendingPrompt: { enumerable: true, get: () => actor.control.pendingSubmission?.prompt ?? null },
    pendingPromptMentions: { enumerable: true, get: () => actor.control.pendingSubmission?.promptMentions ?? [] },
    pendingReferenceDisplays: { enumerable: true, get: () => actor.control.pendingSubmission?.referenceDisplays ?? [] },
    turnStarting: { enumerable: true, get: () => actor.control.execution.status === "starting" },
    interruptingTurnId: {
      enumerable: true,
      get: () => actor.control.commands.find((entry) => entry.kind === "interrupt" && entry.status === "dispatching")?.targetTurnId ?? null,
    },
    terminalTurnIds: { enumerable: false, get: () => new Set(actor.control.terminalTurns) },
    pendingApprovals: { enumerable: false, get: () => new Map(actor.control.interaction.approvals.map((entry) => [entry.requestId, entry])) },
    pendingQuestions: { enumerable: false, get: () => new Map(actor.control.interaction.questions.map((entry) => [entry.requestId, entry])) },
    sequence: { enumerable: true, get: () => actor.sequence },
    events: { enumerable: true, get: () => actor.events() },
    replayBytes: { enumerable: false, get: () => actor.replayBytes },
    terminalState: { enumerable: true, get: () => terminalStateFromControl(actor.control) },
    providerExited: { enumerable: true, get: () => actor.control.connection.status === "exited" },
  });
  return session;
}

export function requireConnectedSession(session) {
  if (session.providerExited || !session.adapter) {
    throw new Error(`${session.runtime?.displayName || "Agent runtime"} is disconnected. Refresh to resume the saved session.`);
  }
}

export function persistedRecordFromSession(session) {
  return {
    sessionId: session.id,
    workspaceRoot: session.workspaceRoot,
    runtimeId: session.runtimeId,
    runtime: session.runtime,
    provider: session.runtimeId,
    providerSessionId: session.providerSessionId,
    sourceScopeId: session.sourceScopeId ?? "default",
    ...(session.historyCoverage ? { historyCoverage: session.historyCoverage } : {}),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    terminalState: session.terminalState,
    selectedModel: session.selectedModel,
    selectedEffort: session.selectedEffort,
    selectedMode: session.selectedMode,
    lastSequence: session.sequence,
    events: session.events,
  };
}

export function applyProviderSession(session, providerSession) {
  session.providerSessionId = providerSession.providerSessionId;
  session.title = providerSession.title || session.title;
  session.selectedModel = providerSession.model || session.selectedModel;
  session.selectedEffort = providerSession.effort || session.selectedEffort;
  session.selectedMode = providerSession.mode || session.selectedMode;
  session.createdAt = providerSession.createdAt || session.createdAt;
  session.updatedAt = providerSession.updatedAt || new Date().toISOString();
}

export function applyInspection(session, inspection) {
  session.account = inspection.account ?? null;
  session.providers = Array.isArray(inspection.providers) ? inspection.providers : [];
  session.models = Array.isArray(inspection.models) ? inspection.models : [];
  session.modes = Array.isArray(inspection.modes) ? inspection.modes : [];
  session.commands = Array.isArray(inspection.commands) ? inspection.commands : [];
  session.capabilities = normalizeCapabilitySnapshot(inspection.capabilities);
  if (inspection.runtime) session.runtime = { ...session.runtime, ...sanitizeAgentRuntimeDescriptor(inspection.runtime) };
  if (session.selectedModel && !session.models.some((model) => model.model === session.selectedModel)) {
    session.selectedModel = null;
  }
  if (!session.selectedModel) {
    const providerIds = new Set(session.models.map(modelProviderId).filter(Boolean));
    if (providerIds.size <= 1) {
      const [providerId] = providerIds;
      const providerModels = providerId
        ? session.models.filter((model) => modelProviderId(model) === providerId)
        : session.models;
      session.selectedModel = providerModels.find((model) => model.isDefault)?.model ?? providerModels[0]?.model ?? null;
    }
  }
  const selectedModel = session.models.find((model) => model.model === session.selectedModel);
  const efforts = selectedModel?.variants ?? [];
  if (!session.selectedEffort || !efforts.includes(session.selectedEffort)) {
    session.selectedEffort = selectedModel?.defaultVariant && efforts.includes(selectedModel.defaultVariant)
      ? selectedModel.defaultVariant
      : efforts.includes("medium") ? "medium" : efforts[0] ?? null;
  }
  if (!session.selectedMode) {
    session.selectedMode = session.modes.find((mode) => mode.isDefault)?.id ?? session.modes[0]?.id ?? null;
  }
}

export function sessionMetadata(session, control = session.actor.control) {
  return {
    instanceId: session.instanceId,
    id: session.id,
    runtimeId: session.runtimeId,
    runtime: session.runtime,
    provider: session.runtimeId,
    providerSessionId: session.providerSessionId,
    sourceScopeId: session.sourceScopeId ?? "default",
    workspaceRoot: session.workspaceRoot,
    ...(session.historyCoverage ? { historyCoverage: session.historyCoverage } : {}),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    terminalState: terminalStateFromControl(control),
    selectedModel: session.selectedModel,
    selectedEffort: session.selectedEffort,
    selectedMode: session.selectedMode,
    activeTurnId: control.execution.activeTurnId,
    lastSequence: session.sequence,
  };
}

export function sessionSnapshot(session) {
  const actorSnapshot = session.actor.snapshot();
  return {
    session: sessionMetadata(session),
    account: session.account,
    providers: session.providers,
    models: session.models,
    modes: session.modes,
    commands: session.commands,
    capabilities: session.capabilities,
    runtime: session.runtime,
    cursor: actorSnapshot.cursor,
    control: projectAgentControlView(actorSnapshot.control),
    display: actorSnapshot.display,
    timeline: actorSnapshot.timeline,
    events: actorSnapshot.timeline.events,
    partial: actorSnapshot.timeline.partial,
    firstAvailableSequence: actorSnapshot.timeline.firstAvailableSequence,
    lastSequence: actorSnapshot.timeline.lastSequence,
  };
}

function terminalStateFromControl(control) {
  if (control.connection.status === "exited") return "provider-exited";
  if (control.execution.activeTurnId) return "running";
  if (control.execution.status === "outcome-unknown") return "outcome-unknown";
  return control.execution.nativeOutcome || "idle";
}

function modelProviderId(model) {
  if (typeof model?.providerId === "string" && model.providerId) return model.providerId;
  if (typeof model?.model !== "string") return null;
  const slash = model.model.indexOf("/");
  return slash > 0 ? model.model.slice(0, slash) : null;
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}
