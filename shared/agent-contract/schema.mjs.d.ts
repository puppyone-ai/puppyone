import type { AgentSessionSnapshot, AgentSessionControl, AgentSessionControlView, AgentSessionFrame } from './types';
export function assertAgentSessionSnapshot(value: unknown): AgentSessionSnapshot;
export function assertAgentSessionControl(value: unknown, label?: string): AgentSessionControl;
export function assertAgentSessionControlView(value: unknown, label?: string): AgentSessionControlView;
export function assertAgentSessionFrame(value: unknown): AgentSessionFrame;
