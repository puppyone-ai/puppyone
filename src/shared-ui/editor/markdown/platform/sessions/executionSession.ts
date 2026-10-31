import type { CapabilityPrincipal } from "../security/capabilityPrincipal";

export type ExecutionSession = {
  id: string;
  principal: CapabilityPrincipal;
  documentRevision: string;
  featureId: string;
  grantId?: string;
  dispose(): void;
};

export type ExecutionSessionStoreOptions = {
  onDestroy?: (session: ExecutionSession) => void;
};

/**
 * Revision-bound execution sessions. Authorization grants may survive edits;
 * these sessions must not. A document revision change destroys sessions for
 * the previous revision and aborts their work.
 */
export function createExecutionSessionStore(options: ExecutionSessionStoreOptions = {}) {
  const sessions = new Map<string, ExecutionSession>();
  let sequence = 0;

  return {
    create(input: {
      principal: CapabilityPrincipal;
      documentRevision: string;
      featureId?: string;
      grantId?: string;
      onDispose?: () => void;
    }): ExecutionSession {
      const id = `exec:${++sequence}`;
      const session: ExecutionSession = {
        id,
        principal: {
          ...input.principal,
          executionSessionId: id,
        },
        documentRevision: input.documentRevision,
        featureId: input.featureId ?? "embed",
        grantId: input.grantId,
        dispose() {
          if (!sessions.has(id)) return;
          sessions.delete(id);
          options.onDestroy?.(session);
          input.onDispose?.();
        },
      };
      sessions.set(id, session);
      return session;
    },

    get(id: string): ExecutionSession | undefined {
      return sessions.get(id);
    },

    destroyForRevisionChange(previousRevision: string, nextRevision?: string): ExecutionSession[] {
      const keepRevision = nextRevision ?? previousRevision;
      const destroyed: ExecutionSession[] = [];
      for (const session of Array.from(sessions.values())) {
        if (session.documentRevision !== keepRevision) {
          destroyed.push(session);
          session.dispose();
        }
      }
      return destroyed;
    },

    destroyForPrincipal(principal: CapabilityPrincipal) {
      for (const session of Array.from(sessions.values())) {
        if (
          session.principal.editorViewId === principal.editorViewId &&
          session.principal.workspaceId === principal.workspaceId &&
          session.principal.documentPath === principal.documentPath
        ) {
          session.dispose();
        }
      }
    },

    disposeAll() {
      for (const session of Array.from(sessions.values())) session.dispose();
      sessions.clear();
    },

    values() {
      return Array.from(sessions.values());
    },
  };
}

export type ExecutionSessionStore = ReturnType<typeof createExecutionSessionStore>;
