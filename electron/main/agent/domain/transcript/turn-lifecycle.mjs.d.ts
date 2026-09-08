import type { AgentEvent, AgentTurnTerminalState } from "../../../../../shared/agent-contract/types";
import type { AgentActivityStatus, AgentProjection } from "../../../../../shared/agent-contract/display-types";
export declare const LIVE_AGENT_ACTIVITY_STATUSES: ReadonlySet<AgentActivityStatus>;
export declare function agentTurnTerminalState(event: AgentEvent): AgentTurnTerminalState | null;
export declare function isLiveAgentActivityStatus(status: AgentActivityStatus): boolean;
export declare function agentActivityTerminalStatus(terminalState: AgentTurnTerminalState): AgentActivityStatus;
/**
 * One terminal reconciliation authority for legacy compatibility collections
 * and the canonical typed-part timeline. Native Harnesses may omit a terminal
 * child event, but no live child is allowed to survive its owning turn.
 */
export declare function reconcileTerminalAgentTurn(projection: AgentProjection, event: AgentEvent): void;
