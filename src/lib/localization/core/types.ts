export const APP_LOCALES = [
  "en",
  "es",
  "pt-BR",
  "fr",
  "de",
  "ja",
  "ko",
  "zh-Hans",
] as const;

export type AppLocale = (typeof APP_LOCALES)[number];
export type AppLanguagePreference = "system" | AppLocale;
export type AppTextDirection = "ltr" | "rtl";

export type LocaleState = Readonly<{
  preference: AppLanguagePreference;
  locale: AppLocale;
  direction: AppTextDirection;
  systemLanguages: readonly string[];
}>;

export type LocaleDescriptor = Readonly<{
  locale: AppLocale;
  label: string;
  direction: AppTextDirection;
  aliases: readonly string[];
  matchLanguage: boolean;
  matchScript?: string;
  productionReady: boolean;
}>;

export type LocaleCatalog = Readonly<Record<string, string>>;
export type MessageValue = string | number | bigint | boolean | null | undefined | Date;
export type MessageValues = Readonly<Record<string, MessageValue>>;

export type LocalizationDiagnostic = Readonly<{
  code: "missing-message" | "invalid-message" | "catalog-load-failed";
  locale: AppLocale;
  messageId?: string;
  error?: unknown;
}>;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

export function isAppLanguagePreference(value: unknown): value is AppLanguagePreference {
  return value === "system" || isAppLocale(value);
}
