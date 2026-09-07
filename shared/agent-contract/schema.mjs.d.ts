import type { AgentSessionSnapshot, AgentSessionControl, AgentSessionFrame } from './types';
export function assertAgentSessionSnapshot(value: unknown): AgentSessionSnapshot;
export function assertAgentSessionControl(value: unknown, label?: string): AgentSessionControl;
export function assertAgentSessionFrame(value: unknown): AgentSessionFrame;
