import { useSyncExternalStore } from "react";
import type { HtmlFolderAccessConsentRequest } from "@puppyone/shared-ui";

type PendingConsent = Readonly<{ id: number; request: HtmlFolderAccessConsentRequest; answer: (allowed: boolean) => void }>;

let queue: readonly PendingConsent[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const publish = (next: readonly PendingConsent[]) => { queue = next; for (const listener of listeners) listener(); };

/** Pages ask one at a time; a page closed while it waits withdraws its question. */
export function requestHtmlFolderAccessConsent(request: HtmlFolderAccessConsentRequest, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const withdraw = () => { publish(queue.filter((entry) => entry.id !== id)); reject(signal.reason); };
    signal.addEventListener("abort", withdraw, { once: true });
    publish([...queue, { id, request, answer: (allowed) => {
      signal.removeEventListener("abort", withdraw);
      publish(queue.filter((entry) => entry.id !== id));
      resolve(allowed);
    } }]);
  });
}

export function useCurrentHtmlFolderAccessConsent(): PendingConsent | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => queue[0] ?? null);
}
