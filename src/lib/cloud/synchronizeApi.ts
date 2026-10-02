import type { DesktopCloudSession } from "../cloudApi";
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
  last_synchronize_commit_id?: string | null;
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

export type DesktopCloudCreateSynchronizeBindingRequest = {
  project_id: string;
  provider: string;
  config: Record<string, unknown>;
  target_path?: string;
  direction?: string;
  conflict_strategy?: string;
  sync_mode?: "manual" | "scheduled" | "realtime";
  trigger?: { type: string; schedule?: string; timezone?: string };
};

export type DesktopCloudCreateSynchronizeBindingResult = {
  binding: DesktopCloudSynchronizeBinding;
  execution_result?: {
    synchronize_binding_id: string;
    synchronize_run_id?: string | null;
    status: string;
    summary?: string | null;
  } | null;
};

export type DesktopCloudUpdateSynchronizeBindingRequest = {
  config?: Record<string, unknown>;
  target_path?: string;
  direction?: string;
  conflict_strategy?: string;
};

export type DesktopCloudUpdateSynchronizeTriggerRequest = {
  sync_mode: "manual" | "scheduled" | "realtime";
  trigger?: { type: string; schedule?: string; timezone?: string } | null;
};
type SessionHandler = (session: DesktopCloudSession | null) => void | Promise<void>;

/** Canonical resource client. No legacy URL or identity-field fallback. */
export function createSynchronizeApi(request: CloudAutomationTransport) {
  const base = "/synchronize";
  const bindingPath = (id: string) => {
    if (typeof id !== "string" || !id.trim()) throw new Error("A Synchronize binding ID is required.");
    return `${base}/bindings/${encodeURIComponent(id)}`;
  };
  const validateRun = (run: DesktopCloudSynchronizeRun): DesktopCloudSynchronizeRun => {
    if (typeof run.synchronize_binding_id !== "string" || !run.synchronize_binding_id.trim()) {
      throw new Error("Synchronize run is missing its binding ID.");
    }
    return run;
  };

  async function listSynchronizeBindings(
    session: DesktopCloudSession, projectId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeBinding[]> {
    const bindings = await request<DesktopCloudSynchronizeBinding[]>(
      `${base}/bindings?${new URLSearchParams({ project_id: projectId })}`,
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

  async function createSynchronizeBinding(
    session: DesktopCloudSession, body: DesktopCloudCreateSynchronizeBindingRequest,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudCreateSynchronizeBindingResult> {
    const result = await request<DesktopCloudCreateSynchronizeBindingResult>(`${base}/bindings`, session, onSessionChange,
      { method: "POST", body: JSON.stringify(body) }, apiBaseUrl);
    if (!result.binding?.id || result.binding.project_id !== body.project_id
      || (result.execution_result && result.execution_result.synchronize_binding_id !== result.binding.id)) {
      throw new Error("Synchronize creation returned inconsistent resource identities.");
    }
    return result;
  }

  function updateSynchronizeBinding(
    session: DesktopCloudSession, synchronizeBindingId: string,
    body: DesktopCloudUpdateSynchronizeBindingRequest,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeBinding> {
    return request(bindingPath(synchronizeBindingId), session, onSessionChange,
      { method: "PATCH", body: JSON.stringify(body) }, apiBaseUrl);
  }

  function updateSynchronizeTrigger(
    session: DesktopCloudSession, synchronizeBindingId: string,
    body: DesktopCloudUpdateSynchronizeTriggerRequest,
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
    const runs = await request<DesktopCloudSynchronizeRun[]>(
      `${bindingPath(synchronizeBindingId)}/runs?limit=${normalizedLimit}`,
      session, onSessionChange, {}, apiBaseUrl,
    );
    if (runs.some((run) => run.synchronize_binding_id !== synchronizeBindingId)) {
      throw new Error("Synchronize history returned a run from another binding.");
    }
    return runs.map(validateRun);
  }

  async function getSynchronizeRun(
    session: DesktopCloudSession, runId: string,
    onSessionChange?: SessionHandler, apiBaseUrl?: string | null,
  ): Promise<DesktopCloudSynchronizeRun> {
    return validateRun(await request<DesktopCloudSynchronizeRun>(`${base}/runs/${encodeURIComponent(runId)}`,
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
