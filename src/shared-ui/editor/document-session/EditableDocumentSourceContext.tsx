"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EditableDocumentSource } from "./types";

const EditableDocumentSourceContext = createContext<EditableDocumentSource | null>(null);

export function EditableDocumentSourceProvider({
  source,
  children,
}: {
  source: EditableDocumentSource;
  children: ReactNode;
}) {
  return (
    <EditableDocumentSourceContext.Provider value={source}>
      {children}
    </EditableDocumentSourceContext.Provider>
  );
}

/** Returns null for read-only viewers rendered outside a persistence boundary. */
export function useEditableDocumentSource(): EditableDocumentSource | null {
  return useContext(EditableDocumentSourceContext);
}
