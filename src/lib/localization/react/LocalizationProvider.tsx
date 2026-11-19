import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LOCALE_DESCRIPTORS,
  createLocaleFormatters,
  createMessageFormatter,
  type AppLanguagePreference,
  type LocaleCatalog,
  type LocaleFormatters,
  type LocaleState,
  type LocalizationDiagnostic,
  type MessageFormatter,
} from "../core";

export type LocalizationStatus = "ready" | "changing" | "error";

export type LocaleCatalogBundle = Readonly<{
  catalog: LocaleCatalog;
  fallbackCatalog: LocaleCatalog;
}>;

export type LocaleCatalogLoader = (
  locale: LocaleState["locale"],
) => Promise<LocaleCatalogBundle>;

export type LocaleClient = Readonly<{
  setLanguagePreference: (preference: AppLanguagePreference) => Promise<LocaleState>;
  onLocaleChanged: (callback: (state: LocaleState) => void) => () => void;
}>;

export type LocalizationContextValue = LocaleState & LocaleFormatters & Readonly<{
  localeDescriptors: typeof LOCALE_DESCRIPTORS;
  status: LocalizationStatus;
  error: Error | null;
  t: MessageFormatter;
  setLanguagePreference: (preference: AppLanguagePreference) => Promise<void>;
}>;

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

type LocalizationModel = {
  state: LocaleState;
  catalog: LocaleCatalog;
  fallbackCatalog: LocaleCatalog;
};

function defaultDiagnosticReporter(diagnostic: LocalizationDiagnostic) {
  console.warn("Localization diagnostic", {
    code: diagnostic.code,
    locale: diagnostic.locale,
    messageId: diagnostic.messageId,
    error: diagnostic.error,
  });
}

export function LocalizationProvider({
  children,
  initialState,
  initialCatalog,
  fallbackCatalog,
  loadCatalog,
  client,
  onDiagnostic = defaultDiagnosticReporter,
}: {
  children: ReactNode;
  initialState: LocaleState;
  initialCatalog: LocaleCatalog;
  fallbackCatalog: LocaleCatalog;
  loadCatalog: LocaleCatalogLoader;
  client: LocaleClient;
  onDiagnostic?: (diagnostic: LocalizationDiagnostic) => void;
}) {
  const initialModel = useMemo<LocalizationModel>(() => ({
    state: initialState,
    catalog: initialCatalog,
    fallbackCatalog,
  }), [fallbackCatalog, initialCatalog, initialState]);
  const [model, setModel] = useState(initialModel);
  const [status, setStatus] = useState<LocalizationStatus>("ready");
  const [error, setError] = useState<Error | null>(null);
  const modelRef = useRef(initialModel);
  const transitionIdRef = useRef(0);

  const commitModel = useCallback((nextModel: LocalizationModel) => {
    modelRef.current = nextModel;
    setModel(nextModel);
    setError(null);
    setStatus("ready");
  }, []);

  const applyLocaleState = useCallback(async (nextState: LocaleState) => {
    const transitionId = ++transitionIdRef.current;
    const current = modelRef.current;
    if (nextState.locale === current.state.locale) {
      commitModel({ ...current, state: nextState });
      return;
    }

    setStatus("changing");
    try {
      const nextCatalog = await loadCatalog(nextState.locale);
      if (transitionId !== transitionIdRef.current) return;
      commitModel({
        state: nextState,
        catalog: nextCatalog.catalog,
        fallbackCatalog: nextCatalog.fallbackCatalog,
      });
    } catch (cause) {
      if (transitionId !== transitionIdRef.current) return;
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      setError(nextError);
      setStatus("error");
      onDiagnostic({
        code: "catalog-load-failed",
        locale: nextState.locale,
        error: cause,
      });
      throw nextError;
    }
  }, [commitModel, loadCatalog, onDiagnostic]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = model.state.locale;
    root.dir = model.state.direction;
    root.dataset.locale = model.state.locale;
    root.dataset.languagePreference = model.state.preference;
  }, [model.state]);

  useLayoutEffect(() => client.onLocaleChanged((nextState) => {
    void applyLocaleState(nextState).catch(() => {
      // The previous complete catalog remains active. The diagnostic hook owns reporting.
    });
  }), [applyLocaleState, client]);

  const setLanguagePreference = useCallback(async (preference: AppLanguagePreference) => {
    setStatus("changing");
    setError(null);
    try {
      const nextState = await client.setLanguagePreference(preference);
      await applyLocaleState(nextState);
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      setError(nextError);
      setStatus("error");
      throw nextError;
    }
  }, [applyLocaleState, client]);

  const t = useMemo(() => createMessageFormatter({
    locale: model.state.locale,
    catalog: model.catalog,
    fallbackCatalog: model.fallbackCatalog,
    onDiagnostic,
  }), [model.catalog, model.fallbackCatalog, model.state.locale, onDiagnostic]);
  const formatters = useMemo(
    () => createLocaleFormatters(model.state.locale),
    [model.state.locale],
  );

  const value = useMemo<LocalizationContextValue>(() => ({
    ...model.state,
    ...formatters,
    localeDescriptors: LOCALE_DESCRIPTORS,
    status,
    error,
    t,
    setLanguagePreference,
  }), [error, formatters, model.state, setLanguagePreference, status, t]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error("useLocalization must be used inside LocalizationProvider.");
  return value;
}
