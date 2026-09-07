import type { AgentEvent } from "../../../../../shared/agent-contract/types";
import type { AgentProjection } from "../../../../../shared/agent-contract/display-types";
type LegacyProviderConnectionUpdate = {
    state: "reconnecting" | "fallback";
    attempt: number | null;
    maxAttempts: number | null;
};
/** Correlates retry warnings and terminal failures without merging separate turns. */
export declare function providerActivityIdentity(projection: AgentProjection, event: AgentEvent, label: string): {
    id: string;
    turnId: string | null;
};
/** Hides persisted lifecycle-only notices emitted by older adapters. */
export declare function isNonDiagnosticProviderStatusMessage(value: string): boolean;
/**
 * Replay migration for events produced before `provider.connection.updated`
 * existed. New adapters must emit the structured event; UI code must never
 * repeat these provider-specific heuristics.
 */
export declare function legacyProviderConnectionUpdate(event: AgentEvent, label: string): LegacyProviderConnectionUpdate | null;
export {};
