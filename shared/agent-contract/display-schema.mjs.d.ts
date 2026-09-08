import type { AgentProjection, AgentDisplayPatch } from './display-types';
export const agentDisplayLimits: Readonly<{maxEntries: number; maxNodes: number; maxBytes: number; maxText: number}>;
export function assertAgentDisplay(value: unknown): AgentProjection;
export function assertAgentDisplayPatch(value: unknown): AgentDisplayPatch;
