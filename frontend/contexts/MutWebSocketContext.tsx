'use client';

/**
 * MUT WebSocket React bindings — gives any component inside the
 * provider a typed hook to subscribe to ``commit_update`` events for
 * the currently-focused project.
 *
 * Usage:
 *
 *     <MutWebSocketProvider projectId={projectId}>
 *       …app tree…
 *     </MutWebSocketProvider>
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
  type MutNotification,
  type MutNotificationHandler,
  subscribeMutNotifications,
} from '@/lib/mutWebSocketClient';

interface MutWebSocketContextValue {
  projectId: string;
}

const MutWebSocketContext = createContext<MutWebSocketContextValue | null>(null);

interface ProviderProps {
  projectId: string;
  children: ReactNode;
}

export function MutWebSocketProvider({ projectId, children }: ProviderProps) {
  return (
    <MutWebSocketContext.Provider value={{ projectId }}>
      {children}
    </MutWebSocketContext.Provider>
  );
}

function _useProjectId(): string | null {
  const ctx = useContext(MutWebSocketContext);
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
export function useMutNotifications(handler: MutNotificationHandler): void {
  const projectId = _useProjectId();
  const handlerRef = useRef<MutNotificationHandler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!projectId) return;
    const dispatch = (event: MutNotification) => {
      handlerRef.current(event);
    };
    return subscribeMutNotifications(projectId, dispatch);
  }, [projectId]);
}

/**
 * Convenience hook: only fires for ``commit_update`` events. Other
 * frame types are silently filtered.
 */
export function useCommitUpdates(
  handler: (event: CommitUpdateEvent) => void,
): void {
  useMutNotifications((event) => {
    if (event.type === 'commit_update') {
      handler(event as CommitUpdateEvent);
    }
  });
}
