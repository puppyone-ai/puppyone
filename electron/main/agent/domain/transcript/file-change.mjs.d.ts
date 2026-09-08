import type { AgentEvent } from "../../../../../shared/agent-contract/types";
import type { AgentProjection } from "../../../../../shared/agent-contract/display-types";
/** Rejects empty runtime placeholders before they become transcript rows. */
export declare function hasRenderableFileChange(payload: Record<string, unknown>): boolean;
/** Clears only the file-change row represented by an emptied runtime snapshot. */
export declare function clearProjectedFileChange(projection: AgentProjection, event: AgentEvent): void;
