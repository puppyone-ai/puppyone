import type { ItemHostBridge, ItemHostConfiguration, ItemHostEvent, ItemHostFocus, ItemHostGeometry, ItemHostIdentity, ItemHostState } from "../../../../../shared/item-host-contract/types";
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
  private presentationId = 0;
  private bound = false;
  private geometryRevision = 0;
  private geometry: ItemHostGeometry | null = null;
  private focusPending = false;
  constructor(readonly identity: ItemHostIdentity, readonly bridge: ItemHostBridge) {
    this.state = { itemId: identity.itemId, generation: "", display: "starting", execution: "idle" };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  subscribeActivity = (listener: (active: boolean) => void) => {
    this.activityListeners.add(listener); listener(this.activity);
    return () => { this.activityListeners.delete(listener); };
  };
  update(state: ItemHostState) {
    const changed = state.generation !== this.state.generation;
    this.state = state;
    if (state.display === "closed") this.bound = false;
    if (changed) {
      this.configurationSignature = "";
      this.focusPending = false;
      this.publishGeometry();
    }
    this.listeners.forEach((listener) => listener());
  }
  event(event: ItemHostEvent) {
    if (event.generation !== this.state.generation) return;
    if (event.type === "focus-changed") {
      const focus = event.payload as ItemHostFocus;
      if (!this.bound || focus.presentationId !== this.presentationId || !this.geometry?.visible) return;
    }
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
  private get presentationIdentity() {
    return { ...this.identity, generation: this.state.generation, presentationId: this.presentationId };
  }
  private publishGeometry() {
    if (!this.geometry || !this.state.generation) return;
    this.bridge.setGeometry({ ...this.presentationIdentity, ...this.geometry, revision: ++this.geometryRevision });
    if (this.bound && this.geometry.visible && this.focusPending) {
      this.focusPending = false;
      this.bridge.focus(this.presentationIdentity);
    }
  }
  /** The item owns ordering; a React mount only borrows revocable presentation rights. */
  bindPresentation() {
    const id = ++this.presentationId;
    this.bound = true;
    this.geometry = null;
    this.configurationSignature = "";
    this.focusPending = false;
    const current = () => this.bound && id === this.presentationId;
    return {
      geometry: (geometry: ItemHostGeometry) => {
        if (!current()) return;
        this.geometry = geometry;
        this.publishGeometry();
      },
      configure: (configuration: ItemHostConfiguration) => current() ? this.configure(configuration) : Promise.resolve(),
      focus: () => {
        if (!current()) return;
        if (this.geometry?.visible) this.bridge.focus(this.presentationIdentity);
        else this.focusPending = true;
      },
      release: () => {
        if (!current()) return;
        this.releasePresentation();
      },
    };
  }
  private configure(configuration: ItemHostConfiguration) {
    const signature = JSON.stringify(configuration);
    if (signature === this.configurationSignature) return Promise.resolve();
    const identity = this.presentationIdentity;
    return this.bridge.configure({ ...identity, ...configuration }).then(() => {
      if (identity.presentationId === this.presentationId && identity.generation === this.state.generation) this.configurationSignature = signature;
    });
  }
  async close() { await this.bridge.close(this.identity); return true; }
  async recover() { this.update(await this.bridge.recover(this.identity)); }
  private releasePresentation() {
    if (!this.bound) return;
    this.bound = false;
    this.focusPending = false;
    if (this.geometry) { this.geometry = { ...this.geometry, visible: false }; this.publishGeometry(); }
    void this.configure({ presented: false, commandTarget: false }).catch(() => {});
  }
  dispose() {
    this.releasePresentation();
    this.focusPending = false; this.geometry = null;
    this.listeners.clear(); this.eventListeners.clear(); this.activityListeners.clear();
  }
}

/** Shell resources are lightweight proxies; content/controllers live elsewhere. */
class HostedItemPool {
  private items = new Map<string, HostedItem>();
  private cleanup: Array<() => void>;
  private readonly bridge: ItemHostBridge;
  private focusSequence = 0;
  constructor(private readonly project: AuxiliaryWorkbenchProject) {
    const bridge = window.puppyoneDesktop?.itemHosts;
    if (!bridge) throw new Error("Isolated item hosting is unavailable.");
    this.bridge = bridge;
    this.cleanup = [
      bridge.onState((state) => this.items.get(state.itemId)?.update(state)),
      bridge.onEvent((event) => {
        if (event.type === "focus-changed") {
          const { sequence } = event.payload as ItemHostFocus;
          if (!Number.isSafeInteger(sequence) || sequence <= this.focusSequence) return;
          this.focusSequence = sequence;
        }
        this.items.get(event.itemId)?.event(event);
      }),
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
  async close(id: string) { const item = this.items.get(id); if (!item) return true; await item.close(); item.dispose(); this.items.delete(id); return true; }
  dispose() { this.cleanup.forEach((cleanup) => cleanup()); this.cleanup = []; this.items.forEach((item) => item.dispose()); this.items.clear(); }
}

export function projectItemHosts(project: AuxiliaryWorkbenchProject) {
  return project.getResource("item-hosts", () => new HostedItemPool(project));
}
