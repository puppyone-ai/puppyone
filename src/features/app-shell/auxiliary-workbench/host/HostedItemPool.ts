import type { ItemHostBridge, ItemHostConfiguration, ItemHostEvent, ItemHostIdentity, ItemHostState } from "../../../../../shared/item-host-contract/types";
import type { AuxiliaryWorkbenchItemSnapshot, AuxiliaryWorkbenchProject } from "../types";

export class HostedItem {
  state: ItemHostState;
  summary: AuxiliaryWorkbenchItemSnapshot | null = null;
  minimumSize: { width: number; height: number } | null = null;
  activity = false;
  readonly listeners = new Set<() => void>();
  readonly eventListeners = new Set<(event: ItemHostEvent) => void>();
  private activityListeners = new Set<(active: boolean) => void>();
  private configurationSignature = "";
  constructor(readonly identity: ItemHostIdentity, readonly bridge: ItemHostBridge) {
    this.state = { itemId: identity.itemId, generation: "", display: "starting", execution: "idle" };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  subscribeActivity = (listener: (active: boolean) => void) => {
    this.activityListeners.add(listener); listener(this.activity);
    return () => { this.activityListeners.delete(listener); };
  };
  update(state: ItemHostState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  event(event: ItemHostEvent) {
    if (event.generation !== this.state.generation) return;
    if (event.type === "summary") {
      const value = event.payload as { snapshot?: AuxiliaryWorkbenchItemSnapshot; activity?: boolean; minimumSize?: { width: number; height: number } };
      if (value.snapshot) this.summary = value.snapshot;
      if (value.minimumSize) this.minimumSize = value.minimumSize;
      if (typeof value.activity === "boolean" && value.activity !== this.activity) {
        this.activity = value.activity;
        this.activityListeners.forEach((listener) => listener(this.activity));
      }
      this.update({ ...this.state });
    }
    this.eventListeners.forEach((listener) => listener(event));
  }
  configure(configuration: ItemHostConfiguration) {
    const signature = JSON.stringify(configuration);
    if (signature === this.configurationSignature) return Promise.resolve();
    return this.bridge.configure({ ...this.identity, ...configuration }).then(() => { this.configurationSignature = signature; });
  }
  async close() { await this.bridge.close(this.identity); return true; }
  async recover() { this.update(await this.bridge.recover(this.identity)); }
}

/** Shell resources are lightweight proxies; content/controllers live elsewhere. */
class HostedItemPool {
  private items = new Map<string, HostedItem>();
  private cleanup: Array<() => void>;
  private readonly bridge: ItemHostBridge;
  constructor(private readonly project: AuxiliaryWorkbenchProject) {
    const bridge = window.puppyoneDesktop?.itemHosts;
    if (!bridge) throw new Error("Isolated item hosting is unavailable.");
    this.bridge = bridge;
    this.cleanup = [
      bridge.onState((state) => this.items.get(state.itemId)?.update(state)),
      bridge.onEvent((event) => this.items.get(event.itemId)?.event(event)),
    ];
  }
  async prepare(itemId: string, kind: ItemHostIdentity["kind"], options: {
    recipeId?: string | null; historyTarget?: { sessionId: string; runtimeId: string } | null;
    settings?: Record<string, unknown>;
  } = {}) {
    this.project.assertOpen();
    if (this.items.has(itemId)) return;
    const item = new HostedItem({ itemId, kind, projectContext: this.project.context }, this.bridge);
    this.items.set(itemId, item);
    try { item.update(await this.bridge.create({ ...item.identity, ...options })); this.project.assertOpen(); }
    catch (error) { this.items.delete(itemId); throw error; }
  }
  get(id: string) { return this.items.get(id); }
  async close(id: string) { const item = this.items.get(id); if (!item) return true; await item.close(); this.items.delete(id); return true; }
  dispose() { this.cleanup.forEach((cleanup) => cleanup()); this.cleanup = []; this.items.clear(); }
}

export function projectItemHosts(project: AuxiliaryWorkbenchProject) {
  return project.getResource("item-hosts", () => new HostedItemPool(project));
}
