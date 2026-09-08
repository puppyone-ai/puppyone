import type { AgentEvent } from "../../../../../shared/agent-contract/types";
import type { AgentProjection } from "../../../../../shared/agent-contract/display-types";
export declare function projectTypedPart(projection: AgentProjection, event: AgentEvent, options?: {
    legacyProviderConnectionWarnings?: boolean;
}): void;
