import { useEffect, useSyncExternalStore } from "react";
import type { ActivationSnapshot, LocalAgentActivationBridge } from "../../../../shared/local-agent-activation/types";
import { assertActivationSnapshot } from "../../../../shared/local-agent-activation/schema.mjs";

type View = { snapshot: ActivationSnapshot; error: boolean };
const EMPTY: View = { snapshot: { epoch: "initial", revision: 0, operations: [] }, error: false };
export class LocalAgentActivationStore {
  private view = EMPTY;
  private listeners = new Set<() => void>();
  private initialized = false;
  private retiredEpochs = new Set<string>();
  constructor(readonly bridge: LocalAgentActivationBridge | undefined) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private notify = () => { for (const listener of this.listeners) listener(); };
  accept = (input: ActivationSnapshot) => {
    const snapshot = assertActivationSnapshot(input);
    const previous = this.view.snapshot;
    if (this.retiredEpochs.has(snapshot.epoch) || (snapshot.epoch === previous.epoch && snapshot.revision < previous.revision)) return;
    if (snapshot.epoch !== previous.epoch) this.retiredEpochs.add(previous.epoch);
    this.view = { snapshot, error: false }; this.notify();
  };
  ensureLoaded = () => {
    if (this.initialized || !this.bridge) return;
    this.initialized = true;
    // The bridge belongs to this renderer window, not to one sidebar mount.
    this.bridge.subscribe(snapshot => { try { this.accept(snapshot); } catch { this.fail(); } });
    void this.refresh();
  };
  private fail = () => { this.view = { ...this.view, error: true }; this.notify(); };
  refresh = async () => {
    if (!this.bridge) return;
    try { this.accept(await this.bridge.read()); } catch { this.fail(); }
  };
  start = async (planId: string) => {
    if (!this.bridge) throw new Error("Activation unavailable");
    this.accept(await this.bridge.start({ planId }));
  };
  act = async (operationId: string, action: Parameters<LocalAgentActivationBridge["act"]>[0]["action"]) => {
    if (!this.bridge) throw new Error("Activation unavailable");
    this.accept(await this.bridge.act({ operationId, action }));
  };
}
const stores = new WeakMap<LocalAgentActivationBridge, LocalAgentActivationStore>();
const unavailable = new LocalAgentActivationStore(undefined);
export function useLocalAgentActivation() {
  const bridge = window.puppyoneDesktop?.localAgentActivation;
  let store = bridge ? stores.get(bridge) : unavailable;
  if (!store) { store = new LocalAgentActivationStore(bridge); stores.set(bridge!, store); }
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.ensureLoaded(), [store]);
  return { ...view, store, supported: Boolean(bridge) };
}
