import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { retainTextSelectionAppearance } from "./textSelectionAppearance";

// This context deliberately carries no product theme ID, catalog, or token
// payload. Hosts only signal that inherited appearance metrics changed so a
// reusable editor can remeasure without knowing who supplied the styling.
const EditorAppearanceRevisionContext = createContext<string>("default");

export function EditorAppearanceProvider({
  children,
  revision,
}: {
  children: ReactNode;
  revision: string;
}) {
  useLayoutEffect(() => retainTextSelectionAppearance(document), []);
  return (
    <EditorAppearanceRevisionContext.Provider value={revision}>
      {children}
    </EditorAppearanceRevisionContext.Provider>
  );
}

export function useEditorAppearanceRevision(): string {
  return useContext(EditorAppearanceRevisionContext);
}
