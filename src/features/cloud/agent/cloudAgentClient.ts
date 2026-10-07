import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { RepositoryTarget } from "../repositoryTarget";

export type CloudRunState = "queued" | "running" | "waiting_approval" | "publishing"
  | "succeeded" | "stopped" | "failed" | "conflict" | "outcome_unknown";
export type CloudAgentTool = {
  call_id: string; name: string; input: Record<string, unknown>;
  state: "waiting" | "approved" | "rejected" | "executing" | "completed";
  result?: { content?: Array<{ type: string; text?: string }> } | null;
};
export type CloudAgentRun = {
  id: string; project_id: string; agent_id: string; session_id: string; request_id: string;
  prompt: string; state: CloudRunState; sequence: number; stop_requested: boolean;
  snapshot: { text?: string; code?: string; resource_retained?: boolean };
  publication: { status?: string; [key: string]: unknown } | null;
  tools?: CloudAgentTool[]; created_at: string; updated_at: string;
};
export type CloudAgentEvent = { id: number; event: string; data: unknown };
export type CloudAgentSession = { id: string; agent_id: string; title: string | null; mode: string; updated_at: string };
export type CloudAgentSubmission = { request_id: string; prompt: string; session_id?: string; agent_id?: string };

export const cloudRunActive = (run: CloudAgentRun | undefined) => Boolean(run &&
  ["queued", "running", "waiting_approval", "publishing"].includes(run.state));

/** Renderer passes only the public account lease. Credentials stay in Main. */
export class CloudAgentClient {
  constructor(readonly target: RepositoryTarget, readonly session: DesktopCloudSession, readonly apiBaseUrl: string) {}
  private request<T>(path: string, init: RequestInit = {}) {
    return cloudApiRequest<T>(path, this.session, undefined, init, this.apiBaseUrl);
  }
  private owned(run: CloudAgentRun): CloudAgentRun {
    if (run.project_id !== this.target.project_id) throw new Error("Cloud Agent returned a different project.");
    return run;
  }
  async submit(input: CloudAgentSubmission) {
    const run = this.owned(await this.request<CloudAgentRun>("/agents/runs", { method: "POST",
      body: JSON.stringify({ ...input, project_id: this.target.project_id,
        ...(this.target.kind === "scope" ? { scope_id: this.target.scope_id } : {}) }) }));
    if (run.request_id !== input.request_id || (input.session_id && run.session_id !== input.session_id)) {
      throw new Error("Cloud Agent returned a different submission receipt.");
    }
    return run;
  }
  async receipt(request: string) {
    const run = this.owned(await this.request<CloudAgentRun>(
      `/agents/requests/${encodeURIComponent(this.target.project_id)}/${encodeURIComponent(request)}`));
    if (run.request_id !== request) throw new Error("Cloud Agent returned a different request.");
    return run;
  }
  async snapshot(id: string) {
    const run = this.owned(await this.request<CloudAgentRun>(`/agents/runs/${encodeURIComponent(id)}`));
    if (run.id !== id) throw new Error("Cloud Agent returned a different run.");
    return run;
  }
  async runs(session: string) {
    const runs = await this.request<CloudAgentRun[]>(`/agents/sessions/${encodeURIComponent(session)}/runs?limit=100`);
    return runs.map(run => {
      this.owned(run);
      if (run.session_id !== session) throw new Error("Cloud Agent returned a different session.");
      return run;
    });
  }
  async sessions(agent: string) {
    const rows = await this.request<CloudAgentSession[]>(`/agents/sessions?project_id=${encodeURIComponent(this.target.project_id)}&agent_id=${encodeURIComponent(agent)}&limit=200`);
    return rows.filter(row => row.mode === "cloud_pi" && row.agent_id === agent);
  }
  events(run: string, after: number) {
    return this.request<CloudAgentEvent[]>(`/agents/runs/${encodeURIComponent(run)}/events?after=${after}`);
  }
  stop(run: string) { return this.request<CloudAgentRun>(`/agents/runs/${encodeURIComponent(run)}/stop`, { method: "POST" }); }
  approve(run: string, call: string, decision: string, allow: boolean) {
    return this.request<CloudAgentRun>(`/agents/runs/${encodeURIComponent(run)}/approvals/${encodeURIComponent(call)}`,
      { method: "POST", body: JSON.stringify({ decision_id: decision, allow }) });
  }
}
