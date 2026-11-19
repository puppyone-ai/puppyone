import { IntlMessageFormat } from "intl-messageformat";
import type {
  AppLocale,
  LocaleCatalog,
  LocalizationDiagnostic,
  MessageValues,
} from "./types";

export type MessageFormatter = (
  messageId: string,
  values?: MessageValues,
) => string;

export function createMessageFormatter({
  locale,
  catalog,
  fallbackCatalog,
  onDiagnostic,
}: {
  locale: AppLocale;
  catalog: LocaleCatalog;
  fallbackCatalog: LocaleCatalog;
  onDiagnostic?: (diagnostic: LocalizationDiagnostic) => void;
}): MessageFormatter {
  const compiled = new Map<string, IntlMessageFormat>();
  const reported = new Set<string>();

  const reportOnce = (diagnostic: LocalizationDiagnostic) => {
    const identity = `${diagnostic.code}:${diagnostic.messageId ?? "catalog"}`;
    if (reported.has(identity)) return;
    reported.add(identity);
    onDiagnostic?.(diagnostic);
  };

  const compile = (messageId: string, source: string, messageLocale: AppLocale) => {
    const cacheKey = `${messageLocale}:${messageId}:${source}`;
    const cached = compiled.get(cacheKey);
    if (cached) return cached;
    const formatter = new IntlMessageFormat(source, messageLocale, undefined, {
      ignoreTag: true,
    });
    compiled.set(cacheKey, formatter);
    return formatter;
  };

  return (messageId, values = {}) => {
    const localizedSource = catalog[messageId];
    const fallbackSource = fallbackCatalog[messageId];
    const source = localizedSource ?? fallbackSource;
    const messageLocale = localizedSource ? locale : "en";

    if (!source) {
      reportOnce({ code: "missing-message", locale, messageId });
      const unavailable = catalog["common.messageUnavailable"]
        ?? fallbackCatalog["common.messageUnavailable"]
        ?? "";
      return unavailable;
    }

    if (!localizedSource) {
      reportOnce({ code: "missing-message", locale, messageId });
    }

    try {
      const result = compile(messageId, source, messageLocale).format(values);
      return Array.isArray(result) ? result.join("") : String(result);
    } catch (error) {
      reportOnce({ code: "invalid-message", locale, messageId, error });
      if (source !== fallbackSource && fallbackSource) {
        try {
          const result = compile(messageId, fallbackSource, "en").format(values);
          return Array.isArray(result) ? result.join("") : String(result);
        } catch {
          // The catalog checker prevents this path in production.
        }
      }
      return fallbackCatalog["common.messageUnavailable"] ?? "";
    }
  };
}
