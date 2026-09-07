import type { AgentProjection, AgentDisplayPatch } from './display-types';
export const DISPLAY_COLLECTION_KEYS: Readonly<Record<string, string>>;
export const DISPLAY_VALUE_KEYS: readonly string[];
export function createEmptyAgentDisplay(options?: { partialHistory?: boolean }): AgentProjection;
export function createAgentDisplayPatch(previous: AgentProjection, next: AgentProjection): AgentDisplayPatch;
export function applyAgentDisplayPatch(previous: AgentProjection, patch: AgentDisplayPatch): AgentProjection;
