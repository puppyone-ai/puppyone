import type { AgentProjection } from "../../../../../shared/agent-contract/display-types";
export type ProjectionIndexes = {
    messages: Map<string, number>;
    messagesByTurn: Map<string, number[]>;
    activities: Map<string, number>;
    turns: Map<string, number>;
    parts: Map<string, number>;
    rows: Map<string, number>;
};
/** Lazily rebuilds non-serializable indexes on replayed or cloned projections. */
export declare function projectionIndexes(projection: AgentProjection): ProjectionIndexes;
export declare function invalidateProjectionIndexes(projection: AgentProjection): void;
export declare function cloneAgentProjection(value: AgentProjection): AgentProjection;
