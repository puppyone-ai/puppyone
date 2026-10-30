/**
 * The Agent side of the fake desktop bridge: enough of Main's Agent service
 * for the real chat surface to open a session and stream a scripted run.
 *
 * The transcript is produced by Main's own pure code running in the browser:
 * AgentSessionActor folds canonical Agent events into the display state and
 * emits display patches, exactly as it does for a live Codex or Claude Code
 * session. The demo only decides which events happen and when.
 */
import { createHostRpc } from "../../shared/item-host-contract/rpc.mjs";
import { AgentSessionActor, type AgentActorCommit } from "../../electron/main/agent/domain/agent-session-actor.mjs";
import { projectAgentControlView } from "../../electron/main/agent/domain/agent-control-view.mjs";
import { createAgentFileChangeEvidence } from "../../electron/main/agent/runtime/agent-file-change-evidence.mjs";
import type { DemoAgent, DemoScenario } from "./scenario";

const RUNTIMES: Record<DemoAgent, { id: string; displayName: string; iconKey: string; model: [string, string] }> = {
  claude: { id: "claude", displayName: "Claude Code", iconKey: "claude", model: ["claude-sonnet-4.5", "Claude Sonnet 4.5"] },
  codex: { id: "codex", displayName: "Codex", iconKey: "codex", model: ["gpt-5.4", "GPT-5.4"] },
  cursor: { id: "cursor", displayName: "Cursor Agent", iconKey: "cursor", model: ["auto", "Auto"] },
  opencode: { id: "opencode-native", displayName: "OpenCode", iconKey: "opencode", model: ["openai/gpt-5.4", "GPT-5.4"] },
};

const CAPABILITIES = {
  streamingText: true,
  structuredToolEvents: true,
  commandOutputStreaming: true,
  fileChangeEvents: true,
  manualApprovals: false,
  structuredQuestions: false,
  resume: false,
  fork: false,
  steer: false,
  queue: false,
  attachments: false,
  contextReferences: true,
  modelSelection: true,
  modeSelection: false,
  slashCommands: false,
  sessionHistory: false,
  usage: false,
  accountState: false,
  mcp: false,
  skills: false,
  compaction: false,
};

export type AgentHostOptions = {
  scenario: DemoScenario;
  rootPath: string;
  instant: boolean;
  /** Current content of a workspace file (for before/after diffs). */
  readFile: (path: string) => string | undefined;
  /** Apply an agent write to the in-memory folder. */
  writeFile: (path: string, content: string) => void;
  /** The chat is connected and showing its (empty) session. */
  onReady?: () => void;
  /** The run starts once this resolves (the embedding page says when). */
  startSignal?: Promise<void>;
  onDone?: () => void;
};

export function createFakeAgentHost({ scenario, rootPath, instant, readFile, writeFile, onReady, startSignal, onDone }: AgentHostOptions) {
  const runtime = RUNTIMES[scenario.agent];
  const descriptor = { id: runtime.id, displayName: runtime.displayName, iconKey: runtime.iconKey, distribution: "user-installed", kind: "harness" };
  const readiness = { runtimeId: runtime.id, provider: runtime.id, status: "ready", code: "READY", version: "1.0.0", minimumVersion: null, message: "Ready", selectable: true };
  const model = { id: runtime.model[0], model: runtime.model[0], displayName: runtime.model[1], description: "", isDefault: true };
  const inspection = {
    runtimes: [{ descriptor, readiness }],
    selectedRuntimeId: runtime.id,
    runtime: descriptor,
    readiness,
    account: { account: null, requiresOpenaiAuth: false },
    models: [model],
    capabilities: CAPABILITIES,
    warnings: [],
  };

  // ---- one session, folded by Main's actor -------------------------------------
  const actor = new AgentSessionActor();
  const sessionId = "website-demo-session";
  const instanceId = "website-demo-agent";
  const createdAt = new Date().toISOString();
  actor.dispatch({ type: "adapter.attached" });

  const metadata = (commit?: AgentActorCommit) => {
    const control = projectAgentControlView(actor.control);
    return {
      instanceId,
      id: sessionId,
      runtimeId: runtime.id,
      runtime: descriptor,
      provider: runtime.id,
      providerSessionId: "website-demo-thread",
      sourceScopeId: "default",
      workspaceRoot: rootPath,
      title: scenario.prompt.slice(0, 60),
      createdAt,
      updatedAt: commit?.emittedAt ?? createdAt,
      terminalState: control.execution.activeTurnId ? "running" : control.execution.nativeOutcome ?? "idle",
      selectedModel: model.id,
      selectedEffort: null,
      selectedMode: null,
      activeTurnId: control.execution.activeTurnId,
      lastSequence: commit?.sequence ?? actor.sequence,
    };
  };

  const snapshot = () => {
    const state = actor.snapshot();
    return {
      session: metadata(),
      account: inspection.account,
      models: [model],
      capabilities: CAPABILITIES,
      runtime: descriptor,
      cursor: state.cursor,
      control: projectAgentControlView(state.control),
      display: state.display,
      timeline: state.timeline,
      events: state.timeline.events,
      partial: state.timeline.partial,
      firstAvailableSequence: state.timeline.firstAvailableSequence,
      lastSequence: state.timeline.lastSequence,
    };
  };

  // ---- transcript feed over a session port, like Main's AgentSessionFeed --------
  let feed: { port: MessagePort; hostGeneration: string; subscriptionId: string | null; ready: boolean; buffered: unknown[] } | null = null;
  const send = (frame: unknown) => {
    if (!feed) return;
    feed.port.postMessage({ type: "event", generation: feed.hostGeneration, channel: "agent:session-frame", payload: frame });
  };
  actor.subscribe((commit) => {
    if (!feed?.subscriptionId) return;
    const frame = {
      type: "delta",
      subscriptionId: feed.subscriptionId,
      streamId: commit.streamId,
      baseRevision: commit.baseRevision,
      revision: commit.revision,
      control: projectAgentControlView(commit.control),
      displayPatch: commit.displayPatch,
      session: metadata(commit),
    };
    if (feed.ready) send(frame);
    else feed.buffered.push(frame);
  });

  const connect = () => {
    const { port1, port2 } = new MessageChannel();
    const binding = { connection: "website-demo-agent-connection", hostGeneration: "website-demo-agent-host" };
    feed = { port: port1, hostGeneration: binding.hostGeneration, subscriptionId: null, ready: false, buffered: [] };
    const current = feed;
    const host = createHostRpc({
      generation: binding.connection,
      send: (message: unknown) => port1.postMessage(message),
      handle: async (method: string) => {
        switch (method) {
          case "attachSession":
            current.subscriptionId = "website-demo-subscription";
            return { subscriptionId: current.subscriptionId, snapshot: snapshot() };
          case "acknowledgeSession": {
            const first = !current.ready;
            current.ready = true;
            if (first) {
              current.buffered.splice(0).forEach(send);
              onReady?.();
              void (startSignal ?? Promise.resolve()).then(play);
            }
            return { subscriptionId: current.subscriptionId, streamId: actor.control.streamId, revision: actor.control.revision, synchronized: true };
          }
          case "readSessionWatermark":
            return { subscriptionId: current.subscriptionId, streamId: actor.control.streamId, revision: actor.control.revision, acknowledgedRevision: actor.control.revision, resyncRequired: false };
          case "detachSession":
            return { subscriptionId: current.subscriptionId, detached: true };
          case "replay":
            return snapshot();
          default:
            return null;
        }
      },
    });
    port1.onmessage = ({ data }) => void host.receive(data);
    port1.start();
    window.postMessage({ type: "puppyone-session-port", binding }, "*", [port2]);
    return binding;
  };

  // ---- the scripted run -----------------------------------------------------------
  let played = false;
  const append = (type: string, payload: Record<string, unknown>, turnId: string | null, itemId: string | null) =>
    actor.appendEvent({ sessionId, runtimeId: runtime.id, providerSessionId: "website-demo-thread", event: { type, turnId, itemId, payload } });

  function play() {
    if (played) return;
    played = true;
    const turn = "turn-1";
    const steps: Array<[number, () => void]> = [];
    let t = instant ? 0 : 500;
    const at = (delay: number, run: () => void) => {
      if (!instant) t += delay;
      steps.push([t, run]);
    };

    at(0, () => {
      append("turn.started", { prompt: scenario.prompt, userMessageId: "user-1", model: model.id }, turn, null);
      append("user.message", { text: scenario.prompt, clientUserMessageId: "user-1" }, turn, "user-1");
    });
    scenario.steps.forEach((step, index) => {
      const itemId = `tool-${index + 1}`;
      const writes = step.writes ?? [];
      const kind = writes.length ? "edit" : "read";
      at(700, () => append("tool.started", { kind, tool: kind, label: `${step.action} ${step.target}`, path: step.target, status: "running" }, turn, itemId));
      at(650, () => {
        const changes = createAgentFileChangeEvidence(writes.map((write) => ({
          path: write.path,
          kind: readFile(write.path) === undefined ? "add" : "update",
          before: readFile(write.path) ?? "",
          after: write.content,
        })));
        writes.forEach((write) => writeFile(write.path, write.content));
        append("tool.completed", {
          kind, tool: kind, label: `${step.action} ${step.target}`, path: step.target, status: "completed", outputPreview: step.result,
          ...(changes.length ? { changes } : {}),
        }, turn, itemId);
      });
    });
    // Stream the reply the way a model does: a few words at a time.
    const words = scenario.reply.match(/[\s\S]{1,6}/g) ?? [scenario.reply];
    words.forEach((chunk, index) => at(index === 0 ? 500 : 45, () => append("assistant.delta", { delta: chunk, streaming: true }, turn, "assistant-1")));
    at(100, () => append("assistant.completed", { text: scenario.reply }, turn, "assistant-1"));
    at(150, () => {
      append("turn.completed", { status: "completed", durationMs: t }, turn, null);
      onDone?.();
    });

    for (const [delay, run] of steps) window.setTimeout(run, delay);
  }

  // ---- bridge methods (names as in src/types/electron.d.ts) ------------------------
  const sessionResult = () => snapshot();
  return {
    discoverAgentProviders: async () => inspection,
    discoverLocalAgentConnections: async () => ({ connections: [], scannedAt: createdAt, warnings: [] }),
    listAgentModels: async () => [model],
    readAgentAccount: async () => inspection.account,
    createAgentSession: async () => sessionResult(),
    resumeAgentSession: async () => sessionResult(),
    openAgentSession: async () => ({ ok: true, snapshot: sessionResult() }),
    replayAgentSession: async () => sessionResult(),
    listAgentSessions: async () => ({
      sessions: [],
      discovery: { runtimeId: runtime.id, status: "unsupported", nextCursor: null, scanId: null, indexed: 0, warnings: [] },
      warnings: [],
    }),
    forkAgentSession: async () => sessionResult(),
    archiveAgentSession: async () => ({ sessionId, archived: true }),
    deleteAgentSession: async () => ({ sessionId, deleted: true, nativeDeleted: false }),
    closeAgentSession: async () => ({ sessionId, closed: true }),
    stageAgentAttachments: async () => [],
    revokeAgentAttachments: async () => ({ revoked: 0 }),
    resolveAgentWorkspaceReferences: async () => [],
    pickAgentWorkspaceReferences: async () => [],
    startAgentTurn: async () => ({ sessionId, turnId: "turn-visitor" }),
    steerAgentTurn: async () => ({ sessionId, turnId: "turn-1", steered: false }),
    interruptAgentTurn: async () => ({ sessionId, turnId: "turn-1", interruptRequested: false }),
    compactAgentSession: async () => ({ sessionId, compacted: false }),
    resolveAgentApproval: async (request: { requestId: string; decision: string }) => ({ sessionId, requestId: request.requestId, decision: request.decision }),
    resolveAgentQuestion: async (request: { requestId: string }) => ({ sessionId, requestId: request.requestId }),
    connectAgentSession: async () => ({ ok: true, value: connect() }),
  };
}
