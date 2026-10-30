// Main-process Agent modules the website demo runs in the browser. They are
// plain ESM without declarations; the demo only needs these entry points.
declare module "*/agent/domain/agent-session-actor.mjs" {
  export class AgentSessionActor {
    constructor(options?: { events?: unknown[]; sequence?: number; terminalState?: string; clock?: () => number });
    readonly display: unknown;
    readonly control: { streamId: string; revision: number; execution: { activeTurnId: string | null } };
    readonly sequence: number;
    subscribe(listener: (commit: AgentActorCommit) => void): () => void;
    dispatch(input: { type: string; [key: string]: unknown }): unknown;
    appendEvent(input: {
      sessionId: string;
      runtimeId: string;
      providerSessionId: string | null;
      event: { type: string; turnId?: string | null; itemId?: string | null; payload?: Record<string, unknown> };
    }): unknown;
    snapshot(): {
      cursor: { streamId: string; revision: number };
      control: unknown;
      display: unknown;
      timeline: { events: unknown[]; partial: boolean; firstAvailableSequence: number; lastSequence: number };
    };
  }
  export type AgentActorCommit = {
    streamId: string;
    baseRevision: number;
    revision: number;
    control: AgentSessionActor["control"];
    sequence: number;
    emittedAt?: string;
    displayPatch: unknown;
  };
}

declare module "*/agent/domain/agent-control-view.mjs" {
  export function projectAgentControlView(control: unknown): Record<string, unknown> & {
    execution: { activeTurnId: string | null; status: string; nativeOutcome: string | null };
    connection: { status: string };
  };
}

declare module "*/agent/runtime/agent-file-change-evidence.mjs" {
  export function createAgentFileChangeEvidence(
    entries: Array<{ path: string; kind?: string; before?: string; after?: string }>,
  ): Array<{ path: string; kind?: string; additions?: number; deletions?: number }>;
}
