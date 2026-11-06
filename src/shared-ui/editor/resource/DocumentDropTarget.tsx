import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";

/** One entry a pane can hand to a document target instead of splitting. */
export type DocumentDropPayload =
  | Readonly<{ kind: "workspace-entry"; path: string; name: string }>
  | Readonly<{ kind: "file"; file: File }>;

export type DocumentDropPoint = Readonly<{ x: number; y: number }>;
/** null retires a prepared drop after admission failed. */
export type DocumentDropInsertion = (payload: DocumentDropPayload | null) => Promise<boolean>;

export type DocumentDropTargetRegistration = Readonly<{
  /** Hit test in client coordinates. Only the document surface may answer. */
  containsPoint(clientX: number, clientY: number): boolean;
  /** Display a document-owned insertion marker. False means no visible, valid
   * boundary at this point. Preview never changes document source or selection. */
  previewInsert?(point: DocumentDropPoint): boolean;
  clearInsertPreview?(): void;
  /** Capture the document and anchor synchronously at release, before native
   * admission/import. Completion returns false only for an unsupported payload;
   * retired documents consume the drop without editing or splitting. */
  prepareInsert(point: DocumentDropPoint): DocumentDropInsertion;
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
      let active = true;
      registrations.set(key, {
        containsPoint: (x, y) => active && registration.containsPoint(x, y),
        previewInsert: (point) => active && (registration.previewInsert?.(point) ?? true),
        clearInsertPreview: () => registration.clearInsertPreview?.(),
        prepareInsert(point) {
          if (!active) return async () => true;
          const complete = registration.prepareInsert(point);
          return (payload) => complete(active ? payload : null);
        },
      });
      // Idempotent: a second dispose never removes a newer registration.
      return () => {
        if (!active) return;
        active = false;
        registration.clearInsertPreview?.();
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
 * Registrations are memoized by document identity. Retire old handles during
 * commit so a pending native receipt cannot edit a replacement document.
 */
export function useRegisterDocumentDropTarget(
  registration: DocumentDropTargetRegistration | null,
): void {
  const registry = useContext(Context);
  useLayoutEffect(() => {
    if (!registry || !registration) return undefined;
    return registry.install(registration);
  }, [registration, registry]);
}
