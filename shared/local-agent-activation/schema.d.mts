import type { ActivationSnapshot, ActivationStep } from "./types";
export const ACTIVATION_STEPS: readonly ActivationStep["id"][];
export function assertActivationSnapshot(value: unknown): ActivationSnapshot;
export function isActivationActive(status: string): boolean;
