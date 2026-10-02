import type {
  DesktopCloudCreateAutomationRequest,
  DesktopCloudCreateAutomationResult,
  DesktopCloudSession,
  DesktopCloudUpdateAutomationConnectionRequest,
  DesktopCloudUpdateAutomationTriggerRequest,
} from "../cloudApi";
import type { CloudAutomationTransport } from "./automationApi";

/** Persistent source relationship. It is not an Access surface or Scope. */
export type DesktopCloudSynchronizeBinding = {
  id: string;
  project_id: string;
  path: string | null;
  provider: string;
  direction: string;
  config: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  status: string;
  last_sync_commit_id?: string | null;
  last_synced_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudSynchronizeRun = {
  id: string;
  synchronize_binding_id: string;
  status: string;
  worker_job_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  stdout?: string | null;
  error?: string | null;
  trigger_type?: string | null;
  result_summary?: string | null;
};

type LegacyRun = Omit<DesktopCloudSynchronizeRun, "synchronize_binding_id"> & { access_point_id: string };
type SessionHandler = (session: DesktopCloudSession | null) => void | Promise<void>;

/** ISSUE-058 transition: legacy HTTP names are confined to this resource client.
 * The server's legacy access_point_id is a binding reference on these routes
 * only. Never use this conversion for an Access response.
 */
export function createSynchronizeApi(request: CloudAutomationTransport) {
  const base = "/integrations";
  const bindingPath = (id: string) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A Synchronize binding ID is required.");
    return `${base}/connections/${encodeURIComponent(id)}`;
  };
  const runFromWire = ({ access_point_id, ...run }: LegacyRun): DesktopCloudSynchronizeRun => {
    if (typeof access_point_id !== "string" || !access_point_id.trim()) {
      throw new Error("Synchronize run is missing its binding ID.");
    }
    return { ...run, synchronize_binding_id: access_point_id };
  };

  async function listSynchronizeBindings(
    session: DesktopCloudSession, projectId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeBinding[]> {
    const bindings = await request<DesktopCloudSynchronizeBinding[]>(
      `${base}/connections?${new URLSearchParams({ project_id: projectId })}`,
      session, onSessionChange, {}, apiBaseUrl,
    );
    if (!Array.isArray(bindings) || bindings.some((binding) => !binding || typeof binding.id !== "string" || !binding.id.trim())) {
      throw new Error("Synchronize list contains an invalid binding ID.");
    }
    if (bindings.some((binding) => binding.project_id !== projectId)) {
      throw new Error("Synchronize list returned a binding from another project.");
    }
    return bindings;
  }

  function createSynchronizeBinding(
    session: DesktopCloudSession, body: DesktopCloudCreateAutomationRequest,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudCreateAutomationResult> {
    return request(`${base}/connections`, session, onSessionChange,
      { method: "POST", body: JSON.stringify(body) }, apiBaseUrl);
  }

  function updateSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    body: DesktopCloudUpdateAutomationConnectionRequest,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeBinding> {
    return request(bindingPath(synchronizeBindingId), session, onSessionChange,
      { method: "PATCH", body: JSON.stringify(body) }, apiBaseUrl);
  }

  function updateSynchronizeTrigger(
    session: DesktopCloudSession, synchronizeBindingId: string,
    body: DesktopCloudUpdateAutomationTriggerRequest,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<unknown> {
    return request(`${bindingPath(synchronizeBindingId)}/trigger`, session, onSessionChange,
      { method: "PATCH", body: JSON.stringify(body) }, apiBaseUrl);
  }

  async function listSynchronizeRuns(
    session: DesktopCloudSession, synchronizeBindingId: string, limit = 10,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeRun[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 10;
    const runs = await request<LegacyRun[]>(
      `${bindingPath(synchronizeBindingId)}/runs?limit=${normalizedLimit}`,
      session, onSessionChange, {}, apiBaseUrl,
    );
    if (runs.some((run) => run.access_point_id !== synchronizeBindingId)) {
      throw new Error("Synchronize history returned a run from another binding.");
    }
    return runs.map(runFromWire);
  }

  async function getSynchronizeRun(
    session: DesktopCloudSession, runId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeRun> {
    return runFromWire(await request<LegacyRun>(`${base}/runs/${encodeURIComponent(runId)}`,
      session, onSessionChange, {}, apiBaseUrl));
  }

  function refreshSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<unknown> {
    return request(`${bindingPath(synchronizeBindingId)}/refresh`, session, onSessionChange,
      { method: "POST", body: "{}" }, apiBaseUrl);
  }

  function pauseSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<unknown> {
    return request(`${bindingPath(synchronizeBindingId)}/pause`, session, onSessionChange,
      { method: "POST", body: "{}" }, apiBaseUrl);
  }

  function resumeSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<unknown> {
    return request(`${bindingPath(synchronizeBindingId)}/resume`, session, onSessionChange,
      { method: "POST", body: "{}" }, apiBaseUrl);
  }

  function deleteSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<unknown> {
    return request(bindingPath(synchronizeBindingId), session, onSessionChange,
      { method: "DELETE" }, apiBaseUrl);
  }

  return Object.freeze({
    listSynchronizeBindings, createSynchronizeBinding, updateSynchronizeBinding,
    updateSynchronizeTrigger, listSynchronizeRuns, getSynchronizeRun,
    refreshSynchronizeBinding, pauseSynchronizeBinding, resumeSynchronizeBinding,
    deleteSynchronizeBinding,
  });
}
