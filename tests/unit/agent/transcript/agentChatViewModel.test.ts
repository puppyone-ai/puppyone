import { describe, expect, it } from "vitest";
import { AgentSessionController } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import type { AgentControllerState } from "../../../../src/features/desktop-agent/application/agent-controller-state";
import { deriveAgentChatRuntime, deriveAgentChatViewModel, type AgentChatViewOptions } from "../../../../src/features/desktop-agent/ui/agentChatViewModel";
import { testT } from "../../../support/react/localization";

function readyState(): AgentControllerState {
  const state = new AgentSessionController("/workspace", () => undefined).getSnapshot();
  return { ...state, initialized: true, phase: "ready", selectedRuntimeId: "opencode", selectedModel: "model-1", replicaStatus: "live",
    inspection: {
      runtime: { id: "opencode", displayName: "OpenCode", kind: "harness" },
      readiness: { runtimeId: "opencode", provider: "opencode", status: "ready", code: "READY", version: "1", minimumVersion: null, message: "Ready" },
      account: null, models: [{ id: "model-1", model: "model-1", displayName: "Model", description: "Test", isDefault: true }], warnings: [],
      capabilities: { streamingText: true, structuredToolEvents: true, commandOutputStreaming: true, fileChangeEvents: true,
        manualApprovals: true, structuredQuestions: true, resume: true, fork: false, steer: false, queue: false, attachments: false,
        contextReferences: false, modelSelection: true, modeSelection: false, slashCommands: false, sessionHistory: true, usage: true,
        accountState: true, mcp: false, skills: false, compaction: false },
    },
  };
}
function view(state = readyState(), options: Partial<AgentChatViewOptions> = {}, hidden: string[] = []) {
  return deriveAgentChatViewModel(state, deriveAgentChatRuntime(state, hidden, testT), {
    presented: true, pendingConnectionModel: null, computeReady: false, computeAccessRequired: null, preferencesReady: true, ...options,
  }, testT);
}
function onboard() {
  const state = readyState();
  state.inspection!.capabilities!.modelConnections = true;
  state.inspection!.readiness = { ...state.inspection!.readiness!, status: "error", code: "RUNTIME_SETUP_REQUIRED" };
  state.selectedModel = null;
  return state;
}

describe("Agent chat view model", () => {
  it("derives ready rendering and session preparation from the same route", () => {
    expect(view()).toMatchObject({ routingReady: true, composerDisabled: false, showReadyEmptyState: true, showStatus: false,
      presentation: { title: "OpenCode", runtimeLabel: "OpenCode", statusCode: "ready", running: false },
      composerPlaceholder: testT("agent.composer.placeholder.default"), sessionControls: [{ id: "model" }],
    });
  });

  it.each(["discovering", "restoring", "creating"] as const)("shows startup loading for %s", phase => {
    expect(view({ ...readyState(), phase })).toMatchObject({ loading: true, startupLoading: true, composerDisabled: true, showReadyEmptyState: false });
    expect(view({ ...readyState(), phase }, { presented: false }).startupLoading).toBe(false);
  });
  it.each(["failed", "runtime-exited"] as const)("preserves %s recovery", phase => {
    expect(view({ ...readyState(), phase })).toMatchObject({ failed: true, showStatus: true, composerDisabled: true,
      composerPlaceholder: testT("agent.composer.placeholder.preparing"), showReadyEmptyState: false });
  });
  it.each(["stale", "subscribing"] as const)("blocks the composer while replica is %s", replicaStatus => {
    expect(view({ ...readyState(), replicaStatus }).composerDisabled).toBe(true);
  });
  it("keeps hidden sessions bound while hiding unused runtimes from the launcher", () => {
    const state = readyState();
    expect(view(state, {}, ["opencode"])).toMatchObject({ agentRuntimeSelected: false, showRuntimeLauncher: true, runtimeModels: [],
      composerPlaceholder: testT("agent.composer.placeholder.chooseAgent") });
    state.session = session();
    expect(view(state, {}, ["opencode"])).toMatchObject({ agentRuntimeSelected: true, showRuntimeLauncher: false, agentRuntimes: [] });
  });
  it("blocks missing, unregistered and pending model routes", () => {
    expect(view({ ...readyState(), selectedModel: null })).toMatchObject({ routingReady: false, composerPlaceholder: testT("agent.composer.placeholder.chooseModel") });
    expect(view({ ...readyState(), selectedModel: "missing" }).routingReady).toBe(false);
    expect(view(readyState(), { preferencesReady: false }).routingReady).toBe(false);
    expect(view(readyState(), { pendingConnectionModel: "model-2" }).routingReady).toBe(false);
    const state = readyState(); state.inspection!.capabilities!.modelSelection = false; state.selectedModel = null;
    expect(view(state).routingReady).toBe(true);
  });
  it("requires compute readiness only for app-managed models and hides their duplicate model picker", () => {
    const state = readyState(); state.inspection!.capabilities!.modelConnections = true;
    expect(view(state)).toMatchObject({ modelConnections: true, routingReady: false, sessionControls: [] });
    expect(view(state, { computeReady: true }).routingReady).toBe(true);
    expect(view(state, { computeReady: true, pendingConnectionModel: "model-2" }).routingReady).toBe(false);
  });
  it("offers first-use access without turning setup into a session failure", () => {
    expect(view(onboard())).toMatchObject({ computeOnboarding: true, showReadyEmptyState: true, showStatus: false,
      composerDisabled: true, composerPlaceholder: testT("agent.composer.placeholder.default") });
    expect(view(onboard(), { computeAccessRequired: "sign-in" })).toMatchObject({ canRequestComputeAccess: true, composerDisabled: false, routingReady: false });
  });
  it.each(["AUTHENTICATION_REQUIRED", "AUTHENTICATION_EXPIRED", "PROVIDER_CREDENTIALS_REJECTED"] as const)("retains recovery for %s", code => {
    const state = onboard(); state.inspection!.readiness!.code = code;
    expect(view(state, { computeAccessRequired: "sign-in" })).toMatchObject({ computeOnboarding: false, canRequestComputeAccess: false, showStatus: true });
  });
  it.each(["model", "session", "history", "error", "failed"] as const)("excludes %s from first-use onboarding", reason => {
    const state = onboard();
    if (reason === "model") state.selectedModel = "model-1";
    if (reason === "session") state.session = session();
    if (reason === "history") state.projection.messages.push({} as never);
    if (reason === "error") state.error = { code: "event-gap" };
    if (reason === "failed") state.phase = "failed";
    expect(view(state).computeOnboarding).toBe(false);
  });
  it.each(["rows", "parts", "messages", "activities", "approvals", "questions"] as const)("suppresses empty state for %s", kind => {
    const state = readyState(); state.projection[kind].push({} as never);
    expect(view(state).showReadyEmptyState).toBe(false);
    if (["rows", "messages"].includes(kind)) expect(view(state).composerPlaceholder).toBe(testT("agent.composer.placeholder.followUp"));
    if (["approvals", "questions"].includes(kind)) expect(view(state).composerDisabled).toBe(true);
  });
  it("keeps the empty overlay for drafts but hides it for history gaps and connection status", () => {
    expect(view({ ...readyState(), draft: "unsent" }).showReadyEmptyState).toBe(true);
    const state = readyState(); state.projection.history.coverage = "partial";
    expect(view(state).showReadyEmptyState).toBe(false);
    state.projection.history.coverage = "complete";
    state.projection.connectionStatus = { state: "reconnecting" } as never;
    expect(view(state).showReadyEmptyState).toBe(false);
  });
  it("keeps attachment-only submission feedback across session preparation and native admission", () => {
    const state = { ...readyState(), submitting: true, pendingPrompt: "" };
    expect(view(state)).toMatchObject({ submissionPending: true, submissionStage: "preparing-session", configurationDisabled: true });
    state.session = session();
    expect(view(state).submissionStage).toBe("starting-turn");
    state.sessionPreparation = "preparing";
    expect(view(state).submissionStage).toBe("preparing-session");
    state.projection.runningTurnId = "turn-1";
    expect(view(state)).toMatchObject({ submissionStage: null, running: true, computeDisabled: true });
  });
  it("preserves silent event-gap recovery without suppressing other errors", () => {
    const state = readyState();
    state.error = { code: "event-gap" };
    state.displayRecovery = { stage: "silent", cause: "revision-gap", policy: "automatic", attempt: 1, maxAttempts: 3 };
    expect(view(state).showStatus).toBe(false);
    state.displayRecovery.stage = "reconnecting";
    expect(view(state).showStatus).toBe(true);
  });
  it("keeps read-only capability separate from route readiness", () => {
    const state = readyState(); state.inspection!.capabilities!.readOnly = true;
    expect(view(state)).toMatchObject({ readOnly: true, routingReady: true, composerDisabled: true });
  });
});
function session(): NonNullable<AgentControllerState["session"]> {
  return { id: "session-1", provider: "opencode", providerSessionId: "native-1", workspaceRoot: "/workspace", title: "Saved chat",
    createdAt: "2026-01-01", updatedAt: "2026-01-01", terminalState: "idle", selectedModel: "model-1", activeTurnId: null, lastSequence: 0 };
}
