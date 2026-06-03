import { post } from './apiClient';

/**
 * Agent runtime controls.
 *
 * Agent rows are stored as ``access_surfaces`` with ``kind='agent'``.
 * The compatibility pause endpoints flip the same ``status`` column the
 * chat session guard and scheduler tick both read, with agent_id supplied
 * as the legacy connector_id path parameter.
 *
 * Both endpoints are POST and return an empty body — we surface
 * any thrown error so the caller can render it.
 */

export async function pauseAgent(projectId: string, agentId: string): Promise<void> {
  await post<unknown>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/connectors/${encodeURIComponent(agentId)}/pause`,
    {},
  );
}

export async function resumeAgent(projectId: string, agentId: string): Promise<void> {
  await post<unknown>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/connectors/${encodeURIComponent(agentId)}/resume`,
    {},
  );
}
