import { ProjectWorkbenchStore } from "../../app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import { CloudAgentController } from "./CloudAgentController";
import type { AuxiliaryWorkbenchItemSnapshot } from "../../app-shell/auxiliary-workbench/types";
import { CloudAgentClient, cloudRunActive, type CloudAgentSession } from "./cloudAgentClient";

export const CLOUD_AGENT_KIND = "agent-chat";
export const CLOUD_AGENT_LABEL = "Puppyone Agent";
type HistoryState = { sessions: CloudAgentSession[]; loading: boolean; loaded: boolean; error: string | null };
type Actor = { controller: CloudAgentController; unsubscribe: () => void; stop?: () => void };
type SavedWorkbench = { tabs: string[]; active: string | null; agents: string[] };

/** Target-scoped conversations contribute to the same workbench as local chats.
 * Views own neither execution nor event subscriptions. Closing a tab never stops a run. */
export class CloudAgentWorkbench {
  readonly store: ProjectWorkbenchStore;
  readonly primary: CloudAgentController;
  private actors = new Map<string, Actor>();
  private agents = new Set<string>();
  private history: HistoryState = { sessions: [], loading: false, loaded: false, error: null };
  private historyListeners = new Set<() => void>();
  private historyRequest: Promise<void> | null = null;
  private onPublication: (() => void) | null = null;
  private savedTopology: object | null = null;
  constructor(readonly client: CloudAgentClient, private storageKey: string, generation: string) {
    this.store = new ProjectWorkbenchStore({ projectId: client.target.project_id, generation, rootPath: storageKey });
    this.primary = new CloudAgentController(client, storageKey, { sharedHistory: true });
    let saved: SavedWorkbench | null = null;
    try {
      const value = JSON.parse(localStorage.getItem(`${storageKey}:workbench`) || "null");
      if (value && Array.isArray(value.tabs) && value.tabs.every((id: unknown) => typeof id === "string" && /^(primary|[a-f\d-]{36})$/.test(id))) {
        saved = { tabs: value.tabs, active: typeof value.active === "string" ? value.active : null,
          agents: Array.isArray(value.agents) ? value.agents.filter((id: unknown) => typeof id === "string") : [] };
      }
    } catch { /* A broken view preference cannot prevent opening chat. */ }
    for (const agent of saved?.agents ?? []) if (typeof agent === "string") this.agents.add(agent);
    const primaryAgent = this.primary.getSnapshot().agentId;
    if (primaryAgent) this.agents.add(primaryAgent);
    for (const id of new Set(saved?.tabs ?? ["primary"])) {
      this.prepare(id);
      this.store.dispatch({ type: "create", item: { id, kind: CLOUD_AGENT_KIND, rootId: storageKey, contextId: client.target.project_id }, groupId: crypto.randomUUID(), targetGroupId: this.store.getSnapshot().topology.activeGroupId });
    }
    if (saved?.active) this.store.dispatch({ type: "activate", itemId: saved.active });
    this.store.subscribe(() => {
      const topology = this.store.getSnapshot().topology;
      if (topology !== this.savedTopology) { this.savedTopology = topology; this.save(); }
    });
  }
  controller(id: string) { return this.actors.get(id)?.controller; }
  private actorKey(id: string) { return id === "primary" ? this.storageKey : `${this.storageKey}:tab:${id}`; }
  prepare(id: string, session?: CloudAgentSession) {
    if (this.actors.has(id)) return;
    if (session && [...this.actors.values()].some(actor => actor.controller.getSnapshot().sessionId === session.id)) {
      throw new Error("This conversation is already open.");
    }
    const controller = id === "primary" ? this.primary : new CloudAgentController(this.client, this.actorKey(id), {
      sharedHistory: true, ...(session ? { initial: { sessionId: session.id, agentId: session.agent_id, pending: null } } : {}),
    });
    const actor: Actor = { controller, unsubscribe: () => {} };
    this.actors.set(id, actor);
    actor.unsubscribe = controller.subscribe(() => this.update(id));
    this.update(id);
    if (this.onPublication) actor.stop = controller.observe(this.onPublication);
  }
  private update(id: string) {
    const state = this.controller(id)!.getSnapshot();
    const run = state.runs.at(-1);
    const title = state.sessions.find(session => session.id === state.sessionId)?.title
      || state.runs[0]?.prompt.slice(0, 80) || this.history.sessions.find(session => session.id === state.sessionId)?.title || CLOUD_AGENT_LABEL;
    let status: AuxiliaryWorkbenchItemSnapshot["status"] = "idle";
    if (cloudRunActive(run)) status = "running";
    if (state.loading) status = "starting";
    if (state.error) status = "error";
    this.store.updateSnapshot(id, { title, accessibleLabel: title, detail: null, iconKey: "puppyone-agent",
      status,
      running: state.submitting || cloudRunActive(run), resourceId: state.sessionId });
    if (state.agentId && !this.agents.has(state.agentId)) { this.agents.add(state.agentId); this.save(); }
  }
  canClose(id: string) {
    const state = this.controller(id)?.getSnapshot();
    return !state?.pending && !state?.submitting;
  }
  release(id: string) {
    if (!this.canClose(id)) return false;
    const actor = this.actors.get(id);
    actor?.stop?.();
    actor?.unsubscribe();
    this.actors.delete(id);
    // Retain the durable server session and pending-receipt protocol, not a live view.
    return true;
  }
  get working() {
    return [...this.actors.values()].some(({ controller }) => {
      const state = controller.getSnapshot();
      return state.submitting || Boolean(state.pending) || cloudRunActive(state.runs.at(-1));
    });
  }
  observe(onPublication: () => void) {
    this.onPublication = onPublication;
    for (const actor of this.actors.values()) actor.stop = actor.controller.observe(onPublication);
    return () => {
      this.onPublication = null;
      for (const actor of this.actors.values()) { actor.stop?.(); actor.stop = undefined; }
    };
  }
  private save() {
    const topology = this.store.getSnapshot().topology;
    const value: SavedWorkbench = { tabs: topology.groups.flatMap(group => group.itemIds).filter(id => topology.items.some(item => item.id === id && item.kind === CLOUD_AGENT_KIND)),
      active: topology.groups.find(group => group.id === topology.activeGroupId)?.activeItemId ?? null, agents: [...this.agents] };
    try { localStorage.setItem(`${this.storageKey}:workbench`, JSON.stringify(value)); } catch { /* In-memory workbench remains usable. */ }
  }
  getHistory = () => this.history;
  subscribeHistory = (listener: () => void) => { this.historyListeners.add(listener); return () => { this.historyListeners.delete(listener); }; };
  private patchHistory(value: Partial<HistoryState>) {
    this.history = { ...this.history, ...value };
    this.historyListeners.forEach(listener => listener());
  }
  /** One history request per distinct agent, shared by every launcher/tab. Never fetch transcripts here. */
  refreshHistory = () => {
    if (this.historyRequest) return this.historyRequest;
    this.patchHistory({ loading: true, error: null });
    this.historyRequest = (async () => {
      try {
        const rows = (await Promise.all([...this.agents].map(agent => this.client.sessions(agent)))).flat();
        this.patchHistory({ sessions: [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), loaded: true });
      } catch (error) { this.patchHistory({ error: error instanceof Error ? error.message : String(error) }); }
      finally { this.patchHistory({ loading: false }); this.historyRequest = null; }
    })();
    return this.historyRequest;
  };
}
