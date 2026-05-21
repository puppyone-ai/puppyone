'use client';

/**
 * Version WebSocket React bindings — gives any component inside the
 * provider a typed hook to subscribe to ``commit_update`` events for
 * the currently-focused project.
 *
 * Usage:
 *
 *     <VersionWebSocketProvider projectId={projectId}>
 *       …app tree…
 *     </VersionWebSocketProvider>
 *
 *     // inside a child component:
 *     useCommitUpdates((event) => {
 *       if (event.scope === '' || event.scope.startsWith(myScope)) {
 *         mutate(['project-history', projectId]);
 *       }
 *     });
 *
 * The hook re-registers when ``handler`` identity changes, so callers
 * should memoise (``useCallback``) handlers that close over local
 * state — otherwise every render reconnects the listener.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import {
  type CommitUpdateEvent,
  type VersionNotification,
  type VersionNotificationHandler,
  subscribeVersionNotifications,
} from '@/lib/versionWebSocketClient';

interface VersionWebSocketContextValue {
  projectId: string;
}

const VersionWebSocketContext = createContext<VersionWebSocketContextValue | null>(null);

interface ProviderProps {
  projectId: string;
  children: ReactNode;
}

export function VersionWebSocketProvider({ projectId, children }: ProviderProps) {
  return (
    <VersionWebSocketContext.Provider value={{ projectId }}>
      {children}
    </VersionWebSocketContext.Provider>
  );
}

function _useProjectId(): string | null {
  const ctx = useContext(VersionWebSocketContext);
  return ctx?.projectId ?? null;
}

/**
 * Subscribe to every push event for the project in the surrounding
 * provider. ``handler`` is invoked synchronously on each frame.
 *
 * Pass a ``useCallback``-stable handler so the subscription doesn't
 * thrash on every parent re-render. The hook still tolerates an
 * unstable handler — it lazily updates a ref and the underlying
 * subscription stays open across renders — but stable handlers make
 * the data flow easier to reason about.
 */
export function useVersionNotifications(handler: VersionNotificationHandler): void {
  const projectId = _useProjectId();
  const handlerRef = useRef<VersionNotificationHandler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!projectId) return;
    const dispatch = (event: VersionNotification) => {
      handlerRef.current(event);
    };
    return subscribeVersionNotifications(projectId, dispatch);
  }, [projectId]);
}

/**
 * Convenience hook: only fires for ``commit_update`` events. Other
 * frame types are silently filtered.
 */
export function useCommitUpdates(
  handler: (event: CommitUpdateEvent) => void,
): void {
  useVersionNotifications((event) => {
    if (event.type === 'commit_update') {
      handler(event as CommitUpdateEvent);
    }
  });
}
