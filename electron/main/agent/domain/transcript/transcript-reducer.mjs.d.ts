import type { AgentEvent, AgentSessionControl } from "../../../../../shared/agent-contract/types";
import type { AgentProjection } from "../../../../../shared/agent-contract/display-types";
export type * from "../../../../../shared/agent-contract/display-types";
export declare function createAgentProjection(): AgentProjection;
export declare function applyAgentEvents(initial: AgentProjection, events: AgentEvent[], options?: AgentProjectionApplyOptions): AgentProjection;
export declare function applyAgentEvent(previous: AgentProjection, event: AgentEvent, options?: AgentProjectionApplyOptions): AgentProjection;
type AgentProjectionApplyOptions = {
    /** Only snapshot hydration may reinterpret pre-V2 retry warnings. */
    legacyProviderConnectionWarnings?: boolean;
};
export declare const agentProjectionLimits: Readonly<{
    maxMessageText: number;
    maxCommandOutput: number;
    maxActivityText: number;
}>;

export declare function projectAgentUserSubmission(previous: AgentProjection, command: AgentSessionControl["commands"][number]): AgentProjection;
