import type { AgentPart } from "./display-types";
export function isAgentToolActivity(part: AgentPart): part is Extract<AgentPart, { kind: "tool" | "command" | "file-change" }>;
export function isAgentTranscriptActivity(part: AgentPart): boolean;
