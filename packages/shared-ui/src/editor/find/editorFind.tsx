"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";

export type EditorFindDirection = "next" | "previous";

export type EditorFindResult = Readonly<{
  current: number;
  total: number;
}>;

export type EditorFindAdapter = {
  setQuery(query: string): EditorFindResult;
  move(direction: EditorFindDirection): EditorFindResult;
  clear(): void;
  focusEditor(): void;
  subscribe?(listener: (result: EditorFindResult) => void): () => void;
};

export type EditorFindCommand = Readonly<{
  documentId: string;
  open(): void;
}>;

type EditorFindRegistration = (adapter: EditorFindAdapter) => () => void;
type EditorFindPublisher = (command: EditorFindCommand) => () => void;

const EditorFindRegistrationContext = createContext<EditorFindRegistration | null>(null);
const EditorFindCommandContext = createContext<EditorFindCommand | null>(null);
const EditorFindPublisherContext = createContext<EditorFindPublisher | null>(null);

const EMPTY_RESULT: EditorFindResult = Object.freeze({ current: 0, total: 0 });

export function EditorFindContributionProvider({
  active = true,
  children,
  onCommandChange,
}: {
  active?: boolean;
  children: ReactNode;
  onCommandChange?: (command: EditorFindCommand | null) => void;
}) {
  const upstreamPublishCommand = useContext(EditorFindPublisherContext);
  const [command, setCommand] = useState<EditorFindCommand | null>(null);
  const publishCommand = useCallback<EditorFindPublisher>((nextCommand) => {
    setCommand(nextCommand);
    return () => {
      setCommand((currentCommand) => currentCommand === nextCommand ? null : currentCommand);
    };
  }, []);
  useEffect(() => {
    if (!active || !command || !upstreamPublishCommand) return undefined;
    return upstreamPublishCommand(command);
  }, [active, command, upstreamPublishCommand]);
  useEffect(() => {
    onCommandChange?.(command);
    return () => onCommandChange?.(null);
  }, [command, onCommandChange]);
  return (
    <EditorFindPublisherContext.Provider value={publishCommand}>
      <EditorFindCommandContext.Provider value={command}>
        {children}
      </EditorFindCommandContext.Provider>
    </EditorFindPublisherContext.Provider>
  );
}

export function useEditorFindCommand(): EditorFindCommand | null {
  return useContext(EditorFindCommandContext);
}

export function useRegisterEditorFindAdapter(adapter: EditorFindAdapter | null) {
  const register = useContext(EditorFindRegistrationContext);
  useEffect(() => {
    if (!register || !adapter) return undefined;
    return register(adapter);
  }, [adapter, register]);
}

export function EditorFindHost({
  children,
  documentId,
}: {
  children: ReactNode;
  documentId: string;
}) {
  const { direction, t } = useLocalization();
  const publishCommand = useContext(EditorFindPublisherContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const adapterRef = useRef<EditorFindAdapter | null>(null);
  const [adapter, setAdapter] = useState<EditorFindAdapter | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<EditorFindResult>(EMPTY_RESULT);

  const register = useCallback<EditorFindRegistration>((nextAdapter) => {
    adapterRef.current = nextAdapter;
    setAdapter(nextAdapter);
    return () => {
      if (adapterRef.current !== nextAdapter) return;
      adapterRef.current = null;
      setAdapter((currentAdapter) => currentAdapter === nextAdapter ? null : currentAdapter);
      setOpen(false);
      setQuery("");
      setResult(EMPTY_RESULT);
    };
  }, []);

  const openFind = useCallback(() => {
    if (!adapterRef.current) return;
    setOpen(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const closeFind = useCallback((restoreFocus = true) => {
    if (restoreFocus) adapterRef.current?.focusEditor();
    adapterRef.current?.clear();
    setOpen(false);
    setResult(EMPTY_RESULT);
  }, []);

  const move = useCallback((findDirection: EditorFindDirection) => {
    const currentAdapter = adapterRef.current;
    if (!currentAdapter || !query) return;
    setResult(currentAdapter.move(findDirection));
  }, [query]);

  useEffect(() => {
    if (!adapter?.subscribe) return undefined;
    return adapter.subscribe(setResult);
  }, [adapter]);

  useEffect(() => {
    if (!adapter) return;
    setResult(adapter.setQuery(query));
  }, [adapter, query]);

  const command = useMemo<EditorFindCommand | null>(() => (
    adapter ? { documentId, open: openFind } : null
  ), [adapter, documentId, openFind]);

  useEffect(() => {
    if (!publishCommand || !command) return undefined;
    return publishCommand(command);
  }, [command, publishCommand]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const modifierPressed = event.metaKey || event.ctrlKey;
    if (modifierPressed && event.key.toLowerCase() === "f" && adapterRef.current) {
      event.preventDefault();
      event.stopPropagation();
      openFind();
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      move(event.shiftKey ? "previous" : "next");
    }
  }, [closeFind, move, open, openFind]);

  const resultLabel = query
    ? result.total > 0
      ? t("editor.find.resultCount", { current: result.current, total: result.total })
      : t("editor.find.noResults")
    : "";

  return (
    <EditorFindRegistrationContext.Provider value={register}>
      <div
        ref={rootRef}
        className="editor-find-host"
        data-find-available={adapter ? "true" : undefined}
        onKeyDownCapture={handleKeyDown}
      >
        {children}
        {open && adapter && (
          <div className="editor-find-widget" role="search" dir={direction}>
            <Search aria-hidden="true" size={14} strokeWidth={1.8} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("editor.find.placeholder")}
              aria-label={t("editor.find.label")}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="editor-find-widget__result" role="status" aria-live="polite">
              {resultLabel}
            </span>
            <button
              type="button"
              disabled={!query || result.total === 0}
              onClick={() => move("previous")}
              data-tooltip={t("editor.find.previous")}
              aria-label={t("editor.find.previous")}
            >
              <ChevronUp aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              disabled={!query || result.total === 0}
              onClick={() => move("next")}
              data-tooltip={t("editor.find.next")}
              aria-label={t("editor.find.next")}
            >
              <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => closeFind()}
              data-tooltip={t("editor.find.close")}
              aria-label={t("editor.find.close")}
            >
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
    </EditorFindRegistrationContext.Provider>
  );
}
