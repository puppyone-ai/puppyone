import type { AgentEvent } from "../../../../../shared/agent-contract/types";
import type { AgentActivity, AgentActivityLabelCode, AgentActivityStatus, AgentApproval, AgentQuestionPrompt } from "../../../../../shared/agent-contract/display-types";
export declare function normalizeAgentActivityStatus(value: unknown, fallback?: AgentActivityStatus): AgentActivityStatus;
export declare function readQuestions(value: unknown): AgentQuestionPrompt[];
export declare function pickUsage(payload: Record<string, unknown>): Record<string, unknown>;
export declare function pickSafeActivityDetail(payload: Record<string, unknown>): Record<string, unknown>;
export declare function activityId(event: AgentEvent): string;
export declare function readString(value: unknown): string;
/** Makes already-persisted provider errors readable without trusting raw HTML or object shapes. */
export declare function readProviderMessage(value: unknown, depth?: number): string;
export declare function nullableString(value: unknown): string | null;
export declare function readRecordArray(value: unknown): Array<Record<string, unknown>>;
export declare function readNetworkApprovalContext(value: unknown): AgentApproval["networkApprovalContext"];
export declare function defaultToolLabelCode(kind: AgentActivity["kind"]): AgentActivityLabelCode;
export declare function fileChangeLabelCode(_payload: Record<string, unknown>): AgentActivityLabelCode;
export declare function readApprovalDecisions(value: unknown): AgentApproval["availableDecisions"];
