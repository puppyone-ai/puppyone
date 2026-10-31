import rawManifest from "../../../../locales/manifest.json";
import {
  APP_LOCALES,
  type AppLanguagePreference,
  type AppLocale,
  type LocaleDescriptor,
} from "./types";

type RawLocaleDescriptor = {
  locale: string;
  label: string;
  direction: string;
  aliases?: string[];
  matchLanguage?: boolean;
  matchScript?: string;
  productionReady?: boolean;
};

type RawLocaleManifest = {
  version: number;
  defaultLocale: string;
  locales: RawLocaleDescriptor[];
};

function validateManifest(raw: RawLocaleManifest) {
  if (raw.version !== 1) throw new Error(`Unsupported locale manifest version: ${raw.version}`);
  if (raw.defaultLocale !== "en") throw new Error("The final locale fallback must remain English.");
  if (!Array.isArray(raw.locales)) throw new Error("Locale manifest entries are missing.");

  const ids = raw.locales.map((entry) => entry.locale);
  const expected = [...APP_LOCALES];
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) {
    throw new Error("Generated AppLocale values and locales/manifest.json are out of sync.");
  }
  if (new Set(ids).size !== ids.length) throw new Error("Locale manifest contains duplicate locales.");

  for (const entry of raw.locales) {
    if (!entry.label.trim()) throw new Error(`Locale ${entry.locale} has no display label.`);
    if (entry.direction !== "ltr" && entry.direction !== "rtl") {
      throw new Error(`Locale ${entry.locale} has an invalid text direction.`);
    }
  }
  if (!raw.locales.find((entry) => entry.locale === raw.defaultLocale)?.productionReady) {
    throw new Error("The final English fallback must be production-ready.");
  }
}

validateManifest(rawManifest as RawLocaleManifest);

export const DEFAULT_APP_LOCALE: AppLocale = "en";

export const LOCALE_DESCRIPTORS: readonly LocaleDescriptor[] = Object.freeze(
  (rawManifest.locales as RawLocaleDescriptor[]).map((entry) => Object.freeze({
    locale: entry.locale as AppLocale,
    label: entry.label,
    direction: entry.direction as LocaleDescriptor["direction"],
    aliases: Object.freeze([...(entry.aliases ?? [])]),
    matchLanguage: entry.matchLanguage === true,
    ...(entry.matchScript ? { matchScript: entry.matchScript } : {}),
    productionReady: entry.productionReady === true,
  })),
);

export const SELECTABLE_LOCALE_DESCRIPTORS: readonly LocaleDescriptor[] = Object.freeze(
  LOCALE_DESCRIPTORS.filter((descriptor) => descriptor.productionReady),
);

const localeDescriptorById = new Map(
  LOCALE_DESCRIPTORS.map((descriptor) => [descriptor.locale, descriptor] as const),
);

export function getLocaleDescriptor(locale: AppLocale): LocaleDescriptor {
  const descriptor = localeDescriptorById.get(locale);
  if (!descriptor) throw new Error(`Unsupported app locale: ${locale}`);
  return descriptor;
}

export function isSelectableAppLocale(value: unknown): value is AppLocale {
  return SELECTABLE_LOCALE_DESCRIPTORS.some((descriptor) => descriptor.locale === value);
}

export function isSelectableAppLanguagePreference(
  value: unknown,
): value is AppLanguagePreference {
  return value === "system" || isSelectableAppLocale(value);
}
