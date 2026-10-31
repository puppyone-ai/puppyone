import {
  DEFAULT_APP_LOCALE,
  SELECTABLE_LOCALE_DESCRIPTORS,
  getLocaleDescriptor,
  isSelectableAppLanguagePreference,
  isSelectableAppLocale,
} from "./manifest";
import {
  type AppLanguagePreference,
  type AppLocale,
  type LocaleState,
} from "./types";

export function canonicalizeLanguageTag(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}

function languageOf(tag: string): string | null {
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return null;
  }
}

function maximizedScriptOf(tag: string): string | null {
  try {
    return new Intl.Locale(tag).maximize().script ?? null;
  } catch {
    return null;
  }
}

const exactLocaleMatches = new Map<string, AppLocale>();
for (const descriptor of SELECTABLE_LOCALE_DESCRIPTORS) {
  const canonicalLocale = canonicalizeLanguageTag(descriptor.locale);
  if (canonicalLocale) exactLocaleMatches.set(canonicalLocale, descriptor.locale);
  for (const alias of descriptor.aliases) {
    const canonicalAlias = canonicalizeLanguageTag(alias);
    if (canonicalAlias) exactLocaleMatches.set(canonicalAlias, descriptor.locale);
  }
}

export function resolveSystemLocale(systemLanguages: readonly unknown[]): AppLocale {
  for (const candidateValue of systemLanguages) {
    const candidate = canonicalizeLanguageTag(candidateValue);
    if (!candidate) continue;

    const exact = exactLocaleMatches.get(candidate);
    if (exact) return exact;

    const language = languageOf(candidate);
    if (!language) continue;

    for (const descriptor of SELECTABLE_LOCALE_DESCRIPTORS) {
      if (descriptor.matchLanguage && languageOf(descriptor.locale) === language) {
        return descriptor.locale;
      }
      if (
        descriptor.matchScript
        && languageOf(descriptor.locale) === language
        && maximizedScriptOf(candidate) === descriptor.matchScript
      ) {
        return descriptor.locale;
      }
    }
  }
  return DEFAULT_APP_LOCALE;
}

export function normalizeSystemLanguages(values: readonly unknown[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = canonicalizeLanguageTag(value);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return Object.freeze(result);
}

export function resolveLocaleState(
  preferenceValue: unknown,
  systemLanguageValues: readonly unknown[],
): LocaleState {
  const preference: AppLanguagePreference = isSelectableAppLanguagePreference(preferenceValue)
    ? preferenceValue
    : "system";
  const systemLanguages = normalizeSystemLanguages(systemLanguageValues);
  const locale = isSelectableAppLocale(preference)
    ? preference
    : resolveSystemLocale(systemLanguages);
  return Object.freeze({
    preference,
    locale,
    direction: getLocaleDescriptor(locale).direction,
    systemLanguages,
  });
}
