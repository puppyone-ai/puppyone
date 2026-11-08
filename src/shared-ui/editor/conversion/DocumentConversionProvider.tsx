import { createContext, useContext, type ReactNode } from "react";
import type { DocumentConversionPort } from "./types";

const Context = createContext<DocumentConversionPort | null>(null);
export function DocumentConversionProvider({ port, children }: { port: DocumentConversionPort | null; children: ReactNode }) {
  return <Context.Provider value={port}>{children}</Context.Provider>;
}
export function useDocumentConversionPort() { return useContext(Context); }
