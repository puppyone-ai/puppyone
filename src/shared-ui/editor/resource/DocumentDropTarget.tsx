import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

/** One entry a pane can hand to a document target instead of splitting. */
export type DocumentDropPayload =
  | Readonly<{ kind: "workspace-entry"; path: string; name: string }>
  | Readonly<{ kind: "file"; file: File }>;

export type DocumentDropTargetRegistration = Readonly<{
  /** Hit test in client coordinates. Only the document surface may answer. */
  containsPoint(clientX: number, clientY: number): boolean;
  /** Returns whether the target claimed the payload. `false` falls back to the
   * pane's own drop behaviour; a rejection means the target claimed it and the
   * document could not be changed. */
  insert(payload: DocumentDropPayload): Promise<boolean>;
}>;

/**
 * Later registrations win. A pane renders one editor at a time, but the
 * controller is constructed above the pane tree, so preference follows mount
 * order rather than geometry.
 */
export type DocumentDropRegistry = Readonly<{
  install(registration: DocumentDropTargetRegistration): () => void;
  find(clientX: number, clientY: number): DocumentDropTargetRegistration | null;
}>;

export function createDocumentDropRegistry(): DocumentDropRegistry {
  const registrations = new Map<symbol, DocumentDropTargetRegistration>();
  return {
    install(registration) {
      const key = Symbol("document-drop-target");
      registrations.set(key, registration);
      // Idempotent: a second dispose never removes a newer registration.
      return () => {
        registrations.delete(key);
      };
    },
    find(clientX, clientY) {
      const entries = [...registrations.values()];
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const registration = entries[index]!;
        if (registration.containsPoint(clientX, clientY)) return registration;
      }
      return null;
    },
  };
}

const Context = createContext<DocumentDropRegistry | null>(null);

export function DocumentDropTargetProvider({
  registry,
  children,
}: {
  registry: DocumentDropRegistry | null;
  children: ReactNode;
}) {
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}

/**
 * Installs the caller's registration while it is non-null. Callbacks are read
 * through a ref so an unstable registration object does not re-install on
 * every render.
 */
export function useRegisterDocumentDropTarget(
  registration: DocumentDropTargetRegistration | null,
): void {
  const registry = useContext(Context);
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const active = registration !== null;
  useEffect(() => {
    if (!registry || !active) return undefined;
    return registry.install({
      containsPoint: (clientX, clientY) => (
        registrationRef.current?.containsPoint(clientX, clientY) ?? false
      ),
      insert: (payload) => (
        registrationRef.current?.insert(payload) ?? Promise.resolve(false)
      ),
    });
  }, [active, registry]);
}
