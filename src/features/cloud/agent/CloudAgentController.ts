import { CloudAgentClient, cloudRunActive, type CloudAgentRun, type CloudAgentSession,
  type CloudAgentSubmission } from "./cloudAgentClient";

type Saved = { sessionId: string | null; agentId: string | null; pending: CloudAgentSubmission | null };
export type CloudAgentState = Saved & {
  open: boolean; draft: string; loading: boolean; submitting: boolean; resolving: string | null;
  runs: CloudAgentRun[]; sessions: CloudAgentSession[]; error: Error | null; reconnecting: boolean;
};
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** One actor/target owns drafts and receipts; subscriptions never own execution. */
export class CloudAgentController {
  private listeners = new Set<() => void>();
  private revision = 0;
  private observer = 0;
  private published = new Set<string>();
  private decisions = new Map<string, { id: string; allow: boolean }>();
  private state: CloudAgentState;
  constructor(readonly client: CloudAgentClient, private storageKey: string) {
    let saved: Partial<Saved> = {};
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (value && typeof value === "object") saved = value;
    } catch { /* Unavailable storage must not block chat. */ }
    this.state = { sessionId: saved.sessionId ?? null, agentId: saved.agentId ?? null,
      pending: saved.pending ?? null, open: false, draft: saved.pending?.prompt ?? "", loading: true,
      submitting: false, resolving: null, runs: [], sessions: [], error: null, reconnecting: false };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private patch(values: Partial<CloudAgentState>) {
    this.state = { ...this.state, ...values };
    for (const listener of this.listeners) listener();
  }
  private save() {
    const { sessionId, agentId, pending } = this.state;
    try { localStorage.setItem(this.storageKey, JSON.stringify({ sessionId, agentId, pending })); } catch { /* Memory receipts remain usable. */ }
  }
  setDraft = (draft: string) => this.patch({ draft });
  setOpen = (open: boolean) => this.patch({ open });
  toggle = () => this.setOpen(!this.state.open);
  private accept(run: CloudAgentRun) {
    const old = this.state.runs.find(row => row.id === run.id);
    if (old && old.sequence > run.sequence) return;
    // Command receipts omit tools. Keep the last confirmed projection until the next snapshot.
    const merged = { ...run, tools: run.tools ?? old?.tools ?? [] };
    this.patch({ runs: [...this.state.runs.filter(row => row.id !== run.id), merged]
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) });
  }
  async load() {
    const revision = this.revision;
    this.patch({ loading: true, error: null });
    try {
      if (this.state.pending) {
        try { await this.confirm(await this.client.receipt(this.state.pending.request_id), this.state.pending, revision); }
        catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
      }
      const { sessionId, agentId } = this.state;
      if (sessionId) {
        const runs = await this.client.runs(sessionId);
        if (revision !== this.revision) return;
        for (const run of runs) this.accept(run);
        const last = this.state.runs[this.state.runs.length - 1];
        if (last) {
          const next = await this.client.snapshot(last.id);
          if (revision === this.revision) this.accept(next);
        }
      }
      if (agentId) {
        const sessions = await this.client.sessions(agentId);
        if (revision === this.revision) this.patch({ sessions });
      }
    } catch (cause) {
      if (revision === this.revision) this.patch({ error: asError(cause) });
    } finally { if (revision === this.revision) this.patch({ loading: false }); }
  }
  private async confirm(run: CloudAgentRun, pending: CloudAgentSubmission, revision: number) {
    if (revision !== this.revision) return false;
    this.patch({ sessionId: run.session_id, agentId: run.agent_id, pending: null,
      draft: this.state.draft === pending.prompt ? "" : this.state.draft, error: null,
      sessions: this.state.sessions.some(session => session.id === run.session_id) ? this.state.sessions : [{
        id: run.session_id, agent_id: run.agent_id, title: pending.prompt.slice(0, 80), mode: "cloud_pi", updated_at: run.updated_at,
      }, ...this.state.sessions] });
    this.accept(run);
    this.save();
    return true;
  }
  submit = async (prompt: string) => {
    if (this.state.submitting || this.state.loading || cloudRunActive(this.state.runs[this.state.runs.length - 1]) || !prompt.trim()) return false;
    const revision = this.revision;
    // A lost receipt keeps the original body/UUID, even if the user subsequently edits the draft.
    const pending = this.state.pending;
    if (pending && pending.prompt !== prompt) {
      this.patch({ error: new Error("Confirm the previous message before sending another.") });
      return false;
    }
    const input = pending ?? { request_id: crypto.randomUUID(), prompt,
      ...(this.state.sessionId ? { session_id: this.state.sessionId } : {}),
      ...(this.state.agentId ? { agent_id: this.state.agentId } : {}) };
    this.patch({ pending: input, submitting: true, error: null });
    this.save();
    try {
      let run: CloudAgentRun;
      if (pending) {
        try { run = await this.client.receipt(input.request_id); }
        catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
          run = await this.client.submit(input);
        }
      } else run = await this.client.submit(input);
      return await this.confirm(run, input, revision);
    } catch (cause) {
      // A definite HTTP rejection is unaccepted; transport loss remains pending for receipt recovery.
      if (revision === this.revision) {
        const error = asError(cause);
        const status = (error as { status?: number }).status;
        this.patch({ error, ...(status && status >= 400 && status < 500 ? { pending: null } : {}) });
        this.save();
      }
      return false;
    } finally { if (revision === this.revision) this.patch({ submitting: false }); }
  };
  newChat = () => {
    if (this.state.submitting || this.state.pending || cloudRunActive(this.state.runs.at(-1))) return;
    this.revision++;
    this.patch({ sessionId: null, runs: [], draft: "", error: null, loading: false });
    this.save();
  };
  async selectSession(session: CloudAgentSession) {
    if (this.state.submitting || this.state.pending || cloudRunActive(this.state.runs.at(-1))) return;
    this.revision++;
    this.patch({ sessionId: session.id, agentId: session.agent_id, runs: [], draft: "", error: null });
    this.save();
    await this.load();
  }
  stop = async () => {
    const run = this.state.runs[this.state.runs.length - 1];
    if (!run || !cloudRunActive(run) || run.stop_requested || this.state.resolving) return;
    await this.command("stop", () => this.client.stop(run.id));
  };
  approve = async (call: string, allow: boolean) => {
    const run = this.state.runs[this.state.runs.length - 1];
    if (!run || this.state.resolving) return;
    const key = `${run.id}:${call}`;
    const previous = this.decisions.get(key);
    if (previous && previous.allow !== allow) return;
    const decision = previous ?? { id: crypto.randomUUID(), allow };
    this.decisions.set(key, decision);
    await this.command(call, () => this.client.approve(run.id, call, decision.id, allow));
  };
  private async command(id: string, action: () => Promise<CloudAgentRun>) {
    const revision = this.revision;
    this.patch({ resolving: id, error: null });
    try {
      const run = await action();
      if (revision === this.revision) this.accept(await this.client.snapshot(run.id));
    } catch (cause) { if (revision === this.revision) this.patch({ error: asError(cause) }); }
    finally { if (revision === this.revision) this.patch({ resolving: null }); }
  }
  /** Bounded SSE batches use Main's existing authenticated request bridge. */
  observe(onPublication: () => void) {
    const observer = ++this.observer;
    const alive = () => observer === this.observer;
    const notifyPublication = () => {
      for (const run of this.state.runs) if (run.publication?.status === "committed" && !this.published.has(run.id)) {
        this.published.add(run.id); onPublication();
      }
    };
    void (async () => {
      await this.load();
      while (alive()) {
        const revision = this.revision;
        const run = this.state.runs[this.state.runs.length - 1];
        try {
          notifyPublication();
          if (!run || !cloudRunActive(run)) { await delay(500); continue; }
          const events = await this.client.events(run.id, run.sequence);
          if (!alive() || revision !== this.revision) continue;
          if (events.length) {
            const reset = [...events].reverse().find(event => event.event === "reset");
            const next = reset ? reset.data as CloudAgentRun : await this.client.snapshot(run.id);
            if (!alive() || revision !== this.revision) continue;
            if (next.id !== run.id || next.project_id !== this.client.target.project_id) throw new Error("Cloud Agent event target changed.");
            this.accept(next);
            notifyPublication();
          }
          this.patch({ reconnecting: false });
          // EOF is never interpreted as task completion. Query the server fact even without events.
          if (!events.length) {
            const next = await this.client.snapshot(run.id);
            if (alive() && revision === this.revision) this.accept(next);
            await delay(200);
          }
        } catch (cause) {
          if (!alive()) break;
          const error = asError(cause);
          if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) {
            this.patch({ error, reconnecting: false }); break;
          }
          this.patch({ reconnecting: true });
          await delay(1500);
        }
      }
    })();
    return () => { if (alive()) this.observer++; };
  }
}
function asError(cause: unknown) { return cause instanceof Error ? cause : new Error(String(cause)); }
