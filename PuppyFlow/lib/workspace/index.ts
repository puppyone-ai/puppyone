import { FileWorkspaceStore } from './fileStore';
import { IWorkspaceStore } from './store';

/**
 * Select and return the workspace store implementation.
 *
 * Rules (explicit over implicit):
 * - DEPLOYMENT_MODE === 'cloud' => use UserSystemWorkspaceStore (requires envs)
 * - otherwise => use FileWorkspaceStore
 *
 * Additional safeguards:
 * - If DEPLOYMENT_MODE !== 'cloud' but USER_SYSTEM_BACKEND is set, log a warning (do NOT switch behavior)
 * - In cloud mode, enforce required envs and fail fast with clear errors
 * - Lazy-import cloud store to avoid importing server-only env in local mode
 */
export function getWorkspaceStore(): IWorkspaceStore {
  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();

  if (mode !== 'cloud') {
    // Warn if backend URL is provided but mode isn't cloud
    if (process.env.USER_SYSTEM_BACKEND) {
      console.warn(
        '[PuppyFlow] USER_SYSTEM_BACKEND is set, but DEPLOYMENT_MODE is not "cloud". Continuing with local file store.'
      );
    }
    return new FileWorkspaceStore();
  }

  // Cloud mode: validate envs and use user-system backend
  // Lazy import to avoid requiring server-only envs in non-cloud mode
  try {
    const { UserSystemWorkspaceStore } = require('./userSystemStore');

    // Basic env validation ahead of time for clearer errors
    const hasBackend = !!process.env.USER_SYSTEM_BACKEND;
    if (!hasBackend) {
      throw new Error(
        '[PuppyFlow] DEPLOYMENT_MODE is "cloud" but USER_SYSTEM_BACKEND is not configured.'
      );
    }

    const allowWithoutServiceKey =
      (process.env.ALLOW_VERIFY_WITHOUT_SERVICE_KEY || '').toLowerCase() ===
      'true';
    const hasServiceKey = !!process.env.SERVICE_KEY;
    if (!hasServiceKey && !allowWithoutServiceKey) {
      throw new Error(
        '[PuppyFlow] SERVICE_KEY is not configured and ALLOW_VERIFY_WITHOUT_SERVICE_KEY is not true. Configure SERVICE_KEY for cloud deployments.'
      );
    }

    return new UserSystemWorkspaceStore();
  } catch (err: any) {
    // Surface a clear error for cloud misconfiguration
    const message = err?.message || String(err);
    throw new Error(
      `[PuppyFlow] Failed to initialize cloud workspace store: ${message}`
    );
  }
}
