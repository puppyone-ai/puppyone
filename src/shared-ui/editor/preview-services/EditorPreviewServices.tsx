import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { EditorPreviewServices } from "./types";
const Context = createContext<{ services?: EditorPreviewServices; revision: number }>({ revision: 0 });
export function EditorPreviewServicesBoundary({ services, revision = 0, children }: {
  services?: EditorPreviewServices; revision?: number; children: ReactNode;
}) {
  const value = useMemo(() => ({ services, revision }), [services, revision]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useEditorPreviewServices() { return useContext(Context); }
