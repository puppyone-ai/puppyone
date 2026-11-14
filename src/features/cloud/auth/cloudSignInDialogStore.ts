import { useSyncExternalStore } from "react";

export type CloudSignInDialogRequest = Readonly<{
  id: number;
  apiBaseUrl: string | null;
}>;

let nextRequestId = 0;
let currentRequest: CloudSignInDialogRequest | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function openCloudSignInDialog(apiBaseUrl: string | null) {
  currentRequest = { id: ++nextRequestId, apiBaseUrl };
  notifyListeners();
}

export function closeCloudSignInDialog() {
  if (!currentRequest) return;
  currentRequest = null;
  notifyListeners();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentRequest;
}

export function useCloudSignInDialogRequest() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
