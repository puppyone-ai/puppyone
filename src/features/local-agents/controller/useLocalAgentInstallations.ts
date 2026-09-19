import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LocalAgentInstallationStore } from "../application/LocalAgentInstallationStore";

let sharedStore: LocalAgentInstallationStore | null = null;
let sharedBridge: Window["puppyoneDesktop"] | undefined;

function getSharedStore() {
  const bridge = window.puppyoneDesktop;
  if (!sharedStore || sharedBridge !== bridge) {
    sharedStore?.dispose();
    sharedBridge = bridge;
    sharedStore = new LocalAgentInstallationStore();
  }
  return sharedStore;
}

export function useLocalAgentInstallations({ enabled }: { enabled: boolean }) {
  const store = useMemo(getSharedStore, []);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { if (enabled) store.ensureLoaded(); }, [enabled, store]);
  return {
    ...snapshot,
    refresh: store.refresh,
  };
}
