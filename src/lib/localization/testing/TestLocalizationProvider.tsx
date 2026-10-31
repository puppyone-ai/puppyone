import { useMemo, type ReactNode } from "react";
import {
  getLocaleDescriptor,
  mergeCatalogNamespaces,
  resolveLocaleState,
  type AppLocale,
  type LocaleCatalog,
} from "../core";
import {
  LocalizationProvider,
  type LocaleCatalogLoader,
  type LocaleClient,
} from "../react";

const defaultMessages = mergeCatalogNamespaces({
  common: {
    messageUnavailable: "This text is unavailable.",
  },
});

export function TestLocalizationProvider({
  children,
  locale = "en",
  messages = defaultMessages,
}: {
  children: ReactNode;
  locale?: AppLocale;
  messages?: LocaleCatalog;
}) {
  const state = useMemo(() => Object.freeze({
    ...resolveLocaleState(locale, [locale]),
    preference: locale,
    direction: getLocaleDescriptor(locale).direction,
  }), [locale]);
  const client = useMemo<LocaleClient>(() => ({
    async setLanguagePreference() {
      return state;
    },
    onLocaleChanged() {
      return () => undefined;
    },
  }), [state]);
  const loadCatalog = useMemo<LocaleCatalogLoader>(() => async () => ({
    catalog: messages,
    fallbackCatalog: messages,
  }), [messages]);

  return (
    <LocalizationProvider
      initialState={state}
      initialCatalog={messages}
      fallbackCatalog={messages}
      loadCatalog={loadCatalog}
      client={client}
    >
      {children}
    </LocalizationProvider>
  );
}
