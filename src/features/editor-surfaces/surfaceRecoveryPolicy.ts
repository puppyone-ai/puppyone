import type { PresetViewerContribution } from "@puppyone/shared-ui";

export type SurfaceRecoveryState = Readonly<{
  identity: string;
  safeMode: boolean;
  retryGeneration: number;
  automaticRetries: number;
}>;

type RecoveryPolicy = PresetViewerContribution["recoveryPolicy"];

export function createSurfaceRecoveryState(identity: string): SurfaceRecoveryState {
  return Object.freeze({
    identity,
    safeMode: false,
    retryGeneration: 0,
    automaticRetries: 0,
  });
}

export function resolveAutomaticSurfaceRecovery({
  current,
  identity,
  policy,
}: {
  current: SurfaceRecoveryState;
  identity: string;
  policy: RecoveryPolicy;
}): SurfaceRecoveryState | null {
  if (policy.maxAutomaticRetries === 0) return null;
  const effective = current.identity === identity
    ? current
    : createSurfaceRecoveryState(identity);
  if (effective.automaticRetries >= policy.maxAutomaticRetries) return null;
  return Object.freeze({
    identity,
    safeMode: policy.supportsSafeMode,
    retryGeneration: effective.retryGeneration + 1,
    automaticRetries: effective.automaticRetries + 1,
  });
}

export function resolveManualSurfaceRecovery({
  current,
  identity,
  policy,
}: {
  current: SurfaceRecoveryState;
  identity: string;
  policy: RecoveryPolicy;
}): SurfaceRecoveryState {
  const effective = current.identity === identity
    ? current
    : createSurfaceRecoveryState(identity);
  return Object.freeze({
    identity,
    safeMode: policy.supportsSafeMode,
    retryGeneration: effective.retryGeneration + 1,
    automaticRetries: effective.automaticRetries,
  });
}
