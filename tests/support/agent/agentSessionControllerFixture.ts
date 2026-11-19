import { vi } from "vitest";
import type { AgentCapabilities, AgentRuntimeReadiness } from "../../../shared/agent-contract/types";
import type { AgentEvent, AgentSessionSnapshot } from "../../../src/features/desktop-agent/agentTypes";
import type { AgentClientPort } from "../../../src/features/desktop-agent/application/AgentClientPort";
import { displaySnapshot, withDisplayFeed } from "./agentDisplayFixture";
import { defineAgentEvent, type AgentEventPayloadMap } from "./agentEventFixture";

/** The Main bridge, runtime discovery and event fixtures that every AgentSessionController test drives. */
export function bridgeFixture(
  onEvent: (listener: (event: AgentEvent) => void) => void,
  capabilityOverrides: Partial<ReturnType<typeof capabilities>> = {},
) {
  return withDisplayFeed({
    discoverAgentRuntimes: vi.fn<AgentClientPort["discoverAgentRuntimes"]>(async () => ({
      runtimes: [{ descriptor: { id: "opencode", displayName: "OpenCode", priority: 100 }, readiness: readiness() }],
      selectedRuntimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      readiness: readiness(),
      account: { account: { type: "opencode", email: null, planType: null }, requiresOpenaiAuth: false },
      providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
      models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
      modes: [{ id: "build", displayName: "Build", description: "", isDefault: true }],
      commands: [],
      capabilities: capabilities(capabilityOverrides),
      warnings: [],
    })),
    discoverLocalAgentConnections: vi.fn<AgentClientPort["discoverLocalAgentConnections"]>(async () => ({ connections: [], scannedAt: "2026-07-12T00:00:00.000Z", warnings: [] })),
    resumeAgentSession: vi.fn<AgentClientPort["resumeAgentSession"]>(async () => snapshot("session-1", [event(1, "session.resumed", { title: "Session" })], capabilityOverrides)),
    openAgentSession: vi.fn<AgentClientPort["openAgentSession"]>(async () => ({
      status: "opened" as const,
      snapshot: snapshot("session-1", [event(1, "session.resumed", { title: "Session" })], capabilityOverrides),
    })),
    createAgentSession: vi.fn<AgentClientPort["createAgentSession"]>(async () => snapshot("session-2", [event(1, "session.started", { title: "New" }, null, null, "session-2")], capabilityOverrides)),
    startAgentTurn: vi.fn<AgentClientPort["startAgentTurn"]>(async () => ({ sessionId: "session-1", turnId: "turn-next" })),
    replayAgentSession: vi.fn<AgentClientPort["replayAgentSession"]>(async () => snapshot("session-1", [event(4, "assistant.completed", { text: "Working" }, "turn-1", "message-1")], capabilityOverrides)),
    closeAgentSession: vi.fn<AgentClientPort["closeAgentSession"]>(async () => ({ sessionId: "session-1", closed: true })),
    stageAgentAttachments: vi.fn<AgentClientPort["stageAgentAttachments"]>(async () => [{
      id: "stage-reference",
      kind: "staged-attachment",
      token: "stage-token",
      displayName: "capture.png",
      mime: "image/png",
      size: 3,
      status: "ready",
    }]),
    revokeAgentAttachments: vi.fn<AgentClientPort["revokeAgentAttachments"]>(async ({ tokens }: { tokens: string[] }) => ({ revoked: tokens.length })),
    resolveAgentWorkspaceReferences: vi.fn<AgentClientPort["resolveAgentWorkspaceReferences"]>(async ({ paths }: { paths: string[] }) => paths.map((referencePath, index) => ({
      id: `workspace-${index}-${referencePath.replace(/[^A-Za-z0-9]/g, "-")}`,
      kind: "workspace-entry",
      entryType: referencePath === "src" ? "directory" : "file",
      relativePath: referencePath,
      displayName: referencePath.split("/").at(-1) || referencePath,
      mime: "text/markdown",
      size: 4,
      status: "ready",
    }))),
    pickAgentWorkspaceReferences: vi.fn<AgentClientPort["pickAgentWorkspaceReferences"]>(async () => []),
    steerAgentTurn: vi.fn<AgentClientPort["steerAgentTurn"]>(async () => ({ sessionId: "session-1", turnId: "turn-running", steered: true })),
    listAgentSessions: vi.fn<AgentClientPort["listAgentSessions"]>(async () => ({
      sessions: [],
      discovery: {
        runtimeId: null,
        status: "not-requested" as const,
        nextCursor: null,
        scanId: null,
        indexed: 0,
        warnings: [],
      },
      warnings: [],
    })),
  }, onEvent);
}

export function snapshot(
  sessionId: string,
  events: AgentEvent[],
  capabilityOverrides: Partial<ReturnType<typeof capabilities>> = {},
): AgentSessionSnapshot {
  return displaySnapshot({
    session: {
      id: sessionId,
      runtimeId: "opencode",
      runtime: { id: "opencode", displayName: "OpenCode" },
      provider: "opencode",
      providerSessionId: `native-${sessionId}`,
      workspaceRoot: "/workspace",
      title: "Session",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      terminalState: "idle",
      selectedModel: "openai/gpt-5",
      selectedMode: "build",
      activeTurnId: null,
      lastSequence: events.at(-1)?.sequence ?? 0,
    },
    account: { account: { type: "opencode", email: null, planType: null }, requiresOpenaiAuth: false },
    providers: [{ id: "openai", displayName: "OpenAI", defaultModel: "openai/gpt-5", modelCount: 1 }],
    models: [{ id: "openai/gpt-5", model: "openai/gpt-5", providerId: "openai", displayName: "GPT-5", description: "OpenAI · GPT-5", isDefault: true }],
    modes: [{ id: "build", displayName: "Build", description: "", isDefault: true }],
    commands: [],
    capabilities: capabilities(capabilityOverrides),
    events,
    partial: false,
    firstAvailableSequence: events[0]?.sequence ?? 1,
    lastSequence: events.at(-1)?.sequence ?? 0,
  });
}

export function readiness(): AgentRuntimeReadiness {
  return { runtimeId: "opencode", provider: "opencode", status: "ready" as const, code: "READY", version: "1.17.18", minimumVersion: "1.17.18", message: "ready" };
}

export function readinessFor(runtimeId: string): AgentRuntimeReadiness {
  return { runtimeId, provider: runtimeId, status: "ready" as const, code: "READY", version: "1.0.0", minimumVersion: null, message: "ready", selectable: true };
}

export function runtimeInspection(
  runtimes: Array<{ descriptor: { id: string; displayName: string; iconKey: string; distribution: string }; readiness: ReturnType<typeof readinessFor> }>,
  runtimeId: string,
  model: { id: string; model: string; displayName: string; description: string; isDefault: boolean },
) {
  const runtime = runtimes.find((entry) => entry.descriptor.id === runtimeId)!.descriptor;
  return {
    runtimes,
    selectedRuntimeId: runtimeId,
    runtime,
    readiness: readinessFor(runtimeId),
    account: null,
    providers: [],
    models: [model],
    modes: [],
    commands: [],
    capabilities: capabilities(),
    warnings: [],
  };
}

export function runtimeSnapshot(
  sessionId: string,
  runtimeId: string,
  displayName: string,
  model: { id: string; model: string; displayName: string; description: string; isDefault: boolean },
): AgentSessionSnapshot {
  const base = snapshot(sessionId, []);
  const runtime = { id: runtimeId, displayName };
  return {
    ...base,
    session: {
      ...base.session,
      runtimeId,
      runtime,
      provider: runtimeId,
      selectedModel: model.model,
    },
    runtime,
    account: null,
    providers: [],
    models: [model],
    modes: [],
  };
}

export function capabilities(overrides: Partial<AgentCapabilities> = {}): AgentCapabilities {
  return { streamingText: true, structuredToolEvents: true, commandOutputStreaming: true, fileChangeEvents: true, manualApprovals: true, structuredQuestions: true, resume: true, fork: true, steer: false, queue: false, attachments: true, contextReferences: true, modelSelection: true, modeSelection: true, slashCommands: true, sessionHistory: true, usage: true, accountState: true, mcp: true, skills: true, compaction: true, referenceInputs: referenceCapabilities(), ...overrides };
}

export function referenceCapabilities() {
  return {
    schemaVersion: 1 as const,
    workspace: { files: true, directories: true },
    attachments: {
      image: { accepted: true, mimeTypes: ["image/png"] },
      text: { accepted: false },
      audio: { accepted: false },
      video: { accepted: false },
      binary: { accepted: false },
    },
    limits: {
      maxCount: 32,
      maxBytesPerReference: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
    },
    steer: false,
    attachmentOnly: false,
  };
}

export function event<T extends AgentEvent["type"]>(sequence: number, type: T, payload: AgentEventPayloadMap[T] & Record<string, unknown>, turnId: string | null = null, itemId: string | null = null, sessionId = "session-1"): AgentEvent<T> {
  return defineAgentEvent<T>({ schemaVersion: 1, sequence, sessionId, runtimeId: "opencode", provider: "opencode", providerSessionId: "native-1", turnId, itemId, emittedAt: new Date(sequence * 1_000).toISOString(), type, payload });
}
