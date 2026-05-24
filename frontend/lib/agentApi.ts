import { post } from './apiClient';

/**
 * Agent runtime controls.
 *
 * Agent rows are stored as ``connectors`` with ``provider='agent'``;
 * the connector pause endpoints flip the same ``status`` column the
 * chat session guard and scheduler tick both read. So the agent
 * UI's "Pause / Resume" button is the existing connector pause
 * endpoint with the agent_id supplied as the connector_id.
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
