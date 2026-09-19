import { useEffect, useSyncExternalStore } from "react";
import { ModelConnectionStore } from "../application/ModelConnectionStore";
import { modelConnectionClient } from "../infrastructure/electron/modelConnectionClient";

const sharedStore = new ModelConnectionStore(modelConnectionClient);
export function useModelConnections(store = sharedStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.connect(), [store]);
  return { state, store };
}
