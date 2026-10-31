"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";

export type EditorPaneMenuCommand = Readonly<{
  kind: "command";
  id: string;
  label: string;
  disabled?: boolean;
  run: () => void;
}>;

export type EditorPaneMenuToggle = Readonly<{
  kind: "toggle";
  id: string;
  label: string;
  checked: boolean;
  setChecked: (checked: boolean) => void;
}>;

export type EditorPaneMenuSegmentedOption = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
}>;

export type EditorPaneMenuSegmentedControl = Readonly<{
  kind: "segmented";
  id: string;
  label: string;
  value: string;
  options: readonly EditorPaneMenuSegmentedOption[];
  setValue: (value: string) => void;
}>;

export type EditorPaneMenuItem =
  | EditorPaneMenuCommand
  | EditorPaneMenuToggle
  | EditorPaneMenuSegmentedControl;

export type EditorPaneMenuContribution = Readonly<{
  documentId: string;
  viewItems: readonly EditorPaneMenuItem[];
}>;

type EditorPaneMenuContributionPublisher = (
  contribution: EditorPaneMenuContribution | null,
) => void;

type EditorPaneMenuContributionRegistry = Readonly<{
  publish: (
    owner: symbol,
    contribution: EditorPaneMenuContribution | null,
  ) => void;
}>;

const EditorPaneMenuContributionContext = createContext<
  EditorPaneMenuContributionRegistry | null
>(null);

export function EditorPaneMenuContributionProvider({
  children,
  onContributionChange,
}: Readonly<{
  children: ReactNode;
  onContributionChange: EditorPaneMenuContributionPublisher;
}>) {
  const activeOwnerRef = useRef<symbol | null>(null);
  const publish = useCallback((
    owner: symbol,
    contribution: EditorPaneMenuContribution | null,
  ) => {
    if (contribution) {
      activeOwnerRef.current = owner;
      onContributionChange(contribution);
      return;
    }
    if (activeOwnerRef.current !== owner) return;
    activeOwnerRef.current = null;
    onContributionChange(null);
  }, [onContributionChange]);
  const registry = useMemo<EditorPaneMenuContributionRegistry>(
    () => ({ publish }),
    [publish],
  );

  return (
    <EditorPaneMenuContributionContext.Provider value={registry}>
      {children}
    </EditorPaneMenuContributionContext.Provider>
  );
}

export function useEditorPaneMenuContributionPublisher() {
  const registry = useContext(EditorPaneMenuContributionContext);
  const ownerRef = useRef(Symbol("editor-pane-menu-contribution"));
  const publish = useCallback<EditorPaneMenuContributionPublisher>(
    (contribution) => registry?.publish(ownerRef.current, contribution),
    [registry],
  );
  return registry ? publish : null;
}
